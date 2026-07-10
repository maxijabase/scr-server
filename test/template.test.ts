import { describe, expect, test } from 'bun:test';
import {
  buildTemplateContext,
  CHAT_PLACEHOLDERS,
  EVENT_PLACEHOLDERS,
  findUnknownPlaceholders,
  placeholdersForType,
  renderTemplate,
  unescapeTemplate,
} from '../src/bot/template.js';

describe('renderTemplate', () => {
  test('substitutes known placeholders', () => {
    const result = renderTemplate('[{username}]({profileUrl}): {message}', {
      username: 'PlayerOne',
      profileUrl: 'https://steamcommunity.com/profiles/1',
      message: 'hello world',
    });

    expect(result).toBe('[PlayerOne](https://steamcommunity.com/profiles/1): hello world');
  });

  test('replaces missing/unknown keys with an empty string rather than throwing', () => {
    const result = renderTemplate('{username} says {message} {typo}', {
      username: 'PlayerOne',
      message: 'hi',
    });

    expect(result).toBe('PlayerOne says hi ');
  });

  test('leaves a template with no placeholders untouched', () => {
    expect(renderTemplate('no placeholders here', {})).toBe('no placeholders here');
  });
});

describe('unescapeTemplate', () => {
  test('converts literal backslash-n into a real newline', () => {
    expect(unescapeTemplate('line one\\nline two')).toBe('line one\nline two');
  });

  test('leaves templates without escapes untouched', () => {
    expect(unescapeTemplate('{username}: {message}')).toBe('{username}: {message}');
  });
});

describe('findUnknownPlaceholders', () => {
  test('returns an empty array when all placeholders are known', () => {
    expect(findUnknownPlaceholders('{username}: {message}', CHAT_PLACEHOLDERS)).toEqual([]);
  });

  test('returns unknown placeholder names, deduplicated', () => {
    expect(findUnknownPlaceholders('{typo} said {message}, {typo} again', CHAT_PLACEHOLDERS)).toEqual([
      'typo',
    ]);
  });
});

describe('placeholdersForType', () => {
  test('returns chat placeholders for "chat"', () => {
    expect(placeholdersForType('chat')).toEqual(CHAT_PLACEHOLDERS);
  });

  test('returns event placeholders for "event"', () => {
    expect(placeholdersForType('event')).toEqual(EVENT_PLACEHOLDERS);
  });
});

describe('buildTemplateContext', () => {
  test('derives a Steam profile URL for idType "steam"', () => {
    const context = buildTemplateContext({
      type: 'chat',
      entityName: 'Server A',
      idType: 'steam',
      id: '76561198000000000',
      username: 'PlayerOne',
      message: 'hi',
    });

    expect(context.profileUrl).toBe('https://steamcommunity.com/profiles/76561198000000000');
  });

  test('derives a Discord profile URL for idType "discord"', () => {
    const context = buildTemplateContext({
      type: 'chat',
      entityName: 'Server A',
      idType: 'discord',
      id: '123456789012345678',
      username: 'PlayerOne',
      message: 'hi',
    });

    expect(context.profileUrl).toBe('https://discord.com/users/123456789012345678');
  });

  test('leaves profileUrl empty for idType "unknown"', () => {
    const context = buildTemplateContext({
      type: 'chat',
      entityName: 'Server A',
      idType: 'unknown',
      id: 'n/a',
      username: 'PlayerOne',
      message: 'hi',
    });

    expect(context.profileUrl).toBe('');
  });

  test('builds event context from entityName/event/data', () => {
    const context = buildTemplateContext({
      type: 'event',
      entityName: 'Server A',
      event: 'Map Start',
      data: 'de_dust2',
    });

    expect(context).toEqual({ entityName: 'Server A', event: 'Map Start', data: 'de_dust2' });
  });
});
