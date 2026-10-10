/**
 * Reel 1.0 – the document format.
 *
 * A reel is a sequence of slides drawn on a 16:9 canvas. Each slide has layers (image, video, text,
 * shape) placed in percent of the canvas, timed in seconds from the start of the slide, plus optional
 * audio clips. Music can play under the whole reel. A player draws exactly what the document
 * describes – a reel contains no code and no HTML.
 *
 * This file is the specification. `reel/1` is frozen: fields are never added, removed or given a new
 * meaning. A future change becomes `reel/2`, and players for 2 keep playing 1.
 *
 * Units used everywhere:
 *  - x, y, w, h        percent of the canvas width (x, w) and height (y, h), 0–100
 *  - sizes in styles   percent of the canvas height (6 ≈ 65 px on a 1080p screen)
 *  - times             seconds from the start of the slide, decimals allowed
 *  - volume, opacity   0–1
 *
 * Package (a reel with its files, as a folder or a zip with the same content – see package.ts):
 *
 *     my-reel/
 *     ├── reel.json      the document (this format)
 *     └── media/…        images, audio and video it uses
 *
 * File references (`src`, at most 2000 characters) are either
 *  - relative to reel.json: a clean path that starts with `media/`, e.g. `media/photo.jpg` or
 *    `media/intro/voice.mp3`. Segments are separated by `/`; none is empty, `.` or `..` (nor
 *    percent-encoded like `%2e%2e`). No `\`, `?`, `#` or control characters; other characters,
 *    `%` included, are allowed. It ends in an extension listed in REEL_MEDIA_TYPES for its use, in
 *    any case (`.JPG` is fine).
 *  - or absolute `https://` URLs with a host, which must parse as URLs (no spaces: write `%20`).
 *    Any path is allowed, with or without an extension; the file should be of a listed type.
 * Players resolve relative references against the URL reel.json was loaded from, so a package can be
 * published on any web server as it is.
 *
 * Rules for every object in a document:
 *  - Only the fields defined here are allowed. An unknown field – usually a misspelling such as
 *    `durration` – is an error, not ignored. The one exception is a top-level `$schema` (text): it is
 *    allowed and ignored, so editors can offer autocompletion from the JSON Schema.
 *  - Fields marked `?` may be left out. In JavaScript, a field set to undefined counts as left out,
 *    and lists may not have holes.
 *  - Lengths of texts are counted in Unicode code points, as JSON Schema counts them (an emoji is one
 *    character). Required texts must not be empty.
 */

/** The value of `format` in every Reel 1.0 document. */
export const REEL_FORMAT = 'reel/1';
/** File name of the document inside a package. */
export const REEL_MANIFEST = 'reel.json';
/** Folder for media files inside a package. Relative `src` values must start with this. */
export const REEL_MEDIA_DIR = 'media/';
/** Width / height of the canvas. */
export const REEL_ASPECT = 16 / 9;

/**
 * File types a player must be able to play (lower-case extension → MIME type).
 * Other types may work in some players but are not part of the format.
 */
export const REEL_MEDIA_TYPES = {
  image: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' },
  audio: { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav' },
  video: { mp4: 'video/mp4' },
} as const;

/** `#rrggbb` or `#rrggbbaa`. */
export type Color = string;

/** `media/…` (relative to reel.json) or `https://…`, at most 2000 characters. See the rules above. */
export type MediaSrc = string;

// --- The reel --------------------------------------------------------------------------------

export interface Reel {
  format: typeof REEL_FORMAT;
  /** 1–120 characters. */
  title: string;
  /** ≤ 500 characters. Not shown by the player. */
  description?: string;
  /** BCP 47 language tag, e.g. `en`, `nb`. ≤ 35 characters. */
  language?: string;
  /** At most 20 tags of 1–40 characters each. */
  tags?: string[];
  /** Background music under the whole reel. Loops when it ends. */
  music?: Music;
  /** Values used when a slide or layer does not set its own. */
  defaults?: Defaults;
  /** 1–500 slides. The reel's duration is the sum of the slides' durations. */
  slides: Slide[];
}

export interface Defaults {
  /** Merged into every text layer's style: player default → defaults.text.style → layer.style. */
  text?: { style?: TextStyle };
  /** Used by slides without a transition. */
  transition?: Transition;
}

export interface Music {
  /** An audio file (REEL_MEDIA_TYPES.audio). */
  src: MediaSrc;
  /** Length of the file in seconds, 0.1–86 400. Needed to start at the right place mid-reel. */
  duration: number;
  /** 0–1, default 0.25. */
  volume?: number;
  /** Volume while an audio clip with `duck` plays, 0–1, default 0.08. */
  duckTo?: number;
}

// --- Slides ----------------------------------------------------------------------------------

export interface Slide {
  /** 1–80 characters, unique in the reel. Reported when the slide has been shown. */
  id: string;
  /** 1–600 seconds. */
  duration: number;
  /** Behind all layers. Default `#000000`. */
  background?: Color;
  /**
   * How the slide appears. Part of the slide's own time. Default: defaults.transition, else a 1 s fade.
   * A fade without duration always lasts 1 s.
   */
  transition?: Transition;
  /** 1–12 layers, drawn in order: later layers are on top. */
  layers: Layer[];
  /** 0–4 audio clips, e.g. narration and sound effects. */
  audio?: AudioClip[];
  /** ≤ 200 characters, shown small in the lower right corner. */
  credit?: string;
}

/** `type` is required. A cut has no other field. */
export type Transition =
  | { type: 'fade'; /** 0–5 s, default 1. The new slide fades in over the previous one. */ duration?: number }
  | { type: 'cut' };

export interface AudioClip {
  /** An audio file (REEL_MEDIA_TYPES.audio). */
  src: MediaSrc;
  /** When the clip starts, 0–600, default 0. */
  start?: number;
  /** Length of the file, 0.1–600 s. start + duration must be within the slide (0.05 s tolerance). */
  duration: number;
  /** 0–1, default 1. */
  volume?: number;
  /** Lower the music to music.duckTo while the clip plays. Default true. */
  duck?: boolean;
  /** What is said, ≤ 2000 characters. Not shown; kept for accessibility and search. */
  transcript?: string;
}

// --- Layers ----------------------------------------------------------------------------------

/** Fields every layer has. */
export interface LayerBase {
  /** Position and size in percent of the canvas, 0–100. Default 0, 0, 100, 100. Text without h grows with its content. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /**
   * When the layer is visible, 0–600. Default 0 and the end of the slide.
   * start < the slide's duration, and start < end ≤ the slide's duration (0.05 s tolerance).
   */
  start?: number;
  end?: number;
  /** Soft fade in/out in seconds, 0–600, default 0. Shrunk proportionally if together longer than the layer is visible. */
  fadeIn?: number;
  fadeOut?: number;
  /** 0–1, default 1. */
  opacity?: number;
}

export type Fit = 'cover' | 'contain';

export interface MotionPoint {
  /** 1–2, default 1. */
  scale?: number;
  /** The point zoomed towards, in percent of the image as shown in the layer's box (with cover, its visible part), 0–100, default 50. */
  x?: number;
  y?: number;
}

/** Slow zoom and pan through the layer's visible time. Both from and to are required. */
export interface Motion {
  from: MotionPoint;
  to: MotionPoint;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  /** An image file (REEL_MEDIA_TYPES.image). */
  src: MediaSrc;
  /** cover fills the box and may crop; contain shows the whole image. Default cover. */
  fit?: Fit;
  /** ≤ 300 characters. */
  alt?: string;
  motion?: Motion;
}

export interface VideoLayer extends LayerBase {
  type: 'video';
  /** MP4 (H.264 + AAC). */
  src: MediaSrc;
  /** Length of the clip, 0.1–86 400 s. */
  duration: number;
  /** Default cover. */
  fit?: Fit;
  /** Seconds into the clip to start from, 0 or more and less than duration. Default 0. */
  trimStart?: number;
  /** Default true when the slide has audio clips, else false. */
  muted?: boolean;
  /** 0–1, default 1. */
  volume?: number;
  /** Default false: the last frame stays when the clip ends. */
  loop?: boolean;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  /** Plain text, 1–500 characters. `\n` is a line break. Never interpreted as HTML. */
  text: string;
  /** Default left. */
  align?: 'left' | 'center' | 'right';
  /** Default top. Only has an effect when the layer has h. */
  valign?: 'top' | 'middle' | 'bottom';
  style?: TextStyle;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  /** Required. */
  shape: 'rect' | 'ellipse';
  /** Default none (transparent). */
  fill?: Color;
  /** Default none (no border). */
  stroke?: Color;
  /** 0–5, percent of the canvas height. Default 0. */
  strokeWidth?: number;
  /** Rounded corners on rect, 0–50, percent of the canvas height. Default 0. */
  radius?: number;
}

export type Layer = ImageLayer | VideoLayer | TextLayer | ShapeLayer;
export type LayerType = Layer['type'];

export interface TextStyle {
  /** The device's own fonts, nothing is downloaded. Default sans. */
  font?: 'sans' | 'serif';
  /** 1.5–20, percent of the canvas height. Default 5. At least 4.5 is recommended for body text on TV. */
  size?: number;
  /** Default regular. */
  weight?: 'regular' | 'bold';
  /** Default false. */
  italic?: boolean;
  /** Default white. */
  color?: Color;
  /** Covers only the text itself (plus padding). Use a shape layer for a full-width band. */
  background?: Color;
  /** 0–10, percent of the canvas height. Default 0. */
  padding?: number;
  /** Rounded corners on the background, 0–50, percent of the canvas height. Default 0. */
  radius?: number;
  /** 0.8–3, default 1.25. */
  lineHeight?: number;
  /** Shadow behind the text for legibility. Default true when the text has no background. */
  shadow?: boolean;
}

// --- What the player plays -------------------------------------------------------------------

/**
 * A reel ready to play: defaults merged into slides and layers, media URLs absolute, duration known.
 * Made with `resolveReel()`.
 */
export interface ResolvedReel {
  /** Identifies the reel in events, e.g. the URL of reel.json. */
  id: string;
  title: string;
  /** Seconds, the sum of the slides' durations. */
  duration: number;
  music?: Music;
  slides: Slide[];
}
