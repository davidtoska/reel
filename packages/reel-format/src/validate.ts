// Checks a document against Reel 1.0. Accepts anything (it usually arrives as JSON from elsewhere)
// and returns every problem with the path to the field, e.g.
//   slides[1].audio[0]: ends after the slide: start + duration = 13.4 s, but the slide lasts 12 s

import { REEL_FORMAT, REEL_MEDIA_DIR, REEL_MEDIA_TYPES, type Reel } from './format.ts';

export type ValidationResult = { ok: true; reel: Reel; errors: [] } | { ok: false; errors: string[] };

/** Times may exceed the slide by this much (rounding in authoring tools). */
const TOLERANCE = 0.05;
const COLOR = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
const LAYER_TYPES = ['image', 'video', 'text', 'shape'];

type Kind = keyof typeof REEL_MEDIA_TYPES;

/** Lower-case file extension of a path or URL, without query and fragment. */
export const extensionOf = (src: string) => {
  const path = src.split(/[?#]/)[0];
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : '';
};

/** Problem with a media reference, or null. Relative paths must be clean paths under media/. */
export const checkMediaSrc = (src: unknown, kind: Kind): string | null => {
  if (typeof src !== 'string' || !src) return 'required';
  if (src.length > 2000) return 'at most 2000 characters';
  if (src.startsWith('https://')) {
    const ext = extensionOf(src);
    return ext && !(ext in REEL_MEDIA_TYPES[kind]) ? `.${ext} is not a ${kind} type – use ${Object.keys(REEL_MEDIA_TYPES[kind]).join(', ')}` : null;
  }
  if (!src.startsWith(REEL_MEDIA_DIR)) return `must start with ${REEL_MEDIA_DIR} or https://`;
  const parts = src.split('/');
  if (src.includes('\\') || parts.some(p => p === '' || p === '.' || p === '..')) return 'must be a clean relative path (no .., \\ or empty parts)';
  const ext = extensionOf(src);
  if (!(ext in REEL_MEDIA_TYPES[kind])) return `.${ext || '(none)'} is not a ${kind} type – use ${Object.keys(REEL_MEDIA_TYPES[kind]).join(', ')}`;
  return null;
};

export const validateReel = (input: unknown): ValidationResult => {
  const errors: string[] = [];
  const err = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const num = (v: unknown, min: number, max: number, path: string, required = false) => {
    if (v === undefined) { if (required) err(path, 'required'); return; }
    if (typeof v !== 'number' || !Number.isFinite(v)) err(path, 'must be a number');
    else if (v < min || v > max) err(path, `must be ${min}–${max}`);
  };
  const str = (v: unknown, max: number, path: string, required = false) => {
    if (v === undefined || v === '') { if (required) err(path, 'required'); return; }
    if (typeof v !== 'string') err(path, 'must be text');
    else if (v.length > max) err(path, `at most ${max} characters`);
  };
  const bool = (v: unknown, path: string) => { if (v !== undefined && typeof v !== 'boolean') err(path, 'must be true or false'); };
  const color = (v: unknown, path: string) => { if (v !== undefined && (typeof v !== 'string' || !COLOR.test(v))) err(path, 'must be #rrggbb or #rrggbbaa'); };
  const oneOf = (v: unknown, values: string[], path: string) => { if (v !== undefined && !values.includes(v as string)) err(path, `must be ${values.join(' or ')}`); };
  const media = (v: unknown, kind: Kind, path: string) => { const p = checkMediaSrc(v, kind); if (p) err(path, p); };
  const transition = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!isObj(v)) return err(path, 'must be an object');
    oneOf(v.type, ['fade', 'cut'], `${path}.type`);
    if (v.type === 'fade') num(v.duration, 0, 5, `${path}.duration`);
  };
  const textStyle = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!isObj(v)) return err(path, 'must be an object');
    oneOf(v.font, ['sans', 'serif'], `${path}.font`);
    num(v.size, 1.5, 20, `${path}.size`);
    oneOf(v.weight, ['regular', 'bold'], `${path}.weight`);
    bool(v.italic, `${path}.italic`);
    color(v.color, `${path}.color`);
    color(v.background, `${path}.background`);
    num(v.padding, 0, 10, `${path}.padding`);
    num(v.radius, 0, 50, `${path}.radius`);
    num(v.lineHeight, 0.8, 3, `${path}.lineHeight`);
    bool(v.shadow, `${path}.shadow`);
  };

  if (!isObj(input)) return { ok: false, errors: ['document: must be a JSON object'] };
  const d = input;
  if (d.format !== REEL_FORMAT) err('format', `must be "${REEL_FORMAT}"`);
  str(d.title, 120, 'title', true);
  str(d.description, 500, 'description');
  str(d.language, 35, 'language');
  if (d.tags !== undefined) {
    if (!Array.isArray(d.tags) || d.tags.length > 20) err('tags', 'at most 20 tags');
    else d.tags.forEach((t, i) => str(t, 40, `tags[${i}]`, true));
  }
  if (d.music !== undefined) {
    if (!isObj(d.music)) err('music', 'must be an object');
    else {
      media(d.music.src, 'audio', 'music.src');
      num(d.music.duration, 0.1, 86_400, 'music.duration', true);
      num(d.music.volume, 0, 1, 'music.volume');
      num(d.music.duckTo, 0, 1, 'music.duckTo');
    }
  }
  if (d.defaults !== undefined) {
    if (!isObj(d.defaults)) err('defaults', 'must be an object');
    else {
      if (d.defaults.text !== undefined) {
        if (!isObj(d.defaults.text)) err('defaults.text', 'must be an object');
        else textStyle(d.defaults.text.style, 'defaults.text.style');
      }
      transition(d.defaults.transition, 'defaults.transition');
    }
  }

  if (!Array.isArray(d.slides) || d.slides.length < 1 || d.slides.length > 500) {
    err('slides', 'must be a list of 1–500 slides');
    return { ok: false, errors };
  }
  const ids = new Set<string>();
  d.slides.forEach((s: unknown, i) => {
    const p = `slides[${i}]`;
    if (!isObj(s)) return err(p, 'must be an object');
    str(s.id, 80, `${p}.id`, true);
    if (typeof s.id === 'string') {
      if (ids.has(s.id)) err(`${p}.id`, `"${s.id}" is used by an earlier slide`);
      ids.add(s.id);
    }
    num(s.duration, 1, 600, `${p}.duration`, true);
    const D = typeof s.duration === 'number' ? s.duration : Infinity;
    color(s.background, `${p}.background`);
    transition(s.transition, `${p}.transition`);
    str(s.credit, 200, `${p}.credit`);

    if (!Array.isArray(s.layers) || s.layers.length < 1 || s.layers.length > 12) err(`${p}.layers`, 'must be a list of 1–12 layers');
    else s.layers.forEach((l: unknown, j) => {
      const q = `${p}.layers[${j}]`;
      if (!isObj(l)) return err(q, 'must be an object');
      if (!LAYER_TYPES.includes(l.type as string)) return err(`${q}.type`, `must be ${LAYER_TYPES.join(', ')}`);
      for (const k of ['x', 'y', 'w', 'h']) num(l[k], 0, 100, `${q}.${k}`);
      num(l.start, 0, 600, `${q}.start`);
      num(l.end, 0, 600, `${q}.end`);
      num(l.fadeIn, 0, 600, `${q}.fadeIn`);
      num(l.fadeOut, 0, 600, `${q}.fadeOut`);
      num(l.opacity, 0, 1, `${q}.opacity`);
      const start = typeof l.start === 'number' ? l.start : 0;
      const end = typeof l.end === 'number' ? l.end : D;
      if (start >= D) err(`${q}.start`, `must be less than the slide's duration (${D} s)`);
      if (end <= start) err(`${q}.end`, 'must be after start');
      if (end > D + TOLERANCE) err(`${q}.end`, `is after the end of the slide (${D} s)`);

      if (l.type === 'image') {
        media(l.src, 'image', `${q}.src`);
        oneOf(l.fit, ['cover', 'contain'], `${q}.fit`);
        str(l.alt, 300, `${q}.alt`);
        if (l.motion !== undefined) {
          if (!isObj(l.motion) || !isObj(l.motion.from) || !isObj(l.motion.to)) err(`${q}.motion`, 'needs both from and to');
          else for (const end of ['from', 'to'] as const) {
            const m = l.motion[end] as Record<string, unknown>;
            num(m.scale, 1, 2, `${q}.motion.${end}.scale`);
            num(m.x, 0, 100, `${q}.motion.${end}.x`);
            num(m.y, 0, 100, `${q}.motion.${end}.y`);
          }
        }
      } else if (l.type === 'video') {
        media(l.src, 'video', `${q}.src`);
        num(l.duration, 0.1, 86_400, `${q}.duration`, true);
        oneOf(l.fit, ['cover', 'contain'], `${q}.fit`);
        num(l.trimStart, 0, 86_400, `${q}.trimStart`);
        if (typeof l.trimStart === 'number' && typeof l.duration === 'number' && l.trimStart >= l.duration) err(`${q}.trimStart`, 'must be less than duration');
        bool(l.muted, `${q}.muted`);
        num(l.volume, 0, 1, `${q}.volume`);
        bool(l.loop, `${q}.loop`);
      } else if (l.type === 'text') {
        str(l.text, 500, `${q}.text`, true);
        oneOf(l.align, ['left', 'center', 'right'], `${q}.align`);
        oneOf(l.valign, ['top', 'middle', 'bottom'], `${q}.valign`);
        textStyle(l.style, `${q}.style`);
      } else {
        oneOf(l.shape, ['rect', 'ellipse'], `${q}.shape`);
        if (l.shape === undefined) err(`${q}.shape`, 'required');
        color(l.fill, `${q}.fill`);
        color(l.stroke, `${q}.stroke`);
        num(l.strokeWidth, 0, 5, `${q}.strokeWidth`);
        num(l.radius, 0, 50, `${q}.radius`);
      }
    });

    if (s.audio !== undefined) {
      if (!Array.isArray(s.audio) || s.audio.length > 4) err(`${p}.audio`, 'must be a list of at most 4 clips');
      else s.audio.forEach((a: unknown, j) => {
        const q = `${p}.audio[${j}]`;
        if (!isObj(a)) return err(q, 'must be an object');
        media(a.src, 'audio', `${q}.src`);
        num(a.start, 0, 600, `${q}.start`);
        num(a.duration, 0.1, 600, `${q}.duration`, true);
        num(a.volume, 0, 1, `${q}.volume`);
        bool(a.duck, `${q}.duck`);
        str(a.transcript, 2000, `${q}.transcript`);
        const ends = (typeof a.start === 'number' ? a.start : 0) + (typeof a.duration === 'number' ? a.duration : 0);
        if (ends > D + TOLERANCE) err(q, `ends after the slide: start + duration = ${+ends.toFixed(2)} s, but the slide lasts ${D} s`);
      });
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true, reel: d as unknown as Reel, errors: [] };
};
