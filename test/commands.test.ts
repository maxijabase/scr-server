import { beforeEach, describe, expect, test } from 'bun:test';
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import { filterCommand } from '../src/bot/commands/filter.js';
import { formatCommand } from '../src/bot/commands/format.js';
import { linkCommand } from '../src/bot/commands/link.js';
import { nodeCommand } from '../src/bot/commands/node.js';
import type { BotContext } from '../src/bot/context.js';
import { Store } from '../src/store/store.js';

let store: Store;
let ctx: BotContext;
let replies: unknown[];

function fakeInteraction(overrides: {
  subcommand: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  channel?: { id: string; name: string };
}): ChatInputCommandInteraction {
  return {
    options: {
      getSubcommand: () => overrides.subcommand,
      getString: (name: string) => overrides.strings?.[name] ?? null,
      getInteger: (name: string) => overrides.integers?.[name] ?? null,
      getChannel: (_name: string) => overrides.channel ?? null,
    },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
  } as unknown as ChatInputCommandInteraction;
}

interface FakeReply {
  readonly content?: string;
  readonly embeds?: { toJSON(): { title?: string; description?: string } }[];
  readonly flags?: number;
}

function fakeAutocomplete(commandName: string, focusedName: string, focusedValue: string): {
  interaction: AutocompleteInteraction;
  responses: unknown[];
} {
  const responses: unknown[] = [];

  const interaction = {
    commandName,
    options: {
      getFocused: (withDetails?: boolean) =>
        withDetails ? { name: focusedName, value: focusedValue } : focusedValue,
    },
    respond: async (choices: unknown[]) => {
      responses.push(...choices);
    },
  } as unknown as AutocompleteInteraction;

  return { interaction, responses };
}

beforeEach(() => {
  store = Store.open(':memory:');
  ctx = { store, ownerId: 'owner-1' };
  replies = [];
});

describe('node command', () => {
  test('list reports no nodes when empty', async () => {
    await nodeCommand.execute(fakeInteraction({ subcommand: 'list' }), ctx);

    expect(replies).toEqual([{ content: 'No nodes found.', flags: MessageFlags.Ephemeral }]);
  });

  test('list includes created nodes', async () => {
    store.nodes.getOrCreate('server-a', 'game_server', 'Server A');

    await nodeCommand.execute(fakeInteraction({ subcommand: 'list' }), ctx);

    const reply = replies[0] as { content: string };
    expect(reply.content).toContain('Server A');
  });

  test('rename updates an existing node', async () => {
    store.nodes.getOrCreate('chan-1', 'discord_channel');

    await nodeCommand.execute(
      fakeInteraction({ subcommand: 'rename', strings: { node: 'chan-1', name: '#renamed' } }),
      ctx,
    );

    expect(store.nodes.getById('chan-1')?.displayName).toBe('#renamed');
  });

  test('rename reports an error for an unknown node', async () => {
    await nodeCommand.execute(
      fakeInteraction({ subcommand: 'rename', strings: { node: 'nope', name: 'x' } }),
      ctx,
    );

    const reply = replies[0] as { content: string };
    expect(reply.content).toContain('No node found');
  });

  test('delete removes a node', async () => {
    store.nodes.getOrCreate('chan-1', 'discord_channel');

    await nodeCommand.execute(fakeInteraction({ subcommand: 'delete', strings: { node: 'chan-1' } }), ctx);

    expect(store.nodes.getById('chan-1')).toBeUndefined();
  });

  test('autocomplete returns matching nodes as id/name pairs', async () => {
    store.nodes.getOrCreate('server-a', 'game_server', 'Server A');
    store.nodes.getOrCreate('chan-a', 'discord_channel', 'general');

    const { interaction, responses } = fakeAutocomplete('node', 'node', 'Server');
    await nodeCommand.autocomplete?.(interaction, ctx);

    expect(responses).toEqual([{ name: 'Server A (game_server)', value: 'server-a' }]);
  });
});

describe('link command', () => {
  test('create fails when source node does not exist', async () => {
    await linkCommand.execute(
      fakeInteraction({
        subcommand: 'create',
        strings: { source: 'missing', direction: 'two_way', types: 'chat,event' },
        channel: { id: 'chan-a', name: 'general' },
      }),
      ctx,
    );

    const reply = replies[0] as { content: string };
    expect(reply.content).toContain('No node found');
    expect(store.links.list()).toHaveLength(0);
  });

  test('create links an existing source to a channel, creating the channel node', async () => {
    store.nodes.getOrCreate('server-a', 'game_server', 'Server A');

    await linkCommand.execute(
      fakeInteraction({
        subcommand: 'create',
        strings: { source: 'server-a', direction: 'two_way', types: 'chat,event' },
        channel: { id: 'chan-a', name: 'general' },
      }),
      ctx,
    );

    expect(store.nodes.getById('chan-a')?.kind).toBe('discord_channel');

    const links = store.links.list();
    expect(links).toHaveLength(1);
    expect(links[0]?.sourceNodeId).toBe('server-a');
    expect(links[0]?.targetNodeId).toBe('chan-a');
    expect(links[0]?.allowedTypes).toEqual(['chat', 'event']);
  });

  test('create reports a friendly error on duplicate links', async () => {
    store.nodes.getOrCreate('server-a', 'game_server', 'Server A');
    store.nodes.getOrCreate('chan-a', 'discord_channel', 'general');
    store.links.create('server-a', 'chan-a', 'two_way', ['chat']);

    await linkCommand.execute(
      fakeInteraction({
        subcommand: 'create',
        strings: { source: 'server-a', direction: 'two_way', types: 'chat' },
        channel: { id: 'chan-a', name: 'general' },
      }),
      ctx,
    );

    const reply = replies[0] as { content: string };
    expect(reply.content).toContain('already exists');
  });

  test('list and delete round-trip', async () => {
    store.nodes.getOrCreate('server-a', 'game_server', 'Server A');
    store.nodes.getOrCreate('chan-a', 'discord_channel', 'general');
    const link = store.links.create('server-a', 'chan-a', 'one_way', ['chat']);

    await linkCommand.execute(fakeInteraction({ subcommand: 'list' }), ctx);
    expect((replies[0] as { content: string }).content).toContain('Server A');

    await linkCommand.execute(
      fakeInteraction({ subcommand: 'delete', integers: { link: link.id } }),
      ctx,
    );

    expect(store.links.list()).toHaveLength(0);
  });
});

describe('filter command', () => {
  test('add, list, and remove a pattern', async () => {
    await filterCommand.execute(
      fakeInteraction({ subcommand: 'add', strings: { pattern: 'badword' } }),
      ctx,
    );
    expect(store.filters.list()).toHaveLength(1);

    await filterCommand.execute(fakeInteraction({ subcommand: 'list' }), ctx);
    expect((replies[1] as { content: string }).content).toContain('badword');

    const [filter] = store.filters.list();

    await filterCommand.execute(
      fakeInteraction({ subcommand: 'remove', integers: { id: filter!.id } }),
      ctx,
    );
    expect(store.filters.list()).toHaveLength(0);
  });

  test('add reports an error for invalid regex', async () => {
    await filterCommand.execute(
      fakeInteraction({ subcommand: 'add', strings: { pattern: '[unterminated' } }),
      ctx,
    );

    const reply = replies[0] as { content: string };
    expect(reply.content).toContain('Invalid regular expression');
    expect(store.filters.list()).toHaveLength(0);
  });
});

describe('format command', () => {
  test('set saves a plain-text template and previews it with sample data', async () => {
    await formatCommand.execute(
      fakeInteraction({
        subcommand: 'set',
        strings: { type: 'chat', mode: 'plain', template: '[{username}]({profileUrl}): {message}' },
      }),
      ctx,
    );

    const setting = store.formatSettings.get('chat');
    expect(setting?.useEmbed).toBe(false);
    expect(setting?.template).toBe('[{username}]({profileUrl}): {message}');

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('Saved');
    expect(reply.embeds?.[0]?.toJSON().description).toBe(
      '[PlayerOne](https://steamcommunity.com/profiles/76561198000000000): hello world',
    );
  });

  test('set saves an embed template with a color', async () => {
    await formatCommand.execute(
      fakeInteraction({
        subcommand: 'set',
        strings: { type: 'event', mode: 'embed', template: '{event}: {data}', color: '#00ff00' },
      }),
      ctx,
    );

    const setting = store.formatSettings.get('event');
    expect(setting?.useEmbed).toBe(true);
    expect(setting?.color).toBe(0x00ff00);

    const reply = replies[0] as FakeReply;
    expect(reply.embeds?.[0]?.toJSON().description).toBe('Map Start: de_dust2');
  });

  test('set rejects an unknown placeholder without saving', async () => {
    await formatCommand.execute(
      fakeInteraction({
        subcommand: 'set',
        strings: { type: 'chat', mode: 'plain', template: '{username}: {typo}' },
      }),
      ctx,
    );

    expect(store.formatSettings.get('chat')).toBeUndefined();

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('Unknown placeholder');
    expect(reply.content).toContain('typo');
  });

  test('set rejects an invalid color', async () => {
    await formatCommand.execute(
      fakeInteraction({
        subcommand: 'set',
        strings: { type: 'chat', mode: 'embed', template: '{message}', color: 'not-a-color' },
      }),
      ctx,
    );

    expect(store.formatSettings.get('chat')).toBeUndefined();

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('Invalid color');
  });

  test('show reports the default embed when unconfigured', async () => {
    await formatCommand.execute(fakeInteraction({ subcommand: 'show', strings: { type: 'chat' } }), ctx);

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('default embed');
  });

  test('show reports the saved template, mode, and color', async () => {
    store.formatSettings.set('chat', '', { useEmbed: true, template: '{message}', color: 0xff0000 });

    await formatCommand.execute(fakeInteraction({ subcommand: 'show', strings: { type: 'chat' } }), ctx);

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('embed');
    expect(reply.content).toContain('{message}');
    expect(reply.content).toContain('#ff0000');
  });

  test('reset reverts to the default embed', async () => {
    store.formatSettings.set('chat', '', { useEmbed: true, template: '{message}' });

    await formatCommand.execute(fakeInteraction({ subcommand: 'reset', strings: { type: 'chat' } }), ctx);

    expect(store.formatSettings.get('chat')).toBeUndefined();
    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('Reset');
  });

  test('reset reports when there was nothing to reset', async () => {
    await formatCommand.execute(fakeInteraction({ subcommand: 'reset', strings: { type: 'chat' } }), ctx);

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('already');
  });

  test('placeholders lists the valid keys for the given type', async () => {
    await formatCommand.execute(
      fakeInteraction({ subcommand: 'placeholders', strings: { type: 'chat' } }),
      ctx,
    );

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('{username}');
    expect(reply.content).toContain('{profileUrl}');
  });

  test('set with an event name overrides just that event, independent of the generic default', async () => {
    await formatCommand.execute(
      fakeInteraction({
        subcommand: 'set',
        strings: { type: 'event', mode: 'plain', template: '**{data}**', event: 'Player Kicked' },
      }),
      ctx,
    );

    expect(store.formatSettings.get('event', 'Player Kicked')?.template).toBe('**{data}**');
    expect(store.formatSettings.get('event')).toBeUndefined();

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('Player Kicked');
  });

  test('set rejects an event name for the chat type', async () => {
    await formatCommand.execute(
      fakeInteraction({
        subcommand: 'set',
        strings: { type: 'chat', mode: 'plain', template: '{message}', event: 'Player Kicked' },
      }),
      ctx,
    );

    expect(store.formatSettings.list()).toHaveLength(0);
    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('only applies to type');
  });

  test('show for a specific event falls back to reporting the default when unconfigured', async () => {
    await formatCommand.execute(
      fakeInteraction({ subcommand: 'show', strings: { type: 'event', event: 'Player Kicked' } }),
      ctx,
    );

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('Player Kicked');
    expect(reply.content).toContain('default embed');
  });

  test('list reports every configured override, generic and per-event', async () => {
    store.formatSettings.set('event', '', { useEmbed: true, template: '{event}: {data}' });
    store.formatSettings.set('event', 'Player Kicked', { useEmbed: false, template: '**{data}**' });

    await formatCommand.execute(fakeInteraction({ subcommand: 'list' }), ctx);

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('event');
    expect(reply.content).toContain('Player Kicked');
  });

  test('list reports nothing configured when store is empty', async () => {
    await formatCommand.execute(fakeInteraction({ subcommand: 'list' }), ctx);

    const reply = replies[0] as FakeReply;
    expect(reply.content).toContain('No custom formats configured');
  });
});
