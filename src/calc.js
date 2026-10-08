// The arithmetic operations exposed by the API.
//
// JavaScript numbers lose precision above 2^53, so terms and results are
// BigInt and every result is range-checked against int64. That keeps the
// API identical to the Go implementation. To add an operation, append it
// to OPERATIONS: the routes, the catalogue and the UI all read this list.

export const MAX_INT64 = 9223372036854775807n;
export const MIN_INT64 = -9223372036854775808n;

export class DivisionByZeroError extends Error {
  constructor() {
    super('division by zero');
    this.outcome = 'division_by_zero';
  }
}

export class OverflowError extends Error {
  constructor() {
    super('result overflows a 64-bit integer');
    this.outcome = 'overflow';
  }
}

/** @param {bigint} r */
function checked(r) {
  if (r > MAX_INT64 || r < MIN_INT64) throw new OverflowError();
  return r;
}

/** @typedef {{name: string, symbol: string, label: string, apply: (a: bigint, b: bigint) => bigint}} Operation */

/** @type {readonly Operation[]} */
export const OPERATIONS = Object.freeze([
  { name: 'sum', symbol: '+', label: 'Addition', apply: (a, b) => checked(a + b) },
  { name: 'sub', symbol: '−', label: 'Subtraction', apply: (a, b) => checked(a - b) },
  { name: 'mul', symbol: '×', label: 'Multiplication', apply: (a, b) => checked(a * b) },
  {
    name: 'div',
    symbol: '÷',
    label: 'Division',
    // BigInt division truncates toward zero: 7n / 2n === 3n, -7n / 2n === -3n.
    apply: (a, b) => {
      if (b === 0n) throw new DivisionByZeroError();
      return checked(a / b);
    },
  },
]);

/** @param {string} name */
export function lookup(name) {
  return OPERATIONS.find((op) => op.name === name);
}
