import type { Server, ServerWebSocket } from 'bun';
import { parseMessage, serializeMessage } from '../protocol/codec.js';
import { isKnownRelayMessage, type RelayMessage } from '../protocol/messages.js';
import type { Store } from '../store/store.js';
import type { ConnectionState } from './connectionState.js';

/**
 * Above this many buffered bytes on a single connection's outgoing queue, we
 * consider the client too slow/unresponsive and disconnect it rather than
 * let memory grow unbounded. Mirrors the intent of the old Go server's
 * "channel full -> close connection" behavior (relay/relay.go
 * ListenClientSend), but measured directly via Bun's socket buffer instead
 * of a fixed-size Go channel.
 */
const MAX_BUFFERED_BYTES = 1_000_000;

export type IncomingMessageHandler = (senderId: string, message: RelayMessage) => void;

export interface RelayServerOptions {
  readonly port: number;
  readonly store: Store;
  readonly onMessage: IncomingMessageHandler;
  readonly onLog?: (message: string) => void;
}

/**
 * WebSocket transport for game-server connections. Purely transport-level:
 * it authenticates connections and hands validated messages to `onMessage`,
 * but has no knowledge of routing/Links -- see src/routing/router.ts for
 * that, wired up by whatever owns both (the app entry point).
 */
export class RelayServer {
  private readonly port: number;
  private readonly store: Store;
  private readonly onMessage: IncomingMessageHandler;
  private readonly log: (message: string) => void;

  /** Connected, authenticated sockets keyed by node id, for outbound delivery. */
  private readonly sockets = new Map<string, ServerWebSocket<ConnectionState>>();

  private server: Server<ConnectionState> | undefined;

  public constructor(options: RelayServerOptions) {
    this.port = options.port;
    this.store = options.store;
    this.onMessage = options.onMessage;
    this.log = options.onLog ?? (() => {});
  }

  public start(): Server<ConnectionState> {
    this.server = Bun.serve<ConnectionState, never>({
      port: this.port,
      fetch: (req, server) => {
        if (server.upgrade(req, { data: {} })) {
          return undefined;
        }

        return new Response('Upgrade required', { status: 426 });
      },
      websocket: {
        message: (ws, raw) => {
          this.handleMessage(ws, typeof raw === 'string' ? raw : raw.toString('utf-8'));
        },
        close: (ws) => {
          this.handleClose(ws);
        },
      },
    });

    return this.server;
  }

  public stop(): void {
    for (const socket of this.sockets.values()) {
      socket.close(1001, 'Server shutting down');
    }

    this.sockets.clear();
    this.server?.stop(true);
  }

  public get actualPort(): number | undefined {
    return this.server?.port;
  }

  /** Sends a message to a connected node, if it has an active connection. Returns whether it was delivered. */
  public sendToNode(nodeId: string, message: RelayMessage): boolean {
    const socket = this.sockets.get(nodeId);

    if (!socket) {
      return false;
    }

    socket.send(serializeMessage(message));

    if (socket.getBufferedAmount() > MAX_BUFFERED_BYTES) {
      this.log(`Disconnecting node ${nodeId}: backpressure limit exceeded`);
      socket.close(1013, 'Backpressure limit exceeded');
      this.sockets.delete(nodeId);
    }

    return true;
  }

  public isConnected(nodeId: string): boolean {
    return this.sockets.has(nodeId);
  }

  private handleMessage(ws: ServerWebSocket<ConnectionState>, raw: string): void {
    const parsed = parseMessage(raw);

    if (!parsed.ok) {
      this.log(`Dropping malformed message: ${parsed.error}`);
      return;
    }

    const message = parsed.value;

    if (!isKnownRelayMessage(message)) {
      // Forward-compatible: an unrecognized type isn't an error, but this
      // phase has nothing that knows how to route/display it yet.
      if (!ws.data.nodeId) {
        this.log('Dropping message from unauthenticated connection');
        return;
      }

      this.onMessage(ws.data.nodeId, message);
      return;
    }

    if (message.type === 'authenticate') {
      this.handleAuthenticate(ws, message.token);
      return;
    }

    if (!ws.data.nodeId) {
      this.log('Dropping message from unauthenticated connection');
      return;
    }

    // Re-affirm the sender's display name on every message, in case it
    // changed (e.g. the game server's hostname convar changed at runtime).
    if ('entityName' in message) {
      ws.data.entityName = message.entityName;
      this.store.nodes.rename(ws.data.nodeId, message.entityName);
    }

    this.onMessage(ws.data.nodeId, message);
  }

  private handleAuthenticate(ws: ServerWebSocket<ConnectionState>, token: string): void {
    const existingNode = this.store.nodes.getById(token);

    if (existingNode && existingNode.kind !== 'game_server') {
      ws.send(
        serializeMessage({
          type: 'authenticateResponse',
          success: false,
          reason: 'Token conflicts with an existing non-game-server node',
        }),
      );
      ws.close(1008, 'Invalid token');
      return;
    }

    const node = this.store.nodes.getOrCreate(token, 'game_server');

    const previousSocket = this.sockets.get(node.id);

    if (previousSocket && previousSocket !== ws) {
      previousSocket.close(1000, 'Replaced by new connection');
    }

    ws.data.nodeId = node.id;
    this.sockets.set(node.id, ws);

    ws.send(serializeMessage({ type: 'authenticateResponse', success: true }));

    this.log(`Node ${node.id} authenticated`);
  }

  private handleClose(ws: ServerWebSocket<ConnectionState>): void {
    if (ws.data.nodeId && this.sockets.get(ws.data.nodeId) === ws) {
      this.sockets.delete(ws.data.nodeId);
    }
  }
}
