// The studio's HTTP API. Open: no login, CORS for everyone. Made for scripts and AI agents as much as
// for the builder – GET /api describes everything needed to make a reel without other documentation.

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { REEL_FORMAT, REEL_MEDIA_TYPES } from 'reel-format';
import { HttpError, readBody, readJson, sendJson } from './http.ts';
import { seed } from './seed.ts';
import { createReel, importPackage, updateReel } from './service.ts';
import { deleteMedia, deleteReel, getReel, importMedia, listLibrary, listMedia, listReels, packageZip, putMedia, MAX_REEL_BYTES } from './store.ts';
import { THEMES, TEMPLATES, compile, type MediaImport } from './templates/index.ts';

const SCHEMA_PATH = createRequire(import.meta.url).resolve('reel-schema');

const origin = (req: IncomingMessage) => `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host ?? 'localhost'}`;

const urls = (req: IncomingMessage, id: string) => ({
  reel: `${origin(req)}/reels/${id}/reel.json`,
  play: `${origin(req)}/play.html?src=/reels/${id}/reel.json`,
  edit: `${origin(req)}/edit.html?id=${id}`,
  package: `${origin(req)}/api/reels/${id}/package.zip`,
});

/** Request bodies may be { document, media? } or just the document. */
const unwrap = (body: unknown): { document: unknown; media?: MediaImport[]; id?: string } => {
  const b = body as { document?: unknown; media?: MediaImport[]; id?: string; format?: unknown };
  return b && typeof b === 'object' && 'document' in b && !('format' in b) ? { document: b.document, media: b.media, id: b.id } : { document: body };
};

const describe = (req: IncomingMessage) => ({
  name: 'Reel Studio API',
  about: 'Open demo API for creating reels (Reel 1.0, the "reel/1" format: npm packages reel-format, reel-dom and reel-schema). No login. Data may be reset at any time.',
  workflow: [
    'Pick a format: write "reel/1" directly (full control), or a template (simpler, see GET /api/templates).',
    'Every reel is a package: reel.json plus files under media/. Files must be in the package before the document refers to them.',
    'Create the reel: POST /api/reels with { document, media? }. `media` copies files from the demo library: [{ "from": "images/fjord.svg" }] → media/fjord.svg.',
    'Add your own files: PUT /api/reels/{id}/media/{name} with the raw file as body. Use the returned `src` in the document; audio needs its duration in seconds.',
    'Update: PUT /api/reels/{id} with { document }. Invalid documents are rejected with a list of errors with paths; nothing is saved.',
    'Check without saving: POST /api/validate with { document }.',
    'Or upload a finished package: POST /api/reels/import with a .zip (reel.json + media/) as the body.',
    'Publish: the reel is served at /reels/{id}/reel.json with its media next to it; play it at /play.html?src=…, play it in any page with new ReelPlayer(element).load("…/reel.json") from reel-dom, or download /api/reels/{id}/package.zip and host the folder anywhere.',
  ],
  formats: {
    [REEL_FORMAT]: { schema: `${origin(req)}/api/schema`, types: 'https://www.npmjs.com/package/reel-format (src/format.ts)', schemaPackage: 'https://www.npmjs.com/package/reel-schema' },
    ...Object.fromEntries(TEMPLATES.map(t => [t.format, { label: t.label, description: t.description, example: `${origin(req)}/api/templates` }])),
  },
  units: 'x, y, w, h: percent of the 16:9 canvas. Text size: percent of canvas height (5 ≈ 54 px at 1080p; use ≥ 4.5 for body text). Times: seconds from the start of the slide.',
  limits: { layersPerSlide: 12, audioClipsPerSlide: 4, slides: 500, slideSeconds: '1–600', bytesPerReel: MAX_REEL_BYTES, fileTypes: REEL_MEDIA_TYPES },
  themes: Object.keys(THEMES),
  endpoints: {
    'GET /api': 'This description',
    'GET /api/schema': 'JSON Schema for reel/1',
    'GET /api/templates': 'Template formats with complete examples',
    'GET /api/library': 'Demo images and sounds that can be imported into a reel (with durations for audio)',
    'POST /api/validate': '{ document } → { ok, format, errors, reel } – compiles and checks without saving',
    'GET /api/reels': 'All reels',
    'POST /api/reels': '{ document, media?, id? } → 201 { id, urls }',
    'POST /api/reels/import?id=': 'Body: a package zip (application/zip) → 201 { id, warnings, urls }',
    'GET /api/reels/{id}': '{ reel, source, media, urls }',
    'PUT /api/reels/{id}': '{ document, media? } → replaces the document',
    'DELETE /api/reels/{id}': 'Deletes the reel and its files',
    'GET /api/reels/{id}/media': 'Files in the reel',
    'PUT /api/reels/{id}/media/{name}': 'Upload a file (raw body). Name is cleaned to a–z, 0–9, -, _, .',
    'POST /api/reels/{id}/media': '{ from, as? } – import a library file',
    'DELETE /api/reels/{id}/media/{name}': 'Delete a file',
    'GET /api/reels/{id}/package.zip': 'The package: reel.json + the media it uses',
    'POST /api/reset': 'Restore the demo data',
  },
});

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void>;

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/?$/, async (req, res) => sendJson(res, 200, describe(req))],
  ['GET', /^\/api\/schema$/, async (_req, res) => sendJson(res, 200, JSON.parse(await readFile(SCHEMA_PATH, 'utf8')))],
  ['GET', /^\/api\/templates$/, async (_req, res) => sendJson(res, 200, TEMPLATES.map(({ format, label, description, example }) => ({ format, label, description, example })))],
  ['GET', /^\/api\/library$/, async (_req, res) => sendJson(res, 200, await listLibrary())],
  ['POST', /^\/api\/validate$/, async (req, res) => {
    const r = compile(unwrap(await readJson(req)).document);
    sendJson(res, 200, r.ok ? { ok: true, format: r.format, errors: [], reel: r.reel } : r);
  }],
  ['GET', /^\/api\/reels$/, async (_req, res) => sendJson(res, 200, await listReels())],
  ['POST', /^\/api\/reels$/, async (req, res) => {
    const { document, media, id } = unwrap(await readJson(req));
    const saved = await createReel(document, media, id);
    sendJson(res, 201, { ...saved, urls: urls(req, saved.id) });
  }],
  ['POST', /^\/api\/reels\/import$/, async (req, res) => {
    const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? undefined;
    const saved = await importPackage(new Uint8Array(await readBody(req, MAX_REEL_BYTES + 2_000_000)), id);
    sendJson(res, 201, { ...saved, urls: urls(req, saved.id) });
  }],
  ['GET', /^\/api\/reels\/([^/]+)$/, async (req, res, [id]) => {
    const { reel, source } = await getReel(id);
    sendJson(res, 200, { id, reel, source: source ?? null, media: await listMedia(id), urls: urls(req, id) });
  }],
  ['PUT', /^\/api\/reels\/([^/]+)$/, async (req, res, [id]) => {
    const { document, media } = unwrap(await readJson(req));
    sendJson(res, 200, { ...(await updateReel(id, document, media)), urls: urls(req, id) });
  }],
  ['DELETE', /^\/api\/reels\/([^/]+)$/, async (_req, res, [id]) => { await deleteReel(id); sendJson(res, 200, { deleted: id }); }],
  ['GET', /^\/api\/reels\/([^/]+)\/media$/, async (_req, res, [id]) => { await getReel(id); sendJson(res, 200, await listMedia(id)); }],
  ['PUT', /^\/api\/reels\/([^/]+)\/media\/([^/]+)$/, async (req, res, [id, name]) => {
    sendJson(res, 201, await putMedia(id, decodeURIComponent(name), await readBody(req, MAX_REEL_BYTES)));
  }],
  ['POST', /^\/api\/reels\/([^/]+)\/media$/, async (req, res, [id]) => {
    await getReel(id);
    const { from, as } = (await readJson(req)) as { from: string; as?: string };
    sendJson(res, 201, await importMedia(id, from, as));
  }],
  ['DELETE', /^\/api\/reels\/([^/]+)\/media\/([^/]+)$/, async (_req, res, [id, name]) => {
    await deleteMedia(id, decodeURIComponent(name));
    sendJson(res, 200, { deleted: name });
  }],
  ['GET', /^\/api\/reels\/([^/]+)\/package\.zip$/, async (_req, res, [id]) => {
    const body = await packageZip(id);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': body.length, 'Content-Disposition': `attachment; filename="${id}.zip"` });
    res.end(body);
  }],
  ['POST', /^\/api\/reset$/, async (_req, res) => { await seed(); sendJson(res, 200, { reset: true, reels: await listReels() }); }],
];

export const handleApi = async (req: IncomingMessage, res: ServerResponse, path: string) => {
  try {
    for (const [method, pattern, handler] of routes) {
      const m = pattern.exec(path);
      if (m && (req.method === method || (method === 'GET' && req.method === 'HEAD'))) return await handler(req, res, m.slice(1));
    }
    throw new HttpError(404, `No endpoint ${req.method} ${path} – see GET /api`);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...(err.details as object) });
    console.error(err);
    sendJson(res, 500, { error: 'Internal error' });
  }
};
