// The Reel player: draws a resolved reel on a 16:9 canvas with layers – image, video, text and
// shape – placed in percent of the canvas, and plays its audio clips and music.
//
// Visibility, fades and zoom are Web Animations over the whole length of a slide, so pause, resume
// and starting in the middle of a slide are only a matter of setting or freezing `currentTime`.
// The player keeps its own clock (position in the reel, excluding paused time) and schedules slide
// changes and audio clips from it. The caller owns time: it says where in the reel to start, and
// when to play something else.
//
// Behaviour is part of Reel 1.0 and is frozen together with the format.

import { h } from './dom.ts';
import { slideStarts } from './resolve.ts';
import { PLAYER_CSS } from './styles.ts';
import type {
  AudioClip, Layer, LayerBase, Motion, MotionPoint, ReelPlayerError, ResolvedReel, Slide, SlideShown, VideoLayer,
} from './format.ts';

/** s – audio clips that started more than this before a mid-slide start are skipped (no speech mid-sentence). */
const JOIN_TOLERANCE = 0.25;
/** Tick at least this often, so the clock corrects itself. */
const MAX_WAIT_MS = 5000;
const FONTS: Record<string, string> = {
  sans: 'var(--reel-font-sans, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif)',
  serif: 'var(--reel-font-serif, Georgia, "Times New Roman", serif)',
};
const ALIGN: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end', top: 'flex-start', middle: 'center', bottom: 'flex-end' };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** n percent of the canvas height, as CSS. */
const ch = (n: number) => `calc(var(--reel-h) * ${n} / 100)`;

/** Keyframes for a layer's visibility over the whole slide: off before start, fade in/out, off after end. */
export const visibilityKeyframes = (layer: LayerBase, D: number): Keyframe[] => {
  const o = clamp(layer.opacity ?? 1, 0, 1);
  const s = clamp(layer.start ?? 0, 0, D);
  const e = clamp(layer.end ?? D, s, D);
  let fi = Math.max(0, layer.fadeIn ?? 0);
  let fo = Math.max(0, layer.fadeOut ?? 0);
  if (fi + fo > e - s) { const k = (e - s) / (fi + fo); fi *= k; fo *= k; }
  const points: [number, number][] = [[0, s > 0 || fi > 0 ? 0 : o]];
  if (s > 0) points.push([s, 0]);
  points.push([s + fi, o], [e - fo, o], [e, fo > 0 ? 0 : o]);
  if (e < D) points.push([e, 0], [D, 0]);
  // Rounding can make an offset slightly smaller than the previous one – animate() throws then. Keep them ascending.
  let previous = 0;
  return points.map(([t, opacity]) => ({ offset: previous = Math.max(previous, D > 0 ? clamp(t / D, 0, 1) : 0), opacity }));
};

/** Keyframes for a slow zoom and pan towards a point in the image, through the layer's time. */
export const motionKeyframes = (motion: Motion, layer: LayerBase, D: number): Keyframe[] => {
  const point = (p?: MotionPoint) => ({ transform: `scale(${clamp(p?.scale ?? 1, 1, 2)})`, transformOrigin: `${p?.x ?? 50}% ${p?.y ?? 50}%` });
  const s = clamp(layer.start ?? 0, 0, D);
  const e = clamp(layer.end ?? D, s, D);
  const from = point(motion.from);
  const to = point(motion.to ?? motion.from);
  return [{ offset: 0, ...from }, { offset: s / D, ...from }, { offset: e / D, ...to }, { offset: 1, ...to }];
};

// --- Internal state ------------------------------------------------------------------------------

type ClipState = 'waiting' | 'playing' | 'done' | 'skipped' | 'error';
interface Clip extends AudioClip { start: number; el: HTMLAudioElement | null; state: ClipState }
interface Video { layer: VideoLayer; el: HTMLVideoElement; playing: boolean; finished: boolean }
interface ShownSlide {
  index: number;
  slide: Slide;
  el: HTMLDivElement;
  animations: Animation[];
  videos: Video[];
  clips: Clip[];
  startPos: number;
  reported: boolean;
  audioPlayed: boolean;
  dead: boolean;
  paused: Animation[];
}

export interface ReelPlayerOptions {
  /** The player takes over this element's content and fills it, letterboxed to 16:9. */
  element: HTMLElement;
  /** A media file could not be loaded. Playback continues without it. */
  onError?: (error: ReelPlayerError) => void;
  /** The browser refused to play sound before a user gesture. Call `unlockAudio()` on the next click or key press. */
  onAudioBlocked?: () => void;
  /** A slide has been shown to its end. */
  onSlideShown?: (shown: SlideShown) => void;
  /** The last slide has been shown to its end. The player stays on it until told otherwise. */
  onEnded?: (reel: ResolvedReel) => void;
}

export interface ReelPlayer {
  /** Starts a reel `offset` seconds in. Replaces whatever was playing. */
  play: (reel: ResolvedReel, offset?: number) => void;
  /** Stops and clears the canvas. */
  stop: () => void;
  pause: () => void;
  resume: () => void;
  /** Call on the first click or key press after `onAudioBlocked`. */
  unlockAudio: () => void;
  /** Current position in the reel (s). */
  position: () => number;
  readonly paused: boolean;
  readonly reel: ResolvedReel | null;
}

export const createReelPlayer = ({ element, onError = () => {}, onAudioBlocked = () => {}, onSlideShown = () => {}, onEnded = () => {} }: ReelPlayerOptions): ReelPlayer => {
  const canvas = h('div', { class: 'reel-canvas' });
  const music = h('audio', { loop: true, preload: 'auto' });
  element.classList.add('reel-stage');
  element.replaceChildren(h('style', {}, PLAYER_CSS), canvas);

  let reel: ResolvedReel | null = null;
  let starts: number[] = [];          // start position per slide
  let active: ShownSlide | null = null;   // the slide shown now
  let previous: ShownSlide | null = null; // the slide the new one fades in over
  let basePos = 0;                    // clock: position (s) in the reel at baseT
  let baseT = 0;
  let paused = false;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rampTimer: ReturnType<typeof setInterval> | undefined;
  let musicTarget: number | null = null;
  let reportedMissing = new Set<string>(); // files already reported missing in this play
  let preloaded: HTMLImageElement[] = [];  // images loaded ahead; kept so they are not collected
  let audioBlocked = false;
  const mutedByBlock = new Set<Video>();  // video layers playing without sound because sound was refused

  const position = () => (paused ? basePos : basePos + (performance.now() - baseT) / 1000);
  const indexAt = (p: number) => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= p) i++;
    return i;
  };

  // --- The canvas: 16:9, centred, black bars ---------------------------------------------------
  const fit = () => {
    const W = element.clientWidth;
    const H = element.clientHeight;
    if (!W || !H) return;
    const height = Math.min(H, W * 9 / 16);
    canvas.style.width = `${height * 16 / 9}px`;
    canvas.style.height = `${height}px`;
    canvas.style.setProperty('--reel-h', `${height}px`);
  };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(element);
  window.addEventListener('resize', fit);

  // --- Errors and sound --------------------------------------------------------------------------
  const reportMissing = (src: string | undefined, slideId?: string) => {
    if (!src || reportedMissing.has(src)) return;
    reportedMissing.add(src);
    onError({ kind: 'media-missing', src, ...(slideId && { slideId }), fatal: false });
  };

  const soundRefused = () => {
    if (audioBlocked) return;
    audioBlocked = true;
    onAudioBlocked();
  };

  const rampMusic = (target: number) => {
    clearInterval(rampTimer);
    const from = music.volume;
    let step = 0;
    rampTimer = setInterval(() => {
      step++;
      music.volume = clamp(from + (target - from) * step / 8, 0, 1);
      if (step >= 8) clearInterval(rampTimer);
    }, 40);
  };

  // The music is lowered while an audio clip with duck is playing.
  const updateDucking = () => {
    const m = reel?.music;
    if (!m?.src) return;
    const duck = active?.clips.some(k => k.duck !== false && k.state === 'playing');
    const target = clamp(duck ? m.duckTo ?? 0.08 : m.volume ?? 0.25, 0, 1);
    if (target !== musicTarget) { musicTarget = target; rampMusic(target); }
  };

  const playMusic = () => music.play().catch(err => { if (err?.name === 'NotAllowedError') soundRefused(); });

  const startMusic = (pos: number) => {
    const m = reel!.music;
    clearInterval(rampTimer);
    if (!m?.src) { music.pause(); music.removeAttribute('src'); musicTarget = null; return; }
    if (music.getAttribute('src') !== m.src) music.src = m.src;
    music.currentTime = m.duration > 0 ? pos % m.duration : 0;
    musicTarget = clamp(m.volume ?? 0.25, 0, 1);
    music.volume = musicTarget;
    playMusic();
  };
  music.addEventListener('error', () => { if (reel?.music?.src && music.getAttribute('src')) reportMissing(reel.music.src); });

  // --- Layers ------------------------------------------------------------------------------------
  const animate = (el: Element, keyframes: Keyframe[], D: number, sp: number) => {
    const a = el.animate(keyframes, { duration: D * 1000, fill: 'both' });
    a.currentTime = clamp(sp, 0, D) * 1000;
    return a;
  };

  const addLayer = (ss: ShownSlide, layer: Layer, sp: number) => {
    const D = ss.slide.duration;
    const box = h('div', { class: ['reel-layer', `reel-layer-${layer.type}`] });
    Object.assign(box.style, {
      left: `${layer.x ?? 0}%`, top: `${layer.y ?? 0}%`, width: `${layer.w ?? 100}%`,
      height: layer.type === 'text' && layer.h == null ? 'auto' : `${layer.h ?? 100}%`,
    });
    ss.el.append(box);

    if (layer.type === 'image') {
      const img = h('img', { src: layer.src, alt: layer.alt ?? '', decoding: 'async' });
      img.style.objectFit = layer.fit ?? 'cover';
      // Hide an image that failed, so the screen does not show the browser's broken-image icon and alt text.
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; if (!ss.dead) reportMissing(layer.src, ss.slide.id); });
      box.append(img);
      if (layer.motion) ss.animations.push(animate(img, motionKeyframes(layer.motion, layer, D), D, sp));
    } else if (layer.type === 'video') {
      const el = h('video', { src: layer.src, muted: Boolean(layer.muted), playsinline: true, preload: 'auto' });
      el.style.objectFit = layer.fit ?? 'cover';
      el.volume = clamp(layer.volume ?? 1, 0, 1);
      const v: Video = { layer, el, playing: false, finished: false };
      el.addEventListener('error', () => { if (!ss.dead) reportMissing(layer.src, ss.slide.id); });
      el.addEventListener('ended', () => {
        if (ss.dead || !v.playing) return;
        if (layer.loop && !paused) { el.currentTime = layer.trimStart ?? 0; el.play().catch(() => {}); return; }
        v.playing = false;
        v.finished = true; // stays on the last frame
      });
      box.append(el);
      ss.videos.push(v);
    } else if (layer.type === 'text') {
      const st = layer.style ?? {};
      box.style.justifyContent = ALIGN[layer.valign ?? 'top'];
      box.style.alignItems = ALIGN[layer.align ?? 'left'];
      const text = h('div', { class: 'reel-text' }, layer.text);
      Object.assign(text.style, {
        fontFamily: FONTS[st.font ?? 'sans'] ?? FONTS.sans,
        fontSize: ch(st.size ?? 5),
        fontWeight: st.weight === 'bold' ? '700' : '400',
        fontStyle: st.italic ? 'italic' : 'normal',
        color: st.color ?? '#ffffff',
        background: st.background ?? 'transparent',
        padding: ch(st.padding ?? 0),
        borderRadius: ch(st.radius ?? 0),
        lineHeight: String(st.lineHeight ?? 1.25),
        textAlign: layer.align ?? 'left',
        textShadow: st.shadow ?? !st.background ? `0 ${ch(0.15)} ${ch(0.6)} rgba(0,0,0,.9), 0 0 ${ch(1.5)} rgba(0,0,0,.6)` : 'none',
      });
      box.append(text);
    } else if (layer.type === 'shape') {
      Object.assign(box.style, {
        background: layer.fill ?? 'transparent',
        border: layer.stroke && (layer.strokeWidth ?? 0) > 0 ? `${ch(layer.strokeWidth!)} solid ${layer.stroke}` : 'none',
        borderRadius: layer.shape === 'ellipse' ? '50%' : ch(layer.radius ?? 0),
      });
    }
    ss.animations.push(animate(box, visibilityKeyframes(layer, D), D, sp));
  };

  // A video layer plays only within its time window, from trimStart + the time since the layer started.
  // Returns seconds until the layer needs to be checked again.
  const syncVideo = (ss: ShownSlide, v: Video, sp: number) => {
    const { layer, el } = v;
    const s = layer.start ?? 0;
    const e = layer.end ?? ss.slide.duration;
    if (sp < s) return s - sp;
    if (sp >= e) {
      if (v.playing) { el.pause(); v.playing = false; }
      return Infinity;
    }
    if (!v.playing && !v.finished) {
      const trim = layer.trimStart ?? 0;
      const length = Math.max(0.1, (layer.duration ?? Infinity) - trim);
      let inside = sp - s;
      if (layer.loop) inside %= length;
      if (inside >= length) { el.currentTime = trim + length - 0.05; v.finished = true; return e - sp; }
      el.currentTime = trim + inside;
      v.playing = true;
      el.play().catch(err => {
        if (ss.dead || err?.name !== 'NotAllowedError' || el.muted) return;
        // Sound refused: show the video without sound until the first key press.
        soundRefused();
        el.muted = true;
        mutedByBlock.add(v);
        el.play().catch(() => {});
      });
    }
    return e - sp;
  };

  // --- Audio clips -------------------------------------------------------------------------------
  const makeClip = (ss: ShownSlide, a: AudioClip, sp: number): Clip => {
    const start = a.start ?? 0;
    const k: Clip = { ...a, start, el: null, state: sp - start > JOIN_TOLERANCE ? 'skipped' : 'waiting' };
    if (k.state === 'skipped') return k;
    k.el = h('audio', { src: a.src, preload: 'auto' });
    k.el.addEventListener('playing', () => { if (!ss.dead) ss.audioPlayed = true; });
    k.el.addEventListener('ended', () => { if (ss.dead) return; k.state = 'done'; updateDucking(); });
    k.el.addEventListener('error', () => {
      if (ss.dead) return;
      k.state = 'error';
      reportMissing(a.src, ss.slide.id);
      updateDucking();
    });
    return k;
  };

  const startClip = (ss: ShownSlide, k: Clip, sp: number) => {
    const el = k.el!;
    k.state = 'playing';
    const inside = sp - k.start;
    if (inside > 0.05) el.currentTime = inside;
    el.volume = clamp(k.volume ?? 1, 0, 1);
    el.play().catch(err => {
      if (ss.dead || k.state !== 'playing' || err?.name !== 'NotAllowedError') return;
      // Narration does not start later in the middle of a sentence – it is skipped.
      k.state = 'skipped';
      soundRefused();
      updateDucking();
    });
  };

  // --- Slides ------------------------------------------------------------------------------------
  const silence = (ss: ShownSlide) => {
    for (const k of ss.clips) if (k.el && k.state === 'playing') { k.el.pause(); k.state = 'done'; }
    for (const v of ss.videos) if (v.playing) { v.el.pause(); v.playing = false; }
  };

  const tearDown = (ss: ShownSlide | null) => {
    if (!ss || ss.dead) return;
    ss.dead = true;
    silence(ss);
    for (const a of ss.animations) a.cancel();
    for (const el of [...ss.clips.map(k => k.el), ...ss.videos.map(v => v.el)]) {
      if (!el) continue;
      el.pause();
      el.removeAttribute('src');
      el.load(); // aborts the download
    }
    for (const v of ss.videos) mutedByBlock.delete(v);
    ss.el.remove();
  };

  const report = (ss: ShownSlide) => {
    if (ss.reported) return;
    ss.reported = true;
    onSlideShown({
      slideId: ss.slide.id,
      seconds: Math.round(Math.max(0, ss.slide.duration - ss.startPos) * 10) / 10,
      audioPlayed: ss.audioPlayed,
      reel,
    });
  };

  const preload = (i: number) => {
    const next = reel!.slides[i];
    preloaded = (next?.layers ?? []).filter(l => l.type === 'image' && l.src).map(l => {
      const img = new Image();
      img.decoding = 'async';
      img.src = (l as { src: string }).src;
      return img;
    });
  };

  const showSlide = (i: number, sp: number): ShownSlide => {
    const slide = reel!.slides[i];
    const D = slide.duration;
    const el = h('div', { class: 'reel-slide' });
    el.style.background = slide.background || '#000000';
    canvas.append(el);
    const ss: ShownSlide = { index: i, slide, el, animations: [], videos: [], clips: [], startPos: sp, reported: false, audioPlayed: false, dead: false, paused: [] };
    for (const layer of slide.layers ?? []) addLayer(ss, layer, sp);
    if (slide.credit) el.append(h('div', { class: 'reel-credit' }, slide.credit));

    // Transition: the new slide fades in over the previous one (or from black when starting mid-reel).
    const transition = slide.transition ?? { type: 'fade', duration: 1 };
    const d = transition.type === 'fade' ? clamp(transition.duration ?? 1, 0, D) : 0;
    if (d > 0) {
      const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d * 1000, fill: 'both', easing: 'ease-in-out' });
      a.currentTime = Math.min(sp, d) * 1000;
      a.onfinish = () => { if (active === ss && previous) { tearDown(previous); previous = null; } };
      ss.animations.push(a);
    } else if (previous) { tearDown(previous); previous = null; }

    ss.clips = (slide.audio ?? []).map(a => makeClip(ss, a, sp));
    preload(i + 1);
    return ss;
  };

  const switchTo = (i: number, p: number) => {
    const old = active;
    if (old) {
      if (p >= starts[old.index] + old.slide.duration - 0.05) report(old);
      silence(old);
      tearDown(previous);
      previous = old;
    }
    active = showSlide(i, p - starts[i]);
  };

  // Does everything due at the current position, and schedules the next time something is due.
  const tick = () => {
    clearTimeout(timer);
    if (!reel || paused) return;
    const p = position();
    const i = indexAt(p);
    if (!active || active.index !== i) switchTo(i, p);
    const ss = active!;
    const sp = p - starts[i];
    const last = i === reel.slides.length - 1;
    if (last && sp >= ss.slide.duration - 0.05) report(ss);

    let next = ss.slide.duration - sp; // until the slide is over
    for (const k of ss.clips) {
      if (k.state !== 'waiting') continue;
      if (sp >= k.start - 0.02) startClip(ss, k, sp);
      else next = Math.min(next, k.start - sp);
    }
    for (const v of ss.videos) next = Math.min(next, syncVideo(ss, v, sp));
    updateDucking();
    if (last && ss.reported) {
      if (!ended) { ended = true; onEnded(reel); }
      return;
    }
    timer = setTimeout(tick, clamp(next * 1000, 20, MAX_WAIT_MS));
  };

  const tearDownAll = () => {
    clearTimeout(timer);
    clearInterval(rampTimer);
    // The last slide has usually just finished when the caller moves on.
    if (active && reel && position() >= starts[active.index] + active.slide.duration - 0.5) report(active);
    tearDown(previous);
    tearDown(active);
    previous = active = null;
    preloaded = [];
    music.pause();
  };

  return {
    play: (next, offset = 0) => {
      tearDownAll();
      reel = next;
      starts = slideStarts(reel.slides ?? []);
      reportedMissing = new Set();
      paused = false;
      ended = false;
      if (!starts.length) { reel = null; return; }
      const total = starts.at(-1)! + reel.slides.at(-1)!.duration;
      basePos = clamp(offset, 0, total);
      baseT = performance.now();
      fit();
      startMusic(basePos);
      tick();
    },
    stop: () => {
      tearDownAll();
      reel = null;
      paused = false;
      music.removeAttribute('src');
      music.load();
      musicTarget = null;
    },
    pause: () => {
      if (paused) return;
      basePos = position();
      paused = true;
      clearTimeout(timer);
      if (!reel) return;
      for (const ss of [previous, active]) {
        if (!ss || ss.dead) continue;
        ss.paused = ss.animations.filter(a => a.playState === 'running');
        ss.paused.forEach(a => a.pause());
      }
      for (const k of active?.clips ?? []) if (k.state === 'playing') k.el!.pause();
      for (const v of active?.videos ?? []) if (v.playing) v.el.pause();
      music.pause();
      clearInterval(rampTimer);
    },
    resume: () => {
      if (!paused) return;
      baseT = performance.now();
      paused = false;
      if (!reel) return;
      for (const ss of [previous, active]) {
        if (!ss || ss.dead) continue;
        ss.paused.forEach(a => a.play());
        ss.paused = [];
      }
      for (const k of active?.clips ?? []) if (k.state === 'playing') k.el!.play().catch(() => {});
      for (const v of active?.videos ?? []) if (v.playing) v.el.play().catch(() => {});
      if (music.getAttribute('src')) {
        if (musicTarget != null) music.volume = musicTarget;
        playMusic();
      }
      tick();
    },
    unlockAudio: () => {
      if (!audioBlocked) return;
      audioBlocked = false;
      for (const v of mutedByBlock) v.el.muted = Boolean(v.layer.muted);
      mutedByBlock.clear();
      if (reel && !paused && music.getAttribute('src') && music.paused) playMusic();
    },
    position: () => (reel ? Math.min(position(), reelEnd()) : 0),
    get paused() { return paused; },
    get reel() { return reel; },
  };

  function reelEnd() { return starts.length ? starts.at(-1)! + reel!.slides.at(-1)!.duration : 0; }
};
