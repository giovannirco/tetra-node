// RED metrics for every request, calculation outcomes, and one structured
// log line per request. Names and labels match the other Tetra
// implementations, so one dashboard and one rule file cover all of them.

import client from 'prom-client';

const STREAM_ROUTE = '/events';
const QUIET_ROUTES = new Set(['/healthz', '/readyz', '/metrics']);
const BUCKETS = [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];

/**
 * @param {{implementation: string, version: string, commit: string, runtime: string}} info
 * @param {{subscribers: number, dropped: number}} live
 * @param {import('./logger.js').Logger} logger
 */
export function createTelemetry(info, live, logger) {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const requests = new client.Counter({
    name: 'tetra_http_requests_total',
    help: 'HTTP requests by method, route and status code.',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const duration = new client.Histogram({
    name: 'tetra_http_request_duration_seconds',
    help: 'HTTP request latency by method and route.',
    labelNames: ['method', 'route'],
    buckets: BUCKETS,
    registers: [registry],
  });
  const inFlight = new client.Gauge({
    name: 'tetra_http_requests_in_flight',
    help: 'HTTP requests currently being served, live streams included.',
    registers: [registry],
  });
  const calcOps = new client.Counter({
    name: 'tetra_calc_operations_total',
    help: 'Calculations by operation and outcome (ok, invalid_input, division_by_zero, overflow).',
    labelNames: ['operation', 'outcome'],
    registers: [registry],
  });
  new client.Gauge({
    name: 'tetra_build_info',
    help: 'Always 1; labels identify the running build.',
    labelNames: ['implementation', 'version', 'commit', 'runtime'],
    registers: [registry],
  }).set({ implementation: info.implementation, version: info.version, commit: info.commit, runtime: info.runtime }, 1);
  new client.Gauge({
    name: 'tetra_live_subscribers',
    help: 'Open Server-Sent Events streams.',
    registers: [registry],
    collect() {
      this.set(live.subscribers);
    },
  });
  new client.Counter({
    name: 'tetra_live_events_dropped_total',
    help: 'Live events dropped because a subscriber was too slow.',
    registers: [registry],
    collect() {
      this.reset();
      this.inc(live.dropped);
    },
  });

  return {
    registry,

    calcOutcome(operation, outcome) {
      calcOps.inc({ operation, outcome });
    },

    /** Start measuring a request; call the returned function once the route is known. */
    track(req, res, requestId) {
      const started = process.hrtime.bigint();
      inFlight.inc();
      let route = 'unmatched';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        inFlight.dec();
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        const status = res.statusCode;
        requests.inc({ method: req.method, route, status: String(status) });
        if (route !== STREAM_ROUTE) duration.observe({ method: req.method, route }, seconds);

        const level = QUIET_ROUTES.has(route) && status < 400 ? 'debug' : 'info';
        logger.log(level, 'request', {
          method: req.method,
          path: req.url.split('?')[0],
          route,
          status,
          bytes: res.getHeader('Content-Length') === undefined ? undefined : Number(res.getHeader('Content-Length')),
          duration_ms: Math.round(seconds * 1e6) / 1e3,
          request_id: requestId,
          remote_addr: `${req.socket.remoteAddress}:${req.socket.remotePort}`,
          user_agent: req.headers['user-agent'] ?? '',
        });
      };
      res.on('finish', finish);
      res.on('close', finish);
      return (matchedRoute) => {
        route = matchedRoute;
      };
    },
  };
}
