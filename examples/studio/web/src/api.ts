// Client for the studio API (see GET /api). The builder uses exactly the same API as scripts and AI agents.

import type { Reel } from 'reel-format';

export interface MediaInfo { name: string; src: string; kind: 'image' | 'audio' | 'video'; bytes: number; duration?: number }
export interface LibraryFile { path: string; url: string; kind: 'image' | 'audio' | 'video'; bytes: number; duration?: number }
export interface ReelSummary { id: string; title: string; source: string; duration: number; slides: number; updated: string; thumbnail?: string }
export interface ReelUrls { reel: string; play: string; edit: string; package: string }
export interface ReelDetails { id: string; reel: Reel; source: { format: string } | null; media: MediaInfo[]; urls: ReelUrls }
export interface Template { format: string; label: string; description: string; example: { document: unknown; media: { from: string; as?: string }[] } }

/** An API error, with the format's error list when the document was invalid. */
export class ApiError extends Error {
  errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.errors = errors;
  }
}

const call = async <T>(method: string, path: string, body?: unknown, raw = false): Promise<T> => {
  const res = await fetch(path, {
    method,
    ...(body !== undefined && { body: raw ? (body as BodyInit) : JSON.stringify(body), headers: raw ? {} : { 'Content-Type': 'application/json' } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, data.errors ?? []);
  return data as T;
};

export const api = {
  reels: () => call<ReelSummary[]>('GET', '/api/reels'),
  reel: (id: string) => call<ReelDetails>('GET', `/api/reels/${id}`),
  create: (document: unknown, media?: Template['example']['media']) => call<{ id: string; urls: ReelUrls }>('POST', '/api/reels', { document, media }),
  save: (id: string, document: Reel) => call<{ id: string }>('PUT', `/api/reels/${id}`, { document }),
  remove: (id: string) => call('DELETE', `/api/reels/${id}`),
  templates: () => call<Template[]>('GET', '/api/templates'),
  library: () => call<LibraryFile[]>('GET', '/api/library'),
  upload: (id: string, file: File) => call<MediaInfo>('PUT', `/api/reels/${id}/media/${encodeURIComponent(file.name)}`, file, true),
  importMedia: (id: string, from: string) => call<MediaInfo>('POST', `/api/reels/${id}/media`, { from }),
  deleteMedia: (id: string, name: string) => call('DELETE', `/api/reels/${id}/media/${encodeURIComponent(name)}`),
  reset: () => call('POST', '/api/reset'),
};
