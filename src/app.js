// Wires the modules into one request handler.
//
// Request path: request ID → security headers → telemetry → routes.

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { apiFallback, apiRoutes } from './api.js';
import { isRead, methodNotAllowed, sendError, sendJSON } from './http-util.js';
import { Broker } from './live.js';
import { staticFiles } from './static.js';
import { createTelemetry } from './telemetry.js';
import { versionInfo } from './version.js';

const WEB_ROOT = fileURLToPath(new URL('../web', import.meta.url));

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Keep a well-formed incoming X-Request-Id (set by a gateway, say), else make one. */
export function requestIdFor(req) {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomBytes(16).toString('hex');
}

/**
 * @param {ReturnType<import('./config.js').loadConfig>} config
 * @param {import('./logger.js').Logger} logger
 */
export function createApp(config, logger, { env = process.env } = {}) {
  const info = versionInfo(env);
  let draining = false;
  const broker = new Broker(config.maxLiveStreams);
  const telemetry = createTelemetry(info, broker, logger);

  const routes = apiRoutes(
    { service: info.service, implementation: info.implementation, version: info.version },
    (event) => {
      telemetry.calcOutcome(event.operation, event.outcome);
      broker.publish(event);
    },
  );
  routes.set('/healthz', (req, res) => sendJSON(res, 200, { status: 'ok' }));
  routes.set('/readyz', (req, res) =>
    draining ? sendJSON(res, 503, { status: 'draining' }) : sendJSON(res, 200, { status: 'ready' }),
  );
  routes.set('/version', (req, res) => sendJSON(res, 200, info));
  routes.set('/events', (req, res) => broker.handle(req, res));
  routes.set('/metrics', async (req, res) => {
    const body = await telemetry.registry.metrics();
    res.writeHead(200, { 'Content-Type': telemetry.registry.contentType, 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  });
  const serveStatic = staticFiles(WEB_ROOT);

  async function handler(req, res) {
    const requestId = requestIdFor(req);
    res.setHeader('X-Request-Id', requestId);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const setRoute = telemetry.track(req, res, requestId);

    try {
      const url = new URL(req.url, 'http://localhost');
      const route = routes.get(url.pathname);
      if (route) {
        setRoute(url.pathname);
        if (!isRead(req.method)) return methodNotAllowed(res);
        return await route(req, res, url, requestId);
      }
      if (url.pathname.startsWith('/api/')) {
        setRoute('/api/');
        return apiFallback(req, res, url);
      }
      setRoute('/');
      if (!isRead(req.method)) return methodNotAllowed(res);
      return serveStatic(req, res, url);
    } catch (err) {
      logger.error('unhandled error', { request_id: requestId, error: String(err?.stack || err) });
      if (!res.headersSent) sendError(res, 500, 'internal error');
      else res.end();
    }
  }

  return {
    handler,
    /** Fail readiness; called when shutdown starts. */
    drain() {
      draining = true;
    },
    /** End the live streams so server.close() can finish. */
    close() {
      broker.close();
    },
    info,
  };
}
