// reel-album/1 – a photo album: a list of images with captions and optional narration.
// Title slide, slow zoom/pan and timing are chosen automatically.

import type { Layer, MediaSrc, Motion, Reel, Slide } from 'reel-format';
import { type CommonFields, type Sound, Errors, clip, flat, r1, reelHead, resolveTheme } from './common.ts';

export const ALBUM = 'reel-album/1';

export interface AlbumDocument extends CommonFields {
  format: typeof ALBUM;
  /** Under the title on the first slide. */
  subtitle?: string;
  /** Image behind the title. Default: the first photo. */
  cover?: MediaSrc;
  /** Show a title slide first. Default true. */
  titleSlide?: boolean;
  /** Seconds per photo, 3–60. Default 8. A photo with narration stays until the narration has finished. */
  secondsPerPhoto?: number;
  /** auto: slow zoom/pan that alternates from photo to photo. none: still images. Default auto. */
  motion?: 'auto' | 'none';
  /** 1–200 photos. */
  photos: AlbumPhoto[];
  /** Text on a closing slide. */
  ending?: string;
}

export interface AlbumPhoto {
  src: MediaSrc;
  /** ≤ 200 characters, at the bottom. */
  caption?: string;
  credit?: string;
  alt?: string;
  /** Overrides secondsPerPhoto. */
  seconds?: number;
  /** Starts shortly after the photo appears. */
  narration?: Sound;
  /** The important point of the image (percent). The zoom moves towards it. Default the centre. */
  focus?: { x: number; y: number };
  /** contain shows the whole image instead of filling the screen. */
  fit?: 'cover' | 'contain';
}

const NARRATION_START = 0.8;
const NARRATION_TAIL = 1.5;

/** Four movements taking turns, all towards the focus point. */
const movement = (i: number, f = { x: 50, y: 50 }): Motion => {
  const { x, y } = f;
  switch (i % 4) {
    case 0: return { from: { scale: 1, x, y }, to: { scale: 1.15, x, y } };
    case 1: return { from: { scale: 1.15, x, y }, to: { scale: 1, x, y } };
    case 2: return { from: { scale: 1.12, x: Math.max(0, x - 15), y }, to: { scale: 1.12, x: Math.min(100, x + 15), y } };
    default: return { from: { scale: 1.12, x, y: Math.min(100, y + 12) }, to: { scale: 1.12, x, y: Math.max(0, y - 12) } };
  }
};

export const validateAlbum = (doc: AlbumDocument): string[] => {
  const e = new Errors();
  e.common(doc);
  e.text(doc.subtitle, 200, 'subtitle');
  e.range(doc.secondsPerPhoto, 3, 60, 'secondsPerPhoto');
  e.text(doc.ending, 300, 'ending');
  if (e.items(doc.photos, 1, 200, 'photos', 'photos')) doc.photos.forEach((p, i) => {
    const q = `photos[${i}]`;
    e.check(typeof p?.src === 'string' && p.src.length > 0, `${q}.src`, 'required');
    e.text(p.caption, 200, `${q}.caption`);
    e.text(p.credit, 200, `${q}.credit`);
    e.range(p.seconds, 3, 600, `${q}.seconds`);
    e.range(p.focus?.x, 0, 100, `${q}.focus.x`);
    e.range(p.focus?.y, 0, 100, `${q}.focus.y`);
    e.sound(p.narration, `${q}.narration`);
  });
  return e.list;
};

export const compileAlbum = (doc: AlbumDocument): Reel => {
  const t = resolveTheme(doc.theme, 'night');
  const seconds = doc.secondsPerPhoto ?? 8;
  const slides: Slide[] = [];

  if (doc.titleSlide !== false) {
    const cover = doc.cover ?? doc.photos[0]?.src;
    const layers: Layer[] = [];
    if (cover) layers.push({ type: 'image', src: cover, opacity: 0.45, motion: { from: { scale: 1.1 }, to: { scale: 1 } } });
    layers.push({ type: 'text', text: doc.title, x: 5, y: doc.subtitle ? 34 : 40, w: 90, align: 'center', start: 0.5, fadeIn: 1,
      style: { size: 9, weight: 'bold', background: '#00000000' } });
    if (doc.subtitle) layers.push({ type: 'text', text: doc.subtitle, x: 5, y: 55, w: 90, align: 'center', start: 1.5, fadeIn: 1,
      style: { size: 4.5, italic: true, background: '#00000000' } });
    slides.push({ id: 'title', duration: 6, background: t.background, layers });
  }

  doc.photos.forEach((p, i) => {
    const n = p.narration;
    const fit = p.fit ?? 'cover';
    const duration = r1(Math.max(p.seconds ?? seconds, n ? NARRATION_START + n.duration + NARRATION_TAIL : 0));
    const layers: Layer[] = [{
      type: 'image', src: p.src, fit,
      ...(p.alt && { alt: p.alt }),
      ...(doc.motion !== 'none' && fit === 'cover' && { motion: movement(i, p.focus) }),
    }];
    if (p.caption) layers.push({ type: 'text', text: p.caption, x: 5, y: 80, w: 90, align: 'center', start: 0.6, fadeIn: 0.6 });
    slides.push({
      id: `photo-${i + 1}`, duration, background: '#000000', layers,
      ...(n && { audio: [clip(n, NARRATION_START)] }),
      ...(p.credit && { credit: p.credit }),
    });
  });

  if (doc.ending) {
    slides.push({ id: 'end', duration: 6, background: t.background, layers: [
      { type: 'text', text: doc.ending, x: 5, y: 0, w: 90, h: 100, align: 'center', valign: 'middle', fadeIn: 1, fadeOut: 1.2,
        style: flat(t.text, { size: 7 }) },
    ] });
  }

  return {
    ...reelHead(doc, {
      text: { style: { font: t.font, size: 5.5, color: '#ffffff', background: '#00000099', padding: 1.2, radius: 1 } },
      transition: { type: 'fade', duration: 1.5 },
    }),
    slides,
  };
};
