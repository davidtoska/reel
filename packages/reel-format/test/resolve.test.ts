// resolveReel: defaults merged the way Reel 1.0 specifies, media resolved against an absolute baseUrl.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveReel, type Reel, type TextLayer } from '../src/index.ts';

const reel: Reel = {
  format: 'reel/1',
  title: 'Resolve',
  music: { src: 'media/music.mp3', duration: 30 },
  defaults: { text: { style: { size: 6, font: 'serif' } }, transition: { type: 'fade', duration: 2 } },
  slides: [
    {
      id: 'a', duration: 5,
      layers: [
        { type: 'image', src: 'media/a b.jpg' },
        { type: 'video', src: 'media/v.mp4', duration: 4 },
        { type: 'text', text: 'Hi', style: { color: '#ff0000' } },
        { type: 'text', text: 'Plain' },
        { type: 'shape', shape: 'rect' },
      ],
      audio: [{ src: 'https://cdn.example.com/voice.mp3?v=2', duration: 3 }],
    },
    { id: 'b', duration: 5, transition: { type: 'cut' }, layers: [{ type: 'video', src: 'https://cdn.example.com/v.mp4', duration: 9 }] },
    { id: 'c', duration: 5, layers: [{ type: 'video', src: 'media/v.mp4', duration: 9, muted: false }], audio: [{ src: 'media/x.wav', duration: 1 }] },
  ],
};
const styleOf = (r: ReturnType<typeof resolveReel>, slide: number, layer: number) => (r.slides[slide].layers[layer] as TextLayer).style;

test('resolveReel: a relative baseUrl is a TypeError that says what to do', () => {
  for (const baseUrl of ['reel.json', './x/reel.json', '/reels/x/reel.json', '../reel.json', 'media/', '//cdn.example.com/x/reel.json']) {
    assert.throws(() => resolveReel(reel, { baseUrl }), { name: 'TypeError', message: /^resolveReel: baseUrl must be an absolute URL such as https:\/\// }, baseUrl);
  }
  // An absolute URL that relative references cannot be resolved against.
  assert.throws(() => resolveReel(reel, { baseUrl: 'mailto:someone@example.com' }), { name: 'TypeError', message: /^resolveReel: "media\/[^"]+" cannot be resolved against baseUrl "mailto:someone@example.com"$/ });
});

test('resolveReel: media resolve against an absolute baseUrl; https stays as it is', () => {
  for (const baseUrl of ['https://cdn.example.com/reels/x/reel.json', new URL('https://cdn.example.com/reels/x/reel.json'), 'https://cdn.example.com/reels/x/']) {
    const r = resolveReel(reel, { baseUrl });
    assert.equal(r.music?.src, 'https://cdn.example.com/reels/x/media/music.mp3');
    assert.equal((r.slides[0].layers[0] as { src: string }).src, 'https://cdn.example.com/reels/x/media/a%20b.jpg');
    assert.equal(r.slides[0].audio?.[0].src, 'https://cdn.example.com/voice.mp3?v=2');
    assert.equal((r.slides[1].layers[0] as { src: string }).src, 'https://cdn.example.com/v.mp4');
    assert.equal(r.id, String(baseUrl));
  }
  assert.equal(resolveReel(reel, { baseUrl: 'http://localhost:8080/reels/x/reel.json' }).music?.src, 'http://localhost:8080/reels/x/media/music.mp3');
  assert.equal(resolveReel(reel, { baseUrl: 'file:///home/me/x/reel.json' }).music?.src, 'file:///home/me/x/media/music.mp3');
  // Without a baseUrl, references stay as they are and the title identifies the reel.
  const plain = resolveReel(reel);
  assert.equal(plain.music?.src, 'media/music.mp3');
  assert.equal((plain.slides[0].layers[0] as { src: string }).src, 'media/a b.jpg');
  assert.equal(plain.id, 'Resolve');
  assert.equal(resolveReel(reel, { id: 'mine', baseUrl: 'https://x.example/reel.json' }).id, 'mine');
});

test('resolveReel: text styles, transitions and video sound get their defaults', () => {
  const r = resolveReel(reel);
  assert.equal(r.duration, 15);
  assert.deepEqual(styleOf(r, 0, 2), { size: 6, font: 'serif', color: '#ff0000' });
  assert.deepEqual(styleOf(r, 0, 3), { size: 6, font: 'serif' });
  assert.notEqual(styleOf(r, 0, 3), reel.defaults?.text?.style, 'each layer gets its own copy');
  assert.deepEqual(r.slides.map(s => s.transition), [{ type: 'fade', duration: 2 }, { type: 'cut' }, { type: 'fade', duration: 2 }]);
  // muted: true when the slide has audio clips, else false, unless the layer says otherwise.
  assert.deepEqual(r.slides.map(s => s.layers.filter(l => l.type === 'video').map(l => l.muted)), [[true], [false], [false]]);
  // Without defaults there is nothing to merge, and no transition is made up.
  const bare = resolveReel({ ...reel, defaults: undefined });
  assert.deepEqual(styleOf(bare, 0, 3), {});
  assert.equal('transition' in bare.slides[0], false);
});

test('resolveReel: fields set to undefined do not hide a default', () => {
  const doc = structuredClone(reel);
  doc.defaults!.text!.style = { size: 6, font: undefined, color: '#00ff00', weight: undefined };
  (doc.slides[0].layers[2] as TextLayer).style = { color: undefined, weight: 'bold', size: undefined };
  const r = resolveReel(doc);
  assert.deepEqual(styleOf(r, 0, 2), { size: 6, color: '#00ff00', weight: 'bold' });
  assert.deepEqual(styleOf(r, 0, 3), { size: 6, color: '#00ff00' });
  assert.ok(!Object.values(styleOf(r, 0, 2) ?? {}).includes(undefined));
});

test('resolveReel does not change the document it is given', () => {
  const doc = structuredClone(reel);
  resolveReel(doc, { baseUrl: 'https://cdn.example.com/reels/x/reel.json' });
  assert.deepEqual(doc, reel);
});
