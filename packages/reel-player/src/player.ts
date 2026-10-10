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
   * Unlock sound on the first click or tap on the host, or key press in the page, after the browser
   * refused to play sound without a user gesture. Default true. Set false to call unlockAudio() yourself.
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
  /**
   * A slide has been shown to its end, or left in its last half second (for statistics). Only reported
   * while playing – not for still frames after load, stop() or a seek while not playing.
   */
  slideshown: SlideShown;
  /**
   * The reel has played to its end – or seekToEnd(), or next() on the last slide, while playing. Not fired
   * when `loop` restarts the reel, nor when a seek while not playing shows the end (the state still becomes 'ended').
   */
  ended: void;
  /** A media file could not be loaded. Playback continues without it. */
  error: ReelPlayerError;
  /**
   * The browser refused sound during playback, because there was no user gesture yet. After unlockAudio(),
   * music and video sound come back; narration already refused on the current slide is skipped.
   */
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

/** An absolute URL as given (so the reel's id stays the same), a relative one resolved against the page. */
const absoluteUrl = (url: string | URL) => {
  const s = String(url);
  try {
    new URL(s);
    return s;
  } catch {
    return new URL(s, document.baseURI).href;
  }
};

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
  /** The download of the running load(), aborted when something else replaces it. */
  #loadAbort: AbortController | null = null;
  /** Bumped by every show, unload and destroy: a listener that calls back into the player ends the step in progress. */
  #gen = 0;
  #seeking = false;
  #reachedEnd = false;
  /** The exact time of a still frame (after load, seek or stop), so currentTime does not drift. */
  #stillAt: number | null = null;
  #destroyed = false;

  constructor(host: HTMLElement, options: ReelPlayerOptions = {}) {
    if (!(host instanceof HTMLElement)) throw new TypeError('ReelPlayer needs an HTMLElement to play in');
    this.host = host;
    this.#options = { loop: false, autoplay: false, unlockAudioOnInteraction: true, ...options };
    this.#engine = createEngine({
      element: host,
      onError: e => this.#emit('error', e),
      // Only what was watched counts: no reports for still frames (after load, stop() or a seek while not playing).
      onSlideShown: s => { if (this.#state === 'playing') this.#emit('slideshown', s); },
      // The engine only reports a refusal while it is playing; still frames do not count.
      onAudioBlocked: () => this.#emit('audioblocked', undefined),
      onEnded: r => {
        this.#reachedEnd = true;
        if (this.#seeking) return; // #show() ends the reel once it has reported the slide
        if (this.#options.loop && this.#state === 'playing') {
          this.#engine.play(r, 0);
          this.#trackSlide();
          return;
        }
        this.#end(true);
      },
    });
    host.addEventListener('pointerdown', this.#onPointer);
    host.addEventListener('pointerup', this.#onPointer);
    host.addEventListener('pointermove', this.#onPointerMove);
    document.addEventListener('keydown', this.#onInteraction);
  }

  // --- Loading ------------------------------------------------------------------------------------

  /**
   * Fetches reel.json, checks it and shows its first frame. Media is loaded relative to the URL.
   * Rejects with ReelLoadError when the reel cannot be fetched or is not valid. When a newer load() or
   * loadReel(), or destroy(), comes first, the download is aborted and the promise resolves without
   * loading anything.
   */
  async load(url: string | URL): Promise<void> {
    this.#assertAlive();
    const id = ++this.#loadId;
    this.#unload();
    if (id === this.#loadId) this.#setState('loading');
    if (id !== this.#loadId) return; // a listener started something else meanwhile
    const abort = new AbortController();
    this.#loadAbort = abort;
    let href = String(url);
    let base = href;
    let doc: unknown;
    try {
      href = base = new URL(href, document.baseURI).href;
      const res = await fetch(href, { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      base = res.url || href;
      doc = await res.json();
    } catch (err) {
      if (id !== this.#loadId) return; // replaced by a newer load, or destroyed
      this.#setState('empty');
      throw new ReelLoadError(`Could not load ${href}`, [(err as Error).message]);
    } finally {
      if (this.#loadAbort === abort) this.#loadAbort = null;
    }
    if (id !== this.#loadId) return; // a newer load() won
    this.loadReel(doc as Reel, base);
  }

  /**
   * Plays a document you already have – e.g. read from disk in Electron. Relative media is resolved
   * against `baseUrl` (the URL reel.json would have; a relative one is taken relative to the page),
   * else against the page. Throws ReelLoadError when the reel is not valid.
   */
  loadReel(reel: Reel, baseUrl?: string | URL): void {
    this.#assertAlive();
    const id = ++this.#loadId;
    this.#unload();
    if (id !== this.#loadId) return; // a listener started something else meanwhile
    const checked = validateReel(reel);
    if (!checked.ok) {
      this.#setState('empty');
      throw new ReelLoadError('The reel is not valid reel/1', checked.errors);
    }
    let resolved: ResolvedReel;
    try {
      resolved = resolveReel(checked.reel, { baseUrl: absoluteUrl(baseUrl ?? document.baseURI) });
    } catch (err) {
      this.#setState('empty');
      throw new ReelLoadError('Could not resolve the media URLs', [(err as Error).message]);
    }
    this.#reel = resolved;
    this.#starts = slideStarts(resolved.slides);
    if (!this.#show(0, false)) return;
    this.#setState('ready');
    if (this.#options.autoplay) this.play();
  }

  // --- Playback -----------------------------------------------------------------------------------

  play(): void {
    if (!this.#reel || this.#state === 'playing') return;
    // After the end, show the start first, as a still frame – like stop() and then play().
    if (this.#state === 'ended' && !this.#show(0, false)) return; // a listener took over
    this.#stillAt = null;
    // 'playing' before the engine runs, so an end reached at once (paused in the last moment) loops or ends.
    this.#setState('playing');
    if (this.state !== 'playing') return; // a statechange listener paused or stopped it (the getter, as TS narrows #state)
    this.#engine.resume();
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
    if (this.#show(0, false)) this.#setState('ready');
  }

  /** Jumps to a time in seconds. Keeps playing if it was playing; otherwise shows that frame. */
  seek(seconds: number): void {
    if (!this.#reel) return;
    const t = Math.min(Math.max(0, Number(seconds) || 0), this.#reel.duration);
    const before = this.#state;
    const playing = before === 'playing';
    // Seeking to the very end ends the reel (#show() sets the state then). A listener that paused or
    // played during the seek (e.g. on 'slidechange') has set the state itself.
    if (this.#show(t, playing) && !this.#reachedEnd && this.#state === before) this.#setState(playing ? 'playing' : t === 0 ? 'ready' : 'paused');
  }

  /**
   * Jumps to the start of a slide, by index (an integer from 0) or id.
   * @throws RangeError when the loaded reel has no such slide.
   */
  seekToSlide(slide: number | string): void {
    if (!this.#reel) return;
    const index = typeof slide === 'number' ? slide : this.#reel.slides.findIndex(s => s.id === slide);
    if (!Number.isInteger(index) || index < 0 || index >= this.#starts.length) throw new RangeError(`No slide ${slide}`);
    this.seek(this.#starts[index]);
  }

  /** To the next slide. On the last slide: back to the first while playing with `loop`, else to the end (state 'ended'). */
  next(): void {
    if (!this.#reel) return;
    const i = this.#indexAt(this.currentTime);
    if (i + 1 < this.#starts.length) this.seekToSlide(i + 1);
    else if (this.#options.loop && this.#state === 'playing') this.seekToSlide(0);
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

  /**
   * Call after 'audioblocked', from a click or key press – e.g. in your own buttons outside the host.
   * Done for you on a click or tap on the host or a key press, unless unlockAudioOnInteraction is false.
   * Does nothing when sound is not blocked.
   */
  unlockAudio(): void {
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

  /**
   * Makes the host element full screen. Browsers only allow it from a click or key press. Never throws:
   * the promise rejects when the browser refuses, or has no element full screen (iPhone Safari).
   */
  async enterFullscreen(): Promise<void> {
    if (this.isFullscreen) return;
    if (typeof this.host.requestFullscreen !== 'function') throw new Error('Full screen is not supported in this browser');
    await this.host.requestFullscreen();
  }

  async exitFullscreen(): Promise<void> {
    if (this.isFullscreen) await document.exitFullscreen();
  }

  toggleFullscreen(): Promise<void> {
    return this.isFullscreen ? this.exitFullscreen() : this.enterFullscreen();
  }

  /** Whether the host is full screen – also when it is inside shadow DOM. */
  get isFullscreen(): boolean {
    // document.fullscreenElement is retargeted to the outermost shadow host; the host's own root is not.
    const root = this.host.getRootNode() as Partial<DocumentOrShadowRoot>;
    return document.fullscreenElement === this.host || root.fullscreenElement === this.host;
  }

  // --- Events -------------------------------------------------------------------------------------

  /** Listens for an event. Returns a function that stops listening. */
  on<E extends keyof ReelPlayerEvents>(event: E, listener: (value: ReelPlayerEvents[E]) => void): () => void {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(listener as (value: never) => void);
    this.#listeners.set(event, set);
    return () => { set.delete(listener as (value: never) => void); };
  }

  /**
   * Stops playback, leaves full screen, removes everything the player added to the host and every listener.
   * No events are fired from then on. The player cannot be used afterwards.
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    // Emptying each set also stops a dispatch in progress, so no listener runs after destroy().
    for (const set of this.#listeners.values()) set.clear();
    this.#listeners.clear();
    ++this.#loadId;
    ++this.#gen;
    this.#loadAbort?.abort();
    this.#loadAbort = null;
    if (this.isFullscreen) this.exitFullscreen().catch(() => {});
    clearTimeout(this.#slideTimer);
    clearTimeout(this.#idleTimer);
    this.host.removeEventListener('pointerdown', this.#onPointer);
    this.host.removeEventListener('pointerup', this.#onPointer);
    this.host.removeEventListener('pointermove', this.#onPointerMove);
    document.removeEventListener('keydown', this.#onInteraction);
    this.host.classList.remove('reel-idle');
    this.#engine.destroy();
    this.#reel = null;
    this.#starts = [];
    this.#slide = null;
    this.#stillAt = null;
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
    if (state === this.#state || this.#destroyed) return;
    this.#state = state;
    this.#emit('statechange', state);
  }

  #unload() {
    ++this.#gen;
    this.#loadAbort?.abort();
    this.#loadAbort = null;
    clearTimeout(this.#slideTimer);
    this.#reel = null;
    this.#starts = [];
    this.#slide = null;
    this.#stillAt = null;
    this.#engine.stop(); // last: it may report the slide being left ('slideshown')
  }

  #indexAt(t: number) {
    let i = 0;
    while (i + 1 < this.#starts.length && this.#starts[i + 1] <= t) i++;
    return i;
  }

  /** Shows the reel at time t, playing or as a still frame. False when a listener took over meanwhile. */
  #show(t: number, playing: boolean): boolean {
    const gen = ++this.#gen;
    this.#seeking = true;
    this.#reachedEnd = false;
    this.#stillAt = playing ? null : t;
    try {
      this.#engine.play(this.#reel!, t);
      if (!playing && gen === this.#gen) this.#engine.pause();
    } finally {
      if (gen === this.#gen) this.#seeking = false;
    }
    if (gen !== this.#gen) return false;
    this.#trackSlide();
    if (gen !== this.#gen) return false;
    // Showing the very end ends the reel. Only a reel that was playing fires 'ended'.
    if (this.#reachedEnd) this.#end(playing);
    return gen === this.#gen;
  }

  /** The reel is over: hold the last frame, with the music and any looping video stopped. */
  #end(emit: boolean) {
    this.#engine.pause();
    this.#stillAt ??= this.#reel?.duration ?? 0;
    clearTimeout(this.#slideTimer);
    const was = this.#state;
    this.#setState('ended');
    if (emit && was !== 'ended' && this.#state === 'ended') this.#emit('ended', undefined);
  }

  /** Reports the current slide, and while playing, schedules the check for the next one. */
  #trackSlide = () => {
    clearTimeout(this.#slideTimer);
    if (!this.#reel) return;
    const t = this.currentTime;
    // The slide on screen decides, so 'slidechange' never runs ahead of the picture: the engine's own timer
    // can fire a little after this one. Until the engine has switched, this checks again shortly.
    const shown = this.#engine.shownSlide();
    const index = shown >= 0 ? shown : this.#indexAt(t);
    if (index !== this.#slide?.index) {
      this.#slide = { index, id: this.#reel.slides[index].id };
      this.#emit('slidechange', this.#slide);
    }
    if (this.#state === 'playing' && index + 1 < this.#starts.length) {
      this.#slideTimer = setTimeout(this.#trackSlide, Math.max(10, (this.#starts[index + 1] - t) * 1000 + 10));
    }
  };

  /** Browsers count pointerdown as a user gesture only for a mouse; for touch and pen it is pointerup. */
  #onPointer = (e: PointerEvent) => {
    if ((e.type === 'pointerdown') === (e.pointerType === 'mouse')) this.#onInteraction();
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
