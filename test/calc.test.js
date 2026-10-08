import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DivisionByZeroError, MAX_INT64, MIN_INT64, OPERATIONS, OverflowError, lookup } from '../src/calc.js';

const op = (name) => lookup(name).apply;

test('operations', async (t) => {
  const cases = [
    ['sum', 4n, 1n, 5n],
    ['sum', -4n, -6n, -10n],
    ['sum', MAX_INT64 - 1n, 1n, MAX_INT64],
    ['sum', MAX_INT64, 1n, OverflowError],
    ['sum', MIN_INT64, -1n, OverflowError],
    ['sub', 4n, 1n, 3n],
    ['sub', 1n, 4n, -3n],
    ['sub', MIN_INT64 + 1n, 1n, MIN_INT64],
    ['sub', MAX_INT64, -1n, OverflowError],
    ['sub', MIN_INT64, 1n, OverflowError],
    ['mul', 6n, 7n, 42n],
    ['mul', MAX_INT64, 0n, 0n],
    ['mul', -3n, 5n, -15n],
    ['mul', MIN_INT64, 1n, MIN_INT64],
    ['mul', MAX_INT64, 2n, OverflowError],
    ['mul', MIN_INT64, -1n, OverflowError],
    ['mul', 1n << 32n, 1n << 32n, OverflowError],
    ['div', 8n, 2n, 4n],
    ['div', 7n, 2n, 3n],
    ['div', -7n, 2n, -3n],
    ['div', 1n, 0n, DivisionByZeroError],
    ['div', 0n, 0n, DivisionByZeroError],
    ['div', MIN_INT64, -1n, OverflowError],
  ];
  for (const [name, a, b, want] of cases) {
    await t.test(`${name}(${a}, ${b})`, () => {
      if (typeof want === 'bigint') assert.equal(op(name)(a, b), want);
      else assert.throws(() => op(name)(a, b), want);
    });
  }
});

test('error outcomes', () => {
  assert.equal(new DivisionByZeroError().outcome, 'division_by_zero');
  assert.equal(new OverflowError().message, 'result overflows a 64-bit integer');
});

test('registry', () => {
  assert.deepEqual(
    OPERATIONS.map((o) => o.name),
    ['sum', 'sub', 'mul', 'div'],
  );
  for (const o of OPERATIONS) assert.ok(o.symbol && o.label && o.apply);
  assert.equal(lookup('pow'), undefined);
  assert.ok(Object.isFrozen(OPERATIONS));
});
