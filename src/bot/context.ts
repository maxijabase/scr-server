import type { Store } from '../store/store.js';

/** Shared dependencies passed to every slash command handler. */
export interface BotContext {
  readonly store: Store;
  /** Discord user id of the bot owner (SCR_DISCORD_OWNER_ID), or undefined if unset. */
  readonly ownerId: string | undefined;
}
