// Demo data: one reel written directly in Reel 1.0, and one made from each template's example.
// Loaded when the server starts with no reels, and by POST /api/reset.

import type { Reel } from 'reel-format';
import { deleteAllReels, listReels } from './store.ts';
import { createReel } from './service.ts';
import { TEMPLATES, type MediaImport } from './templates/index.ts';

/** Written by hand in Reel 1.0, to show the format itself: zoom, timed text, a pointer shape, ducking. */
const handWritten: Reel = {
  format: 'reel/1',
  title: 'A trip that never happened',
  description: 'Hand-written demo reel. Every image and sound is generated and means nothing.',
  language: 'en',
  tags: ['demo', 'landscape'],
  music: { src: 'media/music-calm.wav', duration: 32, volume: 0.35, duckTo: 0.1 },
  defaults: {
    text: { style: { font: 'sans', size: 5.5, color: '#ffffff', background: '#00000099', padding: 1.2, radius: 1 } },
    transition: { type: 'fade', duration: 1.5 },
  },
  slides: [
    {
      id: 'title', duration: 7, background: '#0d1b2a',
      layers: [
        { type: 'image', src: 'media/fjord.svg', opacity: 0.45, motion: { from: { scale: 1.1 }, to: { scale: 1 } } },
        { type: 'text', text: 'A trip that never happened', x: 5, y: 34, w: 90, align: 'center', start: 0.6, fadeIn: 1.2,
          style: { size: 9, weight: 'bold', background: '#00000000', font: 'serif' } },
        { type: 'text', text: 'Generated pictures and sounds', x: 5, y: 54, w: 90, align: 'center', start: 2, fadeIn: 1,
          style: { size: 4.5, italic: true, background: '#00000000' } },
      ],
      audio: [{ src: 'media/chime.wav', start: 0.5, duration: 3, volume: 0.6, duck: false }],
    },
    {
      id: 'fjord', duration: 12,
      layers: [
        { type: 'image', src: 'media/fjord.svg', alt: 'Drawn fjord with a small sailing boat',
          motion: { from: { scale: 1, x: 50, y: 50 }, to: { scale: 1.2, x: 52, y: 72 } } },
        { type: 'shape', shape: 'ellipse', x: 44, y: 66, w: 14, h: 18, stroke: '#f2c48d', strokeWidth: 0.6, start: 5, end: 10, fadeIn: 0.8, fadeOut: 0.8 },
        { type: 'text', text: 'A boat', x: 44, y: 58, w: 14, align: 'center', start: 5, end: 10, fadeIn: 0.8, fadeOut: 0.8,
          style: { size: 3.5, background: '#00000000' } },
        { type: 'text', text: 'A quiet morning on the fjord', x: 5, y: 82, w: 90, align: 'center', start: 0.5, fadeIn: 0.6, style: { weight: 'bold', size: 6 } },
      ],
      audio: [{ src: 'media/waves.wav', start: 1, duration: 5, volume: 0.8, transcript: '(waves)' }],
      credit: 'Generated demo image',
    },
    {
      id: 'aurora', duration: 12,
      layers: [
        { type: 'image', src: 'media/aurora.svg', alt: 'Drawn northern lights over a cabin',
          motion: { from: { scale: 1.15, x: 50, y: 30 }, to: { scale: 1, x: 50, y: 50 } } },
        { type: 'text', text: 'When it gets dark,\nthe lights come out', x: 5, y: 8, w: 60, start: 1, end: 11, fadeIn: 1, fadeOut: 1,
          style: { size: 5.5, background: '#00000000', font: 'serif', italic: true } },
      ],
      credit: 'Generated demo image',
    },
    {
      id: 'stripes', duration: 8, transition: { type: 'cut' },
      layers: [
        { type: 'image', src: 'media/stripes.svg', motion: { from: { scale: 1.2, x: 20 }, to: { scale: 1.2, x: 80 } } },
        { type: 'shape', shape: 'rect', x: 30, y: 38, w: 40, h: 24, fill: '#000000cc', radius: 2, start: 1, fadeIn: 0.5 },
        { type: 'text', text: 'Cut!', x: 30, y: 38, w: 40, h: 24, align: 'center', valign: 'middle', start: 1, fadeIn: 0.5,
          style: { size: 10, weight: 'bold', background: '#00000000', shadow: false } },
      ],
    },
    {
      id: 'sunset', duration: 10,
      layers: [
        { type: 'image', src: 'media/sunset.svg', alt: 'Drawn sunset', motion: { from: { scale: 1, y: 60 }, to: { scale: 1.12, y: 60 } } },
        { type: 'text', text: 'Good night', x: 5, y: 40, w: 90, align: 'center', start: 2, end: 9.5, fadeIn: 1.5, fadeOut: 1.5,
          style: { size: 12, weight: 'bold', background: '#00000000', font: 'serif' } },
      ],
    },
  ],
};

const handWrittenMedia: MediaImport[] = ['images/fjord.svg', 'images/aurora.svg', 'images/stripes.svg', 'images/sunset.svg',
  'audio/music-calm.wav', 'audio/chime.wav', 'audio/waves.wav'].map(from => ({ from }));

export const seed = async () => {
  await deleteAllReels();
  await createReel(handWritten, handWrittenMedia, 'demo-trip');
  for (const t of TEMPLATES) await createReel(t.example.document, t.example.media, `demo-${t.format.replace(/^reel-|\/\d+$/g, '')}`);
};

export const seedIfEmpty = async () => {
  if ((await listReels()).length === 0) await seed();
};
