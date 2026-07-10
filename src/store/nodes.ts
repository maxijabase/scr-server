import type { Database } from 'bun:sqlite';
import type { NodeKind, NodeRecord } from './types.js';

interface NodeRow {
  readonly id: string;
  readonly kind: string;
  readonly display_name: string;
  readonly created_at: string;
}

function toNodeRecord(row: NodeRow): NodeRecord {
  return {
    id: row.id,
    kind: row.kind as NodeKind,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export class NodeRepository {
  public constructor(private readonly db: Database) {}

  public getById(id: string): NodeRecord | undefined {
    const row = this.db.query('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | null;

    return row ? toNodeRecord(row) : undefined;
  }

  public list(): NodeRecord[] {
    const rows = this.db.query('SELECT * FROM nodes ORDER BY id').all() as NodeRow[];

    return rows.map(toNodeRecord);
  }

  /** Creates the node if it doesn't exist yet, otherwise returns the existing record unchanged. */
  public getOrCreate(id: string, kind: NodeKind, displayName = ''): NodeRecord {
    const existing = this.getById(id);

    if (existing) {
      return existing;
    }

    this.db.run('INSERT INTO nodes (id, kind, display_name) VALUES (?, ?, ?)', [
      id,
      kind,
      displayName,
    ]);

    const created = this.getById(id);

    if (!created) {
      throw new Error(`Failed to create node ${id}`);
    }

    return created;
  }

  public rename(id: string, displayName: string): NodeRecord | undefined {
    this.db.run('UPDATE nodes SET display_name = ? WHERE id = ?', [displayName, id]);

    return this.getById(id);
  }

  /** Deletes the node and any links referencing it (via ON DELETE CASCADE). */
  public delete(id: string): boolean {
    const result = this.db.run('DELETE FROM nodes WHERE id = ?', [id]);

    return result.changes > 0;
  }

  /** Finds nodes whose display name matches (case-insensitively, substring), for command autocomplete. */
  public findByDisplayNamePrefix(prefix: string, limit = 25): NodeRecord[] {
    const rows = this.db
      .query('SELECT * FROM nodes WHERE display_name LIKE ? ORDER BY display_name LIMIT ?')
      .all(`%${prefix}%`, limit) as NodeRow[];

    return rows.map(toNodeRecord);
  }
}
