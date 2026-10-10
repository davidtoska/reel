// Storage on disk. Every reel is stored as a Reel package, so publishing is just serving the folder:
//
//   data/reels/<id>/reel.json      the reel (Reel 1.0)
//   data/reels/<id>/media/…        its files
//   data/reels/<id>/source.json    the template document it was made from, if any (not part of the package)

import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REEL_MANIFEST, REEL_MEDIA_DIR, REEL_MEDIA_TYPES, checkPackageFiles, extensionOf, reelDuration, reelMediaRefs, writeReelPackage, type Reel } from 'reel-format';
import { HttpError } from './http.ts';

// fileURLToPath, not URL.pathname: the path may contain spaces or non-ASCII characters (and C:\ on Windows).
export const STUDIO_DIR = fileURLToPath(new URL('..', import.meta.url));
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
  /**
   * Seconds, for WAV files only. For mp3, m4a, aac and mp4 the caller must measure it
   * (e.g. ffprobe -v error -show_entries format=duration -of csv=p=0 file.mp3).
   */
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
  /** URL of the first image in the reel's own media/ folder, for previews (never a third-party URL). */
  thumbnail?: string;
}

// --- Names ----------------------------------------------------------------------------------------

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const checkId = (id: unknown) => {
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(400, 'Invalid id – use a–z, 0–9 and -, at most 63 characters');
  return id;
};

export const newId = (title: string) => {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'reel';
  return `${slug}-${randomBytes(3).toString('hex')}`;
};

const cleanName = (name: string) =>
  basename(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 100);

/** A safe file name for media/: lower case a–z, 0–9, -, _ and . with a known extension. */
export const mediaName = (name: unknown) => {
  if (typeof name !== 'string') throw new HttpError(400, 'A file name must be text, e.g. "photo.jpg"');
  const clean = cleanName(name);
  const kind = KIND_BY_EXT.get(extensionOf(clean));
  if (!clean || !kind) throw new HttpError(400, `Unsupported file type: ${name} – use ${[...KIND_BY_EXT.keys()].join(', ')}`);
  return { name: clean, kind };
};

const dir = (id: string) => join(DATA_DIR, checkId(id));
const mediaDir = (id: string) => join(dir(id), REEL_MEDIA_DIR);

const exists = async (path: string) => stat(path).then(() => true, () => false);

// --- Audio length -------------------------------------------------------------------------------

/** Chunks read before giving up on finding 'data' (real files have a handful). */
const MAX_WAV_CHUNKS = 64;

/**
 * Duration of a PCM WAV file in seconds, or undefined. Reads only the chunk headers (a few bytes
 * each), never the samples, and stops at the end of the file however the sizes are written.
 */
export const wavDuration = async (path: string): Promise<number | undefined> => {
  const file = await open(path);
  try {
    const { size: fileSize } = await file.stat();
    const buf = Buffer.alloc(16);
    const read = async (at: number, bytes: number) => (await file.read(buf, 0, bytes, at)).bytesRead === bytes;
    if (!(await read(0, 12)) || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return undefined;
    let byteRate = 0;
    for (let p = 12, n = 0; n < MAX_WAV_CHUNKS && (await read(p, 8)); n++) {
      const id = buf.toString('ascii', 0, 4);
      const size = buf.readUInt32LE(4);
      // fmt: audio format (2), channels (2), sample rate (4), byte rate (4) …
      if (id === 'fmt ' && size >= 16 && (await read(p + 8, 12))) byteRate = buf.readUInt32LE(8);
      // A truncated file (or a size written as 0xffffffff while recording) ends where the file ends.
      if (id === 'data') return byteRate ? Math.round((Math.min(size, fileSize - p - 8) / byteRate) * 100) / 100 : undefined;
      p += 8 + size + (size % 2);
    }
    return undefined;
  } finally {
    await file.close();
  }
};

const mediaInfo = async (path: string, name: string): Promise<MediaInfo> => {
  const kind = KIND_BY_EXT.get(extensionOf(name))!;
  const info = await stat(path);
  // A file that is not a readable WAV only loses its duration.
  const duration = extensionOf(name) === 'wav' ? await wavDuration(path).catch(() => undefined) : undefined;
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
      // Only the reel's own files: a remote image would make every visitor of the gallery load it.
      const image = reel.slides.flatMap(s => s.layers).flatMap(l => (l.type === 'image' && l.src.startsWith(REEL_MEDIA_DIR) ? [l.src] : []))[0];
      return {
        id, title: reel.title, source: (source as { format?: string })?.format ?? reel.format, duration: reelDuration(reel), slides: reel.slides.length,
        updated: info.mtime.toISOString(), ...(image && { thumbnail: `/reels/${id}/${image}` }),
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
  const root = mediaDir(id);
  // Files only: a folder can have a name like x.wav too.
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  const names = entries.filter(d => d.isFile()).map(d => relative(root, join(d.parentPath, d.name)).split(sep).join('/'));
  return Promise.all(names.filter(n => KIND_BY_EXT.has(extensionOf(n))).sort().map(n => mediaInfo(join(root, n), n)));
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
  await checkSpace(id, lib.bytes, name);
  await mkdir(mediaDir(id), { recursive: true });
  await copyFile(join(LIBRARY_DIR, lib.path), join(mediaDir(id), name));
  return mediaInfo(join(mediaDir(id), name), name);
};

/**
 * Deletes a file by its name as listMedia gives it (e.g. Photos/Big.PNG from an imported package).
 * The name an upload was sent with (Fjord.SVG for fjord.svg) works too.
 */
export const deleteMedia = async (id: string, fileName: string) => {
  const files = await listMedia(id);
  const file = files.find(m => m.name === fileName) ?? files.find(m => m.name === cleanName(fileName));
  if (!file) throw new HttpError(404, `No file ${REEL_MEDIA_DIR}${fileName}`);
  await rm(join(mediaDir(id), file.name));
  return file.name;
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
