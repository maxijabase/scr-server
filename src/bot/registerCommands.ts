import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';

/** Registers slash commands, scoped to a single guild (fast) if `guildId` is set, otherwise globally. */
export async function registerCommands(
  token: string,
  clientId: string,
  guildId: string | undefined,
): Promise<void> {
  const rest = new REST().setToken(token);
  const body = commands.map((command) => command.data.toJSON());

  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body });
}
