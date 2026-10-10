// Checks a document against Reel 1.0. Accepts anything (it usually arrives as JSON from elsewhere)
// and returns every problem with the path to the field, e.g.
//   slides[1].audio[0]: ends after the slide: start + duration = 13.4 s, but the slide lasts 12 s – …
//
// It checks everything the JSON Schema in reel-schema checks, plus the rules a schema cannot express
// (times within the slide, unique slide ids, https URLs that parse, %2e dot segments in paths).

import { REEL_FORMAT, REEL_MEDIA_DIR, REEL_MEDIA_TYPES, type Reel } from './format.ts';

export type ValidationResult = { ok: true; reel: Reel; errors: [] } | { ok: false; errors: string[] };

/** Times may exceed the slide by this much (rounding in authoring tools). */
const TOLERANCE = 0.05;
const COLOR = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
const SHORT_COLOR = /^#[0-9a-f]{3,4}$/i;
const LAYER_TYPES = ['image', 'video', 'text', 'shape'];
const TRANSITION_SHAPE = 'must be an object like { "type": "fade", "duration": 1 } or { "type": "cut" }';

/** The same shape the JSON Schema requires of an https src: a host, then nothing that is white space. */
// Spaces and control characters are spelled out instead of \s, which means different things in different
// regex engines; the JSON Schema uses the same class, so Go, Java and Python agree with this check.
const HTTPS = /^https:\/\/[^/?#\x00-\x20\x7F]+([/?#][^\x00-\x20\x7F]*)?$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** `.` and `..`, also percent-encoded: URL parsers treat `%2e%2e` as `..`. */
const DOT_SEGMENT = /^(\.|%2e){1,2}$/i;

// The fields each object may have. Anything else is an error, so a misspelled field is reported
// instead of being ignored by the player.
const REEL_FIELDS = ['$schema', 'format', 'title', 'description', 'language', 'tags', 'music', 'defaults', 'slides'];
const MUSIC_FIELDS = ['src', 'duration', 'volume', 'duckTo'];
const TEXT_STYLE_FIELDS = ['font', 'size', 'weight', 'italic', 'color', 'background', 'padding', 'radius', 'lineHeight', 'shadow'];
const SLIDE_FIELDS = ['id', 'duration', 'background', 'transition', 'layers', 'audio', 'credit'];
const AUDIO_FIELDS = ['src', 'start', 'duration', 'volume', 'duck', 'transcript'];
const LAYER_BASE_FIELDS = ['type', 'x', 'y', 'w', 'h', 'start', 'end', 'fadeIn', 'fadeOut', 'opacity'];
const LAYER_FIELDS: Record<string, string[]> = {
  image: [...LAYER_BASE_FIELDS, 'src', 'fit', 'alt', 'motion'],
  video: [...LAYER_BASE_FIELDS, 'src', 'duration', 'fit', 'trimStart', 'muted', 'volume', 'loop'],
  text: [...LAYER_BASE_FIELDS, 'text', 'align', 'valign', 'style'],
  shape: [...LAYER_BASE_FIELDS, 'shape', 'fill', 'stroke', 'strokeWidth', 'radius'],
};
const MOTION_POINT_FIELDS = ['scale', 'x', 'y'];
const EXAMPLE_SRC = { image: 'media/photo.jpg', audio: 'media/voice.mp3', video: 'media/clip.mp4' };

type Kind = keyof typeof REEL_MEDIA_TYPES;

/** Lower-case file extension of a path or URL, without query and fragment. */
export const extensionOf = (src: string) => {
  const path = src.split(/[?#]/)[0];
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : '';
};

/** Length in Unicode code points, as JSON Schema's maxLength counts (an emoji is 1, not 2). */
const codePoints = (s: string) => [...s].length;

/** Number of single-character edits (insert, delete, replace, swap two neighbours) between two short strings. */
const distance = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
};

/**
 * The known field an unknown one was probably meant to be: equal but for case, or at most 2 edits
 * away. Short names allow fewer edits (one per 3 letters), so `id` does not suggest `end`.
 */
const closest = (name: string, known: readonly string[]) => {
  const n = name.toLowerCase();
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const k of known) {
    if (Math.abs(k.length - n.length) > 2) continue;
    const d = distance(n, k.toLowerCase());
    if (d < bestDistance && d <= Math.min(2, Math.floor(Math.max(n.length, k.length) / 3))) { best = k; bestDistance = d; }
  }
  return best;
};

/** Problem with an https:// src, or null. It must be a URL that parses and has a host; any path is fine. */
const httpsProblem = (src: string) => {
  if (/[\x00-\x20\x7F]/.test(src)) return 'must be a valid https:// URL – no spaces, line breaks or control characters (write a space as %20)';
  let url: URL | undefined;
  try { url = new URL(src); } catch { /* reported below */ }
  return HTTPS.test(src) && url?.protocol === 'https:' && url.host ? null : 'must be a valid https:// URL';
};

/**
 * Problem with a media reference, or null. Either an https:// URL, or a clean relative path under
 * media/ that ends in an extension listed in REEL_MEDIA_TYPES for the kind.
 */
export const checkMediaSrc = (src: unknown, kind: Kind): string | null => {
  if (typeof src !== 'string' || !src) return 'required';
  if (src.length > 2000 && codePoints(src) > 2000) return 'at most 2000 characters';
  if (src.startsWith('https://')) return httpsProblem(src);
  if (/^https?:/i.test(src)) return `must start with ${REEL_MEDIA_DIR} or https:// – use https://`;
  if (!src.startsWith(REEL_MEDIA_DIR)) return `must start with ${REEL_MEDIA_DIR} or https:// – put the file under ${REEL_MEDIA_DIR} (e.g. ${EXAMPLE_SRC[kind]})`;
  if (/[?#\\]/.test(src) || CONTROL.test(src) || src.split('/').some(p => p === '' || DOT_SEGMENT.test(p))) {
    return 'must be a clean relative path (no .., . or empty parts, no \\, ?, # or control characters)';
  }
  const ext = extensionOf(src);
  if (!Object.hasOwn(REEL_MEDIA_TYPES[kind], ext)) return `.${ext || '(none)'} is not ${kind === 'image' ? 'an' : 'a'} ${kind} type – use ${Object.keys(REEL_MEDIA_TYPES[kind]).join(', ')}`;
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
    else if (v.length > max && codePoints(v) > max) err(path, `at most ${max} characters`);
  };
  const bool = (v: unknown, path: string) => { if (v !== undefined && typeof v !== 'boolean') err(path, 'must be true or false'); };
  const color = (v: unknown, path: string) => {
    if (v === undefined || (typeof v === 'string' && COLOR.test(v))) return;
    const long = typeof v === 'string' && SHORT_COLOR.test(v) ? `#${[...v.slice(1)].map(c => c + c).join('')}` : '';
    err(path, `must be #rrggbb or #rrggbbaa${long ? ` – use "${long}"` : ''}`);
  };
  const oneOf = (v: unknown, values: string[], path: string) => { if (v !== undefined && !values.includes(v as string)) err(path, `must be ${values.join(' or ')}`); };
  const media = (v: unknown, kind: Kind, path: string) => { const p = checkMediaSrc(v, kind); if (p) err(path, p); };
  /** Reports fields the object may not have. Fields set to undefined count as left out (JSON has no undefined). */
  let hints = 0; // "did you mean" is only worked out for the first few unknown fields, so huge documents stay fast
  const fields = (v: Record<string, unknown>, known: readonly string[], path: string) => {
    for (const k of Object.keys(v)) {
      if (v[k] === undefined || known.includes(k)) continue;
      const near = hints++ < 20 ? closest(k, known) : undefined;
      err(path, `unknown field ${JSON.stringify(k)}${near ? ` – did you mean ${JSON.stringify(near)}?` : ''}`);
    }
  };
  /** Checks every item of a list. Holes (sparse arrays built in JS) are reported, not skipped. */
  const each = (list: unknown[], path: string, check: (v: unknown, path: string) => void) => {
    for (let i = 0; i < list.length; i++) {
      if (Object.hasOwn(list, i)) check(list[i], `${path}[${i}]`);
      else err(`${path}[${i}]`, 'missing');
    }
  };
  const transition = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!isObj(v)) return err(path, TRANSITION_SHAPE);
    fields(v, v.type === 'cut' ? ['type'] : ['type', 'duration'], path);
    if (v.type === undefined) err(`${path}.type`, 'required – fade or cut');
    else oneOf(v.type, ['fade', 'cut'], `${path}.type`);
    if (v.type !== 'cut') num(v.duration, 0, 5, `${path}.duration`);
  };
  const textStyle = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!isObj(v)) return err(path, 'must be an object');
    fields(v, TEXT_STYLE_FIELDS, path);
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
  // `$schema` is not part of the format; it is allowed so editors can offer autocompletion, and ignored.
  fields(d, REEL_FIELDS, 'document');
  if (d.$schema !== undefined && typeof d.$schema !== 'string') err('$schema', 'must be text');
  if (d.format !== REEL_FORMAT) err('format', `must be "${REEL_FORMAT}"`);
  str(d.title, 120, 'title', true);
  str(d.description, 500, 'description');
  str(d.language, 35, 'language');
  if (d.tags !== undefined) {
    if (!Array.isArray(d.tags)) err('tags', 'must be a list of texts');
    else if (d.tags.length > 20) err('tags', 'at most 20 tags');
    else each(d.tags, 'tags', (t, p) => str(t, 40, p, true));
  }
  if (d.music !== undefined) {
    if (!isObj(d.music)) err('music', 'must be an object');
    else {
      fields(d.music, MUSIC_FIELDS, 'music');
      media(d.music.src, 'audio', 'music.src');
      num(d.music.duration, 0.1, 86_400, 'music.duration', true);
      num(d.music.volume, 0, 1, 'music.volume');
      num(d.music.duckTo, 0, 1, 'music.duckTo');
    }
  }
  if (d.defaults !== undefined) {
    if (!isObj(d.defaults)) err('defaults', 'must be an object');
    else {
      fields(d.defaults, ['text', 'transition'], 'defaults');
      if (d.defaults.text !== undefined) {
        if (!isObj(d.defaults.text)) err('defaults.text', 'must be an object');
        else {
          fields(d.defaults.text, ['style'], 'defaults.text');
          textStyle(d.defaults.text.style, 'defaults.text.style');
        }
      }
      transition(d.defaults.transition, 'defaults.transition');
    }
  }

  if (!Array.isArray(d.slides) || d.slides.length < 1 || d.slides.length > 500) {
    err('slides', 'must be a list of 1–500 slides');
    return { ok: false, errors };
  }
  const ids = new Set<string>();
  each(d.slides, 'slides', (s, p) => {
    if (!isObj(s)) return err(p, 'must be an object');
    fields(s, SLIDE_FIELDS, p);
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
    else each(s.layers, `${p}.layers`, (l, q) => {
      if (!isObj(l)) return err(q, 'must be an object');
      if (!LAYER_TYPES.includes(l.type as string)) return err(`${q}.type`, `must be ${LAYER_TYPES.join(', ')}`);
      fields(l, LAYER_FIELDS[l.type as string], q);
      for (const k of ['x', 'y', 'w', 'h']) num(l[k], 0, 100, `${q}.${k}`);
      num(l.start, 0, 600, `${q}.start`);
      num(l.end, 0, 600, `${q}.end`);
      num(l.fadeIn, 0, 600, `${q}.fadeIn`);
      num(l.fadeOut, 0, 600, `${q}.fadeOut`);
      num(l.opacity, 0, 1, `${q}.opacity`);
      const start = typeof l.start === 'number' ? l.start : 0;
      const end = typeof l.end === 'number' ? l.end : D;
      if (start >= D) err(`${q}.start`, `must be less than the slide's duration (${D} s)`);
      // Without end the layer lasts to the end of the slide, and start ≥ duration is reported above.
      if (typeof l.end === 'number' && end <= start) err(`${q}.end`, 'must be after start');
      if (end > D + TOLERANCE) err(`${q}.end`, `is after the end of the slide (${D} s)`);

      if (l.type === 'image') {
        media(l.src, 'image', `${q}.src`);
        oneOf(l.fit, ['cover', 'contain'], `${q}.fit`);
        str(l.alt, 300, `${q}.alt`);
        if (l.motion !== undefined) {
          if (isObj(l.motion)) fields(l.motion, ['from', 'to'], `${q}.motion`);
          if (!isObj(l.motion) || !isObj(l.motion.from) || !isObj(l.motion.to)) err(`${q}.motion`, 'needs both from and to');
          else for (const end of ['from', 'to'] as const) {
            const m = l.motion[end] as Record<string, unknown>;
            fields(m, MOTION_POINT_FIELDS, `${q}.motion.${end}`);
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
      else each(s.audio, `${p}.audio`, (a, q) => {
        if (!isObj(a)) return err(q, 'must be an object');
        fields(a, AUDIO_FIELDS, q);
        media(a.src, 'audio', `${q}.src`);
        num(a.start, 0, 600, `${q}.start`);
        num(a.duration, 0.1, 600, `${q}.duration`, true);
        num(a.volume, 0, 1, `${q}.volume`);
        bool(a.duck, `${q}.duck`);
        str(a.transcript, 2000, `${q}.transcript`);
        const ends = (typeof a.start === 'number' ? a.start : 0) + (typeof a.duration === 'number' ? a.duration : 0);
        if (ends > D + TOLERANCE) err(q, `ends after the slide: start + duration = ${+ends.toFixed(2)} s, but the slide lasts ${D} s – make the slide longer or start the clip earlier`);
      });
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true, reel: d as unknown as Reel, errors: [] };
};
