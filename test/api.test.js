import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

let srv;
before(async () => {
  srv = await startApp();
});
after(() => srv.close());

test('calculations', async (t) => {
  const cases = [
    ['/api/sum?term_one=4&term_two=1', 200, '{"result":5}'],
    ['/api/sub?term_one=4&term_two=1', 200, '{"result":3}'],
    ['/api/mul?term_one=4&term_two=1', 200, '{"result":4}'],
    ['/api/div?term_one=4&term_two=1', 200, '{"result":4}'],
    ['/api/div?term_one=7&term_two=2', 200, '{"result":3}'],
    ['/api/sum?term_one=-4&term_two=%2B10', 200, '{"result":6}'],
    ['/api/sum?term_one=9223372036854775807&term_two=0', 200, '{"result":9223372036854775807}'],
    ['/api/div?term_one=1&term_two=0', 400, '{"error":"division by zero"}'],
    ['/api/mul?term_one=9223372036854775807&term_two=2', 400, '{"error":"result overflows a 64-bit integer"}'],
    ['/api/sum?term_two=1', 400, '{"error":"missing query parameter term_one"}'],
    ['/api/sum?term_one=1', 400, '{"error":"missing query parameter term_two"}'],
    ['/api/sum?term_one=abc&term_two=1', 400, '{"error":"term_one must be an integer, got \\"abc\\""}'],
    ['/api/sum?term_one=1.5&term_two=1', 400, '{"error":"term_one must be an integer, got \\"1.5\\""}'],
    [
      '/api/sum?term_one=1&term_two=99999999999999999999',
      400,
      '{"error":"term_two is outside the 64-bit integer range"}',
    ],
  ];
  for (const [path, status, body] of cases) {
    await t.test(path, async () => {
      const res = await srv.get(path);
      assert.equal(res.status, status);
      assert.equal((await res.text()).trim(), body);
      assert.match(res.headers.get('content-type'), /^application\/json/);
    });
  }
});

test('long input is cut in the error message', async () => {
  const res = await srv.get(`/api/sum?term_one=${'x'.repeat(40)}&term_two=1`);
  const { error } = await res.json();
  assert.equal(error, `term_one must be an integer, got "${'x'.repeat(32)}…"`);
});

test('catalogue', async () => {
  const res = await srv.get('/api');
  const body = await res.json();
  assert.equal(body.implementation, 'node');
  assert.equal(body.operations.length, 4);
  assert.equal(body.operations[3].path, '/api/div');
});

test('fallback: 405 for a known operation, 404 otherwise', async () => {
  const post = await srv.get('/api/sum?term_one=1&term_two=1', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.deepEqual(await post.json(), { error: 'method not allowed' });

  const unknown = await srv.get('/api/pow?term_one=2&term_two=8');
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'not found' });

  const wrongVerb = await srv.get('/api/pow', { method: 'DELETE' });
  assert.equal(wrongVerb.status, 404);

  const head = await srv.get('/api/sum?term_one=1&term_two=1', { method: 'HEAD' });
  assert.equal(head.status, 200);
});
