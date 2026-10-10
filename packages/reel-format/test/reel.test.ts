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
