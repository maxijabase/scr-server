/**
 * JSON message schema shared by the WebSocket relay and (eventually) the
 * scr-client SourcePawn plugin.
 *
 * Replaces the old hand-rolled binary layout (see the Go project's
 * packet/protocol packages) with plain JSON objects. Message framing is
 * handled by the WebSocket transport itself, not by this schema.
 */

export type IdentificationType = 'steam' | 'discord' | 'unknown';

export interface AuthenticateMessage {
  readonly type: 'authenticate';
  readonly token: string;
}

export interface AuthenticateResponseMessage {
  readonly type: 'authenticateResponse';
  readonly success: boolean;
  readonly reason?: string;
}

export interface ChatMessage {
  readonly type: 'chat';
  readonly entityName: string;
  readonly idType: IdentificationType;
  readonly id: string;
  readonly username: string;
  readonly message: string;
}

export interface EventMessage {
  readonly type: 'event';
  readonly entityName: string;
  readonly event: string;
  readonly data: string;
}

/**
 * A server command issued from Discord (via a "!"-prefixed message from an
 * authorized operator) to be run directly on the linked game server with
 * `ServerCommandEx()`. Deliberately kept out of `LinkableMessageType` -- this
 * bypasses the chat/event content filter and routing pipeline entirely, so
 * an admin command can never be silently dropped by a chat filter, and is
 * resolved via its own dispatch path (see src/index.ts).
 *
 * `replyTo` is the Discord channel node id the command was issued from --
 * carried through to the game server and echoed back in the corresponding
 * `CommandResponseMessage` so the response can be routed to that exact
 * channel without guessing from the link graph.
 */
export interface CommandMessage {
  readonly type: 'command';
  readonly command: string;
  readonly issuedBy: string;
  readonly replyTo: string;
}

/**
 * The printed output of a `CommandMessage` that a game server captured via
 * `ServerCommandEx()` and is sending back for delivery to the Discord
 * channel identified by `replyTo`.
 */
export interface CommandResponseMessage {
  readonly type: 'commandResponse';
  readonly output: string;
  readonly replyTo: string;
}

export type KnownRelayMessage =
  | AuthenticateMessage
  | AuthenticateResponseMessage
  | ChatMessage
  | EventMessage
  | CommandMessage
  | CommandResponseMessage;

const KNOWN_MESSAGE_TYPES = [
  'authenticate',
  'authenticateResponse',
  'chat',
  'event',
  'command',
  'commandResponse',
] as const satisfies readonly KnownRelayMessage['type'][];

export type KnownMessageType = KnownRelayMessage['type'];

/**
 * A message whose `type` isn't one of the built-in kinds above. The relay
 * does not reject these outright -- routing/formatting code should treat
 * unrecognized types generically (see routing engine and Discord bot
 * formatter) rather than assuming a closed set, so a future message kind
 * doesn't require a protocol change to be forwarded.
 *
 * Full support for custom message types (pluggable formatting, per-type
 * config, etc.) is intentionally out of scope for this phase -- this type
 * only keeps the schema from being a closed enum.
 */
export interface UnknownRelayMessage {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export type RelayMessage = KnownRelayMessage | UnknownRelayMessage;

export function isKnownMessageType(type: string): type is KnownMessageType {
  return (KNOWN_MESSAGE_TYPES as readonly string[]).includes(type);
}

/**
 * Narrows a full `RelayMessage` to `KnownRelayMessage`. Prefer this over
 * `isKnownMessageType(message.type)` when you need to access fields other
 * than `type` -- TypeScript can't propagate a predicate on `message.type`
 * back to `message` itself, since `UnknownRelayMessage.type` is a plain
 * `string` and therefore isn't provably excluded by a `===` literal check.
 */
export function isKnownRelayMessage(message: RelayMessage): message is KnownRelayMessage {
  return isKnownMessageType(message.type);
}

/** Message kinds a Node can be restricted to sending/receiving via a Link's `allowedTypes`. */
export type LinkableMessageType = Extract<KnownMessageType, 'chat' | 'event'>;

const LINKABLE_MESSAGE_TYPES: readonly LinkableMessageType[] = ['chat', 'event'];

export function isLinkableMessageType(type: string): type is LinkableMessageType {
  return (LINKABLE_MESSAGE_TYPES as readonly string[]).includes(type);
}

/** Same rationale as {@link isKnownRelayMessage}: narrows the whole message, not just its `type`. */
export function isLinkableRelayMessage(message: RelayMessage): message is ChatMessage | EventMessage {
  return isLinkableMessageType(message.type);
}
