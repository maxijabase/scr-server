import type { Database } from 'bun:sqlite';

interface Migration {
  readonly id: number;
  readonly name: string;
  readonly up: (db: Database) => void;
}

/**
 * Ordered schema migrations. Applied once each, tracked in
 * `schema_migrations`. Append new migrations here rather than editing
 * existing ones once they've shipped.
 */
const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'create_nodes_and_links',
    up: (db) => {
      db.run(`
        CREATE TABLE nodes (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('game_server', 'discord_channel')),
          display_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `);

      db.run(`
        CREATE TABLE links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
          target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
          direction TEXT NOT NULL CHECK (direction IN ('one_way', 'two_way')),
          allowed_types TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (source_node_id, target_node_id)
        )
      `);

      db.run('CREATE INDEX idx_links_source_node_id ON links(source_node_id)');
      db.run('CREATE INDEX idx_links_target_node_id ON links(target_node_id)');
    },
  },
  {
    id: 2,
    name: 'create_filters',
    up: (db) => {
      db.run(`
        CREATE TABLE filters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pattern TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `);
    },
  },
  {
    id: 3,
    name: 'create_format_settings',
    up: (db) => {
      db.run(`
        CREATE TABLE format_settings (
          message_type TEXT PRIMARY KEY CHECK (message_type IN ('chat', 'event')),
          use_embed INTEGER NOT NULL DEFAULT 1,
          template TEXT NOT NULL,
          color INTEGER,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `);
    },
  },
  {
    id: 4,
    name: 'add_format_settings_event_name',
    up: (db) => {
      // Widens the format_settings key from just message_type to
      // (message_type, event_name), so a specific event (e.g. "Player
      // Kicked") can have its own template/color distinct from the generic
      // default for its type. event_name is '' for that generic default,
      // never NULL, so the composite primary key/upsert behaves predictably
      // (SQLite treats NULLs in a unique key as mutually non-conflicting).
      db.run('ALTER TABLE format_settings RENAME TO format_settings_old');

      db.run(`
        CREATE TABLE format_settings (
          message_type TEXT NOT NULL CHECK (message_type IN ('chat', 'event')),
          event_name TEXT NOT NULL DEFAULT '',
          use_embed INTEGER NOT NULL DEFAULT 1,
          template TEXT NOT NULL,
          color INTEGER,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          PRIMARY KEY (message_type, event_name)
        )
      `);

      db.run(`
        INSERT INTO format_settings (message_type, event_name, use_embed, template, color, updated_at)
        SELECT message_type, '', use_embed, template, color, updated_at FROM format_settings_old
      `);

      db.run('DROP TABLE format_settings_old');
    },
  },
  {
    id: 5,
    name: 'create_operators',
    up: (db) => {
      db.run(`
        CREATE TABLE operators (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_user_id TEXT NOT NULL UNIQUE,
          added_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `);
    },
  },
  {
    id: 6,
    name: 'add_operators_kind',
    up: (db) => {
      // Widens operators from just Discord users to also allow authorizing a
      // whole Discord role -- anyone holding an authorized role can run
      // "!"-prefixed commands, without being individually added. The unique
      // key moves from discord_user_id alone to (discord_id, kind), since a
      // user id and a role id could theoretically collide in isolation.
      db.run('ALTER TABLE operators RENAME TO operators_old');

      db.run(`
        CREATE TABLE operators (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('user', 'role')),
          added_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (discord_id, kind)
        )
      `);

      db.run(`
        INSERT INTO operators (discord_id, kind, added_by, created_at)
        SELECT discord_user_id, 'user', added_by, created_at FROM operators_old
      `);

      db.run('DROP TABLE operators_old');
    },
  },
];

export function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const appliedIds = new Set(
    db
      .query('SELECT id FROM schema_migrations')
      .all()
      .map((row) => (row as { id: number }).id),
  );

  const pending = migrations
    .filter((migration) => !appliedIds.has(migration.id))
    .sort((a, b) => a.id - b.id);

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.run('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [
        migration.id,
        migration.name,
      ]);
    })();
  }
}
