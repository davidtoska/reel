// HTTP helpers on node:http: JSON responses, request bodies with a size limit and static files with
// Range support (audio and video need it to seek).

import { open, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { pipeline, type Readable } from 'node:stream';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.ts': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.zip': 'application/zip',
};

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
};

export const readBody = async (req: IncomingMessage, limit: number): Promise<Buffer> => {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) throw new HttpError(413, `Body is larger than ${Math.round(limit / 1e6)} MB`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `Body is larger than ${Math.round(limit / 1e6)} MB`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const readJson = async (req: IncomingMessage, limit = 2_000_000): Promise<unknown> => {
  const body = await readBody(req, limit);
  try { return JSON.parse(body.toString('utf8')); } catch { throw new HttpError(400, 'Body is not valid JSON'); }
};

/** decodeURIComponent for a part of the URL path, with 400 for broken encoding such as %E0. */
export const decodePath = (s: string) => {
  try { return decodeURIComponent(s); } catch { throw new HttpError(400, 'Bad URL encoding'); }
};

/**
 * Sends a file stream. pipeline closes the file when the client goes away (media elements abort
 * requests all the time when seeking) and when reading fails – then the response is cut off.
 */
const stream = (file: Readable, res: ServerResponse) =>
  pipeline(file, res, err => {
    if (err && (err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(err);
  });

/**
 * Serves a file. `untrusted` files (user uploads) get a sandboxing CSP, so an uploaded SVG or HTML
 * cannot run script on this origin when opened directly.
 */
export const sendFile = async (req: IncomingMessage, res: ServerResponse, path: string, { untrusted = false, cache = 'no-cache' } = {}) => {
  // Opened once, so a file deleted meanwhile is still the one stat() saw (or a 404 – never a crash).
  let file: FileHandle;
  try { file = await open(path); } catch { throw new HttpError(404, 'Not found'); }
  let streaming = false;
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new HttpError(404, 'Not found');
    const headers: Record<string, string | number> = {
      'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
      'Last-Modified': info.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    };
    if (untrusted) headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      streaming = true;
      return stream(file.createReadStream({ start, end }), res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (req.method === 'HEAD' || info.size === 0) return res.end();
    streaming = true;
    // Never more than Content-Length, even if the file grows meanwhile.
    stream(file.createReadStream({ end: info.size - 1 }), res);
  } finally {
    // A stream closes the file itself when it ends or is destroyed.
    if (!streaming) await file.close();
  }
};
