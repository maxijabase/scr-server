import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { BotContext } from './context.js';

/**
 * Minimal structural shape shared by all of discord.js's slash-command
 * builder variants, regardless of which chain of `.addSubcommand()` /
 * `.addStringOption()` etc. calls produced them -- avoids depending on
 * discord.js's precise (and intentionally restrictive) builder return types.
 */
export interface CommandData {
  readonly name: string;
  toJSON(): unknown;
}

export interface SlashCommandModule {
  readonly data: CommandData;
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: BotContext): Promise<void>;
}
