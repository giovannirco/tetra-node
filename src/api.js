// The /api routes: the four calculations, the catalogue, and the fallback.
//
// This module knows nothing about metrics, the live stream or the UI; they
// observe calculations through the onEvent callback.

import { OPERATIONS, MAX_INT64, MIN_INT64, lookup } from './calc.js';
import { methodNotAllowed, sendError, sendJSON, sendRawJSON } from './http-util.js';

const MAX_ECHO = 32;
const INTEGER = /^[+-]?\d+$/;

class InputError extends Error {
  outcome = 'invalid_input';
}

const truncate = (s) => (s.length <= MAX_ECHO ? s : `${s.slice(0, MAX_ECHO)}…`);

/**
 * Parse a base-10 int64 with an optional sign.
 * @param {URLSearchParams} query
 * @param {string} name
 */
export function parseTerm(query, name) {
  const raw = query.get(name) ?? '';
  if (raw === '') throw new InputError(`missing query parameter ${name}`);
  if (!INTEGER.test(raw)) throw new InputError(`${name} must be an integer, got ${JSON.stringify(truncate(raw))}`);
  const value = BigInt(raw);
  if (value > MAX_INT64 || value < MIN_INT64) throw new InputError(`${name} is outside the 64-bit integer range`);
  return value;
}

/**
 * @param {{service: string, implementation: string, version: string}} info
 * @param {(event: object) => void} [onEvent]
 * @returns {Map<string, (req, res, url: URL, requestId: string) => void>} path -> handler
 */
export function apiRoutes(info, onEvent) {
  const routes = new Map();
  const catalogue = {
    ...info,
    operations: OPERATIONS.map(({ name, symbol, label }) => ({ name, symbol, label, path: `/api/${name}` })),
  };
  routes.set('/api', (req, res) => sendJSON(res, 200, catalogue));

  for (const op of OPERATIONS) {
    routes.set(`/api/${op.name}`, (req, res, url, requestId) => {
      const started = process.hrtime.bigint();
      const q = url.searchParams;
      const event = {
        operation: op.name,
        term_one: truncate(q.get('term_one') ?? ''),
        term_two: truncate(q.get('term_two') ?? ''),
        result: null,
        status: 200,
        outcome: 'ok',
        request_id: requestId,
        time: new Date().toISOString(),
      };
      try {
        const result = op.apply(parseTerm(q, 'term_one'), parseTerm(q, 'term_two'));
        event.result = result.toString();
        // Written by hand: JSON.stringify cannot serialize a BigInt.
        sendRawJSON(res, 200, `{"result":${result}}`);
      } catch (err) {
        if (!err.outcome) throw err;
        Object.assign(event, { status: 400, outcome: err.outcome, error: err.message });
        sendError(res, 400, err.message);
      }
      if (onEvent) {
        event.duration_ms = Number(process.hrtime.bigint() - started) / 1e6;
        onEvent(event);
      }
    });
  }
  return routes;
}

/** Any other /api/ path: 405 for a known operation with the wrong method, else 404. */
export function apiFallback(req, res, url) {
  if (lookup(url.pathname.slice('/api/'.length))) methodNotAllowed(res);
  else sendError(res, 404, 'not found');
}
