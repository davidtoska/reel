// Building blocks shared by the templates: themes, sounds with a known length and an error collector.
// Templates are a convenience of this example app – simpler documents that compile to Reel 1.0.
// They are not part of the Reel format.

import type { AudioClip, Color, Defaults, MediaSrc, Reel, TextStyle } from 'reel-format';

/** Fields every template has; they carry over to the reel. */
export interface CommonFields {
  /** ≤ 120 characters. */
  title: string;
  description?: string;
  language?: string;
  tags?: string[];
  music?: Reel['music'];
  /** A built-in theme, or colours on top of the template's default theme. */
  theme?: ThemeName | Partial<Theme>;
}

/** An audio file with a known length – the length is needed to place it on the timeline. */
export interface Sound {
  src: MediaSrc;
  /** Seconds. */
  duration: number;
  volume?: number;
  transcript?: string;
}

// --- Themes --------------------------------------------------------------------------------------

export interface Theme {
  /** Slides without an image. */
  background: Color;
  /** Cards and panels behind text. */
  surface: Color;
  /** Text on the background. */
  text: Color;
  /** Text on surfaces. */
  surfaceText: Color;
  /** Highlights: header bands, the right answer, times. */
  accent: Color;
  /** Text on the accent colour. */
  accentText: Color;
  font: 'sans' | 'serif';
}

export type ThemeName = 'warm' | 'ocean' | 'forest' | 'night';

export const THEMES: Record<ThemeName, Theme> = {
  warm: { background: '#f4efe6', surface: '#fffaf2', text: '#1f2933', surfaceText: '#1f2933', accent: '#b4532a', accentText: '#fffaf2', font: 'serif' },
  ocean: { background: '#0f2a3d', surface: '#173e57', text: '#ffffff', surfaceText: '#ffffff', accent: '#2f9bbf', accentText: '#ffffff', font: 'sans' },
  forest: { background: '#1f3a2a', surface: '#2c4d38', text: '#f3f7ef', surfaceText: '#f3f7ef', accent: '#e2b04a', accentText: '#1f2933', font: 'serif' },
  night: { background: '#0b0f1a', surface: '#1a2133', text: '#ffffff', surfaceText: '#ffffff', accent: '#7c5cff', accentText: '#ffffff', font: 'sans' },
};

export const resolveTheme = (theme: CommonFields['theme'], fallback: ThemeName): Theme =>
  typeof theme === 'string' ? THEMES[theme] ?? THEMES[fallback] : { ...THEMES[fallback], ...theme };

// --- Compile helpers -----------------------------------------------------------------------------

/** The fields that carry over from a template to the reel. */
export const reelHead = (doc: CommonFields, defaults: Defaults): Omit<Reel, 'slides'> => ({
  format: 'reel/1',
  title: doc.title,
  ...(doc.description && { description: doc.description }),
  ...(doc.language && { language: doc.language }),
  ...(doc.tags && { tags: doc.tags }),
  ...(doc.music && { music: doc.music }),
  defaults,
});

/** A sound as an audio clip on a slide. */
export const clip = (s: Sound, start: number, extra: Partial<AudioClip> = {}): AudioClip => ({
  src: s.src, start, duration: s.duration,
  ...(s.volume != null && { volume: s.volume }),
  ...(s.transcript && { transcript: s.transcript }),
  ...extra,
});

/** Text style without background and shadow – for text on plain surfaces. */
export const flat = (color: Color, extra: TextStyle = {}): TextStyle => ({ color, background: '#00000000', shadow: false, ...extra });

/** Colour with transparency: alpha('#0f2a3d', 'cc') → '#0f2a3dcc'. A colour that already has alpha is kept. */
export const alpha = (color: Color, aa: string): Color => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}${aa}` : color);

/** Rounds to a tenth of a second, so generated times stay readable. */
export const r1 = (n: number) => Math.round(n * 10) / 10;

export const chunk = <T>(list: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// --- Validation ----------------------------------------------------------------------------------

/** Collects errors with paths, like validateReel: "photos[2].src: required". */
export class Errors {
  readonly list: string[] = [];
  add(path: string, message: string) { this.list.push(`${path}: ${message}`); }
  check(ok: boolean, path: string, message: string) { if (!ok) this.add(path, message); }
  range(v: number | undefined, min: number, max: number, path: string) {
    if (v != null && !(typeof v === 'number' && v >= min && v <= max)) this.add(path, `must be ${min}–${max}`);
  }
  text(v: string | undefined, max: number, path: string, required = false) {
    if (required && !v) this.add(path, 'required');
    else if (v != null && (typeof v !== 'string' || v.length > max)) this.add(path, `text of at most ${max} characters`);
  }
  items(v: unknown, min: number, max: number, path: string, what: string): v is unknown[] {
    const ok = Array.isArray(v) && v.length >= min && v.length <= max;
    if (!ok) this.add(path, `${min}–${max} ${what}`);
    return ok;
  }
  sound(s: Sound | undefined, path: string) {
    if (s == null) return;
    this.check(typeof s.src === 'string' && s.src.length > 0, `${path}.src`, 'required');
    this.range(s.duration, 0.1, 600, `${path}.duration`);
    this.range(s.volume, 0, 1, `${path}.volume`);
  }
  common(doc: CommonFields) {
    this.text(doc.title, 120, 'title', true);
    this.check((doc.tags?.length ?? 0) <= 20, 'tags', 'at most 20 tags');
    this.check(typeof doc.theme !== 'string' || doc.theme in THEMES, 'theme', `unknown theme – use ${Object.keys(THEMES).join(', ')}`);
  }
}
