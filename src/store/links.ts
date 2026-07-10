import type { Database } from 'bun:sqlite';
import { isLinkableMessageType, type LinkableMessageType } from '../protocol/messages.js';
import type { LinkDirection, LinkRecord } from './types.js';

interface LinkRow {
  readonly id: number;
  readonly source_node_id: string;
  readonly target_node_id: string;
  readonly direction: string;
  readonly allowed_types: string;
  readonly created_at: string;
}

function parseAllowedTypes(raw: string): LinkableMessageType[] {
  let decoded: unknown;

  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(decoded)) {
    return [];
  }

  return decoded.filter((value): value is LinkableMessageType => {
    return typeof value === 'string' && isLinkableMessageType(value);
  });
}

function toLinkRecord(row: LinkRow): LinkRecord {
  return {
    id: row.id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    direction: row.direction as LinkDirection,
    allowedTypes: parseAllowedTypes(row.allowed_types),
    createdAt: row.created_at,
  };
}

export class LinkRepository {
  public constructor(private readonly db: Database) {}

  public getById(id: number): LinkRecord | undefined {
    const row = this.db.query('SELECT * FROM links WHERE id = ?').get(id) as LinkRow | null;

    return row ? toLinkRecord(row) : undefined;
  }

  public list(): LinkRecord[] {
    const rows = this.db.query('SELECT * FROM links ORDER BY id').all() as LinkRow[];

    return rows.map(toLinkRecord);
  }

  public create(
    sourceNodeId: string,
    targetNodeId: string,
    direction: LinkDirection,
    allowedTypes: readonly LinkableMessageType[],
  ): LinkRecord {
    this.db.run(
      'INSERT INTO links (source_node_id, target_node_id, direction, allowed_types) VALUES (?, ?, ?, ?)',
      [sourceNodeId, targetNodeId, direction, JSON.stringify(allowedTypes)],
    );

    const row = this.db
      .query('SELECT * FROM links WHERE source_node_id = ? AND target_node_id = ?')
      .get(sourceNodeId, targetNodeId) as LinkRow | null;

    if (!row) {
      throw new Error(`Failed to create link ${sourceNodeId} -> ${targetNodeId}`);
    }

    return toLinkRecord(row);
  }

  public delete(id: number): boolean {
    const result = this.db.run('DELETE FROM links WHERE id = ?', [id]);

    return result.changes > 0;
  }

  /**
   * Links relevant to messages *sent by* `nodeId`: links where it's the
   * source (any direction), plus links where it's the target of a two-way
   * link. This is the routing engine's core lookup -- see src/routing.
   */
  public findOutgoingForSender(nodeId: string): LinkRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM links
         WHERE source_node_id = ?
            OR (target_node_id = ? AND direction = 'two_way')
         ORDER BY id`,
      )
      .all(nodeId, nodeId) as LinkRow[];

    return rows.map(toLinkRecord);
  }
}
