// The studio's HTTP API. Open: no login, CORS for everyone. Made for scripts and AI agents as much as
// for the builder – GET /api describes everything needed to make a reel without other documentation.

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { REEL_FORMAT, REEL_MEDIA_TYPES, validateReel, type Reel } from 'reel-format';
import { HttpError, decodePath, readBody, readJson, sendJson } from './http.ts';
import { seed } from './seed.ts';
import { createReel, importPackage, updateReel, MAX_MEDIA_IMPORTS } from './service.ts';
import { deleteMedia, deleteReel, getReel, importMedia, listLibrary, listMedia, listReels, packageZip, putMedia, MAX_REEL_BYTES } from './store.ts';
import { THEMES, TEMPLATES, compile, type MediaImport } from './templates/index.ts';

const SCHEMA_PATH = createRequire(import.meta.url).resolve('reel-schema');
const GUIDE_URL = 'https://github.com/davidtoska/reel/blob/main/packages/reel-schema/GUIDE.md';

/**
 * A small but complete reel/1 request for GET /api: music, defaults, a slow zoom, timed text, a shape,
 * a sound with its duration and a cut. It can be POSTed as it is to /api/reels – its media is in the library.
 */
const REEL_EXAMPLE: { document: Reel; media: MediaImport[] } = {
  document: {
    format: 'reel/1',
    title: 'A quiet morning',
    language: 'en',
    music: { src: 'media/music-calm.wav', duration: 32, volume: 0.3, duckTo: 0.1 },
    defaults: {
      text: { style: { font: 'sans', size: 5.5, color: '#ffffff', background: '#00000099', padding: 1.2, radius: 1 } },
      transition: { type: 'fade', duration: 1 },
    },
    slides: [
      {
        id: 'fjord', duration: 8,
        layers: [
          { type: 'image', src: 'media/fjord.svg', alt: 'Drawn fjord with a small sailing boat',
            motion: { from: { scale: 1 }, to: { scale: 1.15, x: 52, y: 70 } } },
          { type: 'text', text: 'A quiet morning on the fjord', x: 5, y: 80, w: 90, align: 'center', start: 0.5, fadeIn: 0.8 },
        ],
        audio: [{ src: 'media/waves.wav', start: 1, duration: 5, volume: 0.8, transcript: '(waves)' }],
      },
      {
        id: 'end', duration: 6, background: '#0d1b2a', transition: { type: 'cut' },
        layers: [
          { type: 'shape', shape: 'rect', x: 25, y: 35, w: 50, h: 30, fill: '#ffffff22', radius: 2 },
          { type: 'text', text: 'Good night', x: 25, y: 35, w: 50, h: 30, align: 'center', valign: 'middle', start: 1, end: 5.5, fadeIn: 1, fadeOut: 0.5,
            style: { size: 9, weight: 'bold', background: '#00000000' } },
        ],
      },
    ],
  },
  media: ['images/fjord.svg', 'audio/music-calm.wav', 'audio/waves.wav'].map(from => ({ from })),
};

// The example is what agents copy, so it must stay valid: refuse to start with a broken one.
const exampleCheck = validateReel(REEL_EXAMPLE.document);
if (!exampleCheck.ok) throw new Error(`The reel/1 example in api.ts is not valid:\n${exampleCheck.errors.join('\n')}`);

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
  about: 'Open demo API for creating reels (Reel 1.0, the "reel/1" format: npm packages reel-format, reel-player and reel-schema). No login. Data may be reset at any time.',
  workflow: [
    'Pick a format: write "reel/1" directly (full control), or a template (simpler, see GET /api/templates).',
    'Every reel is a package: reel.json plus files under media/. Files must be in the package before the document refers to them.',
    'Create the reel: POST /api/reels with { document, media? }. `media` copies files from the demo library: [{ "from": "images/fjord.svg" }] → media/fjord.svg.',
    'Add your own files: PUT /api/reels/{id}/media/{name} with the raw file as body. Use the returned `src` in the document.',
    'Audio (clips and music) and video need their length in seconds as `duration`. The media endpoints and GET /api/library return `duration` for WAV files only; for mp3, m4a, aac and mp4 you must supply it yourself, e.g. measured with `ffprobe -v error -show_entries format=duration -of csv=p=0 voice.mp3`. A clip\'s start + duration must fit in its slide, so make the slide long enough (narration start + its length + about 1.5 s reads well).',
    'Update: PUT /api/reels/{id} with { document }. Invalid documents are rejected with a list of errors with paths; nothing is saved.',
    'Check without saving: POST /api/validate with { document }.',
    'Or upload a finished package: POST /api/reels/import with a .zip (reel.json + media/) as the body.',
    'Publish: the reel is served at /reels/{id}/reel.json with its media next to it; play it at /play.html?src=…, play it in any page with new ReelPlayer(element).load("…/reel.json") from reel-player, or download /api/reels/{id}/package.zip and host the folder anywhere.',
  ],
  formats: {
    [REEL_FORMAT]: {
      guide: GUIDE_URL,
      schema: `${origin(req)}/api/schema`,
      types: 'https://www.npmjs.com/package/reel-format (src/format.ts)',
      schemaPackage: 'https://www.npmjs.com/package/reel-schema',
      example: REEL_EXAMPLE,
    },
    ...Object.fromEntries(TEMPLATES.map(t => [t.format, { label: t.label, description: t.description, example: `${origin(req)}/api/templates` }])),
  },
  units: 'x, y, w, h: percent of the 16:9 canvas. Text size: percent of canvas height (5 ≈ 54 px at 1080p; use ≥ 4.5 for body text). Times: seconds from the start of the slide.',
  limits: { layersPerSlide: 12, audioClipsPerSlide: 4, slides: 500, slideSeconds: '1–600', bytesPerReel: MAX_REEL_BYTES, mediaImportsPerRequest: MAX_MEDIA_IMPORTS, fileTypes: REEL_MEDIA_TYPES },
  themes: Object.keys(THEMES),
  endpoints: {
    'GET /api': 'This description',
    'GET /api/schema': 'JSON Schema for reel/1',
    'GET /api/templates': 'Template formats with complete examples',
    'GET /api/library': 'Demo images and sounds that can be imported into a reel (with durations for its WAV audio)',
    'POST /api/validate': '{ document } → { ok, format, errors, reel } – compiles and checks without saving',
    'GET /api/reels': 'All reels',
    'POST /api/reels': '{ document, media?, id? } → 201 { id, urls }',
    'POST /api/reels/import?id=': 'Body: a package zip (application/zip) → 201 { id, warnings, urls }',
    'GET /api/reels/{id}': '{ reel, source, media, urls }',
    'PUT /api/reels/{id}': '{ document, media? } → replaces the document',
    'DELETE /api/reels/{id}': 'Deletes the reel and its files',
    'GET /api/reels/{id}/media': 'Files in the reel (with `duration` for WAV)',
    'PUT /api/reels/{id}/media/{name}': 'Upload a file (raw body). Name is cleaned to a–z, 0–9, -, _, . → { name, src, kind, bytes, duration? }',
    'POST /api/reels/{id}/media': '{ from, as? } – import a library file',
    'DELETE /api/reels/{id}/media/{name}': 'Delete a file (its name as GET /api/reels/{id}/media lists it, URL-encoded)',
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
    sendJson(res, 201, await putMedia(id, decodePath(name), await readBody(req, MAX_REEL_BYTES)));
  }],
  ['POST', /^\/api\/reels\/([^/]+)\/media$/, async (req, res, [id]) => {
    await getReel(id);
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be { "from": "images/fjord.svg", "as"?: "name.svg" } – see GET /api/library');
    const { from, as } = body as { from: string; as?: string };
    sendJson(res, 201, await importMedia(id, from, as));
  }],
  ['DELETE', /^\/api\/reels\/([^/]+)\/media\/([^/]+)$/, async (_req, res, [id, name]) => {
    sendJson(res, 200, { deleted: await deleteMedia(id, decodePath(name)) });
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
