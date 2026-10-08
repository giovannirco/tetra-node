// Runtime settings from the environment. Every setting has a default.

import { isLevel } from './logger.js';

function intVar(env, name, def, min, max) {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!/^-?\d+$/.test(v) || n < min || n > max) {
    throw new Error(`${name}: ${JSON.stringify(v)} must be an integer between ${min} and ${max}`);
  }
  return n;
}

/** @param {Record<string, string | undefined>} env */
export function loadConfig(env = process.env) {
  const logLevel = (env.LOG_LEVEL || 'info').toLowerCase();
  if (!isLevel(logLevel))
    throw new Error(`LOG_LEVEL: ${JSON.stringify(env.LOG_LEVEL)} is not one of debug, info, warn, error`);
  return {
    port: intVar(env, 'PORT', 8000, 1, 65535),
    logLevel,
    drainDelayMs: intVar(env, 'DRAIN_DELAY_SECONDS', 5, 0, 300) * 1000,
    shutdownTimeoutMs: intVar(env, 'SHUTDOWN_TIMEOUT_SECONDS', 10, 1, 300) * 1000,
    maxLiveStreams: intVar(env, 'MAX_LIVE_STREAMS', 100, 0, 10000),
  };
}
