import type { Database } from 'bun:sqlite';
import type { FilterRecord } from './types.js';

interface FilterRow {
  readonly id: number;
  readonly pattern: string;
  readonly created_at: string;
}

function toFilterRecord(row: FilterRow): FilterRecord {
  return {
    id: row.id,
    pattern: row.pattern,
    createdAt: row.created_at,
  };
}

export class InvalidRegexError extends Error {}

export class FilterRepository {
  public constructor(private readonly db: Database) {}

  public list(): FilterRecord[] {
    const rows = this.db.query('SELECT * FROM filters ORDER BY id').all() as FilterRow[];

    return rows.map(toFilterRecord);
  }

  public add(pattern: string): FilterRecord {
    try {
      new RegExp(pattern);
    } catch (cause) {
      throw new InvalidRegexError(`Invalid regular expression: ${pattern}`, { cause });
    }

    this.db.run('INSERT OR IGNORE INTO filters (pattern) VALUES (?)', [pattern]);

    const row = this.db.query('SELECT * FROM filters WHERE pattern = ?').get(pattern) as
      | FilterRow
      | null;

    if (!row) {
      throw new Error(`Failed to add filter ${pattern}`);
    }

    return toFilterRecord(row);
  }

  public remove(id: number): boolean {
    const result = this.db.run('DELETE FROM filters WHERE id = ?', [id]);

    return result.changes > 0;
  }

  /** Compiled regexes for the content filter, ready to test message bodies against. */
  public compiledPatterns(): RegExp[] {
    return this.list()
      .map((filter) => {
        try {
          return new RegExp(filter.pattern);
        } catch {
          return null;
        }
      })
      .filter((regex): regex is RegExp => regex !== null);
  }
}
