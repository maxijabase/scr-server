import type { Interaction, Message } from 'discord.js';
import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import {
  isLinkableRelayMessage,
  type ChatMessage,
  type CommandMessage,
  type RelayMessage,
} from '../protocol/messages.js';
import type { Store } from '../store/store.js';
import { commands } from './commands/index.js';
import type { BotContext } from './context.js';
import { formatMessageContent } from './formatting.js';
import { registerCommands } from './registerCommands.js';

export type IncomingMessageHandler = (senderId: string, message: RelayMessage) => void;
export type OutgoingCommandHandler = (channelNodeId: string, message: CommandMessage) => void;

/** Prefix that marks a Discord message as a server command rather than chat. */
const COMMAND_PREFIX = '!';

/** Discord's hard message content limit, minus room for the surrounding ``` fence. */
const MAX_COMMAND_OUTPUT_LENGTH = 1990;

export interface DiscordBotOptions {
  readonly token: string;
  readonly clientId: string;
  readonly guildId: string | undefined;
  /** Discord user id of the bot owner. Always authorized for !commands and /op. */
  readonly ownerId: string | undefined;
  readonly store: Store;
  readonly onMessage: IncomingMessageHandler;
  readonly onCommand: OutgoingCommandHandler;
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
    this.ctx = { store: options.store, ownerId: options.ownerId };
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

  /**
   * Delivers a game server's captured `ServerCommandEx()` output (see
   * `CommandResponseMessage`) to the Discord channel that issued the
   * command, enclosed in triple backticks. Bypasses `/format` templates --
   * command output is raw console text, not a chat/event message.
   */
  public async deliverCommandOutput(channelId: string, output: string): Promise<boolean> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);

    if (!channel?.isSendable()) {
      return false;
    }

    const trimmed = output.trim();
    const body =
      trimmed.length > MAX_COMMAND_OUTPUT_LENGTH
        ? `${trimmed.slice(0, MAX_COMMAND_OUTPUT_LENGTH)}\n... (truncated)`
        : trimmed;

    await channel.send({ content: `\`\`\`\n${body.length > 0 ? body : '(no output)'}\n\`\`\`` });
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

    // "!"-prefixed messages are always treated as server commands, never as
    // chat -- regardless of whether the sender turns out to be authorized,
    // so they're never accidentally relayed into the game as a message.
    if (message.cleanContent.startsWith(COMMAND_PREFIX)) {
      void this.handleCommandMessage(message, node.id);
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

  /** True if the message's author is the bot owner, an authorized operator, or holds an authorized operator role. */
  private isAuthorizedOperator(message: Message): boolean {
    if (this.options.ownerId && message.author.id === this.options.ownerId) {
      return true;
    }

    const roleIds = message.member ? Array.from(message.member.roles.cache.keys()) : [];

    return this.options.store.operators.isAuthorizedForUser(message.author.id, roleIds);
  }

  /** Dispatches a "!"-prefixed message as a server command if the sender is authorized. */
  private async handleCommandMessage(message: Message, channelNodeId: string): Promise<void> {
    const command = message.cleanContent.slice(COMMAND_PREFIX.length).trim();

    if (!this.isAuthorizedOperator(message)) {
      await message.react('❌').catch(() => {});
      return;
    }

    if (command.length === 0) {
      await message.react('❌').catch(() => {});
      return;
    }

    const commandMessage: CommandMessage = {
      type: 'command',
      command,
      issuedBy: message.author.id,
      replyTo: channelNodeId,
    };

    this.options.onCommand(channelNodeId, commandMessage);

    await message.react('✅').catch(() => {});
  }
}
