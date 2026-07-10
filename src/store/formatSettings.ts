import type { Database } from 'bun:sqlite';
import type { LinkableMessageType } from '../protocol/messages.js';
import type { FormatSettingRecord } from './types.js';

/** Sentinel used for the row that represents a message type's generic default. */
const DEFAULT_EVENT_NAME = '';

interface FormatSettingRow {
  readonly message_type: string;
  readonly event_name: string;
  readonly use_embed: number;
  readonly template: string;
  readonly color: number | null;
  readonly updated_at: string;
}

function toFormatSettingRecord(row: FormatSettingRow): FormatSettingRecord {
  return {
    messageType: row.message_type as LinkableMessageType,
    eventName: row.event_name,
    useEmbed: row.use_embed !== 0,
    template: row.template,
    color: row.color ?? undefined,
    updatedAt: row.updated_at,
  };
}

export interface FormatSettingInput {
  readonly useEmbed: boolean;
  readonly template: string;
  readonly color?: number;
}

/**
 * Global (not per-channel/per-link) display settings for chat/event
 * messages delivered to Discord, keyed by (messageType, eventName).
 *
 * eventName is '' for a type's generic default (e.g. every event that
 * isn't otherwise overridden), or a specific event name (e.g. "Player
 * Kicked") for a targeted override. Built-in events and events raised by
 * a companion plugin via SCR_SendEvent are treated identically here --
 * neither gets a default row that the other doesn't, so there's nothing
 * special-cased about scr's own event names. Absence of a matching row
 * means "use the built-in default embed", see src/bot/formatting.ts.
 */
export class FormatSettingsRepository {
  public constructor(private readonly db: Database) {}

  public get(
    messageType: LinkableMessageType,
    eventName: string = DEFAULT_EVENT_NAME,
  ): FormatSettingRecord | undefined {
    const row = this.db
      .query('SELECT * FROM format_settings WHERE message_type = ? AND event_name = ?')
      .get(messageType, eventName) as FormatSettingRow | null;

    return row ? toFormatSettingRecord(row) : undefined;
  }

  /**
   * Looks up the format setting for a message, preferring a specific
   * `eventName` override and falling back to the type's generic default.
   * This is what delivery code (DiscordBot.deliverToChannel) should call.
   */
  public resolve(
    messageType: LinkableMessageType,
    eventName: string = DEFAULT_EVENT_NAME,
  ): FormatSettingRecord | undefined {
    if (eventName !== DEFAULT_EVENT_NAME) {
      const specific = this.get(messageType, eventName);

      if (specific) {
        return specific;
      }
    }

    return this.get(messageType, DEFAULT_EVENT_NAME);
  }

  public list(): FormatSettingRecord[] {
    const rows = this.db
      .query('SELECT * FROM format_settings ORDER BY message_type, event_name')
      .all() as FormatSettingRow[];

    return rows.map(toFormatSettingRecord);
  }

  public set(
    messageType: LinkableMessageType,
    eventName: string,
    input: FormatSettingInput,
  ): FormatSettingRecord {
    this.db.run(
      `INSERT INTO format_settings (message_type, event_name, use_embed, template, color, updated_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(message_type, event_name) DO UPDATE SET
         use_embed = excluded.use_embed,
         template = excluded.template,
         color = excluded.color,
         updated_at = excluded.updated_at`,
      [messageType, eventName, input.useEmbed ? 1 : 0, input.template, input.color ?? null],
    );

    const record = this.get(messageType, eventName);

    if (!record) {
      throw new Error(`Failed to save format setting for "${messageType}"/"${eventName}"`);
    }

    return record;
  }

  public reset(messageType: LinkableMessageType, eventName: string = DEFAULT_EVENT_NAME): boolean {
    const result = this.db.run('DELETE FROM format_settings WHERE message_type = ? AND event_name = ?', [
      messageType,
      eventName,
    ]);

    return result.changes > 0;
  }
}
