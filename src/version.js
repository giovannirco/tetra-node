// What build is running, and where. VERSION, COMMIT and BUILD_DATE are
// baked into the image as environment variables at build time.

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function versionInfo(env = process.env, startedAt = new Date()) {
  return {
    service: 'tetra',
    implementation: 'node',
    version: env.VERSION || `v${pkg.version}`,
    commit: env.COMMIT || 'unknown',
    build_date: env.BUILD_DATE || '',
    runtime: `node${process.versions.node}`,
    hostname: hostname(),
    started_at: startedAt.toISOString(),
  };
}
