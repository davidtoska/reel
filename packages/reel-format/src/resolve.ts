// Turns a Reel document into what the player plays: defaults merged in, media URLs made absolute.

import type { AudioClip, Layer, Reel, ResolvedReel, Slide, TextStyle } from './format.ts';

/** Duration of a reel in seconds: the sum of its slides' durations. */
export const reelDuration = (reel: Pick<Reel, 'slides'>) => reel.slides.reduce((sum, s) => sum + s.duration, 0);

/** Start time (s) of each slide in the reel. */
export const slideStarts = (slides: Pick<Slide, 'duration'>[]) => {
  let sum = 0;
  return slides.map(s => { const start = sum; sum += s.duration; return start; });
};

export interface ResolveOptions {
  /** Identifies the reel in events. Default: baseUrl, else the title. */
  id?: string;
  /**
   * Absolute URL of reel.json, e.g. `res.url` after a fetch, or an `https:` or `file:` URL. Relative
   * `media/…` references are resolved against it, so a package works wherever it is published.
   * Without it, references are left as they are (a browser then resolves them against the page).
   * A relative baseUrl such as `/reels/x/reel.json` throws a TypeError – make it absolute first,
   * e.g. `new URL(path, document.baseURI)`.
   */
  baseUrl?: string | URL;
}

/** A copy without the fields set to undefined, so spreading it does not hide a default. */
const defined = <T extends object>(o: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

const parseBase = (base: string) => {
  try { return new URL(base); } catch {
    throw new TypeError(`resolveReel: baseUrl must be an absolute URL such as https://example.com/my-reel/reel.json, got ${JSON.stringify(base)}`);
  }
};

/**
 * Merges defaults the way Reel 1.0 specifies:
 *  - text style: player default → defaults.text.style → layer.style
 *  - transition: slide.transition → defaults.transition (a fade without duration lasts 1 s)
 *  - video.muted: true when the slide has audio clips, else false
 * and resolves relative media references against `baseUrl`. Style fields set to undefined (possible
 * in documents built in JS) count as left out.
 *
 * Expects a valid document – run `validateReel()` first on anything that comes from outside.
 * Throws a TypeError if `baseUrl` is not an absolute URL, or if a reference cannot be resolved
 * against it.
 */
export const resolveReel = (reel: Reel, options: ResolveOptions = {}): ResolvedReel => {
  const base = options.baseUrl != null && String(options.baseUrl) !== '' ? String(options.baseUrl) : undefined;
  const baseUrl = base ? parseBase(base) : undefined;
  const url = (src: string) => {
    if (!baseUrl) return src;
    try { return new URL(src, baseUrl).href; } catch {
      throw new TypeError(`resolveReel: ${JSON.stringify(src)} cannot be resolved against baseUrl ${JSON.stringify(base)}`);
    }
  };
  const textDefaults: TextStyle = defined(reel.defaults?.text?.style);

  const slides = reel.slides.map((slide): Slide => {
    const hasAudio = (slide.audio?.length ?? 0) > 0;
    const layers = slide.layers.map((layer): Layer => {
      switch (layer.type) {
        case 'text': return { ...layer, style: { ...textDefaults, ...defined(layer.style) } };
        case 'video': return { ...layer, src: url(layer.src), muted: layer.muted ?? hasAudio };
        case 'image': return { ...layer, src: url(layer.src) };
        default: return layer;
      }
    });
    const audio = slide.audio?.map((a): AudioClip => ({ ...a, src: url(a.src) }));
    const transition = slide.transition ?? reel.defaults?.transition;
    return { ...slide, layers, ...(audio && { audio }), ...(transition && { transition }) };
  });

  return {
    id: options.id ?? base ?? reel.title,
    title: reel.title,
    duration: reelDuration(reel),
    ...(reel.music && { music: { ...reel.music, src: url(reel.music.src) } }),
    slides,
  };
};
