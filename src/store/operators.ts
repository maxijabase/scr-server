import type { Database } from 'bun:sqlite';
import type { OperatorRecord } from './types.js';

interface OperatorRow {
  readonly id: number;
  readonly discord_user_id: string;
  readonly added_by: string;
  readonly created_at: string;
}

function toOperatorRecord(row: OperatorRow): OperatorRecord {
  return {
    id: row.id,
    discordUserId: row.discord_user_id,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

/**
 * Discord users (besides the owner, see SCR_DISCORD_OWNER_ID) authorized to
 * run "!"-prefixed messages as server commands. Managed via /op.
 */
export class OperatorRepository {
  public constructor(private readonly db: Database) {}

  public list(): OperatorRecord[] {
    const rows = this.db.query('SELECT * FROM operators ORDER BY id').all() as OperatorRow[];

    return rows.map(toOperatorRecord);
  }

  public add(discordUserId: string, addedBy: string): OperatorRecord {
    this.db.run('INSERT OR IGNORE INTO operators (discord_user_id, added_by) VALUES (?, ?)', [
      discordUserId,
      addedBy,
    ]);

    const row = this.db.query('SELECT * FROM operators WHERE discord_user_id = ?').get(
      discordUserId,
    ) as OperatorRow | null;

    if (!row) {
      throw new Error(`Failed to add operator ${discordUserId}`);
    }

    return toOperatorRecord(row);
  }

  public remove(discordUserId: string): boolean {
    const result = this.db.run('DELETE FROM operators WHERE discord_user_id = ?', [
      discordUserId,
    ]);

    return result.changes > 0;
  }

  public isAuthorized(discordUserId: string): boolean {
    const row = this.db
      .query('SELECT 1 FROM operators WHERE discord_user_id = ?')
      .get(discordUserId);

    return row !== null;
  }
}
