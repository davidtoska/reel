// Reel packages: a reel and its media files as one .zip – reading, writing and checking.
// Runs in Node 18+ and in browsers (uses only Uint8Array, TextEncoder and DecompressionStream).
//
// The package format (Reel package 1.0):
//
//   reel.json          at the root of the zip, UTF-8 JSON, a valid reel/1 document, at most 1 MB
//   media/…            every file reel.json refers to with a relative src, at exactly that path
//
//  - Entries are stored (method 0) or deflated (method 8). No encryption, no ZIP64, no multi-part zips.
//  - Paths are relative and clean: no leading /, no drive letter, no `..`, `.` or empty parts, no `\`.
//    The same path may not occur twice. Paths are case-sensitive.
//  - Every relative src in reel.json must exist in the package. Files nobody refers to are allowed
//    but produce a warning. Files that operating systems add by themselves (__MACOSX/, ._*,
//    .DS_Store, Thumbs.db, desktop.ini) are ignored silently.
//  - Media files must have an extension listed in REEL_MEDIA_TYPES for their use.
//  - Readers may refuse packages larger than they are willing to handle (default here: 200 MB).

import { REEL_MANIFEST, REEL_MEDIA_DIR, type Reel } from './format.ts';
import { checkMediaSrc, validateReel } from './validate.ts';

export const REEL_PACKAGE_DEFAULTS = {
  /** Total uncompressed size of all files. */
  maxBytes: 200_000_000,
  /** Size of reel.json. */
  maxManifestBytes: 1_000_000,
  maxFiles: 20_000,
};

export type ReelPackageResult =
  | { ok: true; reel: Reel; files: Map<string, Uint8Array>; warnings: string[]; errors: [] }
  | { ok: false; errors: string[]; warnings: string[] };

// --- Checking a reel against the files it comes with --------------------------------------------

/** Files operating systems add to zips and folders by themselves. */
export const isSystemFile = (path: string) =>
  path.startsWith('__MACOSX/') || /(^|\/)(\._[^/]*|\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path);

/** Every relative media reference in a reel (music, image and video layers, audio clips). */
export const reelMediaRefs = (reel: Reel): string[] => {
  const refs = new Set<string>();
  if (reel.music) refs.add(reel.music.src);
  for (const s of reel.slides) {
    for (const l of s.layers) if (l.type === 'image' || l.type === 'video') refs.add(l.src);
    for (const a of s.audio ?? []) refs.add(a.src);
  }
  return [...refs].filter(r => !r.startsWith('https://'));
};

/**
 * Checks that a reel and a set of package paths belong together: every reference exists, and files
 * nobody uses are reported as warnings. Works for zips and for folders on disk alike.
 */
export const checkPackageFiles = (reel: Reel, paths: Iterable<string>): { errors: string[]; warnings: string[] } => {
  const have = new Set([...paths].filter(p => !isSystemFile(p)));
  const lower = new Map([...have].map(p => [p.toLowerCase(), p]));
  const refs = reelMediaRefs(reel);
  const errors = refs.filter(r => !have.has(r)).map(r => {
    const near = lower.get(r.toLowerCase());
    return `${r}: not in the package${near ? ` – did you mean ${near}?` : ''}`;
  });
  const used = new Set([REEL_MANIFEST, ...refs]);
  const warnings = [...have].filter(p => !used.has(p)).map(p => `${p} is not used by ${REEL_MANIFEST}`);
  return { errors, warnings };
};

// --- Zip primitives -----------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export const crc32 = (data: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const cleanPath = (path: string) =>
  !path.startsWith('/') && !/^[a-z]:/i.test(path) && !path.includes('\\') && path.split('/').every(p => p !== '' && p !== '.' && p !== '..');

// --- Writing ------------------------------------------------------------------------------------

/**
 * Builds a package zip: reel.json plus the given files (path → content, e.g. "media/a.jpg").
 * Files are stored without compression – media is already compressed.
 */
export const writeReelPackage = (reel: Reel, files: Map<string, Uint8Array> | Record<string, Uint8Array>): Uint8Array => {
  const enc = new TextEncoder();
  const entries: [string, Uint8Array][] = [
    [REEL_MANIFEST, enc.encode(JSON.stringify(reel, null, 2))],
    ...(files instanceof Map ? [...files] : Object.entries(files)).filter(([p]) => p !== REEL_MANIFEST),
  ];
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of entries) {
    if (!cleanPath(path)) throw new Error(`Invalid path in package: ${path}`);
    const name = enc.encode(path);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);       // version needed
    lv.setUint16(6, 0x0800, true);   // names are UTF-8
    lv.setUint16(8, 0, true);        // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let p = 0;
  for (const b of [...parts, ...central, end]) { out.set(b, p); p += b.length; }
  return out;
};

// --- Reading ------------------------------------------------------------------------------------

/**
 * Reads and checks a package zip. Returns the reel and its files (path → content), or every problem
 * found. Never throws for bad input.
 */
export const readReelPackage = async (zip: Uint8Array | ArrayBuffer, options: Partial<typeof REEL_PACKAGE_DEFAULTS> = {}): Promise<ReelPackageResult> => {
  const limits = { ...REEL_PACKAGE_DEFAULTS, ...options };
  const bytes = zip instanceof Uint8Array ? zip : new Uint8Array(zip);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (message: string): ReelPackageResult => ({ ok: false, errors: [...errors, message], warnings });

  // End of central directory: the last 22+ bytes (a comment of up to 65 535 bytes may follow it).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return fail('not a zip file');
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) return fail('multi-part zips are not supported');
  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff) return fail('ZIP64 is not supported');
  if (count > limits.maxFiles) return fail(`the package has ${count} files – the limit is ${limits.maxFiles}`);

  // Pass 1: the central directory – names, sizes and where each entry's data starts.
  const entries: { path: string; method: number; crc: number; csize: number; size: number; local: number }[] = [];
  const seen = new Set<string>();
  let total = 0;
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return fail('the zip directory is damaged');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const path = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (path.endsWith('/') || isSystemFile(path)) continue;
    if (!cleanPath(path)) { errors.push(`${path}: paths must be relative and clean (no leading /, .., \\ or empty parts)`); continue; }
    if (seen.has(path)) { errors.push(`${path}: occurs more than once`); continue; }
    seen.add(path);
    if (flags & 1) { errors.push(`${path}: encrypted entries are not supported`); continue; }
    if (method !== 0 && method !== 8) { errors.push(`${path}: compression method ${method} is not supported – use stored or deflate`); continue; }
    if (csize === 0xffffffff || size === 0xffffffff) return fail('ZIP64 is not supported');
    total += size;
    if (total > limits.maxBytes) return fail(`the package is larger than ${Math.round(limits.maxBytes / 1e6)} MB`);
    entries.push({ path, method, crc, csize, size, local });
  }

  // The manifest must be at the root. A zipped folder is the most common mistake.
  if (!seen.has(REEL_MANIFEST)) {
    const nested = [...seen].find(x => x.endsWith(`/${REEL_MANIFEST}`));
    return fail(nested ? `${REEL_MANIFEST} must be at the root – zip the contents of the folder, not the folder itself (found ${nested})` : `${REEL_MANIFEST} is missing`);
  }

  // Pass 2: the data. Sizes come from the central directory, so streamed zips (data descriptors) work.
  const files = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.local + 30 > bytes.length || view.getUint32(e.local, true) !== 0x04034b50) { errors.push(`${e.path}: damaged entry`); continue; }
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    if (start + e.csize > bytes.length) { errors.push(`${e.path}: the file is cut off`); continue; }
    const raw = bytes.subarray(start, start + e.csize);
    let data: Uint8Array;
    try { data = e.method === 0 ? raw : await inflateRaw(raw); } catch { errors.push(`${e.path}: could not be unpacked`); continue; }
    if (data.length !== e.size || crc32(data) !== e.crc) { errors.push(`${e.path}: the content does not match its checksum`); continue; }
    files.set(e.path, data);
  }
  if (errors.length) return { ok: false, errors, warnings };

  // reel.json: size, JSON, the format.
  const manifest = files.get(REEL_MANIFEST)!;
  if (manifest.length > limits.maxManifestBytes) return fail(`${REEL_MANIFEST} is larger than ${Math.round(limits.maxManifestBytes / 1e3)} kB`);
  let doc: unknown;
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest)); } catch { return fail(`${REEL_MANIFEST} is not valid UTF-8 JSON`); }
  const checked = validateReel(doc);
  if (!checked.ok) return { ok: false, errors: checked.errors.map(x => `${REEL_MANIFEST} ${x}`), warnings };

  // Files: every reference exists; every media file has a known type.
  const pkg = checkPackageFiles(checked.reel, files.keys());
  errors.push(...pkg.errors);
  warnings.push(...pkg.warnings);
  for (const path of files.keys()) {
    if (path === REEL_MANIFEST || !path.startsWith(REEL_MEDIA_DIR)) continue;
    const kinds = (['image', 'audio', 'video'] as const).filter(k => checkMediaSrc(path, k) === null);
    if (!kinds.length) errors.push(`${path}: unknown file type`);
  }
  if (errors.length) return { ok: false, errors, warnings };
  files.delete(REEL_MANIFEST);
  return { ok: true, reel: checked.reel, files, warnings, errors: [] };
};
