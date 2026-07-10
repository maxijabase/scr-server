import { beforeEach, describe, expect, test } from 'bun:test';
import { InvalidRegexError } from '../src/store/filters.js';
import { Store } from '../src/store/store.js';

let store: Store;

beforeEach(() => {
  store = Store.open(':memory:');
});

describe('NodeRepository', () => {
  test('getOrCreate creates a node once and is idempotent', () => {
    const first = store.nodes.getOrCreate('token-abc', 'game_server', 'Server A');
    const second = store.nodes.getOrCreate('token-abc', 'game_server', 'Should Not Overwrite');

    expect(first.displayName).toBe('Server A');
    expect(second.displayName).toBe('Server A');
    expect(store.nodes.list()).toHaveLength(1);
  });

  test('rename updates display name', () => {
    store.nodes.getOrCreate('chan-1', 'discord_channel');
    const renamed = store.nodes.rename('chan-1', '#server-a-chat');

    expect(renamed?.displayName).toBe('#server-a-chat');
  });

  test('delete removes the node', () => {
    store.nodes.getOrCreate('chan-1', 'discord_channel');

    expect(store.nodes.delete('chan-1')).toBe(true);
    expect(store.nodes.getById('chan-1')).toBeUndefined();
  });

  test('findByDisplayNamePrefix matches substrings case-sensitively per SQLite default', () => {
    store.nodes.getOrCreate('s1', 'game_server', 'Server A');
    store.nodes.getOrCreate('s2', 'game_server', 'Server B');
    store.nodes.getOrCreate('c1', 'discord_channel', 'general');

    const results = store.nodes.findByDisplayNamePrefix('Server');

    expect(results.map((n) => n.id).sort()).toEqual(['s1', 's2']);
  });
});

describe('LinkRepository', () => {
  test('create persists direction and allowed types', () => {
    store.nodes.getOrCreate('server-a', 'game_server', 'Server A');
    store.nodes.getOrCreate('chan-a', 'discord_channel', '#server-a-chat');

    const link = store.links.create('server-a', 'chan-a', 'two_way', ['chat', 'event']);

    expect(link.sourceNodeId).toBe('server-a');
    expect(link.targetNodeId).toBe('chan-a');
    expect(link.direction).toBe('two_way');
    expect(link.allowedTypes).toEqual(['chat', 'event']);
  });

  test('findOutgoingForSender includes links where node is source', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'one_way', ['chat']);

    const outgoing = store.links.findOutgoingForSender('server-a');

    expect(outgoing).toHaveLength(1);
  });

  test('findOutgoingForSender includes two_way links where node is target, excludes one_way', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.nodes.getOrCreate('chan-b', 'discord_channel');

    store.links.create('chan-a', 'server-a', 'two_way', ['chat']);
    store.links.create('chan-b', 'server-a', 'one_way', ['chat']);

    const outgoing = store.links.findOutgoingForSender('server-a');

    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.sourceNodeId).toBe('chan-a');
  });

  test('deleting a node cascades to its links', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'two_way', ['chat']);

    store.nodes.delete('server-a');

    expect(store.links.list()).toHaveLength(0);
  });

  test('ignores unrecognized allowed_types values when reading (defensive against manual edits)', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    const link = store.links.create('server-a', 'chan-a', 'one_way', [
      'chat',
      // @ts-expect-error -- intentionally invalid to test defensive parsing
      'authenticate',
    ]);

    expect(link.allowedTypes).toEqual(['chat']);
  });
});

describe('FilterRepository', () => {
  test('add and list a pattern', () => {
    store.filters.add('badword');

    expect(store.filters.list().map((f) => f.pattern)).toEqual(['badword']);
  });

  test('rejects invalid regex', () => {
    expect(() => store.filters.add('[unterminated')).toThrow(InvalidRegexError);
  });

  test('compiledPatterns matches content', () => {
    store.filters.add('bad.*word');

    const [pattern] = store.filters.compiledPatterns();

    expect(pattern?.test('this is a badword here')).toBe(true);
    expect(pattern?.test('this is fine')).toBe(false);
  });

  test('remove deletes a pattern', () => {
    const filter = store.filters.add('temp');

    expect(store.filters.remove(filter.id)).toBe(true);
    expect(store.filters.list()).toHaveLength(0);
  });
});

describe('FormatSettingsRepository', () => {
  test('get returns undefined when unconfigured', () => {
    expect(store.formatSettings.get('chat')).toBeUndefined();
  });

  test('set persists template, mode, and color for the generic default', () => {
    const setting = store.formatSettings.set('chat', '', {
      useEmbed: true,
      template: '[{username}]({profileUrl}): {message}',
      color: 0x00ff00,
    });

    expect(setting.messageType).toBe('chat');
    expect(setting.eventName).toBe('');
    expect(setting.useEmbed).toBe(true);
    expect(setting.template).toBe('[{username}]({profileUrl}): {message}');
    expect(setting.color).toBe(0x00ff00);

    expect(store.formatSettings.get('chat')).toEqual(setting);
  });

  test('set upserts rather than duplicating rows', () => {
    store.formatSettings.set('event', '', { useEmbed: true, template: '{event}' });
    store.formatSettings.set('event', '', { useEmbed: false, template: '{event}: {data}' });

    expect(store.formatSettings.list()).toHaveLength(1);
    expect(store.formatSettings.get('event')?.template).toBe('{event}: {data}');
    expect(store.formatSettings.get('event')?.useEmbed).toBe(false);
  });

  test('color is undefined when not provided', () => {
    const setting = store.formatSettings.set('chat', '', { useEmbed: false, template: '{message}' });

    expect(setting.color).toBeUndefined();
  });

  test('reset deletes the setting, reverting to default', () => {
    store.formatSettings.set('chat', '', { useEmbed: true, template: '{message}' });

    expect(store.formatSettings.reset('chat')).toBe(true);
    expect(store.formatSettings.get('chat')).toBeUndefined();
    expect(store.formatSettings.reset('chat')).toBe(false);
  });

  test('a specific event name is stored independently of the generic default', () => {
    store.formatSettings.set('event', '', { useEmbed: true, template: '{event}: {data}' });
    store.formatSettings.set('event', 'Player Kicked', {
      useEmbed: true,
      template: '**{data}**',
      color: 0xff0000,
    });

    expect(store.formatSettings.list()).toHaveLength(2);
    expect(store.formatSettings.get('event', 'Player Kicked')?.template).toBe('**{data}**');
    expect(store.formatSettings.get('event')?.template).toBe('{event}: {data}');
  });

  test('resolve prefers a specific event override, falling back to the generic default', () => {
    store.formatSettings.set('event', '', { useEmbed: true, template: 'generic: {data}' });
    store.formatSettings.set('event', 'Player Kicked', { useEmbed: true, template: 'kicked: {data}' });

    expect(store.formatSettings.resolve('event', 'Player Kicked')?.template).toBe('kicked: {data}');
    expect(store.formatSettings.resolve('event', 'Player Connected')?.template).toBe('generic: {data}');
    expect(store.formatSettings.resolve('event')?.template).toBe('generic: {data}');
  });

  test('resolve returns undefined when neither the override nor the default is configured', () => {
    expect(store.formatSettings.resolve('event', 'Player Kicked')).toBeUndefined();
  });

  test('resetting a specific event override does not affect the generic default', () => {
    store.formatSettings.set('event', '', { useEmbed: true, template: 'generic' });
    store.formatSettings.set('event', 'Player Kicked', { useEmbed: true, template: 'kicked' });

    expect(store.formatSettings.reset('event', 'Player Kicked')).toBe(true);
    expect(store.formatSettings.get('event', 'Player Kicked')).toBeUndefined();
    expect(store.formatSettings.get('event')?.template).toBe('generic');
  });
});
