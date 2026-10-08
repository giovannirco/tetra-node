// Small response helpers shared by the handlers.

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} body  already-serialized JSON
 */
export function sendRawJSON(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body + '\n'),
  });
  res.end(body + '\n');
}

/** Serialize with JSON.stringify and send. */
export function sendJSON(res, status, value) {
  sendRawJSON(res, status, JSON.stringify(value));
}

export function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

export function methodNotAllowed(res) {
  res.setHeader('Allow', 'GET, HEAD');
  sendError(res, 405, 'method not allowed');
}

export const isRead = (method) => method === 'GET' || method === 'HEAD';
