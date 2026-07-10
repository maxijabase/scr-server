import type { ChatMessage, EventMessage, LinkableMessageType } from '../protocol/messages.js';

export type TemplateContext = Readonly<Record<string, string>>;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * Substitutes `{key}` placeholders from `context`. Unknown/missing keys
 * become an empty string rather than throwing -- admins editing a template
 * via Discord slash commands get a forgiving renderer, and `set` validates
 * against known keys separately (see {@link findUnknownPlaceholders}) so
 * typos are still caught before saving.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => context[key] ?? '');
}

/** Discord slash-command string options can't contain literal newlines; admins type this instead. */
export function unescapeTemplate(raw: string): string {
  return raw.replace(/\\n/g, '\n');
}

function extractPlaceholders(template: string): string[] {
  const matches = template.matchAll(PLACEHOLDER_PATTERN);

  return Array.from(matches)
    .map((match) => match[1])
    .filter((key): key is string => key !== undefined);
}

/** Returns the distinct placeholder names in `template` that aren't in `knownKeys`, for save-time validation. */
export function findUnknownPlaceholders(
  template: string,
  knownKeys: readonly string[],
): string[] {
  const unknown = extractPlaceholders(template).filter((key) => !knownKeys.includes(key));

  return Array.from(new Set(unknown));
}

export const CHAT_PLACEHOLDERS = [
  'entityName',
  'username',
  'message',
  'id',
  'idType',
  'profileUrl',
] as const;

export const EVENT_PLACEHOLDERS = ['entityName', 'event', 'data'] as const;

export function placeholdersForType(type: LinkableMessageType): readonly string[] {
  return type === 'chat' ? CHAT_PLACEHOLDERS : EVENT_PLACEHOLDERS;
}

/**
 * Derives a profile URL from a chat message's `idType`/`id` -- the one
 * computed (not wire-provided) placeholder, since it's what makes a
 * `[{username}]({profileUrl})` style template useful out of the box.
 * Empty string when the id type has no known profile URL scheme.
 */
function deriveProfileUrl(message: ChatMessage): string {
  switch (message.idType) {
    case 'steam':
      return `https://steamcommunity.com/profiles/${message.id}`;
    case 'discord':
      return `https://discord.com/users/${message.id}`;
    default:
      return '';
  }
}

export function buildTemplateContext(message: ChatMessage | EventMessage): TemplateContext {
  if (message.type === 'chat') {
    return {
      entityName: message.entityName,
      username: message.username,
      message: message.message,
      id: message.id,
      idType: message.idType,
      profileUrl: deriveProfileUrl(message),
    };
  }

  return {
    entityName: message.entityName,
    event: message.event,
    data: message.data,
  };
}
