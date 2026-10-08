import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { start } from '../src/server.js';
import { captureLogs } from './helpers.js';

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

test('start serves, stop drains and closes', async () => {
  const logs = captureLogs();
  const port = await freePort();
  const { stop } = await start({ env: { PORT: String(port), DRAIN_DELAY_SECONDS: '0' }, out: logs });

  const res = await fetch(`http://127.0.0.1:${port}/api/sum?term_one=2&term_two=3`);
  assert.deepEqual(await res.json(), { result: 5 });

  await Promise.all([stop(), stop()]); // idempotent
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`));
  const msgs = logs.lines.map((l) => JSON.parse(l).msg);
  for (const m of ['listening', 'shutting down', 'stopped']) assert.ok(msgs.includes(m), `missing log ${m}`);
});

test('start fails on a port in use and on bad config', async () => {
  const port = await freePort();
  const first = await start({ env: { PORT: String(port), DRAIN_DELAY_SECONDS: '0' }, out: captureLogs() });
  await assert.rejects(start({ env: { PORT: String(port) }, out: captureLogs() }), /EADDRINUSE/);
  await first.stop();
  await assert.rejects(start({ env: { PORT: 'nope' } }), /PORT/);
});

test('config defaults, overrides and errors', () => {
  assert.deepEqual(loadConfig({}), {
    port: 8000,
    logLevel: 'info',
    drainDelayMs: 5000,
    shutdownTimeoutMs: 10000,
    maxLiveStreams: 100,
  });
  assert.deepEqual(
    loadConfig({
      PORT: '9000',
      LOG_LEVEL: 'DEBUG',
      DRAIN_DELAY_SECONDS: '0',
      SHUTDOWN_TIMEOUT_SECONDS: '30',
      MAX_LIVE_STREAMS: '5',
    }),
    { port: 9000, logLevel: 'debug', drainDelayMs: 0, shutdownTimeoutMs: 30000, maxLiveStreams: 5 },
  );
  for (const bad of [
    { PORT: 'eighty' },
    { PORT: '70000' },
    { LOG_LEVEL: 'loud' },
    { DRAIN_DELAY_SECONDS: '-1' },
    { SHUTDOWN_TIMEOUT_SECONDS: '0' },
    { MAX_LIVE_STREAMS: '1.5' },
  ]) {
    assert.throws(() => loadConfig(bad), Error, JSON.stringify(bad));
  }
});

test('logger levels and fields', () => {
  const logs = captureLogs();
  const log = new Logger('warn', logs);
  log.debug('hidden');
  log.info('hidden');
  log.warn('shown', { a: 1, skip: undefined });
  log.error('also shown');
  assert.equal(logs.lines.length, 2);
  const entry = JSON.parse(logs.lines[0]);
  assert.equal(entry.level, 'WARN');
  assert.equal(entry.msg, 'shown');
  assert.equal(entry.a, 1);
  assert.ok(!('skip' in entry) && entry.time);
});
