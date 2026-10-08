// Minimal JSON-lines logger with the same keys as Go's slog JSON handler:
// {"time":…,"level":"INFO","msg":…, …fields}.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  /**
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {{write: (s: string) => unknown}} [out]
   */
  constructor(level = 'info', out = process.stdout) {
    this.min = LEVELS[level];
    this.out = out;
  }

  log(level, msg, fields = {}) {
    if (LEVELS[level] < this.min) return;
    const entry = { time: new Date().toISOString(), level: level.toUpperCase(), msg };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) entry[k] = v;
    this.out.write(`${JSON.stringify(entry)}\n`);
  }

  debug(msg, fields) {
    this.log('debug', msg, fields);
  }
  info(msg, fields) {
    this.log('info', msg, fields);
  }
  warn(msg, fields) {
    this.log('warn', msg, fields);
  }
  error(msg, fields) {
    this.log('error', msg, fields);
  }
}

export const isLevel = (v) => Object.hasOwn(LEVELS, v);
