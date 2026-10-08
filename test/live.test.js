import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Broker } from '../src/live.js';

async function serve(broker) {
  const server = createServer((req, res) => broker.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const waitFor = async (cond) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), 'condition not met in time');
};

async function readUntil(reader, needle) {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before ${needle}`);
    text += decoder.decode(value);
  }
  return text;
}

test('publish reaches a subscriber; heartbeat; unsubscribe on close', async () => {
  const broker = new Broker(10, { heartbeatMs: 20 });
  const srv = await serve(broker);
  try {
    const res = await fetch(srv.url);
    const reader = res.body.getReader();
    await readUntil(reader, 'retry: 3000');
    await waitFor(() => broker.subscribers === 1);

    broker.publish({ operation: 'sum' });
    await readUntil(reader, 'event: calc\ndata: {"operation":"sum"}');
    await readUntil(reader, ': keep-alive');

    await reader.cancel();
    await waitFor(() => broker.subscribers === 0);
  } finally {
    await srv.close();
  }
});

test('stream limit and close', async () => {
  const broker = new Broker(1);
  const srv = await serve(broker);
  try {
    const first = await fetch(srv.url);
    await waitFor(() => broker.subscribers === 1);
    const second = await fetch(srv.url);
    assert.equal(second.status, 503);
    await second.text();

    broker.close();
    await first.text(); // ends because the broker closed it
    assert.equal(broker.subscribers, 0);
    const after = await fetch(srv.url);
    assert.equal(after.status, 503);
    await after.text();
  } finally {
    await srv.close();
  }
});

test('a full socket buffer drops the event instead of buffering it', () => {
  const broker = new Broker(10);
  const writes = [];
  const slow = { writableNeedDrain: true, write: (s) => writes.push(s) };
  const fast = { writableNeedDrain: false, write: (s) => writes.push(s) };
  broker.subs.add(slow);
  broker.subs.add(fast);
  broker.publish({ n: 1 });
  broker.publish({ n: 2 });
  assert.equal(broker.dropped, 2);
  assert.equal(writes.length, 2);
});
