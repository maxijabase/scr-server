import type { Database } from 'bun:sqlite';
import type { OperatorKind, OperatorRecord } from './types.js';

interface OperatorRow {
  readonly id: number;
  readonly discord_id: string;
  readonly kind: string;
  readonly added_by: string;
  readonly created_at: string;
}

function toOperatorRecord(row: OperatorRow): OperatorRecord {
  return {
    id: row.id,
    discordId: row.discord_id,
    kind: row.kind as OperatorKind,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

/**
 * Discord users and roles (besides the owner, see SCR_DISCORD_OWNER_ID)
 * authorized to run "!"-prefixed messages as server commands. Managed via
 * /op. A "role" operator authorizes anyone holding that role, without
 * needing to be added individually.
 */
export class OperatorRepository {
  public constructor(private readonly db: Database) {}

  public list(): OperatorRecord[] {
    const rows = this.db.query('SELECT * FROM operators ORDER BY id').all() as OperatorRow[];

    return rows.map(toOperatorRecord);
  }

  public add(discordId: string, kind: OperatorKind, addedBy: string): OperatorRecord {
    this.db.run(
      'INSERT OR IGNORE INTO operators (discord_id, kind, added_by) VALUES (?, ?, ?)',
      [discordId, kind, addedBy],
    );

    const row = this.db
      .query('SELECT * FROM operators WHERE discord_id = ? AND kind = ?')
      .get(discordId, kind) as OperatorRow | null;

    if (!row) {
      throw new Error(`Failed to add operator ${discordId} (${kind})`);
    }

    return toOperatorRecord(row);
  }

  public remove(discordId: string, kind: OperatorKind): boolean {
    const result = this.db.run('DELETE FROM operators WHERE discord_id = ? AND kind = ?', [
      discordId,
      kind,
    ]);

    return result.changes > 0;
  }

  public isAuthorized(discordId: string, kind: OperatorKind): boolean {
    const row = this.db
      .query('SELECT 1 FROM operators WHERE discord_id = ? AND kind = ?')
      .get(discordId, kind);

    return row !== null;
  }

  /** True if `userId` is directly authorized, or holds any role in `roleIds` that is. */
  public isAuthorizedForUser(userId: string, roleIds: readonly string[]): boolean {
    if (this.isAuthorized(userId, 'user')) {
      return true;
    }

    return roleIds.some((roleId) => this.isAuthorized(roleId, 'role'));
  }
}
