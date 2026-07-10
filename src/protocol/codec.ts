import { isBoolean, isNonEmptyString, isRecord, isString } from './guards.js';
import type {
  AuthenticateMessage,
  AuthenticateResponseMessage,
  ChatMessage,
  EventMessage,
  IdentificationType,
  RelayMessage,
  UnknownRelayMessage,
} from './messages.js';
import { isKnownMessageType } from './messages.js';
import { err, ok, type Result } from './result.js';

const IDENTIFICATION_TYPES: readonly IdentificationType[] = ['steam', 'discord', 'unknown'];

function isIdentificationType(value: unknown): value is IdentificationType {
  return isString(value) && (IDENTIFICATION_TYPES as readonly string[]).includes(value);
}

function validateAuthenticate(obj: Record<string, unknown>): Result<AuthenticateMessage> {
  if (!isNonEmptyString(obj['token'])) {
    return err('authenticate message requires a non-empty string "token"');
  }

  return ok({ type: 'authenticate', token: obj['token'] });
}

function validateAuthenticateResponse(
  obj: Record<string, unknown>,
): Result<AuthenticateResponseMessage> {
  if (!isBoolean(obj['success'])) {
    return err('authenticateResponse message requires a boolean "success"');
  }

  if (obj['reason'] !== undefined && !isString(obj['reason'])) {
    return err('authenticateResponse message "reason" must be a string when present');
  }

  return ok({
    type: 'authenticateResponse',
    success: obj['success'],
    ...(obj['reason'] !== undefined ? { reason: obj['reason'] as string } : {}),
  });
}

function validateChat(obj: Record<string, unknown>): Result<ChatMessage> {
  if (!isNonEmptyString(obj['entityName'])) {
    return err('chat message requires a non-empty string "entityName"');
  }

  if (!isIdentificationType(obj['idType'])) {
    return err(`chat message "idType" must be one of ${IDENTIFICATION_TYPES.join(', ')}`);
  }

  if (!isString(obj['id'])) {
    return err('chat message requires a string "id"');
  }

  if (!isNonEmptyString(obj['username'])) {
    return err('chat message requires a non-empty string "username"');
  }

  if (!isString(obj['message'])) {
    return err('chat message requires a string "message"');
  }

  return ok({
    type: 'chat',
    entityName: obj['entityName'],
    idType: obj['idType'],
    id: obj['id'],
    username: obj['username'],
    message: obj['message'],
  });
}

function validateEvent(obj: Record<string, unknown>): Result<EventMessage> {
  if (!isNonEmptyString(obj['entityName'])) {
    return err('event message requires a non-empty string "entityName"');
  }

  if (!isNonEmptyString(obj['event'])) {
    return err('event message requires a non-empty string "event"');
  }

  if (!isString(obj['data'])) {
    return err('event message requires a string "data"');
  }

  return ok({
    type: 'event',
    entityName: obj['entityName'],
    event: obj['event'],
    data: obj['data'],
  });
}

/**
 * Validates a decoded JSON value against the relay message schema.
 *
 * Unrecognized `type` values are not rejected -- they're kept as an
 * `UnknownRelayMessage` so future message kinds can be forwarded without a
 * schema change. Only structurally invalid input (not an object, missing/
 * mistyped `type`) is a hard error.
 */
export function validateMessage(value: unknown): Result<RelayMessage> {
  if (!isRecord(value)) {
    return err('message must be a JSON object');
  }

  const type = value['type'];

  if (!isNonEmptyString(type)) {
    return err('message requires a non-empty string "type"');
  }

  if (!isKnownMessageType(type)) {
    return ok({ type, payload: value });
  }

  switch (type) {
    case 'authenticate':
      return validateAuthenticate(value);
    case 'authenticateResponse':
      return validateAuthenticateResponse(value);
    case 'chat':
      return validateChat(value);
    case 'event':
      return validateEvent(value);
  }
}

/** Parses and validates a raw JSON string received over the wire. */
export function parseMessage(raw: string): Result<RelayMessage> {
  let decoded: unknown;

  try {
    decoded = JSON.parse(raw);
  } catch {
    return err('message is not valid JSON');
  }

  return validateMessage(decoded);
}

/** Serializes a message back into its wire (JSON string) form. */
export function serializeMessage(message: RelayMessage): string {
  if (isKnownMessageType(message.type)) {
    return JSON.stringify(message);
  }

  const unknown = message as UnknownRelayMessage;

  return JSON.stringify({ ...unknown.payload, type: unknown.type });
}
