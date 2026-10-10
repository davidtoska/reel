// Reel packages from hostile or broken sources: zip bombs, limits, damaged and odd zips, file names
// in other Unicode forms – and the zips writeReelPackage makes, checked header by header.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { constants, deflateRawSync } from 'node:zlib';
import { checkPackageFiles, crc32, readReelPackage, writeReelPackage, type Reel } from '../src/index.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const reel: Reel = {
  format: 'reel/1', title: 'Test',
  slides: [{ id: 'a', duration: 5, layers: [{ type: 'image', src: 'media/a.jpg' }], audio: [{ src: 'media/voice.mp3', duration: 3 }] }],
};
const media = { 'media/a.jpg': bytes('jpg'), 'media/voice.mp3': bytes('mp3') };

interface Entry {
  name: string;
  /** The content, for the checksum and the default size. */
  data: Uint8Array;
  /** 0 stored (default) or 8 deflated; anything else is written as given. */
  method?: number;
  /** The bytes in the zip. Default: `data`, deflated for method 8. */
  stored?: Uint8Array;
  /** The uncompressed size the zip declares. Default: the length of `data`. */
  size?: number;
  crc?: number;
  /** General purpose flags: 1 encrypted, 8 sizes in a data descriptor after the data, 0x800 UTF-8 names. */
  flags?: number;
}

/** A zip of the entries, written field by field so tests can make it lie. */
const zip = (entries: Entry[], { comment = '', count, disk = 0 }: { comment?: string; count?: number; disk?: number } = {}) => {
  const parts: Uint8Array[] = [];
  const dir: Uint8Array[] = [];
  let offset = 0;
  const header = (length: number, fill: (v: DataView) => void) => { const b = new Uint8Array(length); fill(new DataView(b.buffer)); return b; };
  for (const e of entries) {
    const method = e.method ?? 0;
    const stored = e.stored ?? (method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data);
    const crc = e.crc ?? crc32(e.data);
    const size = e.size ?? e.data.length;
    const flags = e.flags ?? 0x800;
    const name = bytes(e.name);
    const streamed = (flags & 8) !== 0;
    const local = header(30, v => {
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, flags, true); v.setUint16(8, method, true);
      v.setUint16(12, 0x0021, true); v.setUint32(14, streamed ? 0 : crc, true); v.setUint32(18, streamed ? 0 : stored.length, true);
      v.setUint32(22, streamed ? 0 : size, true); v.setUint16(26, name.length, true);
    });
    const descriptor = streamed ? [header(16, v => {
      v.setUint32(0, 0x08074b50, true); v.setUint32(4, crc, true); v.setUint32(8, stored.length, true); v.setUint32(12, size, true);
    })] : [];
    parts.push(local, name, stored, ...descriptor);
    dir.push(header(46, v => {
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 0x0314, true); v.setUint16(6, 20, true); v.setUint16(8, flags, true);
      v.setUint16(10, method, true); v.setUint16(14, 0x0021, true); v.setUint32(16, crc, true); v.setUint32(20, stored.length, true);
      v.setUint32(24, size, true); v.setUint16(28, name.length, true); v.setUint32(42, offset, true);
    }), name);
    offset += local.length + name.length + stored.length + descriptor.reduce((s, d) => s + d.length, 0);
  }
  const dirSize = dir.reduce((s, b) => s + b.length, 0);
  const note = bytes(comment);
  const end = header(22, v => {
    v.setUint32(0, 0x06054b50, true); v.setUint16(4, disk, true); v.setUint16(8, count ?? entries.length, true);
    v.setUint16(10, count ?? entries.length, true); v.setUint32(12, dirSize, true); v.setUint32(16, offset, true); v.setUint16(20, note.length, true);
  });
  const all = [...parts, ...dir, end, note];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
};

/** The test reel and its media as zip entries, plus `extra` entries. */
const entries = (extra: Entry[] = [], doc: unknown = reel): Entry[] => [
  { name: 'reel.json', data: bytes(JSON.stringify(doc)) },
  ...Object.entries(media).map(([name, data]) => ({ name, data })),
  ...extra,
];

/**
 * A deflate stream of `mib` MiB of zeros, about 1 kB per MiB. Made of independent blocks that each
 * end in a sync flush, so a large bomb needs no large buffer to build.
 */
const zeros = (mib: number) => {
  const block = deflateRawSync(new Uint8Array(1 << 20), { level: 9, finishFlush: constants.Z_SYNC_FLUSH });
  // The last block: empty, final, fixed Huffman codes.
  return new Uint8Array(Buffer.concat([...Array<Buffer>(mib).fill(block), Buffer.from([0x03, 0x00])]));
};

/** The result of `run` and the most resident memory the process used meanwhile, above where it started. */
const peakMemory = async <T>(run: () => Promise<T>) => {
  const start = process.memoryUsage.rss();
  let peak = start;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 1);
  try {
    const result = await run();
    peak = Math.max(peak, process.memoryUsage.rss());
    return { result, growth: peak - start };
  } finally {
    clearInterval(timer);
  }
};

// --- Hostile zips -----------------------------------------------------------------------------

test('a deflate bomb is refused without unpacking it', async () => {
  const bomb = zeros(1024); // 1 GiB of zeros in about 1 MB
  for (const name of ['media/a.jpg', 'reel.json']) {
    const others = entries().filter(e => e.name !== name);
    const { result, growth } = await peakMemory(() => readReelPackage(zip([...others, { name, data: new Uint8Array(1000), method: 8, stored: bomb, crc: 0 }])));
    assert.deepEqual(result.errors, [`${name}: the content is larger than the zip says`]);
    assert.ok(growth < 200 * 2 ** 20, `${name}: used ${growth >> 20} MB more memory`);
  }
});

test('declared sizes above the limits are refused before anything is unpacked', async () => {
  const bomb = zeros(1024);
  const big = (name: string, size: number): Entry => ({ name, data: new Uint8Array(0), size, method: 8, stored: bomb });
  const errors = async (extra: Entry[], options = {}) => (await readReelPackage(zip(entries(extra)), options)).errors;
  assert.deepEqual(await errors([big('media/big.jpg', 300_000_000)]), ['the package is larger than 200 MB']);
  assert.deepEqual(await errors([big('media/b1.jpg', 80_000_000), big('media/b2.jpg', 80_000_000), big('media/b3.jpg', 80_000_000)]), ['the package is larger than 200 MB']);
  assert.deepEqual(await errors([big('media/b.jpg', 1001)], { maxBytes: 1000 }), ['the package is larger than 1 kB']);
  // reel.json has its own limit, checked before it is unpacked.
  const manifest = (size: number) => [{ name: 'reel.json', data: new Uint8Array(0), size, method: 8, stored: bomb }, ...entries().slice(1)];
  assert.deepEqual((await readReelPackage(zip(manifest(1_000_001)))).errors, ['reel.json is larger than 1 MB']);
  assert.deepEqual((await readReelPackage(zip(entries()), { maxManifestBytes: 100 })).errors, ['reel.json is larger than 100 bytes']);
  // The limits count what the zip says; content that turns out larger is caught while unpacking.
  assert.deepEqual((await readReelPackage(zip(manifest(1_000_000)))).errors, ['reel.json: the content is larger than the zip says']);
});

test('too many files are refused before the directory is read', async () => {
  const many = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`media/x${i}.jpg`, new Uint8Array(0)]));
  const z = writeReelPackage(reel, { ...media, ...many });
  assert.deepEqual((await readReelPackage(z)).errors, ['the package has 20003 files – the limit is 20000']);
  assert.equal((await readReelPackage(z, { maxFiles: 20_003 })).ok, true);
  assert.deepEqual((await readReelPackage(zip(entries(), { count: 0xffff }))).errors, ['ZIP64 is not supported']);
  assert.deepEqual((await readReelPackage(zip(entries(), { count: 4 }))).errors, ['the zip directory is damaged']);
});

test('damaged and unsupported zips get a clear error', async () => {
  const errors = async (zipBytes: Uint8Array) => (await readReelPackage(zipBytes)).errors;
  const one = (e: Partial<Entry>) => zip(entries([{ name: 'media/x.jpg', data: bytes('content'), ...e }]));
  assert.deepEqual(await errors(one({ crc: 1234 })), ['media/x.jpg: the content does not match its checksum']);
  assert.deepEqual(await errors(one({ size: 6 })), ['media/x.jpg: the content does not match its checksum']);
  assert.deepEqual(await errors(one({ method: 8, size: 8 })), ['media/x.jpg: the content does not match its checksum']);
  assert.deepEqual(await errors(one({ method: 8, stored: bytes('not deflate data') })), ['media/x.jpg: could not be unpacked']);
  assert.deepEqual(await errors(one({ flags: 0x801 })), ['media/x.jpg: encrypted entries are not supported']);
  assert.deepEqual(await errors(one({ method: 12 })), ['media/x.jpg: compression method 12 is not supported – use stored or deflate']);
  assert.deepEqual(await errors(one({ size: 0xffffffff })), ['ZIP64 is not supported']);
  assert.deepEqual(await errors(zip(entries([{ name: 'media/a.jpg', data: bytes('again') }]))), ['media/a.jpg: occurs more than once']);
  for (const name of ['/etc/passwd', 'C:/x.jpg', 'c:x.jpg', 'media\\x.jpg', 'media//x.jpg', 'media/./x.jpg', 'media/../../x.jpg']) {
    assert.deepEqual(await errors(one({ name })), [`${name}: paths must be relative and clean (no leading /, .., \\ or empty parts)`], name);
  }
  assert.deepEqual(await errors(zip(entries(), { disk: 1 })), ['multi-part zips are not supported']);
  const good = zip(entries());
  assert.deepEqual(await errors(good.subarray(0, 40)), ['not a zip file']);
  // Offsets that point at the wrong place, and sizes larger than the file.
  const wrongDir = zip(entries());
  new DataView(wrongDir.buffer).setUint32(wrongDir.length - 6, 0, true); // the directory "starts" at the first local header
  assert.deepEqual(await errors(wrongDir), ['the zip directory is damaged']);
  const shifted = zip(entries());
  const dir = new DataView(shifted.buffer).getUint32(shifted.length - 6, true);
  new DataView(shifted.buffer).setUint32(dir + 42, 3, true); // the first entry's local header is not at offset 3
  assert.deepEqual(await errors(shifted), ['reel.json: damaged entry']);
  const long = zip(entries());
  new DataView(long.buffer).setUint32(dir + 20, 1_000_000, true); // stored size larger than the file
  new DataView(long.buffer).setUint32(dir + 24, 1_000_000, true);
  assert.deepEqual(await errors(long), ['reel.json: the file is cut off']);
});

test('reel.json must be UTF-8 JSON; a byte order mark is fine', async () => {
  const manifest = (data: Uint8Array) => readReelPackage(zip([{ name: 'reel.json', data }, ...entries().slice(1)]));
  assert.deepEqual((await manifest(new Uint8Array([0x7b, 0xff, 0x7d]))).errors, ['reel.json is not valid UTF-8 JSON']);
  assert.deepEqual((await manifest(bytes('{"format": "reel/1",'))).errors, ['reel.json is not valid UTF-8 JSON']);
  assert.equal((await manifest(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(JSON.stringify(reel))]))).ok, true);
  assert.deepEqual((await manifest(bytes('[]'))).errors, ['reel.json document: must be a JSON object']);
});

test('streamed zips, deflated entries, archive comments and folder entries are read', async () => {
  const r = await readReelPackage(zip([
    { name: 'media/', data: new Uint8Array(0) },
    ...entries().map(e => ({ ...e, method: 8, flags: 0x808 })),
  ], { comment: 'made by a streaming zip tool' }));
  assert.equal(r.ok, true, r.errors.join('\n'));
  if (r.ok) assert.deepEqual([...r.files.keys()].sort(), Object.keys(media).sort());
});

test('files the reel does not use are warnings, whatever their type; system files are ignored', async () => {
  const extra = ['notes.txt', 'media/sub/readme', 'media/a.jpg.bak', 'media/.gitkeep', 'media/b.png'].map(name => ({ name, data: bytes('x') }));
  const system = ['__MACOSX/media/._a.jpg', 'media/.DS_Store', 'Thumbs.db', 'media/desktop.ini', 'media/._a.jpg'].map(name => ({ name, data: bytes('x') }));
  const r = await readReelPackage(zip(entries([...extra, ...system])));
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.warnings, extra.map(e => `${e.name} is not used by reel.json`));
  // A file the reel uses must have a media type of its use.
  const text = structuredClone(reel);
  (text.slides[0].layers[0] as { src: string }).src = 'media/a.txt';
  const used = await readReelPackage(zip(entries([{ name: 'media/a.txt', data: bytes('x') }], text)));
  assert.deepEqual(used.errors, ['reel.json slides[0].layers[0].src: .txt is not an image type – use jpg, jpeg, png, webp, svg, gif']);
});

test('names are compared exactly; another Unicode form or case gets a hint', async () => {
  const nfc = 'media/blåbær.jpg';
  const nfd = nfc.normalize('NFD');
  const withSrc = (src: string) => {
    const doc = structuredClone(reel);
    (doc.slides[0].layers[0] as { src: string }).src = src;
    return doc;
  };
  const hint = /^media\/\S+: not in the package – the package has media\/\S+ with the same letters in another Unicode form/;
  // The reel and the package in either form.
  assert.match(checkPackageFiles(withSrc(nfc), [nfd, 'media/voice.mp3']).errors.join(), hint);
  assert.match(checkPackageFiles(withSrc(nfd), [nfc, 'media/voice.mp3']).errors.join().normalize('NFC'), hint);
  assert.deepEqual(checkPackageFiles(withSrc(nfd), [nfd, 'media/voice.mp3']), { errors: [], warnings: [] });
  assert.deepEqual(checkPackageFiles(withSrc(nfc), ['media/BLÅBÆR.jpg', 'media/voice.mp3']).errors, ['media/blåbær.jpg: not in the package – did you mean media/BLÅBÆR.jpg?']);
  // The same through a zip: the name is stored as written, not normalized.
  const r = await readReelPackage(writeReelPackage(withSrc(nfc), { [nfd]: bytes('x'), 'media/voice.mp3': bytes('v') }));
  assert.match(r.errors.join(), hint);
  assert.deepEqual(r.warnings, [`${nfd} is not used by reel.json`]);
});

// --- The zips writeReelPackage makes ------------------------------------------------------------

const NAMES = ['media/blåbær.jpg', 'media/日本語/写真.png', 'media/😀.gif', 'media/a b.mp3', 'media/Ærø – sommer.webp', 'media/blåbær.jpg'.normalize('NFD').replace('.jpg', '-nfd.jpg')];
const named = (() => {
  const doc = structuredClone(reel);
  doc.slides[0].layers = NAMES.filter(n => !n.endsWith('.mp3')).map(src => ({ type: 'image', src }));
  doc.slides[0].audio = [{ src: 'media/a b.mp3', duration: 3 }];
  return doc;
})();
const namedFiles = Object.fromEntries(NAMES.map((n, i) => [n, bytes(`file ${i}`)]));

test('writeReelPackage: non-ASCII names round trip, with Unix headers, UTF-8 flags and a valid date', async () => {
  const z = writeReelPackage(named, namedFiles);
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  const dirSize = v.getUint32(eocd + 12, true);
  const dirOffset = v.getUint32(eocd + 16, true);
  assert.equal(count, NAMES.length + 1);
  assert.equal(v.getUint16(eocd + 8, true), count);
  assert.equal(v.getUint16(eocd + 20, true), 0, 'no archive comment');
  assert.equal(dirOffset + dirSize, eocd);
  const names: string[] = [];
  for (let i = 0, p = dirOffset; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const nameLength = v.getUint16(p + 28, true);
    const nameBytes = z.subarray(p + 46, p + 46 + nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    names.push(name);
    const local = v.getUint32(p + 42, true);
    const data = name === 'reel.json' ? undefined : namedFiles[name];
    assert.equal(v.getUint8(p + 5), 3, `${name}: made by Unix`);
    assert.equal(v.getUint8(p + 4), 20, `${name}: zip 2.0`);
    assert.equal(v.getUint16(p + 6, true), 20, `${name}: version needed`);
    assert.equal(v.getUint16(p + 8, true), 0x0800, `${name}: UTF-8 names`);
    assert.equal(v.getUint16(p + 10, true), 0, `${name}: stored`);
    assert.equal(v.getUint16(p + 12, true), 0, `${name}: time 00:00`);
    assert.equal(v.getUint16(p + 14, true), 0x0021, `${name}: date 1980-01-01`);
    assert.equal(v.getUint16(p + 30, true) + v.getUint16(p + 32, true), 0, `${name}: no extra field or comment`);
    assert.equal(v.getUint16(p + 34, true), 0, `${name}: disk`);
    assert.equal(v.getUint16(p + 36, true), 0, `${name}: internal attributes`);
    assert.equal(v.getUint32(p + 38, true), (0o100644 << 16) >>> 0, `${name}: a regular file, rw-r--r--`);
    if (data) {
      assert.equal(v.getUint32(p + 16, true), crc32(data), `${name}: checksum`);
      assert.equal(v.getUint32(p + 24, true), data.length, `${name}: size`);
    }
    // The local header says the same: version, flags, method, time, date, name length; checksum and sizes.
    assert.equal(v.getUint32(local, true), 0x04034b50);
    for (const [l, c] of [[4, 6], [6, 8], [8, 10], [10, 12], [12, 14], [26, 28]]) {
      assert.equal(v.getUint16(local + l, true), v.getUint16(p + c, true), `${name}: local header field at ${l}`);
    }
    for (const [l, c] of [[14, 16], [18, 20], [22, 24]]) {
      assert.equal(v.getUint32(local + l, true), v.getUint32(p + c, true), `${name}: local header field at ${l}`);
    }
    assert.equal(v.getUint16(local + 28, true), 0, `${name}: no local extra field`);
    assert.deepEqual(z.subarray(local + 30, local + 30 + nameLength), nameBytes, `${name}: local name`);
    p += 46 + nameLength;
  }
  assert.deepEqual(names, ['reel.json', ...NAMES]);

  const r = await readReelPackage(z);
  assert.equal(r.ok, true, r.errors.join('\n'));
  if (r.ok) {
    assert.deepEqual(r.reel, named);
    assert.deepEqual(Object.fromEntries(r.files), namedFiles);
  }
});

const hasUnzip = (() => { try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('writeReelPackage: Info-ZIP unzip extracts the names as written, dated 1980-01-01', { skip: !hasUnzip && 'unzip is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'reel-unzip-'));
  try {
    writeFileSync(join(dir, 'p.zip'), writeReelPackage(named, namedFiles));
    execFileSync('unzip', ['-q', 'p.zip', '-d', 'out'], { cwd: dir });
    const out = join(dir, 'out');
    const files = (readdirSync(out, { recursive: true }) as string[]).filter(f => statSync(join(out, f)).isFile()).sort();
    // Some file systems (macOS) normalize names; compare the NFC forms there.
    assert.deepEqual(files.map(f => f.normalize('NFC')), ['reel.json', ...NAMES].map(f => f.normalize('NFC')).sort());
    const date = statSync(join(out, 'reel.json')).mtime;
    assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate()], [1980, 0, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeReelPackage refuses what readers would reject', () => {
  assert.throws(() => writeReelPackage({ ...reel, extra: 1 } as Reel, media), /not a valid reel\/1 document:\ndocument: unknown field "extra"/);
  assert.throws(() => writeReelPackage({ ...reel, format: 'reel/2' } as unknown as Reel, media), /format: must be "reel\/1"/);
  for (const path of ['/a.jpg', 'C:/a.jpg', 'media\\a.jpg', 'media//a.jpg', 'media/./a.jpg', 'media/a/', '']) {
    assert.throws(() => writeReelPackage(reel, { ...media, [path]: bytes('x') }), /is not a clean relative path/, JSON.stringify(path));
  }
  // Fields set to undefined are left out, as JSON leaves them out; a file named reel.json is not written twice.
  const z = writeReelPackage({ ...reel, description: undefined }, { ...media, 'reel.json': bytes('ignored') });
  const text = new TextDecoder().decode(z);
  assert.equal(text.split('reel.json').length - 1, 2, 'one local and one central entry');
  assert.ok(!text.includes('description') && !text.includes('ignored'));
});

// --- Anything at all --------------------------------------------------------------------------

test('readReelPackage never throws, whatever the bytes', async () => {
  // A seeded generator (mulberry32), so a failure can be reproduced.
  let seed = 0xb0b;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const good = zip(entries().map(e => ({ ...e, method: 8 })));
  const inputs: Uint8Array[] = [new Uint8Array(0), new Uint8Array(22), new Uint8Array(21), bytes('PK\u0005\u0006')];
  // Every byte left out once, every prefix, and random bytes changed.
  for (let i = 0; i < good.length; i++) inputs.push(new Uint8Array([...good.subarray(0, i), ...good.subarray(i + 1)]), good.slice(0, i));
  for (let i = 0; i < 1500; i++) {
    const b = good.slice();
    for (let n = 1 + Math.floor(random() * 4); n > 0; n--) b[Math.floor(random() * b.length)] = Math.floor(random() * 256);
    inputs.push(b);
  }
  for (const [i, input] of inputs.entries()) {
    const r = await readReelPackage(input);
    assert.ok(Array.isArray(r.errors) && Array.isArray(r.warnings), `input ${i}`);
    assert.equal(r.ok, r.errors.length === 0, `input ${i}: ${r.errors.join('; ')}`);
  }
});
