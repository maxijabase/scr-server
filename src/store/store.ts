import type { Database } from 'bun:sqlite';
import { openDatabase } from './db.js';
import { FilterRepository } from './filters.js';
import { FormatSettingsRepository } from './formatSettings.js';
import { LinkRepository } from './links.js';
import { NodeRepository } from './nodes.js';

/** Ties together the SQLite connection and typed repositories for the rest of the app. */
export class Store {
  public readonly nodes: NodeRepository;
  public readonly links: LinkRepository;
  public readonly filters: FilterRepository;
  public readonly formatSettings: FormatSettingsRepository;

  private constructor(private readonly db: Database) {
    this.nodes = new NodeRepository(db);
    this.links = new LinkRepository(db);
    this.filters = new FilterRepository(db);
    this.formatSettings = new FormatSettingsRepository(db);
  }

  public static open(path: string): Store {
    return new Store(openDatabase(path));
  }

  public close(): void {
    this.db.close();
  }
}
