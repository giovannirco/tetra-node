import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, requestIdFor } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { captureLogs, startApp } from './helpers.js';

test('operations endpoints, headers and metrics', async () => {
  const srv = await startApp({ VERSION: 'v9.9.9', COMMIT: 'abc1234' });
  try {
    const res = await srv.get('/api/sub?term_one=4&term_two=1');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('x-request-id'), /^[0-9a-f]{32}$/);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');

    assert.deepEqual(await (await srv.get('/healthz')).json(), { status: 'ok' });
    assert.deepEqual(await (await srv.get('/readyz')).json(), { status: 'ready' });

    const version = await (await srv.get('/version')).json();
    assert.equal(version.implementation, 'node');
    assert.equal(version.version, 'v9.9.9');
    assert.equal(version.commit, 'abc1234');
    assert.ok(version.hostname && version.started_at);

    await srv.get('/nowhere-at-all');
    const metrics = await (await srv.get('/metrics')).text();
    for (const want of [
      'tetra_http_requests_total{method="GET",route="/api/sub",status="200"} 1',
      'tetra_http_requests_total{method="GET",route="/",status="404"} 1',
      'tetra_http_request_duration_seconds_count{method="GET",route="/api/sub"} 1',
      'tetra_calc_operations_total{operation="sub",outcome="ok"} 1',
      'tetra_build_info{implementation="node",version="v9.9.9",commit="abc1234",runtime="node',
      'tetra_live_subscribers 0',
      'tetra_live_events_dropped_total 0',
      'tetra_http_requests_in_flight 1',
      'process_resident_memory_bytes',
    ]) {
      assert.ok(metrics.includes(want), `metrics are missing ${want}`);
    }

    const entry = srv.logs.lines.map((l) => JSON.parse(l)).find((e) => e.route === '/api/sub');
    assert.equal(entry.msg, 'request');
    assert.equal(entry.level, 'INFO');
    assert.equal(entry.status, 200);
    assert.ok(entry.request_id && entry.duration_ms >= 0 && entry.bytes > 0);
    assert.ok(!srv.logs.lines.some((l) => JSON.parse(l).route === '/healthz'), 'probes log at debug');
  } finally {
    await srv.close();
  }
});

test('request id: keeps a valid one, replaces anything else', () => {
  assert.equal(requestIdFor({ headers: { 'x-request-id': 'gw-1234.abc_DEF' } }), 'gw-1234.abc_DEF');
  for (const bad of [undefined, '', 'bad id', 'a'.repeat(65)]) {
    assert.match(requestIdFor({ headers: { 'x-request-id': bad } }), /^[0-9a-f]{32}$/);
  }
});

test('static UI', async () => {
  const srv = await startApp();
  try {
    const index = await srv.get('/');
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('cache-control'), 'no-cache');
    assert.match(await index.text(), /<canvas id="scene"/);

    const vendor = await srv.get('/vendor/three/build/three.module.min.js');
    assert.equal(vendor.status, 200);
    assert.equal(vendor.headers.get('cache-control'), 'public, max-age=86400');
    assert.match(vendor.headers.get('content-type'), /^text\/javascript/);
    await vendor.arrayBuffer();

    assert.equal((await srv.get('/nope.js')).status, 404);
    assert.equal((await srv.get('/../package.json')).status, 404);
    assert.equal((await srv.get('/', { method: 'POST' })).status, 405);
    assert.equal((await srv.get('/healthz', { method: 'PUT' })).status, 405);
  } finally {
    await srv.close();
  }
});

test('drain fails readiness; events reach the live stream', async () => {
  const srv = await startApp();
  try {
    const stream = await srv.get('/events');
    assert.equal(stream.headers.get('content-type'), 'text/event-stream');
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    assert.match(text, /^retry: 3000/);

    await srv.get('/api/mul?term_one=6&term_two=7');
    while (!text.includes('data: ')) text += decoder.decode((await reader.read()).value);
    const event = JSON.parse(text.split('data: ')[1].split('\n')[0]);
    assert.equal(event.operation, 'mul');
    assert.equal(event.result, '42');
    assert.equal(event.outcome, 'ok');
    assert.ok(event.duration_ms >= 0 && event.request_id);

    srv.app.drain();
    const ready = await srv.get('/readyz');
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: 'draining' });
    await reader.cancel();
  } finally {
    await srv.close();
  }
});

test('an unexpected error becomes a 500 and is logged', async () => {
  const logs = captureLogs();
  const app = createApp(loadConfig({}), new Logger('info', logs));
  const res = {
    headers: {},
    headersSent: false,
    statusCode: 200,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    getHeader(k) {
      return this.headers[k];
    },
    writeHead(status, h) {
      this.statusCode = status;
      Object.assign(this.headers, h);
      this.headersSent = true;
    },
    end(body) {
      this.body = body;
    },
    on() {},
  };
  const url = {
    toString() {
      throw new Error('boom');
    },
  };
  await app.handler({ url, method: 'GET', headers: {}, socket: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.match(logs.lines.join(''), /unhandled error/);
});
