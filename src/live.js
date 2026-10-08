// Fans calculation events out to browsers over Server-Sent Events.
//
// Publishing never blocks a request: when a subscriber's socket buffer is
// full, the event is dropped for that subscriber and counted. Each process
// streams its own events; cross-replica fan-out is in docs/PLAN.md.

import { sendError } from './http-util.js';

export class Broker {
  /** @param {number} maxStreams */
  constructor(maxStreams, { heartbeatMs = 15_000 } = {}) {
    this.maxStreams = maxStreams;
    this.heartbeatMs = heartbeatMs;
    /** @type {Set<import('node:http').ServerResponse>} */
    this.subs = new Set();
    this.dropped = 0;
    this.closed = false;
  }

  get subscribers() {
    return this.subs.size;
  }

  publish(value) {
    const frame = `event: calc\ndata: ${JSON.stringify(value)}\n\n`;
    for (const res of this.subs) {
      if (res.writableNeedDrain) this.dropped++;
      else res.write(frame);
    }
  }

  /** Ends every stream and refuses new ones; server.close() waits for them otherwise. */
  close() {
    this.closed = true;
    for (const res of this.subs) res.end();
    this.subs.clear();
  }

  handle(req, res) {
    if (this.closed || this.subs.size >= this.maxStreams) {
      sendError(res, 503, 'too many live streams');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.subs.add(res);

    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), this.heartbeatMs);
    heartbeat.unref();
    res.on('close', () => {
      clearInterval(heartbeat);
      this.subs.delete(res);
    });
  }
}
