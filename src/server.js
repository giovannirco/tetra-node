// Entry point: serves the Tetra API and UI on port 8000 and shuts down
// gracefully on SIGTERM (fail readiness, drain, close).

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { Logger } from './logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the server. Resolves with a stop() function that runs the same
 * shutdown sequence as SIGTERM.
 */
export async function start({ env = process.env, out = process.stdout } = {}) {
  const config = loadConfig(env);
  const logger = new Logger(config.logLevel, out);
  const app = createApp(config, logger, { env });

  const server = createServer(app.handler);
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 60_000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info('listening', { addr: `:${config.port}`, version: app.info.version });

  let stopping;
  const stop = () => {
    stopping ??= (async () => {
      logger.info('shutting down', { drain_delay: `${config.drainDelayMs / 1000}s` });
      // Keep serving while endpoints and load balancers stop routing here.
      app.drain();
      await sleep(config.drainDelayMs);
      app.close();
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections();
      // Connections still open after the timeout are cut.
      const force = setTimeout(() => server.closeAllConnections(), config.shutdownTimeoutMs);
      await closed;
      clearTimeout(force);
      logger.info('stopped');
    })();
    return stopping;
  };
  return { server, stop, port: server.address().port };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const { stop } = await start();
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, () => stop().then(() => process.exit(0)));
    }
  } catch (err) {
    console.error('tetra:', err.message);
    process.exit(1);
  }
}
