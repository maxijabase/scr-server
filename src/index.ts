import { DiscordBot } from './bot/discordBot.js';
import { loadConfig } from './config/config.js';
import { isLinkableRelayMessage, type RelayMessage } from './protocol/messages.js';
import { RelayServer } from './relay/relayServer.js';
import { Router } from './routing/router.js';
import { Store } from './store/store.js';

const config = loadConfig();

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  const levels = ['debug', 'info', 'warn', 'error'];
  if (levels.indexOf(level) < levels.indexOf(config.logLevel)) return;

  console.log(`[${level}] ${message}`);
}

const store = Store.open(config.databasePath);
const router = new Router(store);

let discordBot: DiscordBot;
let relayServer: RelayServer;

/**
 * Wired transport-agnostically: whichever side a message arrives on
 * (game-server WebSocket or Discord channel) resolves destinations via the
 * Router, then dispatches to each destination's own transport based on its
 * Node kind.
 */
function handleIncomingMessage(senderId: string, message: RelayMessage): void {
  if (!isLinkableRelayMessage(message)) {
    log('debug', `Ignoring message of non-linkable type "${message.type}" from ${senderId}`);
    return;
  }

  const content = message.type === 'chat' ? message.message : undefined;
  const result = router.route(senderId, message.type, content);

  if (result.filtered) {
    log('info', `Message from ${senderId} dropped by content filter`);
    return;
  }

  for (const destination of result.destinations) {
    if (destination.kind === 'game_server') {
      relayServer.sendToNode(destination.id, message);
    } else {
      void discordBot.deliverToChannel(destination.id, message);
    }
  }
}

relayServer = new RelayServer({
  port: config.port,
  store,
  onMessage: handleIncomingMessage,
  onLog: (message) => log('info', `[relay] ${message}`),
});

discordBot = new DiscordBot({
  token: config.discordToken,
  clientId: config.discordClientId,
  guildId: config.discordGuildId,
  store,
  onMessage: handleIncomingMessage,
  onLog: (message) => log('info', `[discord] ${message}`),
});

relayServer.start();
log('info', `Relay WebSocket server listening on port ${relayServer.actualPort ?? config.port}`);

await discordBot.start();

function shutdown(): void {
  log('info', 'Shutting down...');
  relayServer.stop();
  void discordBot.stop().finally(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
