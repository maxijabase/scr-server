import { beforeEach, describe, expect, test } from 'bun:test';
import { Router } from '../src/routing/router.js';
import { Store } from '../src/store/store.js';

let store: Store;
let router: Router;

beforeEach(() => {
  store = Store.open(':memory:');
  router = new Router(store);
});

function ids(nodes: readonly { id: string }[]): string[] {
  return nodes.map((n) => n.id).sort();
}

describe('Router', () => {
  test('one_way link delivers from source to target only', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'one_way', ['chat']);

    const forward = router.route('server-a', 'chat');
    expect(ids(forward.destinations)).toEqual(['chan-a']);

    const backward = router.route('chan-a', 'chat');
    expect(backward.destinations).toEqual([]);
  });

  test('two_way link delivers in both directions', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'two_way', ['chat']);

    expect(ids(router.route('server-a', 'chat').destinations)).toEqual(['chan-a']);
    expect(ids(router.route('chan-a', 'chat').destinations)).toEqual(['server-a']);
  });

  test('allowedTypes restricts routing per message type', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'two_way', ['event']);

    expect(router.route('server-a', 'chat').destinations).toEqual([]);
    expect(ids(router.route('server-a', 'event').destinations)).toEqual(['chan-a']);
  });

  test('fans out to multiple linked nodes', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.nodes.getOrCreate('chan-b', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'one_way', ['chat', 'event']);
    store.links.create('server-a', 'chan-b', 'one_way', ['chat', 'event']);

    expect(ids(router.route('server-a', 'chat').destinations)).toEqual(['chan-a', 'chan-b']);
  });

  test('a node with no links has no destinations', () => {
    store.nodes.getOrCreate('server-a', 'game_server');

    expect(router.route('server-a', 'chat').destinations).toEqual([]);
  });

  test('never routes a message back to its own sender', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    // A self-referencing link should be inert rather than causing an echo.
    store.links.create('server-a', 'server-a', 'two_way', ['chat']);

    expect(router.route('server-a', 'chat').destinations).toEqual([]);
  });

  test('dedupes destinations reachable via more than one link', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'one_way', ['chat']);
    store.links.create('chan-a', 'server-a', 'one_way', ['event']);
    // chan-a is reachable from server-a for 'chat' via the first link, and
    // server-a routing 'event' shouldn't add it again for 'chat'.

    expect(ids(router.route('server-a', 'chat').destinations)).toEqual(['chan-a']);
  });

  test('filtered content is dropped before routing, regardless of links', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'one_way', ['chat']);
    store.filters.add('bad ?word');

    const result = router.route('server-a', 'chat', 'this has a badword in it');

    expect(result.filtered).toBe(true);
    expect(result.destinations).toEqual([]);
  });

  test('non-matching content is not filtered', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'one_way', ['chat']);
    store.filters.add('badword');

    const result = router.route('server-a', 'chat', 'totally fine message');

    expect(result.filtered).toBe(false);
    expect(ids(result.destinations)).toEqual(['chan-a']);
  });

  test('no content provided skips filter check entirely', () => {
    store.nodes.getOrCreate('server-a', 'game_server');
    store.nodes.getOrCreate('chan-a', 'discord_channel');
    store.links.create('server-a', 'chan-a', 'one_way', ['event']);
    store.filters.add('.*');

    const result = router.route('server-a', 'event');

    expect(result.filtered).toBe(false);
    expect(ids(result.destinations)).toEqual(['chan-a']);
  });
});
