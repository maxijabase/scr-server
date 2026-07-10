import { describe, expect, test } from 'bun:test';
import { formatMessageContent, formatMessageEmbed } from '../src/bot/formatting.js';

describe('formatMessageEmbed', () => {
  test('formats a chat message with username as author and message as description', () => {
    const embed = formatMessageEmbed({
      type: 'chat',
      entityName: 'Server A',
      idType: 'steam',
      id: '1',
      username: 'Player One',
      message: 'hello world',
    });

    const data = embed.toJSON();

    expect(data.author?.name).toBe('Player One');
    expect(data.description).toBe('hello world');
    expect(data.footer?.text).toBe('Server A | 1');
  });

  test('formats an event message with event name as a field', () => {
    const embed = formatMessageEmbed({
      type: 'event',
      entityName: 'Server A',
      event: 'Map Start',
      data: 'de_dust2',
    });

    const data = embed.toJSON();

    expect(data.fields?.[0]).toEqual({ name: 'Map Start', value: 'de_dust2' });
    expect(data.footer?.text).toBe('Server A');
  });

  test('falls back to a generic embed for an unrecognized message type', () => {
    const embed = formatMessageEmbed({
      type: 'achievement_unlocked',
      payload: { type: 'achievement_unlocked', player: 'Player One', achievement: 'First Blood' },
    });

    const data = embed.toJSON();

    expect(data.title).toBe('achievement_unlocked');
    expect(data.fields).toContainEqual({ name: 'player', value: 'Player One' });
    expect(data.fields).toContainEqual({ name: 'achievement', value: 'First Blood' });
    // The redundant "type" key from the payload shouldn't become its own field.
    expect(data.fields?.some((f) => f.name === 'type')).toBe(false);
  });

  test('does not render internal handshake messages as if they were content', () => {
    const embed = formatMessageEmbed({ type: 'authenticate', token: 'secret' });

    expect(embed.toJSON().description).toBe('(internal message)');
  });
});

describe('formatMessageContent', () => {
  const chatMessage = {
    type: 'chat' as const,
    entityName: 'Server A',
    idType: 'steam' as const,
    id: '1',
    username: 'PlayerOne',
    message: 'hello world',
  };

  test('falls back to the default embed when no setting is configured', () => {
    const payload = formatMessageContent(chatMessage, undefined);

    expect(payload.content).toBeUndefined();
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds?.[0]?.toJSON().author?.name).toBe('PlayerOne');
  });

  test('renders plain content when useEmbed is false', () => {
    const payload = formatMessageContent(chatMessage, {
      messageType: 'chat',
      eventName: '',
      useEmbed: false,
      template: '[{username}]({profileUrl}): {message}',
      color: undefined,
      updatedAt: '',
    });

    expect(payload.embeds).toBeUndefined();
    expect(payload.content).toBe(
      '[PlayerOne](https://steamcommunity.com/profiles/1): hello world',
    );
  });

  test('renders a templated embed description with color when useEmbed is true', () => {
    const payload = formatMessageContent(chatMessage, {
      messageType: 'chat',
      eventName: '',
      useEmbed: true,
      template: '{username}: {message}',
      color: 0x00ff00,
      updatedAt: '',
    });

    expect(payload.content).toBeUndefined();
    const data = payload.embeds?.[0]?.toJSON();
    expect(data?.description).toBe('PlayerOne: hello world');
    expect(data?.color).toBe(0x00ff00);
  });

  test('falls back to the default embed for non-linkable message types even if a setting exists', () => {
    const payload = formatMessageContent(
      { type: 'authenticate', token: 'secret' },
      {
        messageType: 'chat',
        eventName: '',
        useEmbed: false,
        template: '{message}',
        color: undefined,
        updatedAt: '',
      },
    );

    expect(payload.content).toBeUndefined();
    expect(payload.embeds?.[0]?.toJSON().description).toBe('(internal message)');
  });
});
