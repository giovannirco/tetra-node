// Serves the UI from web/. Files are read once at startup, so a request
// can never reach outside the directory and serving needs no disk I/O.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
};

function walk(dir, root, files) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, root, files);
    else if (TYPES[extname(name)] || name === 'LICENSE' || name === 'VERSION') {
      files.set(`/${relative(root, full).split(sep).join('/')}`, readFileSync(full));
    }
  }
  return files;
}

/** @param {string} root absolute path of web/ */
export function staticFiles(root) {
  const files = walk(root, root, new Map());
  return (req, res, url) => {
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const body = files.get(path);
    if (!body) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(404);
      res.end('404 page not found\n');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] || 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      // Vendored libraries are immutable per release; the app's files are revalidated.
      'Cache-Control': path.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(body);
  };
}
