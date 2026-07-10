import type { Interaction, Message } from 'discord.js';
import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { isLinkableRelayMessage, type ChatMessage, type RelayMessage } from '../protocol/messages.js';
import type { Store } from '../store/store.js';
import { commands } from './commands/index.js';
import type { BotContext } from './context.js';
import { formatMessageContent } from './formatting.js';
import { registerCommands } from './registerCommands.js';

export type IncomingMessageHandler = (senderId: string, message: RelayMessage) => void;

export interface DiscordBotOptions {
  readonly token: string;
  readonly clientId: string;
  readonly guildId: string | undefined;
  readonly store: Store;
  readonly onMessage: IncomingMessageHandler;
  readonly onLog?: (message: string) => void;
}

/**
 * Discord-side transport and admin surface: bridges channel messages
 * to/from the relay, and hosts the /node, /link, /filter slash commands.
 * Like RelayServer, this has no knowledge of routing/Links itself -- the
 * app entry point wires `onMessage` to the Router and calls
 * `deliverToChannel` with the Router's resolved destinations.
 */
export class DiscordBot {
  private readonly client: Client;
  private readonly ctx: BotContext;
  private readonly onMessage: IncomingMessageHandler;
  private readonly log: (message: string) => void;
  private readonly options: DiscordBotOptions;

  public constructor(options: DiscordBotOptions) {
    this.options = options;
    this.ctx = { store: options.store };
    this.onMessage = options.onMessage;
    this.log = options.onLog ?? (() => {});

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.on(Events.ClientReady, (client) => {
      this.log(`Discord bot logged in as ${client.user.tag}`);
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteraction(interaction);
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessageCreate(message);
    });
  }

  public async start(): Promise<void> {
    await registerCommands(this.options.token, this.options.clientId, this.options.guildId);
    await this.client.login(this.options.token);
  }

  public async stop(): Promise<void> {
    await this.client.destroy();
  }

  /** Delivers a relay message to a Discord channel. Returns whether it was sent. */
  public async deliverToChannel(channelId: string, message: RelayMessage): Promise<boolean> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);

    if (!channel?.isSendable()) {
      return false;
    }

    // Format settings are global (not per-channel). A "event" message resolves
    // its specific event name first (e.g. "Player Kicked"), falling back to
    // the type's generic default when no override is configured for it.
    const setting = isLinkableRelayMessage(message)
      ? this.options.store.formatSettings.resolve(
          message.type,
          message.type === 'event' ? message.event : undefined,
        )
      : undefined;

    await channel.send(formatMessageContent(message, setting));
    return true;
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      const command = commands.find((c) => c.data.name === interaction.commandName);

      if (!command) {
        return;
      }

      try {
        await command.execute(interaction, this.ctx);
      } catch (error) {
        this.log(`Command "${interaction.commandName}" failed: ${String(error)}`);

        const errorReply = {
          content: 'Something went wrong running that command.',
          flags: MessageFlags.Ephemeral,
        } as const;

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply);
        } else {
          await interaction.reply(errorReply);
        }
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = commands.find((c) => c.data.name === interaction.commandName);

      try {
        await command?.autocomplete?.(interaction, this.ctx);
      } catch (error) {
        this.log(`Autocomplete for "${interaction.commandName}" failed: ${String(error)}`);
      }
    }
  }

  private handleMessageCreate(message: Message): void {
    if (message.author.bot || !message.guild) {
      return;
    }

    const node = this.options.store.nodes.getById(message.channelId);

    if (!node) {
      // Channel hasn't been linked via /link create -- nothing to relay.
      return;
    }

    const chatMessage: ChatMessage = {
      type: 'chat',
      entityName: node.displayName || message.channel.toString(),
      idType: 'discord',
      id: message.author.id,
      username: message.member?.displayName ?? message.author.username,
      message: message.cleanContent,
    };

    this.onMessage(node.id, chatMessage);
  }
}
