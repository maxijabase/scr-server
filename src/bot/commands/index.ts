import type { SlashCommandModule } from '../commandModule.js';
import { filterCommand } from './filter.js';
import { formatCommand } from './format.js';
import { linkCommand } from './link.js';
import { nodeCommand } from './node.js';

export const commands: readonly SlashCommandModule[] = [
  nodeCommand,
  linkCommand,
  filterCommand,
  formatCommand,
];
