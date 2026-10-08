import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';

export function captureLogs() {
  const lines = [];
  return { lines, write: (s) => lines.push(s) };
}

/** Start the app on an ephemeral port. */
export async function startApp(env = {}) {
  const logs = captureLogs();
  const app = createApp(loadConfig(env), new Logger('info', logs), { env });
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app,
    base,
    logs,
    get: (path, init) => fetch(base + path, init),
    async close() {
      app.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
