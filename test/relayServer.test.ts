import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { parseMessage } from '../src/protocol/codec.js';
import type { RelayMessage } from '../src/protocol/messages.js';
import { isKnownRelayMessage } from '../src/protocol/messages.js';
import { RelayServer } from '../src/relay/relayServer.js';
import { Store } from '../src/store/store.js';

let store: Store;
let relayServer: RelayServer;
let received: { senderId: string; message: RelayMessage }[];

function nextMessage(ws: WebSocket): Promise<RelayMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for message')), 2000);

    ws.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout);

        const raw = typeof event.data === 'string' ? event.data : '';
        const parsed = parseMessage(raw);

        if (!parsed.ok) {
          reject(new Error(`Received unparseable message: ${parsed.error}`));
          return;
        }

        resolve(parsed.value);
      },
      { once: true },
    );
  });
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const timeout = setTimeout(() => reject(new Error('Timed out connecting')), 2000);

    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('WebSocket connection error'));
    });
  });
}

async function authenticate(ws: WebSocket, token: string): Promise<RelayMessage> {
  ws.send(JSON.stringify({ type: 'authenticate', token }));
  return nextMessage(ws);
}

beforeEach(() => {
  store = Store.open(':memory:');
  received = [];
  relayServer = new RelayServer({
    port: 0,
    store,
    onMessage: (senderId, message) => {
      received.push({ senderId, message });
    },
  });
  relayServer.start();
});

afterEach(() => {
  relayServer.stop();
  store.close();
});

describe('RelayServer', () => {
  test('authenticating with a new token creates a game_server node and replies success', async () => {
    const port = relayServer.actualPort;
    if (!port) throw new Error('Server did not start');

    const ws = await connect(port);
    const response = await authenticate(ws, 'token-abc');

    expect(response).toEqual({ type: 'authenticateResponse', success: true });

    const node = store.nodes.getById('token-abc');
    expect(node?.kind).toBe('game_server');

    ws.close();
  });

  test('authenticating twice with the same token reuses the existing node', async () => {
    const port = relayServer.actualPort;
    if (!port) throw new Error('Server did not start');

    const wsA = await connect(port);
    await authenticate(wsA, 'token-abc');
    wsA.close();

    const wsB = await connect(port);
    await authenticate(wsB, 'token-abc');

    expect(store.nodes.list()).toHaveLength(1);

    wsB.close();
  });

  test('messages before authentication are dropped, not forwarded to onMessage', async () => {
    const port = relayServer.actualPort;
    if (!port) throw new Error('Server did not start');

    const ws = await connect(port);
    ws.send(
      JSON.stringify({
        type: 'chat',
        entityName: 'Server A',
        idType: 'steam',
        id: '1',
        username: 'P1',
        message: 'hi',
      }),
    );

    // Give the server a moment to (not) process it.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toEqual([]);

    ws.close();
  });

  test('authenticated chat messages are forwarded to onMessage with the sender node id', async () => {
    const port = relayServer.actualPort;
    if (!port) throw new Error('Server did not start');

    const ws = await connect(port);
    await authenticate(ws, 'token-abc');

    ws.send(
      JSON.stringify({
        type: 'chat',
        entityName: 'Server A',
        idType: 'steam',
        id: '1',
        username: 'P1',
        message: 'hello',
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toHaveLength(1);
    expect(received[0]?.senderId).toBe('token-abc');
    expect(received[0]?.message.type).toBe('chat');

    ws.close();
  });

  test('sendToNode delivers to a connected node and returns true', async () => {
    const port = relayServer.actualPort;
    if (!port) throw new Error('Server did not start');

    const ws = await connect(port);
    await authenticate(ws, 'token-abc');

    const delivered = relayServer.sendToNode('token-abc', {
      type: 'chat',
      entityName: '#general',
      idType: 'discord',
      id: 'discord-user-1',
      username: 'SomeUser',
      message: 'hey from discord',
    });

    expect(delivered).toBe(true);

    const forwarded = await nextMessage(ws);
    expect(forwarded).toEqual({
      type: 'chat',
      entityName: '#general',
      idType: 'discord',
      id: 'discord-user-1',
      username: 'SomeUser',
      message: 'hey from discord',
    });

    ws.close();
  });

  test('sendToNode returns false for a node with no active connection', () => {
    const delivered = relayServer.sendToNode('never-connected', {
      type: 'event',
      entityName: 'Server A',
      event: 'Map Start',
      data: 'de_dust2',
    });

    expect(delivered).toBe(false);
  });

  test('isConnected reflects live connection state', async () => {
    const port = relayServer.actualPort;
    if (!port) throw new Error('Server did not start');

    expect(relayServer.isConnected('token-abc')).toBe(false);

    const ws = await connect(port);
    await authenticate(ws, 'token-abc');

    expect(relayServer.isConnected('token-abc')).toBe(true);

    ws.close();
  });

  test('rejects a token that collides with an existing discord_channel node', async () => {
    const port = relayServer.actualPort;
    if (!port) throw new Error('Server did not start');

    store.nodes.getOrCreate('discord-chan-1', 'discord_channel', '#general');

    const ws = await connect(port);
    const response = await authenticate(ws, 'discord-chan-1');

    expect(response.type).toBe('authenticateResponse');
    if (isKnownRelayMessage(response) && response.type === 'authenticateResponse') {
      expect(response.success).toBe(false);
    }

    ws.close();
  });
});
