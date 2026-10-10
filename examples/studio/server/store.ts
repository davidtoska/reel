// Storage on disk. Every reel is stored as a Reel package, so publishing is just serving the folder:
//
//   data/reels/<id>/reel.json      the reel (Reel 1.0)
//   data/reels/<id>/media/…        its files
//   data/reels/<id>/source.json    the template document it was made from, if any (not part of the package)

import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { REEL_MANIFEST, REEL_MEDIA_DIR, REEL_MEDIA_TYPES, checkPackageFiles, extensionOf, reelDuration, reelMediaRefs, writeReelPackage, type Reel } from 'reel-format';
import { HttpError } from './http.ts';

export const STUDIO_DIR = new URL('..', import.meta.url).pathname;
export const DATA_DIR = join(STUDIO_DIR, 'data', 'reels');
export const LIBRARY_DIR = join(STUDIO_DIR, 'library');

/** Total size of one reel's media. */
export const MAX_REEL_BYTES = 100_000_000;

type Kind = keyof typeof REEL_MEDIA_TYPES;
const KIND_BY_EXT = new Map<string, Kind>(
  (Object.keys(REEL_MEDIA_TYPES) as Kind[]).flatMap(kind => Object.keys(REEL_MEDIA_TYPES[kind]).map(ext => [ext, kind] as [string, Kind])),
);

export interface MediaInfo {
  name: string;
  /** What to write in the reel: media/<name>. */
  src: string;
  kind: Kind;
  bytes: number;
  /** Seconds, for WAV files (other audio: read it from your source). */
  duration?: number;
}

export interface ReelSummary {
  id: string;
  title: string;
  /** Format of the document it was made from: reel/1 or a template. */
  source: string;
  duration: number;
  slides: number;
  updated: string;
  /** URL of the first image in the reel, for previews. */
  thumbnail?: string;
}

// --- Names ----------------------------------------------------------------------------------------

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const checkId = (id: string) => {
  if (!ID.test(id)) throw new HttpError(400, 'Invalid id – use a–z, 0–9 and -, at most 63 characters');
  return id;
};

export const newId = (title: string) => {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'reel';
  return `${slug}-${randomBytes(3).toString('hex')}`;
};

/** A safe file name for media/: lower case a–z, 0–9, -, _ and . with a known extension. */
export const mediaName = (name: string) => {
  const clean = basename(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 100);
  const kind = KIND_BY_EXT.get(extensionOf(clean));
  if (!clean || !kind) throw new HttpError(400, `Unsupported file type: ${name} – use ${[...KIND_BY_EXT.keys()].join(', ')}`);
  return { name: clean, kind };
};

const dir = (id: string) => join(DATA_DIR, checkId(id));
const mediaDir = (id: string) => join(dir(id), REEL_MEDIA_DIR);

const exists = async (path: string) => stat(path).then(() => true, () => false);

// --- Audio length -------------------------------------------------------------------------------

/** Duration of a PCM WAV file in seconds, or undefined. */
export const wavDuration = (buf: Buffer): number | undefined => {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return undefined;
  let byteRate = 0;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(p + 16);
    if (id === 'data') return byteRate ? Math.round((size / byteRate) * 100) / 100 : undefined;
    p += 8 + size + (size % 2);
  }
  return undefined;
};

const mediaInfo = async (path: string, name: string): Promise<MediaInfo> => {
  const kind = KIND_BY_EXT.get(extensionOf(name))!;
  const info = await stat(path);
  const duration = extensionOf(name) === 'wav' ? wavDuration(await readFile(path)) : undefined;
  return { name, src: `${REEL_MEDIA_DIR}${name}`, kind, bytes: info.size, ...(duration && { duration }) };
};

// --- Reels ---------------------------------------------------------------------------------------

export const listReels = async (): Promise<ReelSummary[]> => {
  await mkdir(DATA_DIR, { recursive: true });
  const ids = (await readdir(DATA_DIR, { withFileTypes: true })).filter(d => d.isDirectory() && ID.test(d.name)).map(d => d.name);
  const all = await Promise.all(ids.map(async id => {
    try {
      const { reel, source } = await getReel(id);
      const info = await stat(join(dir(id), REEL_MANIFEST));
      const image = reel.slides.flatMap(s => s.layers).find(l => l.type === 'image')?.src;
      return {
        id, title: reel.title, source: (source as { format?: string })?.format ?? reel.format, duration: reelDuration(reel), slides: reel.slides.length,
        updated: info.mtime.toISOString(), ...(image && { thumbnail: image.startsWith(REEL_MEDIA_DIR) ? `/reels/${id}/${image}` : image }),
      };
    } catch { return null; }
  }));
  return all.filter((r): r is ReelSummary => r !== null).sort((a, b) => b.updated.localeCompare(a.updated));
};

export const reelExists = (id: string) => exists(join(dir(id), REEL_MANIFEST));

export const getReel = async (id: string): Promise<{ reel: Reel; source?: unknown }> => {
  let reel: Reel;
  try { reel = JSON.parse(await readFile(join(dir(id), REEL_MANIFEST), 'utf8')); } catch { throw new HttpError(404, `No reel with id ${id}`); }
  const source = await readFile(join(dir(id), 'source.json'), 'utf8').then(JSON.parse, () => undefined);
  return { reel, ...(source !== undefined && { source }) };
};

export const saveReel = async (id: string, reel: Reel, source?: unknown) => {
  await mkdir(mediaDir(id), { recursive: true });
  await writeFile(join(dir(id), REEL_MANIFEST), JSON.stringify(reel, null, 2));
  if (source !== undefined) await writeFile(join(dir(id), 'source.json'), JSON.stringify(source, null, 2));
  else await rm(join(dir(id), 'source.json'), { force: true });
};

export const deleteReel = async (id: string) => {
  if (!(await exists(dir(id)))) throw new HttpError(404, `No reel with id ${id}`);
  await rm(dir(id), { recursive: true, force: true });
};

export const deleteAllReels = () => rm(DATA_DIR, { recursive: true, force: true });

// --- Media ---------------------------------------------------------------------------------------

/** Files under media/, including sub-folders (packages may use them). Names are relative to media/. */
export const listMedia = async (id: string): Promise<MediaInfo[]> => {
  const names = await readdir(mediaDir(id), { recursive: true }).catch(() => [] as string[]);
  return Promise.all(names.map(n => n.split(sep).join('/')).filter(n => KIND_BY_EXT.has(extensionOf(n))).sort().map(n => mediaInfo(join(mediaDir(id), n), n)));
};

const checkSpace = async (id: string, adding: number, replacing: string) => {
  const used = (await listMedia(id)).filter(m => m.name !== replacing).reduce((s, m) => s + m.bytes, 0);
  if (used + adding > MAX_REEL_BYTES) throw new HttpError(413, `The reel would use ${Math.round((used + adding) / 1e6)} MB – the limit is ${MAX_REEL_BYTES / 1e6} MB`);
};

export const putMedia = async (id: string, fileName: string, data: Buffer): Promise<MediaInfo> => {
  if (!(await reelExists(id))) throw new HttpError(404, `No reel with id ${id}`);
  const { name } = mediaName(fileName);
  await checkSpace(id, data.length, name);
  await mkdir(mediaDir(id), { recursive: true });
  await writeFile(join(mediaDir(id), name), data);
  return mediaInfo(join(mediaDir(id), name), name);
};

/** Copies a file from the studio's demo library into the reel's media folder. */
export const importMedia = async (id: string, from: string, as?: string): Promise<MediaInfo> => {
  const lib = (await listLibrary()).find(f => f.path === from);
  if (!lib) throw new HttpError(400, `No library file ${from} – see GET /api/library`);
  const { name } = mediaName(as ?? basename(from));
  await mkdir(mediaDir(id), { recursive: true });
  await copyFile(join(LIBRARY_DIR, lib.path), join(mediaDir(id), name));
  return mediaInfo(join(mediaDir(id), name), name);
};

export const deleteMedia = async (id: string, fileName: string) => {
  const { name } = mediaName(fileName);
  const path = join(mediaDir(id), name);
  if (!(await exists(path))) throw new HttpError(404, `No file ${REEL_MEDIA_DIR}${name}`);
  await rm(path);
};

/** Errors for references to files the package does not have (the same check readReelPackage does). */
export const missingMedia = async (id: string, reel: Reel): Promise<string[]> =>
  checkPackageFiles(reel, (await listMedia(id)).map(m => m.src)).errors.map(e => `${e} – upload it or import it from the library first`);

/** The reel as a package zip: reel.json and the media files it uses. */
export const packageZip = async (id: string): Promise<Uint8Array> => {
  const { reel } = await getReel(id);
  const files = new Map<string, Uint8Array>();
  for (const ref of reelMediaRefs(reel)) {
    const data = await readFile(join(dir(id), ref)).catch(() => null);
    if (data) files.set(ref, data);
  }
  return writeReelPackage(reel, files);
};

/** Stores a package's files (from readReelPackage) in a new reel. */
export const putPackageFiles = async (id: string, files: Map<string, Uint8Array>) => {
  const total = [...files.values()].reduce((s, f) => s + f.length, 0);
  if (total > MAX_REEL_BYTES) throw new HttpError(413, `The package has ${Math.round(total / 1e6)} MB of media – the limit is ${MAX_REEL_BYTES / 1e6} MB`);
  await mkdir(mediaDir(id), { recursive: true });
  for (const [path, data] of files) {
    if (!path.startsWith(REEL_MEDIA_DIR)) continue;
    const target = join(dir(id), path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, data);
  }
};

// --- Library --------------------------------------------------------------------------------------

export interface LibraryFile { path: string; url: string; kind: Kind; bytes: number; duration?: number }

let libraryCache: LibraryFile[] | null = null;

export const listLibrary = async (): Promise<LibraryFile[]> => {
  if (libraryCache) return libraryCache;
  const out: LibraryFile[] = [];
  for (const sub of await readdir(LIBRARY_DIR).catch(() => [] as string[])) {
    for (const name of (await readdir(join(LIBRARY_DIR, sub)).catch(() => [] as string[])).sort()) {
      if (!KIND_BY_EXT.has(extensionOf(name))) continue;
      const m = await mediaInfo(join(LIBRARY_DIR, sub, name), name);
      out.push({ path: `${sub}/${name}`, url: `/library/${sub}/${name}`, kind: m.kind, bytes: m.bytes, ...(m.duration && { duration: m.duration }) });
    }
  }
  return (libraryCache = out);
};
