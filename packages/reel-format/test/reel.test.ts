// Run with: npm test -w reel-format  (Node 22.18+ runs TypeScript directly)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { crc32, readReelPackage, resolveReel, validateReel, writeReelPackage, type Reel } from '../src/index.ts';

const reel: Reel = {
  format: 'reel/1',
  title: 'Test',
  music: { src: 'media/music.mp3', duration: 30 },
  defaults: { text: { style: { size: 6 } } },
  slides: [{
    id: 'a', duration: 5,
    layers: [{ type: 'image', src: 'media/a.jpg' }, { type: 'text', text: 'Hi', style: { color: '#ff0000' } }],
    audio: [{ src: 'media/voice.mp3', start: 1, duration: 3 }],
  }],
};
const bytes = (s: string) => new TextEncoder().encode(s);
const media = { 'media/a.jpg': bytes('jpg'), 'media/music.mp3': bytes('mp3'), 'media/voice.mp3': bytes('voice') };

test('a valid reel passes', () => {
  assert.equal(validateReel(reel).ok, true);
});

test('errors name the field', () => {
  const bad = structuredClone(reel) as unknown as { slides: { duration: number; audio: { duration: number }[] }[] };
  bad.slides[0].audio[0].duration = 10;
  const r = validateReel(bad);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /slides\[0\]\.audio\[0\]: ends after the slide/);
});

test('media must be under media/ or https://', () => {
  const bad = structuredClone(reel);
  (bad.slides[0].layers[0] as { src: string }).src = '../secret.jpg';
  assert.match(validateReel(bad).errors.join(), /must start with media\//);
});

test('resolveReel merges defaults and resolves media against reel.json', () => {
  const r = resolveReel(reel, { baseUrl: 'https://cdn.example/reels/x/reel.json' });
  assert.equal(r.duration, 5);
  assert.equal(r.music?.src, 'https://cdn.example/reels/x/media/music.mp3');
  assert.equal((r.slides[0].layers[0] as { src: string }).src, 'https://cdn.example/reels/x/media/a.jpg');
  assert.deepEqual((r.slides[0].layers[1] as { style: object }).style, { size: 6, color: '#ff0000' });
});

test('package round trip', async () => {
  const zip = writeReelPackage(reel, media);
  const r = await readReelPackage(zip);
  assert.equal(r.ok, true, r.errors.join('\n'));
  if (!r.ok) return;
  assert.deepEqual(r.reel, reel);
  assert.deepEqual([...r.files.keys()].sort(), Object.keys(media).sort());
  assert.deepEqual(r.warnings, []);
});

test('missing files are errors, with a suggestion for wrong case', async () => {
  const r = await readReelPackage(writeReelPackage(reel, { 'media/A.jpg': bytes('x'), 'media/music.mp3': bytes('m'), 'media/voice.mp3': bytes('v') }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /media\/a\.jpg: not in the package – did you mean media\/A\.jpg\?/);
});

test('unused files give warnings; system files are ignored', async () => {
  const r = await readReelPackage(writeReelPackage(reel, { ...media, 'media/old.jpg': bytes('o'), '__MACOSX/._a.jpg': bytes('') }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, ['media/old.jpg is not used by reel.json']);
});

/** A zip with deflated entries inside a folder, as made by "compress folder" in a file manager. */
const zipOf = (entries: [string, Uint8Array][]) => {
  const parts: Buffer[] = [];
  const dir: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const comp = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    parts.push(local, n, comp);
    dir.push(central, n);
    offset += 30 + n.length + comp.length;
  }
  const size = dir.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...dir, end]));
};

test('deflated entries are read', async () => {
  const r = await readReelPackage(zipOf([['reel.json', bytes(JSON.stringify(reel))], ...Object.entries(media)]));
  assert.equal(r.ok, true, r.errors.join('\n'));
});

test('a zipped folder gets a helpful error', async () => {
  const r = await readReelPackage(zipOf([['my-reel/reel.json', bytes(JSON.stringify(reel))]]));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /zip the contents of the folder, not the folder itself/);
});

test('unsafe paths and garbage are rejected without throwing', async () => {
  const r = await readReelPackage(zipOf([['reel.json', bytes(JSON.stringify(reel))], ['../evil.mp3', bytes('x')], ...Object.entries(media)]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /\.\.\/evil\.mp3: paths must be relative/);
  assert.equal((await readReelPackage(bytes('not a zip'))).ok, false);
});

// --- 1.0.1 fixes ----------------------------------------------------------------------------------

/** The errors validateReel reports for the test reel after `change` has modified a copy of it. */
const errorsAfter = (change: (doc: any) => void) => {
  const doc = structuredClone(reel) as any;
  change(doc);
  return validateReel(doc).errors;
};
/** The problem with a src on the image layer, or undefined. */
const srcError = (src: string) => errorsAfter(d => { d.slides[0].layers[0].src = src; }).find(e => e.startsWith('slides[0].layers[0].src'));

test('unknown fields are errors, with a suggestion for near misses', () => {
  assert.deepEqual(errorsAfter(d => { d.slides[0].durration = 5; }), ['slides[0]: unknown field "durration" – did you mean "duration"?']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].layers[1].style.colour = '#ffffff'; }), ['slides[0].layers[1].style: unknown field "colour" – did you mean "color"?']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].layers[0].FIT = 'cover'; }), ['slides[0].layers[0]: unknown field "FIT" – did you mean "fit"?']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].layers[1].fontSize = 6; }), ['slides[0].layers[1]: unknown field "fontSize"']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].layers[0].id = 'x'; }), ['slides[0].layers[0]: unknown field "id"']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].audio[0].scr = 'media/voice.mp3'; delete d.slides[0].audio[0].src; }), [
    'slides[0].audio[0]: unknown field "scr" – did you mean "src"?', 'slides[0].audio[0].src: required',
  ]);
  assert.deepEqual(errorsAfter(d => { d.transitions = {}; }), ['document: unknown field "transitions"']);
  assert.deepEqual(errorsAfter(d => { d.music.loop = true; d.defaults.text.size = 6; d.slides[0].audio[0].delay = 1; }), [
    'music: unknown field "loop"', 'defaults.text: unknown field "size"', 'slides[0].audio[0]: unknown field "delay"',
  ]);
  assert.deepEqual(errorsAfter(d => { d.slides[0].layers[0].motion = { from: { zoom: 1 }, to: {}, ease: 'in' }; }), [
    'slides[0].layers[0].motion: unknown field "ease"', 'slides[0].layers[0].motion.from: unknown field "zoom"',
  ]);
  // Fields set to undefined count as left out; $schema is allowed at the top level only, as text.
  assert.deepEqual(errorsAfter(d => { d.slides[0].extra = undefined; d.$schema = 'https://unpkg.com/reel-schema@1/reel-1.schema.json'; }), []);
  assert.deepEqual(errorsAfter(d => { d.$schema = 1; }), ['$schema: must be text']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].$schema = 'x'; }), ['slides[0]: unknown field "$schema"']);
});

test('a transition needs a type, and a cut has nothing else', () => {
  assert.deepEqual(errorsAfter(d => { d.slides[0].transition = {}; }), ['slides[0].transition.type: required – fade or cut']);
  assert.deepEqual(errorsAfter(d => { d.defaults.transition = { duration: 2 }; }), ['defaults.transition.type: required – fade or cut']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].transition = { type: 'cut', duration: 2 }; }), ['slides[0].transition: unknown field "duration"']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].transition = 'fade'; }), ['slides[0].transition: must be an object like { "type": "fade", "duration": 1 } or { "type": "cut" }']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].transition = { type: 'fade', duration: 0.5 }; d.defaults.transition = { type: 'cut' }; }), []);
});

test('https sources must be URLs; any path is allowed', () => {
  for (const src of ['https://', 'https://exa mple.com/a.jpg', 'https:///a.jpg', 'https://example.com/my photo.jpg', 'https://example.com:99999/a.jpg']) {
    assert.match(srcError(src) ?? '', /must be a valid https:\/\/ URL/, src);
  }
  for (const src of ['https://cdn.example.com', 'https://example.com/render.php?id=3', 'https://example.com/a.JPG#x', 'https://example.com/a%20b.jpg']) {
    assert.equal(srcError(src), undefined, src);
  }
  assert.match(srcError('http://example.com/a.jpg') ?? '', /– use https:\/\//);
  assert.match(srcError('images/a.jpg') ?? '', /– put the file under media\/ \(e\.g\. media\/photo\.jpg\)/);
});

test('relative sources must be clean paths under media/ with a known extension', () => {
  for (const src of ['media/%2e%2e/x.jpg', 'media/%2E./x.jpg', 'media/./x.jpg', 'media/../x.jpg', 'media//x.jpg', 'media/a.jpg?v=1', 'media/c.jpg#x', 'media/a\nb.jpg', 'media/a\u007f.jpg', 'media\\a.jpg', 'media/a\\b.jpg']) {
    assert.match(srcError(src) ?? '', /must (be a clean relative path|start with media\/)/, JSON.stringify(src));
  }
  for (const src of ['media/a%20b.jpg', 'media/A.JPG', 'media/sub/dir/a.webp', 'media/blåbær.jpg', 'media/%2e%2ex.jpg']) {
    assert.equal(srcError(src), undefined, src);
  }
  assert.match(srcError('media/a.constructor') ?? '', /\.constructor is not an image type/);
  assert.match(srcError('media/a.__proto__') ?? '', /\.__proto__ is not an image type/);
  assert.match(srcError('media/a.mp3') ?? '', /\.mp3 is not an image type/);
});

test('lengths count code points, like JSON Schema', () => {
  assert.deepEqual(errorsAfter(d => { d.title = '😀'.repeat(120); }), []);
  assert.deepEqual(errorsAfter(d => { d.title = '😀'.repeat(121); }), ['title: at most 120 characters']);
});

test('holes in lists are errors', () => {
  assert.deepEqual(validateReel({ format: 'reel/1', title: 'T', slides: new Array(1) }).errors, ['slides[0]: missing']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].layers.length = 3; d.tags = ['a', , 'b']; }), ['tags[1]: missing', 'slides[0].layers[2]: missing']);
});

test('messages point at the real problem', () => {
  assert.deepEqual(errorsAfter(d => { d.tags = 'travel'; }), ['tags: must be a list of texts']);
  assert.deepEqual(errorsAfter(d => { d.tags = Array(21).fill('t'); }), ['tags: at most 20 tags']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].layers[1].start = 6; }), ["slides[0].layers[1].start: must be less than the slide's duration (5 s)"]);
  assert.deepEqual(errorsAfter(d => { d.slides[0].layers[1].start = 3; d.slides[0].layers[1].end = 2; }), ['slides[0].layers[1].end: must be after start']);
  assert.deepEqual(errorsAfter(d => { d.slides[0].background = '#fff'; d.slides[0].layers[1].style.color = '#abcd'; }), [
    'slides[0].background: must be #rrggbb or #rrggbbaa – use "#ffffff"', 'slides[0].layers[1].style.color: must be #rrggbb or #rrggbbaa – use "#aabbccdd"',
  ]);
  assert.match(errorsAfter(d => { d.slides[0].audio[0].duration = 10; }).join(), /but the slide lasts 5 s – make the slide longer or start the clip earlier$/);
});

test('resolveReel: undefined style fields keep the defaults; baseUrl must be absolute', () => {
  const doc = structuredClone(reel);
  (doc.slides[0].layers[1] as { style: object }).style = { size: undefined, color: '#ff0000' };
  assert.deepEqual((resolveReel(doc).slides[0].layers[1] as { style: object }).style, { size: 6, color: '#ff0000' });
  assert.throws(() => resolveReel(reel, { baseUrl: '/reels/x/reel.json' }), { name: 'TypeError', message: /baseUrl must be an absolute URL/ });
  assert.equal(resolveReel(reel, { baseUrl: new URL('file:///reels/x/reel.json') }).music?.src, 'file:///reels/x/media/music.mp3');
});

/** A zip with one deflated entry whose directory gives `size` as its uncompressed size. */
const zipWithSize = (name: string, data: Uint8Array, size: number) => {
  const zip = zipOf([[name, data]]);
  const view = new DataView(zip.buffer);
  const dir = view.getUint32(zip.length - 6, true);
  view.setUint32(22, size, true);
  view.setUint32(dir + 24, size, true);
  return zip;
};

test('entries are never unpacked beyond their declared size', async () => {
  const bomb = zipWithSize('reel.json', new Uint8Array(10_000_000), 1000);
  assert.deepEqual((await readReelPackage(bomb)).errors, ['reel.json: the content is larger than the zip says']);
  // A reel.json that declares more than the limit is not unpacked at all.
  const big = await readReelPackage(zipWithSize('reel.json', bytes('{}'), 2_000_000));
  assert.deepEqual(big.errors, ['reel.json is larger than 1 MB']);
});

test('invalid limits fall back to the defaults', async () => {
  const zip = writeReelPackage(reel, media);
  for (const maxFiles of [undefined, NaN, -1, Infinity, '3' as unknown as number]) {
    assert.equal((await readReelPackage(zip, { maxFiles, maxBytes: maxFiles })).ok, true, String(maxFiles));
  }
  assert.deepEqual((await readReelPackage(zip, { maxBytes: 10 })).errors, ['the package is larger than 10 bytes']);
  assert.deepEqual((await readReelPackage(zip, { maxFiles: 2 })).errors, ['the package has 4 files – the limit is 2']);
});

test('unused files of any type are warnings', async () => {
  const r = await readReelPackage(writeReelPackage(reel, { ...media, 'media/.gitkeep': bytes(''), 'media/credits.txt': bytes('x') }));
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.warnings, ['media/.gitkeep is not used by reel.json', 'media/credits.txt is not used by reel.json']);
});

test('a name in another Unicode form gets a hint', async () => {
  const nfc = structuredClone(reel);
  (nfc.slides[0].layers[0] as { src: string }).src = 'media/blåbær.jpg';
  const r = await readReelPackage(writeReelPackage(nfc, { ...media, ['media/blåbær.jpg'.normalize('NFD')]: bytes('x') }));
  assert.match(r.errors.join('\n'), /^media\/\S+: not in the package – the package has media\/\S+ with the same letters in another Unicode form/);
});

test('writeReelPackage writes Unix headers and a valid date, and refuses what readers would reject', async () => {
  const zip = writeReelPackage(reel, { ...media, 'media/blåbær.jpg': bytes('x') });
  const view = new DataView(zip.buffer, zip.byteOffset);
  const dir = view.getUint32(zip.length - 6, true);
  assert.equal(view.getUint16(dir + 4, true), 0x0314);                // made by Unix, zip 2.0
  assert.equal(view.getUint32(dir + 38, true), (0o100644 << 16) >>> 0); // regular file, rw-r--r--
  assert.equal(view.getUint16(dir + 14, true), 0x0021);               // 1980-01-01
  assert.equal(view.getUint16(12, true), 0x0021);
  assert.equal((await readReelPackage(zip)).ok, true);

  assert.throws(() => writeReelPackage({ ...reel, title: '' }, media), /not a valid reel\/1 document:\ntitle: required/);
  assert.throws(() => writeReelPackage(reel, { ...media, 'media/../x.jpg': bytes('x') }), /"media\/\.\.\/x\.jpg" is not a clean relative path/);
  const many = Object.fromEntries(Array.from({ length: 0xffff }, (_, i) => [`media/${i}.jpg`, new Uint8Array(0)]));
  assert.throws(() => writeReelPackage(reel, many), /too many files/);
});
