// Creating and updating reels from documents: import library media, compile templates, validate, save.

import { REEL_FORMAT } from 'reel-format';
import { HttpError } from './http.ts';
import { deleteReel, importMedia, missingMedia, newId, reelExists, saveReel, checkId } from './store.ts';
import { compile, type MediaImport } from './templates/index.ts';

export interface Saved {
  id: string;
  format: string;
  duration: number;
  slides: number;
}

const apply = async (id: string, document: unknown, media: MediaImport[] = []): Promise<Saved> => {
  if (!Array.isArray(media)) throw new HttpError(400, 'media must be a list of { from, as? }');
  for (const m of media) await importMedia(id, m?.from, m?.as);
  const result = compile(document);
  if (!result.ok) throw new HttpError(400, 'The document is not valid', { format: result.format, errors: result.errors });
  const missing = await missingMedia(id, result.reel);
  if (missing.length) throw new HttpError(400, 'The document refers to files the reel does not have', { errors: missing });
  await saveReel(id, result.reel, result.format === REEL_FORMAT ? undefined : document);
  return { id, format: result.format, duration: result.reel.slides.reduce((s, x) => s + x.duration, 0), slides: result.reel.slides.length };
};

/** Creates a reel. Nothing is left behind if the document is invalid. */
export const createReel = async (document: unknown, media?: MediaImport[], id?: string): Promise<Saved> => {
  const title = (document as { title?: unknown })?.title;
  const newIdValue = id ? checkId(id) : newId(typeof title === 'string' ? title : 'reel');
  if (await reelExists(newIdValue)) throw new HttpError(409, `A reel with id ${newIdValue} exists`);
  try {
    return await apply(newIdValue, document, media);
  } catch (err) {
    await deleteReel(newIdValue).catch(() => {});
    throw err;
  }
};

/** Replaces a reel's document. Media already in the reel is kept. */
export const updateReel = async (id: string, document: unknown, media?: MediaImport[]): Promise<Saved> => {
  if (!(await reelExists(id))) throw new HttpError(404, `No reel with id ${id}`);
  return apply(id, document, media);
};
