# scr-server

**Source Chat Relay** (SCR) server. This is a TypeScript/[Bun](https://bun.sh) rewrite of the original Go-based SCR server by **Fishy**. It bridges in-game chat and events on Source engine game servers with Discord, over a lightweight WebSocket relay. It exposes its admin and configuration surface as Discord slash commands.

The companion SourceMod plugin that runs on the game server side lives in [scr-client](https://github.com/maxijabase/scr-client).

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Running](#running)
- [Discord commands](#discord-commands)
- [Connecting a game server](#connecting-a-game-server)
- [Wire protocol](#wire-protocol)
- [Development](#development)
- [Project structure](#project-structure)
- [Differences from the original SCR](#differences-from-the-original-scr)

## What it does

- Relays in-game chat and custom events to one or more Discord channels, and Discord channel messages back to the game server(s) linked to them.
- Lets admins choose which servers and channels talk to each other, in which direction, and for which message types. All of this is configured from within Discord, with no config file editing.
- Supports a regex-based content filter to drop messages before they're ever routed.
- Lets admins fully customize how chat/events are displayed in Discord, per message type or per specific event name, as either an embed or plain text with a placeholder template.

## How it works

The server has two transports and a small routing core that's agnostic to both:

- **`RelayServer`** (`src/relay`). A Bun WebSocket server that game servers connect to. Each connection authenticates with a token, which the plugin persists on first connect, and becomes a **Node** of kind `game_server`.
- **`DiscordBot`** (`src/bot`). A [discord.js](https://discord.js.org) client. Every Discord channel that has been linked becomes a **Node** of kind `discord_channel`. It also hosts the `/node`, `/link`, `/filter`, and `/format` slash commands used to administer everything below.
- **`Router`** (`src/routing`). Given a message from a sending Node, it resolves which other Nodes should receive it by walking the **Link** graph. It then hands delivery off to whichever transport owns each destination Node. It has no idea whether a destination is a game server or a Discord channel. That job belongs to `src/index.ts`, which wires `Router`'s output back into `RelayServer.sendToNode` and `DiscordBot.deliverToChannel`.
- **`Store`** (`src/store`). A SQLite database, accessed via `bun:sqlite`, holding Nodes, Links, content filters, and format settings. Schema migrations are plain functions in `src/store/migrations.ts`, applied once each and tracked in a `schema_migrations` table.

Here's what each concept means in practice:

- **Node**. Anything that can send or receive messages. This is either a game server, identified by its auth token, or a Discord channel, identified by its channel id. Game server nodes are created automatically on first successful authentication. Discord channel nodes are created automatically the first time you run `/link create` on that channel.
- **Link**. A directed or bidirectional connection between two Nodes, scoped to a set of message types such as `chat`, `event`, or both. Nothing is relayed between two Nodes until a Link exists between them.
- **Content filter**. A list of regular expressions checked against a message's content before routing. A match drops the message entirely. It is never delivered anywhere, not even partially.
- **Format setting**. An optional override of how `chat` and `event` messages render in Discord, keyed by message type and, for events, optionally a specific event name. Without one, messages use a built-in default embed.

## Requirements

- [Bun](https://bun.sh) 1.x
- A Discord application and bot token, created via the [Discord Developer Portal](https://discord.com/developers/applications). Invite it to your server with permission to manage, read, and send messages in the channels you intend to link.
- One or more Source engine game servers running the [scr-client](https://github.com/maxijabase/scr-client) SourceMod plugin, if you want the game-server side of the relay. The server on its own is still useful as a Discord-side message router if you are integrating a different client.

## Getting started

```bash
git clone https://github.com/maxijabase/scr-server.git
cd scr-server
bun install
cp .env.example .env
```

Fill in `.env` (see [Configuration](#configuration)). Then start it:

```bash
bun run dev
```

On first run, the SQLite database and its schema are created automatically at `SCR_DATABASE_PATH` (default `./data/scr.sqlite`). Slash commands are also registered with Discord.

## Configuration

All configuration is via environment variables (Bun loads `.env` automatically). See `.env.example`:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SCR_PORT` | No | `57452` | Port the WebSocket relay server listens on for game server connections. |
| `SCR_DISCORD_TOKEN` | **Yes** | None | Discord bot token. |
| `SCR_DISCORD_CLIENT_ID` | **Yes** | None | Discord application/client id, used to register slash commands. |
| `SCR_DISCORD_GUILD_ID` | No | None | If set, slash commands are registered to this single guild only, which is near-instant and good for development. Leave unset to register them globally, which can take up to an hour to propagate. |
| `SCR_DATABASE_PATH` | No | `./data/scr.sqlite` | Path to the SQLite database file. Parent directories are created automatically. |
| `SCR_LOG_LEVEL` | No | `info` | One of `debug`, `info`, `warn`, `error`. |

## Running

Locally, with Bun installed:

```bash
bun run dev     # bun --watch, restarts on file changes
bun run start   # single run, no watcher (what the Docker image uses)
```

With Docker:

```bash
docker build -t scr-server .
docker run -d \
  --name scr-server \
  --env-file .env \
  -p 57452:57452 \
  -v scr-data:/app/data \
  scr-server
```

The image (`Dockerfile`) is a minimal `oven/bun:1-alpine` build. It installs only production dependencies and runs `bun run src/index.ts` directly, since Bun runs TypeScript natively with no separate build step. The volume mount matters because it is where the SQLite database lives, and it should persist across container restarts and recreates.

## Discord commands

All commands require the **Manage Guild** permission. They reply ephemerally, so only the admin who ran them can see the response.

### `/node`

Manage Nodes, which represent game servers and Discord channels. Nodes are otherwise created automatically, so these commands are mainly for cleanup and inspection.

- `/node list`: list all known Nodes with their id, kind, and display name.
- `/node rename node:<node> name:<name>`: change a Node's display name. Autocompletes on existing Nodes.
- `/node delete node:<node>`: delete a Node and any Links referencing it.

### `/link`

Manage Links between Nodes. Nothing is relayed between two Nodes without one.

- `/link create source:<node> target:<#channel> direction:<one_way|two_way> types:<chat,event|chat|event>`: link an existing Node to a Discord channel. The source autocompletes over existing Nodes, such as a game server that has connected at least once. The target channel's Node is created automatically if it doesn't exist yet.
- `/link list`: list all Links, showing direction and allowed message types.
- `/link delete link:<link>`: delete a Link. Autocompletes on existing Links.

### `/filter`

Manage the regex content filter, checked against message content before routing.

- `/filter add pattern:<regex>`: add a filter pattern.
- `/filter list`: list all configured patterns with their ids.
- `/filter remove id:<id>`: remove a pattern by id.

### `/format`

Customize how `chat` and `event` messages are rendered in Discord, either for a whole message type or for one specific event name. For example, a `"Player Kicked"` event can have its own look, distinct from the generic `event` default.

- `/format set type:<chat|event> mode:<embed|plain> template:<template> [event:<name>] [color:<#hex>]`: set the format. Templates use `{placeholder}` syntax, described below. Use `\n` for a line break, since Discord options can't contain literal newlines. This command rejects unknown placeholders before saving, and previews the result with sample data on success.
- `/format show type:<chat|event> [event:<name>]`: show the current setting, or confirm that the default is in use.
- `/format reset type:<chat|event> [event:<name>]`: revert to the default embed.
- `/format list`: list every configured override, both generic and per-event.
- `/format placeholders type:<chat|event>`: list the valid placeholders for a type.

Available placeholders:

| Type | Placeholders |
| --- | --- |
| `chat` | `{entityName}`, `{username}`, `{message}`, `{id}`, `{idType}`, `{profileUrl}` |
| `event` | `{entityName}`, `{event}`, `{data}` |

`{profileUrl}` is derived automatically from `{idType}` and `{id}`. It is a Steam or Discord profile link, and it is never sent over the wire.

## Connecting a game server

1. Install [scr-client](https://github.com/maxijabase/scr-client) on the game server (see its README for the SourceMod extension prerequisites) and point it at this server's host/port.
2. On first connect, the plugin generates and persists its own auth token. After its first message, the game server appears in Discord under its configured hostname. Check `/node list` or the autocomplete on `/link create` to find it.
3. Run `/link create source:<the game server> target:#some-channel direction:two_way types:chat,event` in Discord to start relaying.

## Wire protocol

Messages are plain JSON objects sent over the WebSocket connection, one per frame. See `src/protocol` for the implementation. There is no binary framing.

| `type` | Direction | Fields |
| --- | --- | --- |
| `authenticate` | client → server | `token` |
| `authenticateResponse` | server → client | `success`, `reason?` |
| `chat` | either | `entityName`, `idType` (`steam`\|`discord`\|`unknown`), `id`, `username`, `message` |
| `event` | either | `entityName`, `event`, `data` |

A connection must successfully `authenticate` before any other message is accepted. Unrecognized `type` values are not rejected outright. They are kept around as a generic passthrough, but nothing currently routes or displays them, since only `chat` and `event` count as "linkable" message types.

## Development

```bash
bun install       # install dependencies
bun run dev        # run with --watch
bun test           # run the test suite (bun:test)
bun run typecheck  # tsc --noEmit
bun run lint       # eslint .
bun run format     # prettier --write .
bun run knip       # find unused files/exports/dependencies
```

Tests live in `test/`. They cover the protocol codec, routing, formatting and templating, the store's repositories, and the relay server's authentication and delivery behavior end-to-end against an in-memory SQLite database.

## Project structure

```
src/
├── index.ts             # entry point: wires RelayServer + DiscordBot + Router + Store together
├── config/
│   └── config.ts        # env var loading/validation
├── protocol/
│   ├── messages.ts       # message type definitions
│   ├── codec.ts          # JSON (de)serialization + validation
│   ├── guards.ts          # runtime type guards used by the codec
│   └── result.ts          # small Result<T> helper type
├── relay/
│   ├── relayServer.ts     # WebSocket server: auth handshake + game-server transport
│   └── connectionState.ts # per-connection state attached to each socket
├── routing/
│   └── router.ts          # resolves message destinations via the Node/Link graph
├── store/
│   ├── db.ts               # SQLite connection + migration bootstrap
│   ├── migrations.ts       # ordered schema migrations
│   ├── nodes.ts, links.ts, filters.ts, formatSettings.ts  # typed repositories
│   ├── store.ts            # aggregates the repositories above
│   └── types.ts            # shared record types
└── bot/
    ├── discordBot.ts        # Discord client: channel transport + command dispatch
    ├── context.ts             # shared context (Store) passed to commands
    ├── commandModule.ts       # SlashCommandModule interface
    ├── registerCommands.ts    # registers slash commands with Discord
    ├── formatting.ts          # renders a RelayMessage for Discord delivery
    ├── template.ts            # {placeholder} template rendering for /format
    └── commands/               # /node, /link, /filter, /format implementations
```

## Differences from the original SCR

This is a from-scratch rewrite, not a line-for-line port. Notable differences from the original Go server:

- **Runtime**. The original was written in Go. This rewrite uses TypeScript on Bun, which runs `.ts` files directly with no separate build step.
- **Storage**. The original used MySQL. This rewrite uses embedded SQLite through `bun:sqlite`, so there is no external database to provision.
- **Configuration**. The original used a `config.toml` file plus a separate `filter.txt` file. This rewrite uses environment variables in `.env` for connection settings. Filters, routing, and formatting are now configured live through Discord, with no config edit or restart required.
- **Routing**. The old server matched servers and channels through a shared numeric "channel" id, using a `ReceiveChannels`/`SendChannels` intersection. This rewrite replaces that with an explicit, directed Node and Link graph, managed through `/link`. It is easier to reason about and audit, since `/link list` shows the whole graph at once.
- **Message display**. The old server had a `SimpleMessage` boolean, choosing between an embed or plain `"Name: Message"` text. This rewrite replaces it with the `/format` command's per-type and per-event templates, which support arbitrary placeholder-based templates in either embed or plain-text mode, not just a fixed pair of styles.
- **Web UI**. The original included an optional, unauthenticated web UI for configuration. This rewrite has no web UI. All administration happens through Discord slash commands, which already have Discord's own permission model behind them.
