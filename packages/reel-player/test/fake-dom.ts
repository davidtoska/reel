// A minimal fake browser for the player tests: just enough DOM, media, fetch and full screen to run
// src/player.ts and src/engine.ts in Node, and a manual clock.
//
// Importing this module installs the globals (document, window, HTMLElement, Image, getComputedStyle,
// ResizeObserver, fetch, setTimeout, setInterval, performance.now …). Import it before the player:
// the tests load the player with a dynamic import after this module has run.
//
// Time stands still until advance() moves it. Media never loads anything: play() resolves on the next
// microtask (and fires 'playing'), or rejects with NotAllowedError while media.allowSound is false and
// the element is not muted. Tests fire 'ended' and 'error' on elements themselves with dispatch().

/* The globals are replaced on purpose, so they are typed loosely here. */
const g = globalThis as any;

// --- Clock -----------------------------------------------------------------------------------------

interface Timer { fn: () => void; at: number; interval: number }

let now = 0;
let nextTimerId = 1;
const timers = new Map<number, Timer>();

g.setTimeout = (fn: () => void, ms = 0) => {
  const id = nextTimerId++;
  timers.set(id, { fn, at: now + Math.max(0, Number(ms) || 0), interval: 0 });
  return id;
};
g.clearTimeout = (id: number | undefined) => { if (id !== undefined) timers.delete(id); };
g.setInterval = (fn: () => void, ms = 0) => {
  const id = nextTimerId++;
  const interval = Math.max(1, Number(ms) || 0);
  timers.set(id, { fn, at: now + interval, interval });
  return id;
};
g.clearInterval = g.clearTimeout;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });

/** Lets pending promise callbacks run (media play() results, fetch responses, async functions). */
export const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Moves the clock forward, running every timer that falls due on the way, in order. */
export const advance = async (ms: number) => {
  const end = now + ms;
  // As in a browser, promise callbacks queued by the code that ran so far go before any timer.
  await flush();
  for (let runs = 0; ; runs++) {
    if (runs > 100_000) throw new Error('advance(): timers keep firing – an endless loop?');
    let next: [number, Timer] | null = null;
    for (const entry of timers) {
      const [id, t] = entry;
      if (t.at <= end && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = entry;
    }
    if (!next) break;
    const [id, t] = next;
    now = Math.max(now, t.at);
    if (t.interval) t.at += t.interval;
    else timers.delete(id);
    t.fn();
    await flush();
  }
  now = end;
  await flush();
};

/** The fake clock in milliseconds. */
export const clock = () => now;
/** Timeouts and intervals that are still scheduled. */
export const pendingTimers = () => timers.size;

// --- Elements --------------------------------------------------------------------------------------

type Listener = (event: any) => void;

/** Event listeners by type, with a dispatch() that hands a plain object to them. */
class Listeners {
  #byType = new Map<string, Set<Listener>>();
  add(type: string, fn: Listener) {
    if (!this.#byType.has(type)) this.#byType.set(type, new Set());
    this.#byType.get(type)!.add(fn);
  }
  remove(type: string, fn: Listener) { this.#byType.get(type)?.delete(fn); }
  dispatch(type: string, init: Record<string, unknown> = {}) {
    for (const fn of [...(this.#byType.get(type) ?? [])]) fn({ type, ...init });
  }
  count(type?: string) {
    if (type) return this.#byType.get(type)?.size ?? 0;
    return [...this.#byType.values()].reduce((n, set) => n + set.size, 0);
  }
  clear() { this.#byType.clear(); }
}

export class FakeNode {}
export class FakeHTMLElement extends FakeNode {}

export class FakeClassList {
  #el: FakeElement;
  constructor(el: FakeElement) { this.#el = el; }
  #names() { return new Set(this.#el.className.split(/\s+/).filter(Boolean)); }
  add(...names: string[]) { const s = this.#names(); names.forEach(n => s.add(n)); this.#el.className = [...s].join(' '); }
  remove(...names: string[]) { const s = this.#names(); names.forEach(n => s.delete(n)); this.#el.className = [...s].join(' '); }
  contains(name: string) { return this.#names().has(name); }
}

/** Inline style: plain properties, plus setProperty() for custom properties. */
export class FakeStyle {
  [property: string]: unknown;
  setProperty(name: string, value: string) { this[name] = value; }
  getPropertyValue(name: string) { return String(this[name] ?? ''); }
}

export class FakeAnimation {
  keyframes: unknown;
  options: unknown;
  currentTime: number | null = 0;
  playState: 'idle' | 'running' | 'paused' | 'finished' = 'running';
  onfinish: (() => void) | null = null;
  constructor(keyframes: unknown, options: unknown) { this.keyframes = keyframes; this.options = options; }
  pause() { this.playState = 'paused'; }
  play() { this.playState = 'running'; }
  cancel() { this.playState = 'idle'; }
  /** What the browser does when the animation reaches its end. */
  finish() { this.playState = 'finished'; this.onfinish?.(); }
}

export class FakeElement extends FakeHTMLElement {
  readonly tagName: string;
  children: (FakeElement | string)[] = [];
  parentNode: FakeElement | null = null;
  className = '';
  readonly classList = new FakeClassList(this);
  readonly style = new FakeStyle();
  readonly animations: FakeAnimation[] = [];
  readonly listeners = new Listeners();
  #attributes = new Map<string, string>();
  /** Layout size, set by the test (there is no layout engine). */
  clientWidth = 0;
  clientHeight = 0;

  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: unknown) { this.#attributes.set(name, String(value)); }
  getAttribute(name: string) { return this.#attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.#attributes.has(name); }
  removeAttribute(name: string) { this.#attributes.delete(name); }

  addEventListener(type: string, fn: Listener) { this.listeners.add(type, fn); }
  removeEventListener(type: string, fn: Listener) { this.listeners.remove(type, fn); }
  /** Fires an event at this element, e.g. dispatch('error') or dispatch('pointerup', { pointerType: 'touch' }). */
  dispatch(type: string, init: Record<string, unknown> = {}) { this.listeners.dispatch(type, { target: this, ...init }); }

  append(...nodes: unknown[]) {
    for (const node of nodes) {
      if (node instanceof FakeElement) {
        node.remove();
        node.parentNode = this;
        this.children.push(node);
      } else this.children.push(String(node));
    }
  }
  replaceChildren(...nodes: unknown[]) {
    for (const child of this.children) if (child instanceof FakeElement) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    this.parentNode = null;
  }
  get textContent(): string {
    return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
  }

  animate(keyframes: unknown, options: unknown) {
    const animation = new FakeAnimation(keyframes, options);
    this.animations.push(animation);
    return animation;
  }

  /** The outermost ancestor: the element itself when it is not attached to anything. */
  getRootNode(): FakeElement {
    let node: FakeElement = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }

  requestFullscreen(): Promise<void> {
    fakeDocument.fullscreenElement = this;
    return Promise.resolve();
  }

  /** Every element below this one, depth first. */
  descendants(): FakeElement[] {
    return this.children.flatMap(c => (c instanceof FakeElement ? [c, ...c.descendants()] : []));
  }
  byClass(name: string) { return this.descendants().filter(el => el.classList.contains(name)); }
  byTag(tag: string) { return this.descendants().filter(el => el.tagName === tag.toUpperCase()); }
}

/** Stands in for a shadow root: the root node of the elements inside it, with its own fullscreenElement. */
export class FakeShadowRoot extends FakeElement {
  fullscreenElement: FakeElement | null = null;
  constructor() { super('#shadow-root'); }
}

// --- Media -----------------------------------------------------------------------------------------

export interface PlayCall {
  el: FakeMedia;
  src: string;
  muted: boolean;
  result: 'pending' | 'ok' | 'refused' | 'aborted';
}

/** Controls and records all <audio> and <video> elements. */
export const media = {
  /** False: play() of an element that is not muted is refused, as before a user gesture. */
  allowSound: true,
  /** Every play() call, in order. */
  calls: [] as PlayCall[],
  /** Every media element created. */
  elements: [] as FakeMedia[],
};

const domError = (message: string, name: string) => Object.assign(new Error(message), { name });

export class FakeMedia extends FakeElement {
  currentTime = 0;
  volume = 1;
  muted = false;
  loop = false;
  preload = '';
  paused = true;
  #pending: { call: PlayCall; reject: (err: Error) => void } | null = null;

  constructor(tag: string) {
    super(tag);
    media.elements.push(this);
  }

  get src() { return this.getAttribute('src') ?? ''; }
  set src(value: string) { this.setAttribute('src', value); }

  play(): Promise<void> {
    const call: PlayCall = { el: this, src: this.src, muted: this.muted, result: 'pending' };
    media.calls.push(call);
    if (!media.allowSound && !this.muted) {
      call.result = 'refused';
      return Promise.reject(domError('play() failed because the user did not interact with the document first.', 'NotAllowedError'));
    }
    this.paused = false;
    return new Promise((resolve, reject) => {
      this.#pending = { call, reject };
      queueMicrotask(() => {
        if (this.#pending?.call !== call) return;
        this.#pending = null;
        call.result = 'ok';
        this.dispatch('playing');
        resolve();
      });
    });
  }

  pause() {
    this.paused = true;
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    pending.call.result = 'aborted';
    pending.reject(domError('The play() request was interrupted by a call to pause().', 'AbortError'));
  }

  load() { this.pause(); }
}

/** The play() calls of media whose src ends with `suffix`. */
export const playsOf = (suffix: string) => media.calls.filter(c => c.src.endsWith(suffix));
/** The media element that last played a src ending with `suffix` (it may have lost its src since). */
export const mediaOf = (suffix: string) => playsOf(suffix).at(-1)?.el;

export class FakeImage extends FakeElement {
  decoding = '';
  constructor() { super('img'); }
}

// --- Document and window ---------------------------------------------------------------------------

const documentListeners = new Listeners();
const windowListeners = new Listeners();

export const fakeDocument = {
  baseURI: 'https://example.com/app/index.html',
  fullscreenElement: null as FakeElement | null,
  createElement: (tag: string) => (tag === 'audio' || tag === 'video' ? new FakeMedia(tag) : new FakeElement(tag)),
  addEventListener: (type: string, fn: Listener) => documentListeners.add(type, fn),
  removeEventListener: (type: string, fn: Listener) => documentListeners.remove(type, fn),
  dispatch: (type: string, init: Record<string, unknown> = {}) => documentListeners.dispatch(type, init),
  listenerCount: (type?: string) => documentListeners.count(type),
  exitFullscreen: (): Promise<void> => {
    fakeDocument.fullscreenElement = null;
    return Promise.resolve();
  },
};

export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  #callback: () => void;
  observed: unknown[] = [];
  disconnected = false;
  constructor(callback: () => void) {
    this.#callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(el: unknown) { this.observed.push(el); }
  unobserve(el: unknown) { this.observed = this.observed.filter(e => e !== el); }
  disconnect() { this.disconnected = true; this.observed = []; }
  /** What the browser does when an observed element changes size. */
  trigger() { if (!this.disconnected) this.#callback(); }
}

export const fakeWindow = {
  ResizeObserver: FakeResizeObserver,
  addEventListener: (type: string, fn: Listener) => windowListeners.add(type, fn),
  removeEventListener: (type: string, fn: Listener) => windowListeners.remove(type, fn),
  dispatch: (type: string, init: Record<string, unknown> = {}) => windowListeners.dispatch(type, init),
  listenerCount: (type?: string) => windowListeners.count(type),
};

/** Only the padding is computed: from paddingTop … or the padding shorthand of the inline style. */
const paddingOf = (el: FakeElement, side: 'Top' | 'Right' | 'Bottom' | 'Left') => {
  const longhand = el.style[`padding${side}`];
  if (longhand) return String(longhand);
  const parts = String(el.style.padding ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '0px';
  const [top, right = top, bottom = top, left = right] = parts;
  return { Top: top, Right: right, Bottom: bottom, Left: left }[side];
};

g.Node = FakeNode;
g.HTMLElement = FakeHTMLElement;
g.Image = FakeImage;
g.ResizeObserver = FakeResizeObserver;
g.document = fakeDocument;
g.window = fakeWindow;
g.getComputedStyle = (el: FakeElement) => ({
  paddingTop: paddingOf(el, 'Top'),
  paddingRight: paddingOf(el, 'Right'),
  paddingBottom: paddingOf(el, 'Bottom'),
  paddingLeft: paddingOf(el, 'Left'),
});

// --- fetch -----------------------------------------------------------------------------------------

export interface FakeRequest {
  url: string;
  signal: AbortSignal | undefined;
  /** Answers with `doc` as JSON. `url` is the final URL after redirects (default: the requested one). */
  respond: (doc: unknown, init?: { status?: number; url?: string }) => void;
  /** Answers with a body that is not JSON. */
  respondText: (text: string, init?: { status?: number; url?: string }) => void;
  /** A network error. */
  fail: (err?: Error) => void;
}

export const network = {
  /** Every fetch() call, in order. Nothing is answered until the test says so. */
  requests: [] as FakeRequest[],
  /** False: an aborted request is not rejected, as if the response arrived anyway. */
  honourAbort: true,
};

g.fetch = (input: string | URL, init: { signal?: AbortSignal } = {}) => new Promise((resolve, reject) => {
  const url = String(input);
  const { signal } = init;
  const respondText = (text: string, { status = 200, url: finalUrl = url } = {}) => resolve({
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    json: async () => JSON.parse(text),
  });
  network.requests.push({
    url,
    signal,
    respond: (doc, options) => respondText(JSON.stringify(doc), options),
    respondText,
    fail: (err = new TypeError('fetch failed')) => reject(err),
  });
  signal?.addEventListener('abort', () => {
    if (network.honourAbort) reject(new DOMException('This operation was aborted', 'AbortError'));
  });
});

// --- Between tests ---------------------------------------------------------------------------------

/** Puts every fake back to its initial state. Destroy the players first. */
export const resetFakes = () => {
  timers.clear();
  now = 0;
  media.allowSound = true;
  media.calls.length = 0;
  media.elements.length = 0;
  documentListeners.clear();
  windowListeners.clear();
  fakeDocument.fullscreenElement = null;
  FakeResizeObserver.instances.length = 0;
  network.requests.length = 0;
  network.honourAbort = true;
};
