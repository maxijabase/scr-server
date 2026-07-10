import type { Store } from '../store/store.js';

/** Shared dependencies passed to every slash command handler. */
export interface BotContext {
  readonly store: Store;
}
