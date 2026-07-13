/**
 * Consolidated runtime configuration, loaded from environment variables.
 *
 * Bun automatically loads `.env` files, so this module only needs to read
 * `process.env` and validate/coerce values. This replaces the old
 * `config.toml` + `filter.txt` pair -- filters now live in the database
 * (see src/store), everything else lives here.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  readonly port: number;
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly discordGuildId: string | undefined;
  readonly discordOwnerId: string | undefined;
  readonly databasePath: string;
  readonly logLevel: LogLevel;
}

class ConfigError extends Error {}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function readRequiredString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readOptionalString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];

  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function readPort(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];

  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new ConfigError(`${key} must be an integer between 1 and 65535, got: ${raw}`);
  }

  return parsed;
}

function readLogLevel(env: NodeJS.ProcessEnv, key: string, fallback: LogLevel): LogLevel {
  const raw = env[key];

  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new ConfigError(`${key} must be one of ${LOG_LEVELS.join(', ')}, got: ${raw}`);
  }

  return raw as LogLevel;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readPort(env, 'SCR_PORT', 57452),
    discordToken: readRequiredString(env, 'SCR_DISCORD_TOKEN'),
    discordClientId: readRequiredString(env, 'SCR_DISCORD_CLIENT_ID'),
    discordGuildId: readOptionalString(env, 'SCR_DISCORD_GUILD_ID'),
    discordOwnerId: readOptionalString(env, 'SCR_DISCORD_OWNER_ID'),
    databasePath: env['SCR_DATABASE_PATH']?.trim() || './data/scr.sqlite',
    logLevel: readLogLevel(env, 'SCR_LOG_LEVEL', 'info'),
  };
}
