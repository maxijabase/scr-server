import type { LinkableMessageType } from '../protocol/messages.js';

export type NodeKind = 'game_server' | 'discord_channel';

export interface NodeRecord {
  readonly id: string;
  readonly kind: NodeKind;
  readonly displayName: string;
  readonly createdAt: string;
}

export type LinkDirection = 'one_way' | 'two_way';

export interface LinkRecord {
  readonly id: number;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly direction: LinkDirection;
  readonly allowedTypes: readonly LinkableMessageType[];
  readonly createdAt: string;
}

export interface FilterRecord {
  readonly id: number;
  readonly pattern: string;
  readonly createdAt: string;
}

export type OperatorKind = 'user' | 'role';

export interface OperatorRecord {
  readonly id: number;
  readonly discordId: string;
  readonly kind: OperatorKind;
  readonly addedBy: string;
  readonly createdAt: string;
}

export interface FormatSettingRecord {
  readonly messageType: LinkableMessageType;
  /** Specific event name this setting overrides, or '' for the type's generic default. */
  readonly eventName: string;
  readonly useEmbed: boolean;
  readonly template: string;
  readonly color: number | undefined;
  readonly updatedAt: string;
}
