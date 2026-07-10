import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { ChatMessage, EventMessage, LinkableMessageType } from '../../protocol/messages.js';
import { formatMessageContent } from '../formatting.js';
import { findUnknownPlaceholders, placeholdersForType } from '../template.js';
import type { SlashCommandModule } from '../commandModule.js';

const SAMPLE_CHAT_MESSAGE: ChatMessage = {
  type: 'chat',
  entityName: 'Example Server',
  idType: 'steam',
  id: '76561198000000000',
  username: 'PlayerOne',
  message: 'hello world',
};

function sampleEventMessage(eventName: string): EventMessage {
  return {
    type: 'event',
    entityName: 'Example Server',
    event: eventName || 'Map Start',
    data: eventName ? 'sample data' : 'de_dust2',
  };
}

function sampleMessageForType(type: LinkableMessageType, eventName: string): ChatMessage | EventMessage {
  return type === 'chat' ? SAMPLE_CHAT_MESSAGE : sampleEventMessage(eventName);
}

/** Accepts "#00ff00" or "00ff00"; returns undefined for anything else. */
function parseHexColor(raw: string): number | undefined {
  const normalized = raw.trim().replace(/^#/, '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return undefined;
  }

  return parseInt(normalized, 16);
}

function describePlaceholders(type: LinkableMessageType): string {
  return placeholdersForType(type)
    .map((key) => `\`{${key}}\``)
    .join(', ');
}

/** How a (type, eventName) pair should read in a reply, e.g. "event (\"Player Kicked\")" or "chat". */
function describeTarget(type: LinkableMessageType, eventName: string): string {
  return eventName ? `${type} ("${eventName}")` : type;
}

export const formatCommand: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('format')
    .setDescription('Configure how chat/event messages are displayed in Discord')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set the display format for a message type, or a specific event')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Which message type to configure')
            .setRequired(true)
            .addChoices({ name: 'Chat', value: 'chat' }, { name: 'Event', value: 'event' }),
        )
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('Whether to render as an embed or plain text')
            .setRequired(true)
            .addChoices({ name: 'Embed', value: 'embed' }, { name: 'Plain text', value: 'plain' }),
        )
        .addStringOption((opt) =>
          opt
            .setName('template')
            .setDescription('Template string, e.g. [{username}]({profileUrl}): {message}. Use \\n for a line break.')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('event')
            .setDescription('Event type only: override just this event name (e.g. "Player Kicked"), instead of the type default')
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('Embed color as hex, e.g. #00ff00 (only used in embed mode)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Show the current format for a message type, or a specific event')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Which message type to inspect')
            .setRequired(true)
            .addChoices({ name: 'Chat', value: 'chat' }, { name: 'Event', value: 'event' }),
        )
        .addStringOption((opt) =>
          opt
            .setName('event')
            .setDescription('Event type only: inspect this specific event name instead of the type default')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Revert a message type, or a specific event, to the default embed')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Which message type to reset')
            .setRequired(true)
            .addChoices({ name: 'Chat', value: 'chat' }, { name: 'Event', value: 'event' }),
        )
        .addStringOption((opt) =>
          opt
            .setName('event')
            .setDescription('Event type only: reset this specific event name instead of the type default')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List every configured format override, including per-event ones'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('placeholders')
        .setDescription('List the valid {placeholders} for a message type')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Which message type to list placeholders for')
            .setRequired(true)
            .addChoices({ name: 'Chat', value: 'chat' }, { name: 'Event', value: 'event' }),
        ),
    ),

  async execute(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const settings = ctx.store.formatSettings.list();

      if (settings.length === 0) {
        await interaction.reply({
          content: 'No custom formats configured. Every message type is using its default embed.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const lines = settings.map(
        (setting) =>
          `**${describeTarget(setting.messageType, setting.eventName)}**: ${
            setting.useEmbed ? 'embed' : 'plain text'
          }, \`${setting.template}\``,
      );

      await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
      return;
    }

    const type = interaction.options.getString('type', true) as LinkableMessageType;

    if (subcommand === 'placeholders') {
      await interaction.reply({
        content: `Valid placeholders for **${type}**: ${describePlaceholders(type)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eventName = interaction.options.getString('event')?.trim() ?? '';

    if (eventName && type !== 'event') {
      await interaction.reply({
        content: 'The `event` option only applies to type **event**. Chat messages don\'t have event names.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'set') {
      const mode = interaction.options.getString('mode', true);
      const template = interaction.options.getString('template', true);
      const colorRaw = interaction.options.getString('color');

      const unknownPlaceholders = findUnknownPlaceholders(template, placeholdersForType(type));

      if (unknownPlaceholders.length > 0) {
        await interaction.reply({
          content: [
            `Unknown placeholder(s): ${unknownPlaceholders.map((key) => `\`{${key}}\``).join(', ')}.`,
            `Valid placeholders for **${type}**: ${describePlaceholders(type)}`,
          ].join('\n'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let color: number | undefined;

      if (colorRaw) {
        color = parseHexColor(colorRaw);

        if (color === undefined) {
          await interaction.reply({
            content: `Invalid color \`${colorRaw}\`. Use a hex value like \`#00ff00\` or \`00ff00\`.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      const setting = ctx.store.formatSettings.set(
        type,
        eventName,
        color === undefined ? { useEmbed: mode === 'embed', template } : { useEmbed: mode === 'embed', template, color },
      );

      const preview = formatMessageContent(sampleMessageForType(type, eventName), setting);

      await interaction.reply({
        content: `Saved **${describeTarget(type, eventName)}** format in **${mode}** mode. Preview with sample data:`,
        embeds:
          setting.useEmbed && preview.embeds
            ? preview.embeds
            : [new EmbedBuilder().setTitle('Preview (plain text)').setDescription(preview.content || '\u200b')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'show') {
      const setting = ctx.store.formatSettings.get(type, eventName);

      if (!setting) {
        await interaction.reply({
          content: `No custom format configured for **${describeTarget(type, eventName)}**, so the default embed is used.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: [
          `**${describeTarget(type, eventName)}** format: **${setting.useEmbed ? 'embed' : 'plain text'}** mode`,
          `Template: \`${setting.template}\``,
          setting.color !== undefined
            ? `Color: #${setting.color.toString(16).padStart(6, '0')}`
            : undefined,
        ]
          .filter((line): line is string => line !== undefined)
          .join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'reset') {
      const wasReset = ctx.store.formatSettings.reset(type, eventName);

      await interaction.reply({
        content: wasReset
          ? `Reset **${describeTarget(type, eventName)}** to the default embed.`
          : `**${describeTarget(type, eventName)}** was already using the default embed.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
