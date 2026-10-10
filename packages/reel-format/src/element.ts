// <reel-player> – the player as a custom element.
//
//   <script type="module">
//     import { defineReelPlayerElement } from 'reel-format';
//     defineReelPlayerElement();
//   </script>
//   <reel-player src="https://example.com/my-reel/reel.json" autoplay loop></reel-player>
//
// Attributes: src (URL of reel.json), autoplay, loop, offset (seconds to start at).
// Property:   element.reel = documentObject (with element.baseUrl for its media) plays a reel without fetching.
// Methods:    play(offset?), pause(), resume(), stop(), position().
// Events:     reel-loaded, reel-invalid (detail.errors), reel-error (detail = ReelPlayerError),
//             reel-slide (detail = SlideShown), reel-ended, reel-audio-blocked.
// The first click or key press after reel-audio-blocked unlocks sound.

import type { Reel, ResolvedReel } from './format.ts';
import { createReelPlayer, type ReelPlayer } from './player.ts';
import { resolveReel } from './resolve.ts';
import { validateReel } from './validate.ts';

// The stage fills the host; the host is 16:9 unless the page gives it another size.
const HOST_CSS = ':host { display: block; position: relative; aspect-ratio: 16 / 9; background: #000; } .stage { width: 100%; height: 100%; }';

export interface ReelPlayerElement extends HTMLElement {
  /** URL of reel.json. Setting it loads the reel. */
  src: string;
  /** A document to play directly. Relative media is resolved against `baseUrl`. */
  reel: Reel | null;
  baseUrl: string;
  /** The reel being played, resolved. */
  readonly resolved: ResolvedReel | null;
  play(offset?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  position(): number;
}

/**
 * Registers <reel-player> (or another tag name). Safe to call more than once.
 * Kept as a function so importing the package has no side effects and works outside the browser.
 */
export const defineReelPlayerElement = (tagName = 'reel-player'): CustomElementConstructor => {
  const existing = customElements.get(tagName);
  if (existing) return existing;

  class Element extends HTMLElement {
    static observedAttributes = ['src'];
    #player: ReelPlayer;
    #doc: Reel | null = null;
    #resolved: ResolvedReel | null = null;
    #loading = 0;
    baseUrl = '';

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = HOST_CSS;
      const stage = document.createElement('div');
      stage.className = 'stage';
      root.append(style, stage);
      const emit = (type: string, detail?: unknown) => this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
      this.#player = createReelPlayer({
        element: stage,
        onError: e => emit('reel-error', e),
        onAudioBlocked: () => emit('reel-audio-blocked'),
        onSlideShown: s => emit('reel-slide', s),
        onEnded: r => {
          emit('reel-ended', r);
          if (this.hasAttribute('loop')) this.#player.play(r, 0);
        },
      });
      const unlock = () => this.#player.unlockAudio();
      this.addEventListener('pointerdown', unlock);
      document.addEventListener('keydown', unlock);
    }

    get src() { return this.getAttribute('src') ?? ''; }
    set src(v: string) { this.setAttribute('src', v); }
    get reel() { return this.#doc; }
    set reel(doc: Reel | null) { this.#load(doc, this.baseUrl || document.baseURI); }
    get resolved() { return this.#resolved; }

    attributeChangedCallback(_name: string, old: string | null, value: string | null) {
      if (value && value !== old) void this.#fetch(value);
    }

    disconnectedCallback() { this.#player.stop(); }

    async #fetch(src: string) {
      const n = ++this.#loading;
      try {
        const url = new URL(src, document.baseURI).href;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = await res.json();
        if (n === this.#loading) this.#load(doc, res.url || url);
      } catch (err) {
        if (n === this.#loading) this.#invalid([`${src}: ${(err as Error).message}`]);
      }
    }

    #load(doc: unknown, baseUrl: string) {
      this.#player.stop();
      this.#resolved = null;
      this.#doc = null;
      if (doc == null) return;
      const result = validateReel(doc);
      if (!result.ok) return this.#invalid(result.errors);
      this.#doc = result.reel;
      this.#resolved = resolveReel(result.reel, { baseUrl });
      this.dispatchEvent(new CustomEvent('reel-loaded', { detail: this.#resolved, bubbles: true, composed: true }));
      if (this.hasAttribute('autoplay')) this.play(Number(this.getAttribute('offset')) || 0);
    }

    #invalid(errors: string[]) {
      this.dispatchEvent(new CustomEvent('reel-invalid', { detail: { errors }, bubbles: true, composed: true }));
    }

    play(offset = 0) { if (this.#resolved) this.#player.play(this.#resolved, offset); }
    pause() { this.#player.pause(); }
    resume() { this.#player.resume(); }
    stop() { this.#player.stop(); }
    position() { return this.#player.position(); }
  }

  customElements.define(tagName, Element);
  return Element;
};

declare global {
  interface HTMLElementTagNameMap { 'reel-player': ReelPlayerElement }
}
