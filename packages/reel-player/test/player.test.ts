// ReelPlayer and its engine, run in Node against the fake browser in fake-dom.ts: a fake DOM, fake
// media elements, a fake fetch and a manual clock (time only moves with advance()).

import assert from 'node:assert/strict';
import { afterEach, describe, test, type TestContext } from 'node:test';
import type { Reel, Slide } from 'reel-format';
import type { ReelPlayer as Player, ReelPlayerOptions } from '../src/index.ts';
import {
  advance, fakeDocument, fakeWindow, flush, media, mediaOf, network, pendingTimers, playsOf, resetFakes,
  FakeElement, FakeMedia, FakeResizeObserver, FakeShadowRoot,
} from './fake-dom.ts';

// Loaded only now, after fake-dom.ts has installed the browser globals.
const { ReelPlayer, ReelLoadError } = await import('../src/index.ts');

// --- Helpers ---------------------------------------------------------------------------------------

/**
 * For every test: a test waiting for a promise that never settles fails on its own instead of hanging
 * the run, and the tests after it still run normally. (Not on describe(): when a group's limit runs out,
 * the rest of the group is cancelled, and the cancelled test's afterEach then resets the fakes in the
 * middle of the next test.) The test runner's own timers are real; only the globals are fake.
 */
const TIMEOUT = { timeout: 5_000 };

/** The outcome of a promise once pending callbacks have run, without waiting for one that never settles. */
const settled = async <T>(promise: Promise<T>) => {
  let outcome: { status: string; value?: T; reason?: unknown } = { status: 'pending' };
  promise.then(value => { outcome = { status: 'fulfilled', value }; }, reason => { outcome = { status: 'rejected', reason }; });
  await flush();
  return outcome;
};
/** What load() settles with when something newer replaced it: resolved, with nothing. */
const RESOLVED = { status: 'fulfilled', value: undefined };

const BASE = 'https://cdn.example.com/reels/test/reel.json';
const MUSIC = { src: 'media/music.mp3', duration: 30 };

/** A slide with one shape. Its credit is its id, so tests can see which slides are on the canvas. */
const slide = (id: string, duration: number, extra: Partial<Slide> = {}): Slide => ({
  id, duration, credit: id, layers: [{ type: 'shape', shape: 'rect', fill: '#112233' }], ...extra,
});
const reelOf = (slides: Slide[], extra: Partial<Reel> = {}): Reel => ({ format: 'reel/1', title: 'Test', slides, ...extra });
/** Three slides of 3 s: a 0–3, b 3–6, c 6–9. */
const abc = (extra: Partial<Reel> = {}) => reelOf([slide('a', 3), slide('b', 3), slide('c', 3)], extra);
/** Three slides of 2 s; a and b have narration (n1.mp3, n2.mp3). */
const narrated = () => reelOf([
  slide('a', 2, { audio: [{ src: 'media/n1.mp3', duration: 1 }] }),
  slide('b', 2, { audio: [{ src: 'media/n2.mp3', duration: 1 }] }),
  slide('c', 2),
]);

const makeHost = (width = 320, height = 180) => {
  const host = new FakeElement('div');
  host.clientWidth = width;
  host.clientHeight = height;
  return host;
};

const players: Player[] = [];
const createPlayer = (options: ReelPlayerOptions = {}, host = makeHost()) => {
  const player = new ReelPlayer(host as unknown as HTMLElement, options);
  players.push(player);
  return { player, host };
};

afterEach(() => {
  for (const player of players.splice(0)) player.destroy();
  resetFakes();
});

/** Records every event as a short string: "state:ready", "slide:a", "shown:a", "ended", "error:…", "audioblocked". */
const record = (player: Player) => {
  const log: string[] = [];
  player.on('statechange', s => log.push(`state:${s}`));
  player.on('slidechange', s => log.push(`slide:${s.id}`));
  player.on('slideshown', s => log.push(`shown:${s.slideId}`));
  player.on('ended', () => log.push('ended'));
  player.on('error', e => log.push(`error:${e.src}`));
  player.on('audioblocked', () => log.push('audioblocked'));
  return log;
};
const count = (log: string[], entry: string) => log.filter(e => e === entry).length;

/** The ids (credits) of the slides on the canvas. */
const shownSlides = (host: FakeElement) => host.byClass('reel-slide').map(s => s.byClass('reel-credit')[0]?.textContent);
const canvasOf = (host: FakeElement) => host.byClass('reel-canvas')[0];
const videoOf = (host: FakeElement) => host.byTag('video')[0] as FakeMedia;

const near = (actual: number, expected: number, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be ${expected}`);

// --- Constructor -----------------------------------------------------------------------------------

describe('constructor', () => {
  test('throws a TypeError without an HTMLElement', TIMEOUT, () => {
    assert.throws(() => new ReelPlayer({} as HTMLElement), TypeError);
    assert.throws(() => new ReelPlayer(null as unknown as HTMLElement), TypeError);
  });

  test('takes over the host: reel-host class, the player CSS and a canvas; nothing loaded', TIMEOUT, () => {
    const host = makeHost();
    host.className = 'mine';
    host.append(new FakeElement('p'), 'old content');
    const { player } = createPlayer({}, host);
    assert.equal(host.className, 'mine reel-host');
    assert.deepEqual(host.children.map(c => (c as FakeElement).tagName), ['STYLE', 'DIV']);
    assert.match((host.children[0] as FakeElement).textContent, /\.reel-canvas \{/);
    assert.equal(host.byClass('reel-stage').length, 1);
    assert.equal(canvasOf(host).parentNode, host.byClass('reel-stage')[0]);
    assert.equal(player.host, host as unknown as HTMLElement);
    assert.equal(player.state, 'empty');
    assert.equal(player.reel, null);
    assert.equal(player.duration, 0);
    assert.equal(player.currentTime, 0);
    assert.equal(player.currentSlide, null);
  });

  test('without a reel, playback methods do nothing', TIMEOUT, () => {
    const { player } = createPlayer();
    const log = record(player);
    player.play();
    player.pause();
    player.stop();
    player.seek(3);
    player.seekToSlide(0);
    player.seekToSlide('a');
    player.next();
    player.previous();
    player.seekToEnd();
    player.unlockAudio();
    assert.equal(player.state, 'empty');
    assert.deepEqual(log, []);
  });
});

// --- loadReel() ------------------------------------------------------------------------------------

describe('loadReel()', () => {
  test('shows the first frame as a still: slidechange, then statechange ready', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    const log = record(player);
    player.loadReel(abc(), BASE);
    assert.deepEqual(log, ['slide:a', 'state:ready']);
    assert.equal(player.state, 'ready');
    assert.deepEqual(player.currentSlide, { index: 0, id: 'a' });
    assert.equal(player.currentTime, 0);
    assert.equal(player.duration, 9);
    assert.deepEqual(shownSlides(host), ['a']);
    await advance(5000);
    assert.equal(player.currentTime, 0, 'a still frame does not move');
    assert.deepEqual(log, ['slide:a', 'state:ready']);
  });

  test('draws the slide: background, layers with absolute media URLs, text and credit', TIMEOUT, () => {
    const { player, host } = createPlayer();
    player.loadReel(reelOf([slide('a', 3, {
      background: '#123456',
      layers: [{ type: 'image', src: 'media/photo.jpg', alt: 'A photo' }, { type: 'text', text: 'Hello' }],
    })]), BASE);
    const [slideEl] = host.byClass('reel-slide');
    assert.equal(slideEl.style.background, '#123456');
    const img = host.byTag('img')[0];
    assert.equal(img.getAttribute('src'), 'https://cdn.example.com/reels/test/media/photo.jpg');
    assert.equal(img.getAttribute('alt'), 'A photo');
    assert.equal(host.byClass('reel-text')[0].textContent, 'Hello');
    assert.equal(host.byClass('reel-credit')[0].textContent, 'a');
    assert.equal(player.reel?.slides[0].layers.length, 2);
  });

  test('resolves media against an absolute baseUrl, which is kept as the reel id', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc({ music: MUSIC }), BASE);
    assert.equal(player.reel?.id, BASE);
    assert.equal(player.reel?.music?.src, 'https://cdn.example.com/reels/test/media/music.mp3');
  });

  test('takes a relative baseUrl relative to the page', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc({ music: MUSIC }), '/reels/fox/reel.json');
    assert.equal(player.reel?.id, 'https://example.com/reels/fox/reel.json');
    assert.equal(player.reel?.music?.src, 'https://example.com/reels/fox/media/music.mp3');
    player.loadReel(abc({ music: MUSIC }), 'fox/reel.json');
    assert.equal(player.reel?.music?.src, 'https://example.com/app/fox/media/music.mp3');
  });

  test('without baseUrl, media resolve against the page', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc({ music: MUSIC }));
    assert.equal(player.reel?.music?.src, 'https://example.com/app/media/music.mp3');
  });

  test('an invalid reel throws ReelLoadError with every error and leaves the player empty', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    await advance(500);
    const log = record(player);
    const bad = { format: 'reel/1', title: '', slides: [{ id: 'a', duration: 0, layers: [] }] } as unknown as Reel;
    let error: unknown;
    try { player.loadReel(bad); } catch (err) { error = err; }
    assert.ok(error instanceof ReelLoadError);
    assert.equal(error.name, 'ReelLoadError');
    assert.ok(error.errors.length >= 2, error.errors.join('\n'));
    assert.match(error.message, /^The reel is not valid reel\/1: .+ \(\+\d+ more\)$/);
    assert.equal(player.state, 'empty');
    assert.equal(player.reel, null);
    assert.deepEqual(shownSlides(host), []);
    assert.deepEqual(log, ['state:empty']);
    assert.equal(pendingTimers(), 0, 'nothing keeps playing');
  });

  test('media that cannot be resolved against baseUrl throw ReelLoadError and leave the player empty', TIMEOUT, () => {
    const { player } = createPlayer();
    for (const baseUrl of ['mailto:someone@example.com', 'http://[']) {
      player.loadReel(abc({ music: MUSIC }), BASE);
      assert.throws(() => player.loadReel(abc({ music: MUSIC }), baseUrl), (err: unknown) => {
        assert.ok(err instanceof ReelLoadError, baseUrl);
        assert.match(err.message, /^Could not resolve the media URLs: /);
        assert.equal(err.errors.length, 1);
        return true;
      });
      assert.equal(player.state, 'empty', baseUrl);
      assert.equal(player.reel, null, baseUrl);
    }
  });

  test('replaces a playing reel: the new one is ready at its start, with nothing left of the old one', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    await advance(4000);
    const log = record(player);
    player.loadReel(reelOf([slide('x', 2), slide('y', 2)]), BASE);
    assert.deepEqual(log, ['slide:x', 'state:ready']);
    assert.equal(player.currentTime, 0);
    assert.deepEqual(shownSlides(host), ['x']);
    await advance(3000);
    assert.equal(player.currentTime, 0);
    assert.deepEqual(log, ['slide:x', 'state:ready']);
  });

  test('autoplay starts playing as soon as the reel is loaded', TIMEOUT, async () => {
    const { player } = createPlayer({ autoplay: true });
    const log = record(player);
    player.loadReel(abc(), BASE);
    assert.deepEqual(log, ['slide:a', 'state:ready', 'state:playing']);
    await advance(1000);
    near(player.currentTime, 1);
  });
});

// --- load() ----------------------------------------------------------------------------------------

describe('load()', () => {
  test('fetches relative to the page, goes loading → ready, and resolves media against the response URL', TIMEOUT, async () => {
    const { player } = createPlayer();
    const log = record(player);
    const loading = player.load('reels/fox/reel.json');
    assert.equal(player.state, 'loading');
    assert.equal(network.requests.length, 1);
    assert.equal(network.requests[0].url, 'https://example.com/app/reels/fox/reel.json');
    assert.ok(network.requests[0].signal instanceof AbortSignal);
    network.requests[0].respond(abc({ music: MUSIC }), { url: 'https://cdn.example.com/fox/reel.json' }); // redirected
    await loading;
    assert.equal(player.state, 'ready');
    assert.deepEqual(log, ['state:loading', 'slide:a', 'state:ready']);
    assert.equal(player.reel?.id, 'https://cdn.example.com/fox/reel.json');
    assert.equal(player.reel?.music?.src, 'https://cdn.example.com/fox/media/music.mp3');
  });

  test('an HTTP error rejects with ReelLoadError and the state becomes empty', TIMEOUT, async () => {
    const { player } = createPlayer();
    const loading = player.load('reels/missing/reel.json');
    network.requests[0].respond({}, { status: 404 });
    await assert.rejects(loading, (err: unknown) => {
      assert.ok(err instanceof ReelLoadError);
      assert.equal(err.message, 'Could not load https://example.com/app/reels/missing/reel.json: HTTP 404');
      assert.deepEqual(err.errors, ['HTTP 404']);
      return true;
    });
    assert.equal(player.state, 'empty');
  });

  test('a network error or a body that is not JSON rejects with ReelLoadError', TIMEOUT, async () => {
    const { player } = createPlayer();
    const failed = player.load(BASE);
    network.requests[0].fail(new TypeError('fetch failed'));
    await assert.rejects(failed, { name: 'ReelLoadError', errors: ['fetch failed'] });
    assert.equal(player.state, 'empty');
    const notJson = player.load(BASE);
    network.requests[1].respondText('<!doctype html><title>Not found</title>');
    await assert.rejects(notJson, { name: 'ReelLoadError' });
    assert.equal(player.state, 'empty');
  });

  test('a document that is not valid reel/1 rejects with the validation errors', TIMEOUT, async () => {
    const { player } = createPlayer();
    const loading = player.load(BASE);
    network.requests[0].respond({ format: 'reel/1', slides: [] });
    await assert.rejects(loading, (err: unknown) => {
      assert.ok(err instanceof ReelLoadError);
      assert.match(err.message, /^The reel is not valid reel\/1: /);
      assert.ok(err.errors.length > 0);
      return true;
    });
    assert.equal(player.state, 'empty');
  });

  test('a malformed URL rejects with ReelLoadError instead of staying in loading', TIMEOUT, async () => {
    const { player } = createPlayer();
    await assert.rejects(player.load('http://['), { name: 'ReelLoadError' });
    assert.equal(player.state, 'empty');
    assert.equal(network.requests.length, 0);
  });

  test('a newer load() aborts the running one, which resolves without changing anything', TIMEOUT, async () => {
    const { player } = createPlayer();
    const first = player.load('reels/a/reel.json');
    const second = player.load('https://example.com/reels/b/reel.json');
    assert.deepEqual(await settled(first), RESOLVED);
    assert.equal(network.requests[0].signal?.aborted, true);
    assert.equal(network.requests[1].signal?.aborted, false);
    assert.equal(player.state, 'loading');
    network.requests[1].respond(abc());
    await second;
    assert.equal(player.state, 'ready');
    assert.equal(player.reel?.id, 'https://example.com/reels/b/reel.json');
  });

  test('a newer load() wins also when older downloads fail or answer anyway', TIMEOUT, async () => {
    const { player } = createPlayer();
    network.honourAbort = false; // the requests end on their own after the abort
    const failing = player.load('reels/a/reel.json');
    const late = player.load('reels/b/reel.json');
    const latest = player.load('reels/c/reel.json');
    network.requests[0].fail();
    network.requests[1].respond(reelOf([slide('late', 2)]));
    assert.deepEqual(await settled(failing), RESOLVED);
    assert.deepEqual(await settled(late), RESOLVED);
    assert.equal(player.state, 'loading');
    assert.equal(player.duration, 0, 'no reel loaded yet');
    network.requests[2].respond(abc());
    await latest;
    assert.equal(player.state, 'ready');
    assert.equal(player.reel?.id, 'https://example.com/app/reels/c/reel.json');
  });

  test('loadReel() aborts a running load(), which resolves even when its download fails', TIMEOUT, async () => {
    const { player } = createPlayer();
    network.honourAbort = false; // the request ends on its own after the abort
    const loading = player.load('reels/a/reel.json');
    player.loadReel(abc(), BASE);
    network.requests[0].fail();
    assert.deepEqual(await settled(loading), RESOLVED);
    assert.equal(network.requests[0].signal?.aborted, true);
    assert.equal(player.state, 'ready');
    assert.equal(player.reel?.id, BASE);
  });

  test('loadReel() aborts a running load(), whose late response changes nothing', TIMEOUT, async () => {
    const { player } = createPlayer();
    network.honourAbort = false;
    const log = record(player);
    const loading = player.load('reels/a/reel.json');
    player.loadReel(abc(), BASE);
    network.requests[0].respond(reelOf([slide('late', 2)]));
    assert.deepEqual(await settled(loading), RESOLVED);
    assert.equal(player.reel?.id, BASE);
    assert.deepEqual(player.currentSlide, { index: 0, id: 'a' });
    assert.deepEqual(log, ['state:loading', 'slide:a', 'state:ready']);
  });

  test('destroy() aborts a running load(), which resolves', TIMEOUT, async () => {
    const { player } = createPlayer();
    const log = record(player);
    const loading = player.load(BASE);
    player.destroy();
    assert.deepEqual(await settled(loading), RESOLVED);
    assert.equal(network.requests[0].signal?.aborted, true);
    assert.equal(player.state, 'empty');
    assert.deepEqual(log, ['state:loading']);
  });

  test('a statechange listener that loads another reel on "loading" wins over the load()', TIMEOUT, async () => {
    const { player } = createPlayer();
    const off = player.on('statechange', s => { if (s === 'loading') { off(); player.loadReel(abc(), BASE); } });
    const loading = player.load('reels/a/reel.json');
    assert.equal(network.requests.length, 0, 'nothing is downloaded');
    assert.deepEqual(await settled(loading), RESOLVED);
    assert.equal(player.state, 'ready');
    assert.equal(player.reel?.id, BASE);
  });

  test('load() and loadReel() fail after destroy()', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.destroy();
    await assert.rejects(player.load(BASE), /destroyed/);
    assert.throws(() => player.loadReel(abc(), BASE), /destroyed/);
  });
});

// --- Playback --------------------------------------------------------------------------------------

describe('playback', () => {
  test('play() plays the slides in real time; currentTime and currentSlide follow the clock', TIMEOUT, async () => {
    const { player, host } = createPlayer({}, makeHost());
    player.loadReel(abc(), BASE);
    player.play();
    assert.equal(player.state, 'playing');
    await advance(1000);
    near(player.currentTime, 1);
    assert.equal(player.currentSlide?.id, 'a');
    await advance(2500);
    near(player.currentTime, 3.5);
    assert.deepEqual(player.currentSlide, { index: 1, id: 'b' });
    assert.ok(shownSlides(host).includes('b'));
  });

  test('a full playback fires statechange, slidechange, slideshown and ended in order', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 2), slide('b', 2)]), BASE);
    const log = record(player);
    player.play();
    await advance(5000);
    assert.deepEqual(log, ['state:playing', 'shown:a', 'slide:b', 'shown:b', 'state:ended', 'ended']);
    assert.equal(player.state, 'ended');
    assert.equal(player.currentTime, 4);
    assert.equal(player.currentSlide?.id, 'b');
  });

  test('slideshown reports the slide id, the seconds shown and whether its audio played', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 2, { audio: [{ src: 'media/n.mp3', duration: 1 }] }), slide('b', 2)]), BASE);
    const shown: unknown[] = [];
    player.on('slideshown', s => shown.push(s));
    player.play();
    await advance(4100);
    assert.deepEqual(shown, [
      { slideId: 'a', seconds: 2, audioPlayed: true, reel: player.reel },
      { slideId: 'b', seconds: 2, audioPlayed: false, reel: player.reel },
    ]);
    // Started in the middle of a slide: only the part that was shown counts, and the narration was skipped.
    shown.length = 0;
    player.seek(0.5);
    player.play();
    await advance(1600);
    assert.deepEqual(shown, [{ slideId: 'a', seconds: 1.5, audioPlayed: false, reel: player.reel }]);
  });

  test('pause() freezes the position and play() resumes from there', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    const log = record(player);
    player.play();
    await advance(1500);
    player.pause();
    assert.equal(player.state, 'paused');
    near(player.currentTime, 1.5);
    await advance(5000);
    near(player.currentTime, 1.5);
    player.play();
    await advance(1000);
    near(player.currentTime, 2.5);
    assert.deepEqual(log, ['state:playing', 'state:paused', 'state:playing']);
  });

  test('pause() does nothing unless playing', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    const log = record(player);
    player.pause();
    assert.equal(player.state, 'ready');
    assert.deepEqual(log, []);
  });

  test('play() while playing does nothing', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    await advance(1000);
    const log = record(player);
    player.play();
    near(player.currentTime, 1);
    assert.deepEqual(log, []);
  });

  test('stop() goes back to the start, ready', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    await advance(4000);
    const log = record(player);
    player.stop();
    assert.deepEqual(log, ['slide:a', 'state:ready']);
    assert.equal(player.currentTime, 0);
    assert.deepEqual(shownSlides(host), ['a']);
    await advance(3000);
    assert.equal(player.currentTime, 0);
  });

  test('seek() while not playing shows that frame, paused; seek(0) is ready', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    const log = record(player);
    player.seek(4);
    assert.equal(player.state, 'paused');
    assert.equal(player.currentTime, 4);
    assert.deepEqual(player.currentSlide, { index: 1, id: 'b' });
    assert.deepEqual(shownSlides(host), ['b']);
    await advance(2000);
    assert.equal(player.currentTime, 4);
    player.seek(0);
    assert.equal(player.state, 'ready');
    assert.deepEqual(log, ['slide:b', 'state:paused', 'slide:a', 'state:ready']);
  });

  test('seek() while playing keeps playing from the new time', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    await advance(500);
    const log = record(player);
    player.seek(5);
    assert.equal(player.state, 'playing');
    near(player.currentTime, 5);
    await advance(500);
    near(player.currentTime, 5.5);
    assert.deepEqual(log, ['slide:b']);
  });

  test('seek() clamps to the reel: negative and NaN go to the start, past the end to the end', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.seek(4);
    player.seek(-5);
    assert.equal(player.currentTime, 0);
    assert.equal(player.state, 'ready');
    player.seek(4);
    player.seek(Number.NaN);
    assert.equal(player.currentTime, 0);
    player.seek(100);
    assert.equal(player.currentTime, 9);
    assert.equal(player.state, 'ended');
  });

  test('seekToSlide() goes to the start of a slide by index or by id', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.seekToSlide(2);
    assert.equal(player.currentTime, 6);
    assert.deepEqual(player.currentSlide, { index: 2, id: 'c' });
    player.seekToSlide('b');
    assert.equal(player.currentTime, 3);
    assert.deepEqual(player.currentSlide, { index: 1, id: 'b' });
  });

  test('seekToSlide() throws RangeError for an unknown id, an index out of range, a fraction or NaN', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.seekToSlide(1);
    for (const bad of ['nope', -1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => player.seekToSlide(bad), RangeError, String(bad));
    }
    assert.equal(player.currentTime, 3, 'the position is unchanged');
  });

  test('next() goes to the start of the following slide', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.seek(1);
    player.next();
    assert.equal(player.currentTime, 3);
    player.next();
    assert.equal(player.currentTime, 6);
    assert.equal(player.state, 'paused');
  });

  test('next() on the last slide while not playing shows the end: state ended, no ended event', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.seekToSlide(2);
    const log = record(player);
    player.next();
    assert.equal(player.state, 'ended');
    assert.equal(player.currentTime, 9);
    assert.deepEqual(log, ['state:ended']);
  });

  test('next() on the last slide while playing ends the reel and fires ended', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.seekToSlide(2);
    player.play();
    await advance(100);
    const log = record(player);
    player.next();
    assert.equal(player.state, 'ended');
    assert.deepEqual(log.filter(e => !e.startsWith('shown:')), ['state:ended', 'ended']);
  });

  test('previous() goes to the start of this slide, or of the previous one within 1.5 s of its start', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.seek(4); // 1 s into b
    player.previous();
    assert.equal(player.currentTime, 0);
    player.seek(5); // 2 s into b
    player.previous();
    assert.equal(player.currentTime, 3);
    player.seek(4.5); // exactly 1.5 s into b
    player.previous();
    assert.equal(player.currentTime, 3);
    player.seek(0.5); // on the first slide
    player.previous();
    assert.equal(player.currentTime, 0);
  });

  test('seekToEnd() while not playing shows the end: state ended, no ended or slideshown', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    const log = record(player);
    player.seekToEnd();
    assert.equal(player.state, 'ended');
    assert.equal(player.currentTime, 9);
    assert.deepEqual(log, ['slide:c', 'state:ended']);
  });
});

// --- Fixes in 1.0.1: ended, slideshown and the end of the reel ---------------------------------

describe('the end of the reel', () => {
  test('ended and slideshown fire only during playback: seeks while not playing fire neither', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    const log = record(player);
    player.seekToEnd();
    player.seekToEnd();
    player.next();
    player.seek(8.8);
    player.seek(5.9);
    player.stop();
    player.seekToEnd();
    assert.equal(count(log, 'ended'), 0);
    assert.equal(log.filter(e => e.startsWith('shown:')).length, 0, log.join());
  });

  test('seekToEnd() while playing: slidechange, then statechange ended, then ended, once', TIMEOUT, () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    const log = record(player);
    player.seekToEnd();
    assert.deepEqual(log.filter(e => !e.startsWith('shown:')), ['slide:c', 'state:ended', 'ended']);
    assert.equal(player.currentTime, 9);
  });

  test('ended does not repeat when seeking at the end', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    const log = record(player);
    player.play();
    await advance(9100);
    assert.equal(count(log, 'ended'), 1);
    player.seekToEnd();
    player.seekToEnd();
    player.next();
    assert.equal(count(log, 'ended'), 1);
    assert.equal(player.state, 'ended');
  });

  test('an ended listener that seeks to the end again does not recurse', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    let calls = 0;
    player.on('ended', () => {
      if (++calls > 10) return; // the old behaviour: recursion until the stack overflows
      player.seekToEnd();
      player.seek(player.duration - 0.05);
      player.seek(player.duration);
    });
    player.play();
    await advance(10_000);
    assert.equal(calls, 1);
    assert.equal(player.state, 'ended');
  });

  test('an ended listener that reloads the reel and seeks near its end does not recurse', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    let calls = 0;
    player.on('ended', () => {
      if (++calls > 10) return;
      player.loadReel(abc(), BASE);
      // Within the last 50 ms, which the engine counts as the end of the reel (8.95 would not be:
      // 8.95 - 6 is a little under 2.95 in floating point).
      player.seek(8.97);
    });
    player.play();
    await advance(10_000);
    assert.equal(calls, 1);
    assert.equal(player.state, 'ended', 'the seek while not playing showed the end');
  });

  test('an ended listener may play the reel again', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 1), slide('b', 1)]), BASE);
    const log = record(player);
    let calls = 0;
    player.on('ended', () => { if (++calls < 3) player.play(); });
    player.play();
    await advance(7000);
    assert.equal(calls, 3);
    assert.equal(player.state, 'ended');
    assert.deepEqual(log.filter(e => e.startsWith('state:') || e === 'ended'), [
      'state:playing', 'state:ended', 'ended', 'state:playing', 'state:ended', 'ended', 'state:playing', 'state:ended', 'ended',
    ]);
  });

  test('play() after the end starts again from the first slide', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    await advance(9100);
    const log = record(player);
    player.play();
    assert.deepEqual(log, ['slide:a', 'state:playing']);
    assert.equal(player.currentTime, 0);
    assert.deepEqual(shownSlides(host), ['a']);
    await advance(1000);
    near(player.currentTime, 1);
  });

  test('seek() after the end shows that frame, paused, and play() continues from there', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 2)]), BASE);
    player.play();
    await advance(2100);
    assert.equal(player.state, 'ended');
    player.seek(0.5);
    assert.equal(player.state, 'paused');
    player.play();
    await advance(100);
    assert.equal(player.state, 'playing');
    near(player.currentTime, 0.6);
  });

  test('play() right after a pause in the last moment ends the reel instead of getting stuck', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 1)]), BASE);
    const log = record(player);
    player.play();
    await advance(970);
    player.pause();
    player.play();
    await advance(500);
    assert.equal(player.state, 'ended');
    assert.equal(count(log, 'ended'), 1);
  });

  test('with loop, play() right after a pause in the last moment starts again', TIMEOUT, async () => {
    const { player } = createPlayer({ loop: true });
    player.loadReel(reelOf([slide('a', 1)]), BASE);
    player.play();
    await advance(970);
    player.pause();
    player.play();
    await advance(500);
    assert.equal(player.state, 'playing');
    near(player.currentTime, 0.5);
  });

  test('the music and looping videos stop at the end', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(reelOf([
      slide('a', 1),
      slide('b', 2, { layers: [{ type: 'video', src: 'media/loop.mp4', duration: 1, loop: true }] }),
    ], { music: MUSIC }), BASE);
    player.play();
    await advance(2000); // 1 s into b: the video has played once and loops
    const video = videoOf(host);
    const plays = playsOf('loop.mp4').length;
    video.dispatch('ended');
    assert.equal(playsOf('loop.mp4').length, plays + 1, 'while playing, the video loops');
    await advance(1100);
    assert.equal(player.state, 'ended');
    assert.equal(mediaOf('music.mp3')?.paused, true, 'the music is paused');
    assert.equal(video.paused, true, 'the video is paused');
    const calls = media.calls.length;
    video.dispatch('ended');
    player.pause();
    await advance(5000);
    assert.equal(media.calls.length, calls, 'nothing plays after the end');
    assert.equal(mediaOf('music.mp3')?.paused, true);
  });

  test('a looping video stops when the reel ends right after play() in its last moment', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(reelOf([slide('a', 2, { layers: [{ type: 'video', src: 'media/loop.mp4', duration: 0.5, loop: true }] })]), BASE);
    player.play();
    await advance(1970);
    player.pause();
    player.play(); // the end is reached at once, while the video is still inside its time window
    await flush();
    const video = videoOf(host);
    assert.equal(video.paused, true, 'the video is paused');
    const plays = playsOf('loop.mp4').length;
    video.dispatch('ended');
    await advance(1000);
    assert.equal(playsOf('loop.mp4').length, plays, 'the video does not loop after the end');
    assert.equal(player.state, 'ended');
  });
});

// --- Loop ------------------------------------------------------------------------------------------

describe('loop', () => {
  test('the reel starts again at the end, without ended', TIMEOUT, async () => {
    const { player } = createPlayer({ loop: true });
    player.loadReel(reelOf([slide('a', 1), slide('b', 1)]), BASE);
    const log = record(player);
    player.play();
    await advance(2500);
    assert.equal(player.state, 'playing');
    near(player.currentTime, 0.5);
    assert.equal(player.currentSlide?.id, 'a');
    assert.deepEqual(log, ['state:playing', 'shown:a', 'slide:b', 'shown:b', 'slide:a']);
    await advance(10_000);
    assert.equal(player.state, 'playing');
    assert.equal(count(log, 'ended'), 0);
    assert.ok(pendingTimers() <= 3, `timers do not pile up (${pendingTimers()})`);
  });

  test('next() on the last slide while playing goes to the first slide', TIMEOUT, () => {
    const { player } = createPlayer({ loop: true });
    player.loadReel(abc(), BASE);
    player.seekToSlide('c');
    player.play();
    const log = record(player);
    player.next();
    assert.equal(player.state, 'playing');
    assert.deepEqual(player.currentSlide, { index: 0, id: 'a' });
    assert.equal(count(log, 'ended'), 0);
  });

  test('next() on the last slide while paused still shows the end', TIMEOUT, () => {
    const { player } = createPlayer({ loop: true });
    player.loadReel(abc(), BASE);
    player.seekToSlide('c');
    player.next();
    assert.equal(player.state, 'ended');
  });

  test('play() after the end starts again and keeps looping', TIMEOUT, async () => {
    const { player } = createPlayer({ loop: true });
    player.loadReel(reelOf([slide('a', 1), slide('b', 1)]), BASE);
    player.seekToEnd();
    assert.equal(player.state, 'ended');
    player.play();
    await advance(5500);
    assert.equal(player.state, 'playing');
    near(player.currentTime, 1.5);
  });
});

// --- Listeners that call the player (fixes in 1.0.1) ----------------------------------------------

describe('listeners calling the player', () => {
  /** Plays narrated() and runs `action` from the first slideshown (slide a, at 2 s). */
  const fromSlideshown = async (action: (player: Player) => void, t: TestContext) => {
    const consoleError = t.mock.method(console, 'error', () => {});
    const { player, host } = createPlayer();
    player.loadReel(narrated(), BASE);
    let fired = 0;
    player.on('slideshown', () => { if (!fired++) action(player); });
    player.play();
    await advance(2100);
    assert.equal(fired, 1);
    assert.equal(consoleError.mock.callCount(), 0, 'no listener threw');
    assert.equal(playsOf('n2.mp3').length, 0, 'the next slide did not start');
    return { player, host };
  };

  test('destroy() from slideshown: nothing is left and nothing throws', TIMEOUT, async t => {
    const { player, host } = await fromSlideshown(p => p.destroy(), t);
    assert.equal(player.state, 'empty');
    assert.deepEqual(host.children, []);
    assert.equal(pendingTimers(), 0);
  });

  test('loadReel() from slideshown: only the new reel is on the canvas, ready', TIMEOUT, async t => {
    const { player, host } = await fromSlideshown(p => p.loadReel(reelOf([slide('x', 2), slide('y', 2)]), BASE), t);
    assert.equal(player.state, 'ready');
    assert.deepEqual(player.currentSlide, { index: 0, id: 'x' });
    assert.deepEqual(shownSlides(host), ['x']);
  });

  test('load() from slideshown: the canvas is cleared while loading, then the new reel is ready', TIMEOUT, async t => {
    let loading: Promise<void> | undefined;
    const { player, host } = await fromSlideshown(p => { loading = p.load('https://example.com/other/reel.json'); }, t);
    assert.equal(player.state, 'loading');
    assert.deepEqual(shownSlides(host), []);
    network.requests[0].respond(reelOf([slide('x', 2)]));
    await loading;
    assert.equal(player.state, 'ready');
    assert.deepEqual(shownSlides(host), ['x']);
  });

  test('seek(0) from slideshown: the reel plays again from the first slide, alone on the canvas', TIMEOUT, async t => {
    const { player, host } = await fromSlideshown(p => p.seek(0), t);
    assert.equal(player.state, 'playing');
    assert.equal(player.currentSlide?.id, 'a');
    near(player.currentTime, 0.1);
    assert.deepEqual(shownSlides(host), ['a']);
  });

  test('stop() from slideshown: ready at the first slide, alone on the canvas', TIMEOUT, async t => {
    const { player, host } = await fromSlideshown(p => p.stop(), t);
    assert.equal(player.state, 'ready');
    assert.equal(player.currentTime, 0);
    assert.deepEqual(shownSlides(host), ['a']);
  });

  test('pause() from slideshown holds the slide that just ended; next() goes on to the following slide', TIMEOUT, async t => {
    const { player, host } = await fromSlideshown(p => p.pause(), t);
    assert.equal(player.state, 'paused');
    assert.equal(player.currentSlide?.id, 'a');
    assert.ok(player.currentTime < 2 && player.currentTime > 1.99, String(player.currentTime));
    assert.deepEqual(shownSlides(host), ['a']);
    player.next();
    assert.deepEqual(player.currentSlide, { index: 1, id: 'b' });
    assert.equal(player.currentTime, 2);
    assert.deepEqual(shownSlides(host), ['b']);
  });

  test('pause() from slideshown, then play() goes on to the following slide with its narration', TIMEOUT, async t => {
    const { player } = await fromSlideshown(p => p.pause(), t);
    player.play();
    await advance(100);
    assert.equal(player.currentSlide?.id, 'b');
    assert.equal(playsOf('n2.mp3').filter(c => c.result === 'ok').length, 1);
  });

  test('pause() after every slide stops at each slide in turn, then the reel ends', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    const log = record(player);
    player.on('slideshown', () => player.pause());
    player.play();
    const stops: string[] = [];
    for (let i = 0; i < 4; i++) {
      await advance(3500);
      stops.push(`${player.state} ${player.currentSlide?.id} ${shownSlides(host).at(-1)}`);
      if (player.state !== 'ended') player.play();
    }
    assert.deepEqual(stops, ['paused a a', 'paused b b', 'paused c c', 'ended c c']);
    assert.deepEqual(log.filter(e => !e.startsWith('state:p')), ['shown:a', 'slide:b', 'shown:b', 'slide:c', 'shown:c', 'state:ended', 'ended']);
  });

  test('destroy() from the last slideshown: no ended, nothing throws', TIMEOUT, async t => {
    const consoleError = t.mock.method(console, 'error', () => {});
    const { player, host } = createPlayer();
    player.loadReel(reelOf([slide('a', 1)]), BASE);
    let ended = 0;
    player.on('ended', () => ended++);
    player.on('slideshown', () => player.destroy());
    player.play();
    await advance(2000);
    assert.equal(ended, 0);
    assert.equal(consoleError.mock.callCount(), 0);
    assert.deepEqual(host.children, []);
    assert.equal(player.state, 'empty', 'the end reached after destroy() does not change the state');
    assert.equal(player.currentSlide, null);
  });

  test('pause() from slidechange during next() while playing is respected', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    await advance(500);
    const off = player.on('slidechange', () => player.pause());
    player.next();
    off();
    assert.equal(player.state, 'paused');
    await advance(1000);
    assert.equal(player.currentTime, 3);
    player.play();
    await advance(1000);
    near(player.currentTime, 4);
  });

  test('play() from slidechange during a seek while paused is respected', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.seek(1);
    const off = player.on('slidechange', () => player.play());
    player.seekToSlide(1);
    off();
    assert.equal(player.state, 'playing');
    await advance(500);
    near(player.currentTime, 3.5);
  });

  test('pause() from statechange during play() after the end is respected', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 1), slide('b', 1)]), BASE);
    player.play();
    await advance(2100);
    assert.equal(player.state, 'ended');
    const off = player.on('statechange', s => { if (s === 'playing') { off(); player.pause(); } });
    player.play();
    assert.equal(player.state, 'paused');
    assert.equal(player.currentTime, 0);
    await advance(1000);
    assert.equal(player.currentTime, 0, 'does not play');
    const log = record(player);
    player.play();
    await advance(3000);
    assert.equal(player.state, 'ended');
    assert.equal(player.currentTime, 2);
    assert.deepEqual(log, ['state:playing', 'shown:a', 'slide:b', 'shown:b', 'state:ended', 'ended']);
  });

  test('seek() from statechange during play() after the end is respected', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 1), slide('b', 1), slide('c', 1)]), BASE);
    player.play();
    await advance(3100);
    const off = player.on('statechange', s => { if (s === 'playing') { off(); player.seek(1.5); } });
    player.play();
    assert.equal(player.state, 'playing');
    assert.equal(player.currentTime, 1.5);
    assert.equal(player.currentSlide?.id, 'b');
    await advance(200);
    near(player.currentTime, 1.7);
  });

  test('play() from statechange during seekToEnd() while playing plays the reel again, and no ended follows', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(abc(), BASE);
    player.play();
    await advance(500);
    const log = record(player);
    const off = player.on('statechange', s => { if (s === 'ended') { off(); player.play(); } });
    player.seekToEnd();
    assert.equal(player.state, 'playing');
    assert.deepEqual(log.filter(e => !e.startsWith('shown:')), ['slide:c', 'state:ended', 'slide:a', 'state:playing']);
    await advance(1000);
    near(player.currentTime, 1);
    assert.equal(count(log, 'ended'), 0);
  });

  test('destroy() from statechange during play() leaves nothing running', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(abc({ music: MUSIC }), BASE);
    player.on('statechange', s => { if (s === 'playing') player.destroy(); });
    player.play();
    await advance(1000);
    assert.equal(player.state, 'empty');
    assert.deepEqual(host.children, []);
    assert.equal(pendingTimers(), 0);
    assert.ok(media.elements.every(el => el.paused));
  });

  test('destroy() from a statechange listener stops the remaining listeners of that event', TIMEOUT, () => {
    const { player } = createPlayer();
    const states: string[] = [];
    player.on('statechange', s => { states.push(`first ${s}`); player.destroy(); });
    player.on('statechange', s => { states.push(`second ${s}`); });
    player.loadReel(abc(), BASE);
    assert.deepEqual(states, ['first ready']);
  });

  test('destroy() from a slideshown listener stops the remaining listeners of that event', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 1), slide('b', 1)]), BASE);
    const calls: string[] = [];
    player.on('slideshown', s => { calls.push(`first ${s.slideId}`); player.destroy(); });
    player.on('slideshown', s => { calls.push(`second ${s.slideId}`); });
    player.play();
    await advance(1100);
    assert.deepEqual(calls, ['first a']);
  });

  test('a listener that throws is logged with console.error and the other listeners still run', TIMEOUT, async t => {
    const consoleError = t.mock.method(console, 'error', () => {});
    const { player } = createPlayer();
    const error = new Error('listener failed');
    player.on('statechange', () => { throw error; });
    const states: string[] = [];
    player.on('statechange', s => states.push(s));
    player.loadReel(abc(), BASE);
    assert.deepEqual(states, ['ready']);
    assert.equal(consoleError.mock.callCount(), 1);
    assert.equal(consoleError.mock.calls[0].arguments[0], error);
  });

  test('on() returns a function that stops listening', TIMEOUT, () => {
    const { player } = createPlayer();
    const states: string[] = [];
    const off = player.on('statechange', s => states.push(s));
    player.loadReel(abc(), BASE);
    off();
    player.play();
    assert.deepEqual(states, ['ready']);
  });
});

// --- Sound -----------------------------------------------------------------------------------------

describe('sound', () => {
  /** Slide a: a video with sound, narration and music; slide b: nothing. */
  const withSound = () => reelOf([
    slide('a', 4, {
      layers: [{ type: 'video', src: 'media/v.mp4', duration: 10, muted: false }],
      audio: [{ src: 'media/n.mp3', duration: 2 }],
    }),
    slide('b', 4),
  ], { music: MUSIC });

  test('a still frame starts no media, also while sound is blocked (after loadReel, a seek while paused and stop)', TIMEOUT, async () => {
    for (const allowSound of [true, false]) {
      media.allowSound = allowSound;
      const sound = allowSound ? 'sound allowed' : 'sound blocked';
      const { player, host } = createPlayer();
      const assertStill = async (when: string) => {
        await flush();
        assert.ok(media.elements.every(el => el.paused), `every audio and video element is paused ${when}, ${sound}`);
        assert.equal(videoOf(host).muted, false, `the video keeps its sound ${when}, ${sound}`);
      };
      player.loadReel(withSound(), BASE);
      assert.ok(media.elements.length >= 3);
      await assertStill('after loadReel()');
      player.seek(1);
      await assertStill('after seek()');
      player.play();
      await advance(500);
      player.stop();
      await assertStill('after stop()');
      player.destroy();
    }
  });

  test('blocked sound in a still frame: no audioblocked, the video keeps its sound, and play() plays the first narration', TIMEOUT, async () => {
    media.allowSound = false;
    const { player, host } = createPlayer();
    const log = record(player);
    player.loadReel(withSound(), BASE);
    await flush();
    const video = videoOf(host);
    assert.equal(video.paused, true);
    assert.equal(video.muted, false);
    assert.equal(count(log, 'audioblocked'), 0);
    media.allowSound = true; // the click on the page's play button allows sound
    const before = media.calls.length;
    player.play();
    await flush();
    const calls = media.calls.slice(before);
    assert.ok(calls.some(c => c.src.endsWith('n.mp3') && c.result === 'ok'), 'the narration plays');
    assert.ok(calls.some(c => c.src.endsWith('v.mp4') && c.result === 'ok' && !c.muted), 'the video plays with sound');
    assert.ok(calls.some(c => c.src.endsWith('music.mp3') && c.result === 'ok'), 'the music plays');
    assert.equal(count(log, 'audioblocked'), 0);
  });

  test('blocked sound during playback fires audioblocked once; the video plays muted, the narration is skipped', TIMEOUT, async () => {
    media.allowSound = false;
    const { player, host } = createPlayer();
    const log = record(player);
    player.loadReel(withSound(), BASE);
    player.play();
    await advance(1000);
    assert.equal(count(log, 'audioblocked'), 1);
    const video = videoOf(host);
    assert.equal(video.muted, true);
    assert.equal(video.paused, false, 'the video plays without sound');
    assert.ok(playsOf('n.mp3').every(c => c.result === 'refused'));
  });

  test('unlockAudio() brings back music and video sound; the refused narration stays skipped', TIMEOUT, async () => {
    media.allowSound = false;
    const { player, host } = createPlayer();
    const log = record(player);
    player.loadReel(withSound(), BASE);
    player.play();
    await advance(500);
    const narrations = playsOf('n.mp3').length;
    media.allowSound = true;
    player.unlockAudio();
    await flush();
    assert.equal(mediaOf('music.mp3')?.paused, false, 'the music plays');
    assert.equal(playsOf('music.mp3').at(-1)?.result, 'ok');
    assert.equal(videoOf(host).muted, false, 'the video has its sound back');
    player.pause();
    player.play();
    await advance(500);
    assert.equal(playsOf('n.mp3').length, narrations, 'the narration is not started in the middle');
    assert.equal(count(log, 'audioblocked'), 1);
  });

  test('unlockAudio() does nothing when sound is not blocked', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(withSound(), BASE);
    player.play();
    await advance(500);
    const calls = media.calls.length;
    player.unlockAudio();
    await flush();
    assert.equal(media.calls.length, calls);
  });

  test('audioblocked fires when the reel was loaded again while sound was blocked', TIMEOUT, async () => {
    media.allowSound = false;
    const { player } = createPlayer();
    const log = record(player);
    player.loadReel(withSound(), BASE);
    await flush();
    player.loadReel(withSound(), BASE);
    await flush();
    assert.equal(count(log, 'audioblocked'), 0);
    player.play();
    await flush();
    assert.equal(count(log, 'audioblocked'), 1);
  });

  test('a mouse press, the end of a touch or pen tap, and a key press unlock sound', TIMEOUT, t => {
    const { player, host } = createPlayer();
    const unlock = t.mock.method(player, 'unlockAudio');
    const calls = () => unlock.mock.callCount();
    host.dispatch('pointerdown', { pointerType: 'mouse' });
    assert.equal(calls(), 1, 'mouse pointerdown');
    host.dispatch('pointerup', { pointerType: 'mouse' });
    assert.equal(calls(), 1, 'mouse pointerup does not count again');
    host.dispatch('pointerdown', { pointerType: 'touch' });
    assert.equal(calls(), 1, 'touch pointerdown is not a user gesture');
    host.dispatch('pointerup', { pointerType: 'touch' });
    assert.equal(calls(), 2, 'touch pointerup');
    host.dispatch('pointerdown', { pointerType: 'pen' });
    host.dispatch('pointerup', { pointerType: 'pen' });
    assert.equal(calls(), 3, 'pen pointerup');
    fakeDocument.dispatch('keydown', { key: ' ' });
    assert.equal(calls(), 4, 'keydown anywhere in the page');
  });

  test('a tap on a touch screen plays the music the browser refused', TIMEOUT, async () => {
    media.allowSound = false;
    const { player, host } = createPlayer();
    const log = record(player);
    player.loadReel(reelOf([slide('a', 4)], { music: MUSIC }), BASE);
    player.play();
    await flush();
    assert.equal(count(log, 'audioblocked'), 1);
    // A tap starts with pointerdown, which browsers do not count as a user gesture on a touch screen:
    // sound is still blocked then.
    host.dispatch('pointerdown', { pointerType: 'touch' });
    await flush();
    // The end of the tap counts.
    media.allowSound = true;
    host.dispatch('pointerup', { pointerType: 'touch' });
    await flush();
    assert.equal(mediaOf('music.mp3')?.paused, false, 'the music plays');
    assert.equal(playsOf('music.mp3').at(-1)?.result, 'ok');
    assert.equal(count(log, 'audioblocked'), 1, 'pointerdown did not try to unlock (and fail) again');
  });

  test('unlockAudioOnInteraction: false leaves unlocking to the app', TIMEOUT, t => {
    const { player, host } = createPlayer({ unlockAudioOnInteraction: false });
    const unlock = t.mock.method(player, 'unlockAudio');
    host.dispatch('pointerdown', { pointerType: 'mouse' });
    host.dispatch('pointerup', { pointerType: 'touch' });
    fakeDocument.dispatch('keydown', { key: 'Enter' });
    assert.equal(unlock.mock.callCount(), 0);
  });

  test('the music is lowered while narration plays and comes back when it ends', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 4, { audio: [{ src: 'media/n.mp3', duration: 2 }] })], { music: MUSIC }), BASE);
    player.play();
    await advance(400);
    const music = mediaOf('music.mp3')!;
    near(music.volume, 0.08);
    mediaOf('n.mp3')!.dispatch('ended');
    await advance(400);
    near(music.volume, 0.25);
  });

  test('a missing file is reported once with an error event, and playback goes on', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    const errors: unknown[] = [];
    player.on('error', e => errors.push(e));
    player.loadReel(reelOf([slide('a', 4, {
      layers: [{ type: 'image', src: 'media/gone.jpg' }, { type: 'image', src: 'media/gone.jpg', x: 50 }],
    })], { music: MUSIC }), BASE);
    player.play();
    const images = host.byTag('img');
    for (const img of images) img.dispatch('error');
    assert.deepEqual(errors, [{ kind: 'media-missing', src: 'https://cdn.example.com/reels/test/media/gone.jpg', slideId: 'a', fatal: false }]);
    assert.ok(images.every(img => img.style.visibility === 'hidden'), 'no broken-image icon');
    mediaOf('music.mp3')!.dispatch('error');
    assert.deepEqual(errors[1], { kind: 'media-missing', src: 'https://cdn.example.com/reels/test/media/music.mp3', fatal: false });
    await advance(1000);
    assert.equal(player.state, 'playing');
    near(player.currentTime, 1);
  });
});

// --- Layout ----------------------------------------------------------------------------------------

describe('layout', () => {
  const canvasSize = (host: FakeElement) => {
    const { style } = canvasOf(host);
    return [style.width, style.height, style.getPropertyValue('--reel-h')];
  };

  test('the canvas is 16:9, letterboxed or pillarboxed in the host', TIMEOUT, () => {
    const { player, host } = createPlayer({}, makeHost(640, 480));
    player.loadReel(abc(), BASE);
    assert.deepEqual(canvasSize(host), ['640px', '360px', '360px']);
    const { player: wide, host: wideHost } = createPlayer({}, makeHost(800, 300));
    wide.loadReel(abc(), BASE);
    assert.deepEqual(canvasSize(wideHost), [`${300 * 16 / 9}px`, '300px', '300px']);
  });

  test('a host with padding letterboxes the picture inside the padding', TIMEOUT, () => {
    const host = makeHost(400, 260);
    host.style.padding = '20px 10px 60px 30px'; // content box 360 × 180
    const { player } = createPlayer({}, host);
    player.loadReel(abc(), BASE);
    assert.deepEqual(canvasSize(host), ['320px', '180px', '180px']);
    const tall = makeHost(340, 400);
    tall.style.padding = '10px'; // content box 320 × 380
    const { player: other } = createPlayer({}, tall);
    other.loadReel(abc(), BASE);
    assert.deepEqual(canvasSize(tall), ['320px', '180px', '180px']);
  });

  test('a host without size leaves the canvas alone', TIMEOUT, () => {
    const host = makeHost(0, 0);
    const { player } = createPlayer({}, host);
    player.loadReel(abc(), BASE);
    assert.equal(canvasOf(host).style.width, undefined);
  });

  test('the canvas follows the host when it is resized', TIMEOUT, () => {
    const { player, host } = createPlayer({}, makeHost(320, 180));
    player.loadReel(abc(), BASE);
    host.clientWidth = 1280;
    host.clientHeight = 720;
    FakeResizeObserver.instances.at(-1)!.trigger();
    assert.deepEqual(canvasSize(host), ['1280px', '720px', '720px']);
    host.clientWidth = 640;
    host.clientHeight = 360;
    fakeWindow.dispatch('resize');
    assert.deepEqual(canvasSize(host), ['640px', '360px', '360px']);
  });

  test('the pointer is hidden (reel-idle) after 2.5 s without moving', TIMEOUT, async () => {
    const { host } = createPlayer();
    host.dispatch('pointermove');
    await advance(2499);
    assert.equal(host.classList.contains('reel-idle'), false);
    await advance(1);
    assert.equal(host.classList.contains('reel-idle'), true);
    host.dispatch('pointermove');
    assert.equal(host.classList.contains('reel-idle'), false);
  });
});

// --- Full screen -----------------------------------------------------------------------------------

describe('full screen', () => {
  test('enterFullscreen(), exitFullscreen() and toggleFullscreen()', TIMEOUT, async t => {
    const { player, host } = createPlayer();
    const request = t.mock.method(host, 'requestFullscreen');
    const exit = t.mock.method(fakeDocument, 'exitFullscreen');
    assert.equal(player.isFullscreen, false);
    await player.enterFullscreen();
    assert.equal(player.isFullscreen, true);
    await player.enterFullscreen();
    assert.equal(request.mock.callCount(), 1, 'already full screen');
    await player.exitFullscreen();
    assert.equal(player.isFullscreen, false);
    await player.exitFullscreen();
    assert.equal(exit.mock.callCount(), 1, 'not full screen any more');
    await player.toggleFullscreen();
    assert.equal(player.isFullscreen, true);
    await player.toggleFullscreen();
    assert.equal(player.isFullscreen, false);
  });

  test('isFullscreen is right inside shadow DOM, and toggleFullscreen() leaves full screen there', TIMEOUT, async t => {
    const host = makeHost();
    const shadowRoot = new FakeShadowRoot();
    const shadowHost = new FakeElement('my-player');
    shadowRoot.append(host);
    const { player } = createPlayer({}, host);
    // The browser retargets document.fullscreenElement to the outermost shadow host.
    fakeDocument.fullscreenElement = shadowHost;
    shadowRoot.fullscreenElement = host;
    assert.equal(player.isFullscreen, true);
    const exit = t.mock.method(fakeDocument, 'exitFullscreen', async () => {
      fakeDocument.fullscreenElement = null;
      shadowRoot.fullscreenElement = null;
    });
    await player.toggleFullscreen();
    assert.equal(exit.mock.callCount(), 1);
    assert.equal(player.isFullscreen, false);
  });

  test('enterFullscreen() rejects instead of throwing when the browser has no full screen for elements', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    (host as { requestFullscreen?: unknown }).requestFullscreen = undefined; // iPhone Safari
    let promise: Promise<void> | undefined;
    assert.doesNotThrow(() => { promise = player.enterFullscreen(); });
    await assert.rejects(promise!, /not supported/);
    await assert.rejects(player.toggleFullscreen(), /not supported/);
  });

  test('exitFullscreen() rejects instead of throwing when the browser fails to leave full screen', TIMEOUT, async t => {
    const { player, host } = createPlayer();
    fakeDocument.fullscreenElement = host;
    t.mock.method(fakeDocument, 'exitFullscreen', () => { throw new TypeError('exitFullscreen is not supported'); });
    let promise: Promise<void> | undefined;
    assert.doesNotThrow(() => { promise = player.exitFullscreen(); });
    await assert.rejects(promise!, /not supported/);
    await assert.rejects(player.toggleFullscreen(), /not supported/);
    assert.doesNotThrow(() => player.destroy());
  });

  test('enterFullscreen() rejects when the browser refuses', TIMEOUT, async t => {
    const { player, host } = createPlayer();
    t.mock.method(host, 'requestFullscreen', () => Promise.reject(new TypeError('Permissions check failed')));
    await assert.rejects(player.enterFullscreen(), /Permissions check failed/);
    assert.equal(player.isFullscreen, false);
  });
});

// --- destroy() -------------------------------------------------------------------------------------

describe('destroy()', () => {
  test('stops playback and removes everything: content, classes, listeners, observers and timers', TIMEOUT, async () => {
    const host = makeHost();
    host.className = 'mine';
    const { player } = createPlayer({}, host);
    player.loadReel(reelOf([
      slide('a', 4, { layers: [{ type: 'video', src: 'media/v.mp4', duration: 10, muted: false }], audio: [{ src: 'media/n.mp3', duration: 2 }] }),
      slide('b', 4),
    ], { music: MUSIC }), BASE);
    player.play();
    host.dispatch('pointermove');
    await advance(3000);
    assert.equal(host.classList.contains('reel-idle'), true);
    assert.ok(pendingTimers() > 0);
    player.destroy();
    assert.deepEqual(host.children, []);
    assert.equal(host.className, 'mine');
    assert.equal(pendingTimers(), 0, 'no timers left');
    assert.equal(host.listeners.count(), 0, 'no pointer listeners on the host');
    assert.equal(fakeDocument.listenerCount(), 0, 'no keydown listener on the document');
    assert.equal(fakeWindow.listenerCount(), 0, 'no resize listener on the window');
    assert.ok(FakeResizeObserver.instances.every(o => o.disconnected), 'the ResizeObserver is disconnected');
    assert.ok(media.elements.every(el => el.paused && !el.hasAttribute('src')), 'all media stopped and released');
    assert.equal(player.state, 'empty');
    assert.equal(player.reel, null);
    assert.equal(player.duration, 0);
    assert.equal(player.currentTime, 0);
    assert.equal(player.currentSlide, null);
  });

  test('fires no events, not even slideshown for the slide being left', TIMEOUT, async () => {
    const { player } = createPlayer();
    player.loadReel(reelOf([slide('a', 2)]), BASE);
    player.play();
    await advance(1800); // in the last half second, which counts as shown when the slide is left
    const log = record(player);
    player.destroy();
    await advance(1000);
    assert.deepEqual(log, []);
  });

  test('leaves full screen', TIMEOUT, async t => {
    const { player } = createPlayer();
    await player.enterFullscreen();
    const exit = t.mock.method(fakeDocument, 'exitFullscreen');
    player.destroy();
    assert.equal(exit.mock.callCount(), 1);
    assert.equal(fakeDocument.fullscreenElement, null);
  });

  test('can be called twice, and the player does nothing afterwards', TIMEOUT, async () => {
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    player.destroy();
    player.destroy();
    const log = record(player);
    player.play();
    player.pause();
    player.seek(4);
    player.next();
    player.previous();
    player.stop();
    player.seekToEnd();
    player.unlockAudio();
    await advance(1000);
    assert.equal(player.state, 'empty');
    assert.deepEqual(log, []);
    assert.deepEqual(host.children, []);
  });
});

describe('the slide on screen decides slidechange', () => {
  /** Makes the engine's own timer (its function is called tick) fire 15 ms late, as busy browsers do. */
  const lateEngineTimer = (t: TestContext) => {
    const g = globalThis as unknown as { setTimeout: (fn: () => void, ms?: number) => number };
    const original = g.setTimeout;
    g.setTimeout = (fn, ms = 0) => original(fn, fn.name === 'tick' ? Number(ms) + 15 : ms);
    t.after(() => { g.setTimeout = original; });
  };

  test('slidechange never runs ahead of the picture when the engine timer is late', TIMEOUT, async t => {
    lateEngineTimer(t);
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    const seen: string[] = [];
    player.on('slidechange', s => seen.push(`${s.id}=${shownSlides(host).at(-1)}`));
    player.play();
    await advance(9_100);
    assert.deepEqual(seen, ['b=b', 'c=c']);
  });

  test('pause() from slideshown with a late engine timer keeps currentSlide, time and picture together', TIMEOUT, async t => {
    lateEngineTimer(t);
    const { player, host } = createPlayer();
    player.loadReel(abc(), BASE);
    let fired = 0;
    player.on('slideshown', () => { if (!fired++) player.pause(); });
    player.play();
    await advance(3_100);
    assert.equal(player.state, 'paused');
    assert.equal(player.currentSlide?.id, 'a');
    assert.ok(player.currentTime < 3, String(player.currentTime));
    assert.deepEqual(shownSlides(host), ['a']);
    player.next();
    assert.equal(player.currentSlide?.id, 'b');
  });
});
