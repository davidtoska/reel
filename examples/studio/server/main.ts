// Reel Studio server. Runs directly on Node 24 (TypeScript type stripping), no dependencies.
//
//   /api/…                     the API (see api.ts, GET /api)
//   /reels/<id>/reel.json      published packages – reel.json and media/… as they are on disk
//   /library/…                 the demo library (generated images and sounds)
//   /vendor/reel-format/…      the built reel-format and reel-player packages, for the browser (import map)
//   /vendor/reel-player/…
//   /…                         the builder (web/public)
//
// PORT (default 8080) and HOST (default 127.0.0.1; use 0.0.0.0 to expose) set where it listens.

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, normalize, sep } from 'node:path';
import { handleApi } from './api.ts';
import { HttpError, decodePath, sendFile, sendJson } from './http.ts';
import { seedIfEmpty } from './seed.ts';
import { DATA_DIR, LIBRARY_DIR, STUDIO_DIR } from './store.ts';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = join(STUDIO_DIR, 'web', 'public');
const require = createRequire(import.meta.url);
const VENDOR = { 'reel-format': dirname(require.resolve('reel-format')), 'reel-player': dirname(require.resolve('reel-player')) };

/** Joins a URL path onto a folder, refusing anything that escapes it. */
const inside = (root: string, urlPath: string) => {
  const path = normalize(join(root, decodePath(urlPath)));
  if (path !== root && !path.startsWith(root.endsWith(sep) ? root : root + sep)) throw new HttpError(403, 'Forbidden');
  return path;
};

const server = createServer(async (req, res) => {
  // Everything is open: any site may use the API and play the published reels.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    // Inside the try: a request target like http://[ makes URL throw, and that must not crash the server.
    const path = URL.parse(req.url ?? '/', 'http://x')?.pathname;
    if (path === undefined) throw new HttpError(400, 'Bad URL');
    if (path === '/api' || path.startsWith('/api/')) return await handleApi(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (path.startsWith('/reels/')) return await sendFile(req, res, inside(DATA_DIR, path.slice('/reels/'.length)), { untrusted: true });
    if (path.startsWith('/library/')) return await sendFile(req, res, inside(LIBRARY_DIR, path.slice('/library/'.length)), { untrusted: true, cache: 'public, max-age=3600' });
    const vendor = /^\/vendor\/(reel-format|reel-player)\/(.+)$/.exec(path);
    if (vendor) return await sendFile(req, res, inside(VENDOR[vendor[1] as keyof typeof VENDOR], vendor[2]));
    return await sendFile(req, res, inside(PUBLIC_DIR, path === '/' ? 'index.html' : path));
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
  }
});

await seedIfEmpty();
server.listen(PORT, HOST, () => console.log(`Reel Studio on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (API: /api)`));
