// Creating and updating reels from documents: import library media, compile templates, validate, save.

import { REEL_FORMAT, readReelPackage } from 'reel-format';
import { HttpError } from './http.ts';
import { deleteReel, importMedia, missingMedia, newId, putPackageFiles, reelExists, saveReel, checkId, MAX_REEL_BYTES } from './store.ts';
import { compile, type MediaImport } from './templates/index.ts';

export interface Saved {
  id: string;
  format: string;
  duration: number;
  slides: number;
}

/** Library files one request may copy into a reel. */
export const MAX_MEDIA_IMPORTS = 200;

const apply = async (id: string, document: unknown, media: MediaImport[] = []): Promise<Saved> => {
  if (!Array.isArray(media)) throw new HttpError(400, 'media must be a list of { from, as? }');
  if (media.length > MAX_MEDIA_IMPORTS) throw new HttpError(400, `media: at most ${MAX_MEDIA_IMPORTS} files per request`);
  for (const m of media) await importMedia(id, m?.from, m?.as);
  const result = compile(document);
  if (!result.ok) throw new HttpError(400, 'The document is not valid', { format: result.format, errors: result.errors });
  const missing = await missingMedia(id, result.reel);
  if (missing.length) throw new HttpError(400, 'The document refers to files the reel does not have', { errors: missing });
  await saveReel(id, result.reel, result.format === REEL_FORMAT ? undefined : document);
  return { id, format: result.format, duration: result.reel.slides.reduce((s, x) => s + x.duration, 0), slides: result.reel.slides.length };
};

/** Ids of reels being created right now. The server is one process, so this is the lock. */
const creating = new Set<string>();

/**
 * Runs `work` to create the reel `id`: 409 if the id exists or another request is creating it, and
 * on failure only the folder this request created is removed.
 */
const create = async <T>(id: string, work: () => Promise<T>): Promise<T> => {
  if (creating.has(id)) throw new HttpError(409, `A reel with id ${id} is being created`);
  creating.add(id);
  try {
    if (await reelExists(id)) throw new HttpError(409, `A reel with id ${id} exists`);
    try {
      return await work();
    } catch (err) {
      await deleteReel(id).catch(() => {});
      throw err;
    }
  } finally {
    creating.delete(id);
  }
};

/** Creates a reel. Nothing is left behind if the document is invalid. */
export const createReel = async (document: unknown, media?: MediaImport[], id?: unknown): Promise<Saved> => {
  const title = (document as { title?: unknown })?.title;
  const newIdValue = id ? checkId(id) : newId(typeof title === 'string' ? title : 'reel');
  return create(newIdValue, () => apply(newIdValue, document, media));
};

/** Replaces a reel's document. Media already in the reel is kept. */
export const updateReel = async (id: string, document: unknown, media?: MediaImport[]): Promise<Saved> => {
  if (!(await reelExists(id))) throw new HttpError(404, `No reel with id ${id}`);
  return apply(id, document, media);
};

/** Creates a reel from a package zip (reel.json + media/), checked with readReelPackage from reel-format. */
export const importPackage = async (zip: Uint8Array, id?: string): Promise<Saved & { warnings: string[] }> => {
  const result = await readReelPackage(zip, { maxBytes: MAX_REEL_BYTES });
  if (!result.ok) throw new HttpError(400, 'The package is not valid', { errors: result.errors, warnings: result.warnings });
  const newIdValue = id ? checkId(id) : newId(result.reel.title);
  await create(newIdValue, async () => {
    await putPackageFiles(newIdValue, result.files);
    await saveReel(newIdValue, result.reel);
  });
  return { id: newIdValue, format: REEL_FORMAT, duration: result.reel.slides.reduce((s, x) => s + x.duration, 0), slides: result.reel.slides.length, warnings: result.warnings };
};
