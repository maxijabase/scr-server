import { EmbedBuilder } from 'discord.js';
import {
  isKnownRelayMessage,
  isLinkableRelayMessage,
  type RelayMessage,
} from '../protocol/messages.js';
import type { FormatSettingRecord } from '../store/types.js';
import { buildTemplateContext, renderTemplate, unescapeTemplate } from './template.js';

const CHAT_COLOR = 0x1db954;
const EVENT_COLOR = 0xe1c15c;
const UNKNOWN_COLOR = 0x99aab5;

/**
 * Renders a relay message as a Discord embed.
 *
 * This is the built-in default renderer, used whenever no admin-configured
 * `/format` setting exists for a message's type (see
 * {@link formatMessageContent}, which is what callers should normally use).
 * Unknown message types still get a reasonable generic embed rather than
 * being dropped, so forwarding a not-yet-understood message type doesn't
 * silently disappear.
 */
export function formatMessageEmbed(message: RelayMessage): EmbedBuilder {
  if (!isKnownRelayMessage(message)) {
    const embed = new EmbedBuilder().setColor(UNKNOWN_COLOR).setTimestamp();

    embed.setTitle(message.type);

    for (const [key, value] of Object.entries(message.payload)) {
      if (key === 'type') continue;

      embed.addFields({ name: key, value: String(value).slice(0, 1024) || '\u200b' });
    }

    return embed;
  }

  switch (message.type) {
    case 'chat':
      return new EmbedBuilder()
        .setColor(CHAT_COLOR)
        .setAuthor({ name: message.username })
        .setDescription(message.message)
        .setFooter({ text: `${message.entityName} | ${message.id}` })
        .setTimestamp();
    case 'event':
      return new EmbedBuilder()
        .setColor(EVENT_COLOR)
        .addFields({ name: message.event, value: message.data || '\u200b' })
        .setFooter({ text: message.entityName })
        .setTimestamp();
    case 'authenticate':
    case 'authenticateResponse':
    case 'command':
    case 'commandResponse':
      // Internal handshake/command messages never reach Discord delivery
      // through this generic path -- commandResponse is delivered via
      // DiscordBot.deliverCommandOutput instead (see src/index.ts).
      return new EmbedBuilder().setColor(UNKNOWN_COLOR).setDescription('(internal message)');
  }
}

export interface MessageDeliveryPayload {
  readonly content?: string;
  readonly embeds?: readonly EmbedBuilder[];
}

/**
 * Renders a relay message for Discord delivery, using the admin-configured
 * `/format` setting for its type (see src/store/formatSettings.ts) when one
 * exists, falling back to {@link formatMessageEmbed} otherwise. This is
 * what `DiscordBot.deliverToChannel` should call.
 */
export function formatMessageContent(
  message: RelayMessage,
  setting: FormatSettingRecord | undefined,
): MessageDeliveryPayload {
  if (!setting || !isLinkableRelayMessage(message)) {
    return { embeds: [formatMessageEmbed(message)] };
  }

  const context = buildTemplateContext(message);
  const rendered = renderTemplate(unescapeTemplate(setting.template), context);

  if (!setting.useEmbed) {
    return { content: rendered };
  }

  const embed = new EmbedBuilder().setDescription(rendered).setTimestamp();

  if (setting.color !== undefined) {
    embed.setColor(setting.color);
  }

  return { embeds: [embed] };
}
