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
   * URL of reel.json. Relative `media/…` references are resolved against it, so a package works
   * wherever it is published. Without it, references are resolved against the page by the browser.
   */
  baseUrl?: string | URL;
}

/**
 * Merges defaults the way Reel 1.0 specifies:
 *  - text style: player default → defaults.text.style → layer.style
 *  - transition: slide.transition → defaults.transition (a fade without duration lasts 1 s)
 *  - video.muted: true when the slide has audio clips, else false
 * and resolves relative media references against `baseUrl`.
 *
 * Expects a valid document – run `validateReel()` first on anything that comes from outside.
 */
export const resolveReel = (reel: Reel, options: ResolveOptions = {}): ResolvedReel => {
  const base = options.baseUrl != null ? String(options.baseUrl) : undefined;
  const url = (src: string) => (base ? new URL(src, base).href : src);
  const textDefaults: TextStyle = reel.defaults?.text?.style ?? {};

  const slides = reel.slides.map((slide): Slide => {
    const hasAudio = (slide.audio?.length ?? 0) > 0;
    const layers = slide.layers.map((layer): Layer => {
      switch (layer.type) {
        case 'text': return { ...layer, style: { ...textDefaults, ...layer.style } };
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
