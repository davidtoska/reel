// ReelPlayer – plays reels in a host element you give it.
//
//   const player = new ReelPlayer(hostElement, { loop: true });
//   await player.load('https://example.com/my-reel/reel.json');
//   player.play();
//
// The player takes full control of the host element: it replaces its content and draws a 16:9
// canvas letterboxed inside it. The host's size decides how large the canvas is, so give it a size
// (e.g. width: 100%; aspect-ratio: 16 / 9, or the whole window). Call destroy() to let go of it.

import { resolveReel, slideStarts, validateReel, type Reel, type ResolvedReel } from 'reel-format';
import { createEngine, type Engine, type ReelPlayerError, type SlideShown } from './engine.ts';

export type ReelPlayerState = 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended';

export interface ReelPlayerOptions {
  /** Start again from the beginning when the reel ends. Default false. */
  loop?: boolean;
  /** Start playing as soon as load() or loadReel() has finished. Default false. */
  autoplay?: boolean;
  /**
   * Unlock sound on the first click on the host or key press in the page, after the browser refused
   * to play sound without a user gesture. Default true. Set false to call unlockAudio() yourself.
   */
  unlockAudioOnInteraction?: boolean;
}

export interface SlidePosition {
  index: number;
  id: string;
}

export interface ReelPlayerEvents {
  /** The state changed. */
  statechange: ReelPlayerState;
  /** Another slide is now shown – during playback and after seeking. */
  slidechange: SlidePosition;
  /** A slide has been shown to its end (for statistics). */
  slideshown: SlideShown;
  /** The last slide has been shown to its end. Not fired when looping restarts the reel. */
  ended: void;
  /** A media file could not be loaded. Playback continues without it. */
  error: ReelPlayerError;
  /** The browser refused sound before a user gesture. Sound starts after unlockAudio(). */
  audioblocked: void;
}

/** Thrown by load() and loadReel() when the reel cannot be fetched or is not valid reel/1. */
export class ReelLoadError extends Error {
  /** Every problem found, with paths: "slides[1].duration: must be 1–600". */
  readonly errors: string[];
  constructor(message: string, errors: string[]) {
    super(errors.length ? `${message}: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}` : message);
    this.name = 'ReelLoadError';
    this.errors = errors;
  }
}

/** Seconds into a slide before previous() goes to the previous slide instead of the start of this one. */
const PREVIOUS_THRESHOLD = 1.5;
const IDLE_MS = 2500;

export class ReelPlayer {
  readonly host: HTMLElement;
  #options: Required<ReelPlayerOptions>;
  #engine: Engine;
  #reel: ResolvedReel | null = null;
  #starts: number[] = [];
  #state: ReelPlayerState = 'empty';
  #slide: SlidePosition | null = null;
  #listeners = new Map<keyof ReelPlayerEvents, Set<(value: never) => void>>();
  #slideTimer: ReturnType<typeof setTimeout> | undefined;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #loadId = 0;
  #seeking = false;
  #reachedEnd = false;
  /** The exact time of a still frame (after load, seek or stop), so currentTime does not drift. */
  #stillAt: number | null = null;
  #blockedWhileStill = false;
  #destroyed = false;

  constructor(host: HTMLElement, options: ReelPlayerOptions = {}) {
    if (!(host instanceof HTMLElement)) throw new TypeError('ReelPlayer needs an HTMLElement to play in');
    this.host = host;
    this.#options = { loop: false, autoplay: false, unlockAudioOnInteraction: true, ...options };
    this.#engine = createEngine({
      element: host,
      onError: e => this.#emit('error', e),
      onSlideShown: s => this.#emit('slideshown', s),
      onAudioBlocked: () => {
        // Showing a still frame also touches the audio; only report a refusal when the user expects sound.
        if (this.#state === 'playing') this.#emit('audioblocked', undefined);
        else this.#blockedWhileStill = true;
      },
      onEnded: r => {
        this.#reachedEnd = true;
        if (this.#options.loop && this.#state === 'playing' && !this.#seeking) {
          this.#engine.play(r, 0);
          this.#trackSlide();
          return;
        }
        this.#setState('ended');
        this.#emit('ended', undefined);
      },
    });
    host.addEventListener('pointerdown', this.#onInteraction);
    host.addEventListener('pointermove', this.#onPointerMove);
    document.addEventListener('keydown', this.#onInteraction);
  }

  // --- Loading ------------------------------------------------------------------------------------

  /** Fetches reel.json, checks it and shows its first frame. Media is loaded relative to the URL. */
  async load(url: string | URL): Promise<void> {
    this.#assertAlive();
    const id = ++this.#loadId;
    this.#unload();
    this.#setState('loading');
    const href = new URL(String(url), document.baseURI).href;
    let doc: unknown;
    let base = href;
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      base = res.url || href;
      doc = await res.json();
    } catch (err) {
      if (id === this.#loadId) this.#setState('empty');
      throw new ReelLoadError(`Could not load ${href}`, [(err as Error).message]);
    }
    if (id !== this.#loadId) return; // a newer load() won
    this.loadReel(doc as Reel, base);
  }

  /**
   * Plays a document you already have – e.g. read from disk in Electron. Relative media is resolved
   * against `baseUrl` (the URL reel.json would have), else against the page.
   */
  loadReel(reel: Reel, baseUrl?: string | URL): void {
    this.#assertAlive();
    ++this.#loadId;
    this.#unload();
    const checked = validateReel(reel);
    if (!checked.ok) {
      this.#setState('empty');
      throw new ReelLoadError('The reel is not valid reel/1', checked.errors);
    }
    this.#reel = resolveReel(checked.reel, { baseUrl: baseUrl ?? document.baseURI });
    this.#starts = slideStarts(this.#reel.slides);
    this.#show(0, false);
    this.#setState('ready');
    if (this.#options.autoplay) this.play();
  }

  // --- Playback -----------------------------------------------------------------------------------

  play(): void {
    if (!this.#reel || this.#state === 'playing') return;
    if (this.#state === 'ended') this.#show(0, true);
    else this.#engine.resume();
    this.#stillAt = null;
    this.#setState('playing');
    if (this.#blockedWhileStill) {
      this.#blockedWhileStill = false;
      this.#emit('audioblocked', undefined);
    }
    this.#trackSlide();
  }

  pause(): void {
    if (this.#state !== 'playing') return;
    this.#engine.pause();
    this.#stillAt = null;
    clearTimeout(this.#slideTimer);
    this.#setState('paused');
  }

  /** Pauses and goes back to the start. */
  stop(): void {
    if (!this.#reel) return;
    this.#show(0, false);
    this.#setState('ready');
  }

  /** Jumps to a time in seconds. Keeps playing if it was playing; otherwise shows that frame. */
  seek(seconds: number): void {
    if (!this.#reel) return;
    const t = Math.min(Math.max(0, Number(seconds) || 0), this.#reel.duration);
    const playing = this.#state === 'playing';
    this.#show(t, playing);
    // Seeking to the very end ends the reel (the engine reports it while showing that frame).
    if (!this.#reachedEnd) this.#setState(playing ? 'playing' : t === 0 ? 'ready' : 'paused');
  }

  /** Jumps to the start of a slide, by index or id. */
  seekToSlide(slide: number | string): void {
    if (!this.#reel) return;
    const index = typeof slide === 'number' ? slide : this.#reel.slides.findIndex(s => s.id === slide);
    if (index < 0 || index >= this.#starts.length) throw new RangeError(`No slide ${slide}`);
    this.seek(this.#starts[index]);
  }

  next(): void {
    const i = this.#indexAt(this.currentTime);
    if (i + 1 < this.#starts.length) this.seekToSlide(i + 1);
    else this.seekToEnd();
  }

  /** To the start of this slide, or of the previous one when this slide has just begun. */
  previous(): void {
    const t = this.currentTime;
    const i = this.#indexAt(t);
    this.seekToSlide(t - this.#starts[i] < PREVIOUS_THRESHOLD ? Math.max(0, i - 1) : i);
  }

  /** Shows the end of the reel; the state becomes 'ended'. */
  seekToEnd(): void {
    if (this.#reel) this.seek(this.#reel.duration);
  }

  /** Call after 'audioblocked', from a click or key press. Done for you unless unlockAudioOnInteraction is false. */
  unlockAudio(): void {
    this.#blockedWhileStill = false;
    this.#engine.unlockAudio();
  }

  // --- State --------------------------------------------------------------------------------------

  get state(): ReelPlayerState { return this.#state; }
  /** Position in the reel, in seconds. */
  get currentTime(): number { return this.#stillAt ?? this.#engine.position(); }
  /** Length of the reel in seconds, 0 when nothing is loaded. */
  get duration(): number { return this.#reel?.duration ?? 0; }
  get currentSlide(): SlidePosition | null { return this.#slide; }
  /** The loaded reel, resolved (defaults merged, media URLs absolute). */
  get reel(): ResolvedReel | null { return this.#reel; }

  // --- Full screen --------------------------------------------------------------------------------

  /** Makes the host element full screen. Browsers only allow it from a click or key press. */
  enterFullscreen(): Promise<void> {
    return this.isFullscreen ? Promise.resolve() : this.host.requestFullscreen();
  }

  exitFullscreen(): Promise<void> {
    return this.isFullscreen ? document.exitFullscreen() : Promise.resolve();
  }

  toggleFullscreen(): Promise<void> {
    return this.isFullscreen ? this.exitFullscreen() : this.enterFullscreen();
  }

  get isFullscreen(): boolean { return document.fullscreenElement === this.host; }

  // --- Events -------------------------------------------------------------------------------------

  /** Listens for an event. Returns a function that stops listening. */
  on<E extends keyof ReelPlayerEvents>(event: E, listener: (value: ReelPlayerEvents[E]) => void): () => void {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(listener as (value: never) => void);
    this.#listeners.set(event, set);
    return () => { set.delete(listener as (value: never) => void); };
  }

  /** Stops playback, removes everything the player added to the host and every listener. The player cannot be used afterwards. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    ++this.#loadId;
    clearTimeout(this.#slideTimer);
    clearTimeout(this.#idleTimer);
    this.host.removeEventListener('pointerdown', this.#onInteraction);
    this.host.removeEventListener('pointermove', this.#onPointerMove);
    document.removeEventListener('keydown', this.#onInteraction);
    this.host.classList.remove('reel-idle');
    this.#engine.destroy();
    this.#listeners.clear();
    this.#reel = null;
    this.#state = 'empty';
  }

  // --- Internals ----------------------------------------------------------------------------------

  #assertAlive() {
    if (this.#destroyed) throw new Error('This ReelPlayer has been destroyed');
  }

  #emit<E extends keyof ReelPlayerEvents>(event: E, value: ReelPlayerEvents[E]) {
    for (const listener of this.#listeners.get(event) ?? []) {
      try { (listener as (v: ReelPlayerEvents[E]) => void)(value); } catch (err) { console.error(err); }
    }
  }

  #setState(state: ReelPlayerState) {
    if (state === this.#state) return;
    this.#state = state;
    this.#emit('statechange', state);
  }

  #unload() {
    clearTimeout(this.#slideTimer);
    this.#engine.stop();
    this.#reel = null;
    this.#starts = [];
    this.#slide = null;
    this.#stillAt = null;
    this.#blockedWhileStill = false;
  }

  #indexAt(t: number) {
    let i = 0;
    while (i + 1 < this.#starts.length && this.#starts[i + 1] <= t) i++;
    return i;
  }

  /** Shows the reel at time t, playing or as a still frame. */
  #show(t: number, playing: boolean) {
    this.#seeking = true;
    this.#reachedEnd = false;
    this.#stillAt = playing ? null : t;
    try {
      this.#engine.play(this.#reel!, t);
      if (!playing) this.#engine.pause();
    } finally {
      this.#seeking = false;
    }
    this.#trackSlide();
  }

  /** Reports the current slide, and while playing, schedules the check for the next one. */
  #trackSlide = () => {
    clearTimeout(this.#slideTimer);
    if (!this.#reel) return;
    const t = this.currentTime;
    const index = this.#indexAt(t);
    if (index !== this.#slide?.index) {
      this.#slide = { index, id: this.#reel.slides[index].id };
      this.#emit('slidechange', this.#slide);
    }
    if (this.#state === 'playing' && index + 1 < this.#starts.length) {
      this.#slideTimer = setTimeout(this.#trackSlide, Math.max(10, (this.#starts[index + 1] - t) * 1000 + 10));
    }
  };

  #onInteraction = () => {
    if (this.#options.unlockAudioOnInteraction) this.unlockAudio();
  };

  /** In full screen, the pointer is hidden after it has been still for a while. */
  #onPointerMove = () => {
    this.host.classList.remove('reel-idle');
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.host.classList.add('reel-idle'), IDLE_MS);
  };
}
