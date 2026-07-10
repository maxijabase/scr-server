import { describe, expect, test } from 'bun:test';
import { parseMessage, serializeMessage } from '../src/protocol/codec.js';
import type {
  AuthenticateMessage,
  ChatMessage,
  EventMessage,
  RelayMessage,
} from '../src/protocol/messages.js';

describe('protocol codec', () => {
  describe('round-trip', () => {
    test('authenticate message', () => {
      const message: AuthenticateMessage = { type: 'authenticate', token: 'abc123' };

      const result = parseMessage(serializeMessage(message));

      expect(result).toEqual({ ok: true, value: message });
    });

    test('authenticateResponse message without reason', () => {
      const message: RelayMessage = { type: 'authenticateResponse', success: true };

      const result = parseMessage(serializeMessage(message));

      expect(result).toEqual({ ok: true, value: message });
    });

    test('authenticateResponse message with reason', () => {
      const message: RelayMessage = {
        type: 'authenticateResponse',
        success: false,
        reason: 'invalid token',
      };

      const result = parseMessage(serializeMessage(message));

      expect(result).toEqual({ ok: true, value: message });
    });

    test('chat message', () => {
      const message: ChatMessage = {
        type: 'chat',
        entityName: 'Server A',
        idType: 'steam',
        id: '76561198000000000',
        username: 'Player One',
        message: 'hello world',
      };

      const result = parseMessage(serializeMessage(message));

      expect(result).toEqual({ ok: true, value: message });
    });

    test('event message', () => {
      const message: EventMessage = {
        type: 'event',
        entityName: 'Server A',
        event: 'Player Connected',
        data: 'Player One',
      };

      const result = parseMessage(serializeMessage(message));

      expect(result).toEqual({ ok: true, value: message });
    });

    test('unknown message type round-trips generically', () => {
      const raw = '{"type":"achievement_unlocked","player":"Player One","achievement":"First Blood"}';

      const parsed = parseMessage(raw);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      expect(parsed.value.type).toBe('achievement_unlocked');

      const reserialized = serializeMessage(parsed.value);

      expect(JSON.parse(reserialized)).toEqual(JSON.parse(raw));
    });
  });

  describe('malformed input handling', () => {
    test('rejects invalid JSON without throwing', () => {
      const result = parseMessage('{not valid json');

      expect(result.ok).toBe(false);
    });

    test('rejects a JSON array', () => {
      const result = parseMessage('[1,2,3]');

      expect(result.ok).toBe(false);
    });

    test('rejects a bare JSON primitive', () => {
      const result = parseMessage('"just a string"');

      expect(result.ok).toBe(false);
    });

    test('rejects an object missing "type"', () => {
      const result = parseMessage('{"token":"abc123"}');

      expect(result.ok).toBe(false);
    });

    test('rejects an object with a non-string "type"', () => {
      const result = parseMessage('{"type":123}');

      expect(result.ok).toBe(false);
    });

    test('rejects authenticate message missing token', () => {
      const result = parseMessage('{"type":"authenticate"}');

      expect(result.ok).toBe(false);
    });

    test('rejects authenticate message with empty token', () => {
      const result = parseMessage('{"type":"authenticate","token":""}');

      expect(result.ok).toBe(false);
    });

    test('rejects chat message with invalid idType', () => {
      const result = parseMessage(
        '{"type":"chat","entityName":"Server A","idType":"xbox","id":"1","username":"P1","message":"hi"}',
      );

      expect(result.ok).toBe(false);
    });

    test('rejects chat message missing username', () => {
      const result = parseMessage(
        '{"type":"chat","entityName":"Server A","idType":"steam","id":"1","message":"hi"}',
      );

      expect(result.ok).toBe(false);
    });

    test('rejects event message with non-string data', () => {
      const result = parseMessage(
        '{"type":"event","entityName":"Server A","event":"Map Start","data":123}',
      );

      expect(result.ok).toBe(false);
    });

    test('does not throw on deeply malformed/huge input', () => {
      const huge = '{"type":"chat",' + '"a":1,'.repeat(10000) + '"entityName":"x"}';

      expect(() => parseMessage(huge)).not.toThrow();
    });
  });
});
