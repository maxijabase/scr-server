import type { LinkableMessageType } from '../protocol/messages.js';
import type { Store } from '../store/store.js';
import type { NodeRecord } from '../store/types.js';

export interface RouteResult {
  /** True if the message content matched a configured filter and was dropped before routing. */
  readonly filtered: boolean;
  readonly destinations: readonly NodeRecord[];
}

/**
 * Resolves message delivery via the explicit Node/Link graph (see
 * src/store/links.ts), replacing the old Go server's implicit
 * "SendChannels intersects ReceiveChannels" numeric matching
 * (entity/utils.go ReceiveIntersectsWith / SendIntersectsWith).
 *
 * This is transport-agnostic: it only decides *which nodes* should receive
 * a message, not *how* -- the WebSocket relay and Discord bot each deliver
 * to the resolved destinations using their own transport.
 */
export class Router {
  public constructor(private readonly store: Store) {}

  public route(
    senderId: string,
    messageType: LinkableMessageType,
    content?: string,
  ): RouteResult {
    if (content !== undefined && this.isFiltered(content)) {
      return { filtered: true, destinations: [] };
    }

    const outgoingLinks = this.store.links.findOutgoingForSender(senderId);

    const destinationIds = new Set<string>();

    for (const link of outgoingLinks) {
      if (!link.allowedTypes.includes(messageType)) {
        continue;
      }

      const destinationId =
        link.sourceNodeId === senderId ? link.targetNodeId : link.sourceNodeId;

      if (destinationId === senderId) {
        continue;
      }

      destinationIds.add(destinationId);
    }

    const destinations = Array.from(destinationIds)
      .map((id) => this.store.nodes.getById(id))
      .filter((node): node is NodeRecord => node !== undefined);

    return { filtered: false, destinations };
  }

  public isFiltered(content: string): boolean {
    return this.store.filters.compiledPatterns().some((pattern) => pattern.test(content));
  }
}
