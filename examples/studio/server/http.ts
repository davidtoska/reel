// HTTP helpers on node:http: JSON responses, request bodies with a size limit and static files with
// Range support (audio and video need it to seek).

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';

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

/**
 * Serves a file. `untrusted` files (user uploads) get a sandboxing CSP, so an uploaded SVG or HTML
 * cannot run script on this origin when opened directly.
 */
export const sendFile = async (req: IncomingMessage, res: ServerResponse, path: string, { untrusted = false, cache = 'no-cache' } = {}) => {
  let info;
  try { info = await stat(path); } catch { throw new HttpError(404, 'Not found'); }
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
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
};
