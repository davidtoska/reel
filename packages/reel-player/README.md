# reel-player

The **Reel player** for browsers and Electron: the `ReelPlayer` class plays `reel/1` stories – pictures,
drawings, text, narration and music over time – on a 16:9 canvas inside any `HTMLElement` you give it.

```bash
npm install reel-player reel-format
```

`reel-player` depends only on [`reel-format`](https://www.npmjs.com/package/reel-format). Both are ES modules
only (no CommonJS build), and their type definitions need TypeScript 5.0 or newer. See
[Requirements](#requirements) for the browsers it runs in.

## Quick start

```ts
import { ReelPlayer } from 'reel-player';

const host = document.getElementById('screen')!;   // an HTMLElement – not a selector
const player = new ReelPlayer(host);

await player.load('https://example.com/the-little-fox/reel.json');
playButton.onclick = () => player.play();           // from a click, so the browser allows sound
```

### The host element

You give the player a real DOM element, and the player takes full control of it: it replaces the
element's content with the canvas. **The element's size decides how large the story is drawn.** The 16:9
picture is fitted inside it and centred, with black bars when the element has another shape, and it
follows the element when it is resized. Padding on the element stays free: the picture is fitted inside it.

The player never changes the element's size, position or display, so size it yourself:

```html
<!-- 16:9 and as wide as its container -->
<div id="screen" style="width: 100%; aspect-ratio: 16 / 9"></div>

<!-- the whole window -->
<div id="screen" style="position: fixed; inset: 0"></div>
```

```ts
// Or make it in code
const host = document.createElement('div');
host.style.cssText = 'width: 960px; height: 540px';
document.body.append(host);
const player = new ReelPlayer(host);
```

An element without a height (an empty `<div>` with no CSS) is 0 pixels high, and nothing is drawn.
The element may be inside shadow DOM, e.g. in your own web component.

## API

```ts
class ReelPlayer {
  constructor(host: HTMLElement, options?: ReelPlayerOptions);

  readonly host: HTMLElement;

  // Loading
  load(url: string | URL): Promise<void>;              // rejects with ReelLoadError
  loadReel(reel: Reel, baseUrl?: string | URL): void;  // throws ReelLoadError

  // Playback
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  seekToSlide(slide: number | string): void;           // throws RangeError for an unknown slide
  next(): void;
  previous(): void;
  seekToEnd(): void;

  // State
  readonly state: 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended';
  readonly currentTime: number;
  readonly duration: number;
  readonly currentSlide: { index: number; id: string } | null;
  readonly reel: ResolvedReel | null;

  // Full screen and sound
  enterFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  readonly isFullscreen: boolean;
  unlockAudio(): void;

  // Events
  on<E extends keyof ReelPlayerEvents>(event: E, listener: (value: ReelPlayerEvents[E]) => void): () => void;

  destroy(): void;
}

interface ReelPlayerOptions {
  loop?: boolean;                      // start again at the end (default false)
  autoplay?: boolean;                  // play as soon as a reel is loaded (default false)
  unlockAudioOnInteraction?: boolean;  // unlock sound on a click or tap on the player, or a key press (default true)
}
```

| | |
| --- | --- |
| `load(url)` | Fetches `reel.json`, checks it, and shows the first picture (state `ready`). Media is loaded relative to the URL, so a package works wherever it is published; a relative `url` is taken relative to the page. Rejects with `ReelLoadError` (with `.errors`, a list of problems with paths) if the URL is malformed, the reel cannot be fetched or is not valid; the state is then `empty`. If a newer `load()` or `loadReel()`, or `destroy()`, comes first, the download is aborted and the promise resolves without loading anything – check `state` or `reel` if you need to know. |
| `loadReel(reel, baseUrl?)` | The same for a document you already have. `baseUrl` is the URL `reel.json` would have, and media is resolved against it; a relative one (`/reels/fox/reel.json`) is taken relative to the page. Without it, media is resolved against the page. Throws `ReelLoadError` if the reel is not valid. |
| `play()` / `pause()` | Start or continue / hold. At the end the last picture stays, and the music and any looping video stop. After the end, `play()` starts again from the beginning. |
| `stop()` | Pause and go back to the start (state `ready`). |
| `seek(seconds)` | Jump to a time. Keeps playing if it was playing, otherwise shows that picture. Narration that would start in the middle of a sentence is skipped. Seeking to the very end ends the reel (state `ended`). |
| `seekToSlide(i \| id)` | Jump to the start of a slide, by index (an integer from 0) or id. Throws `RangeError` if the loaded reel has no such slide. |
| `next()`, `previous()` | `next()` goes to the next slide. On the last slide it goes to the end (state `ended`) – or back to the first slide while playing with `loop`. `previous()` goes to the start of the current slide, or to the previous one if the current slide began less than 1.5 s ago. |
| `seekToEnd()` | Shows the end of the reel; the state becomes `ended`. |
| `currentTime`, `duration` | Seconds. |
| `enterFullscreen()`, `exitFullscreen()`, `toggleFullscreen()`, `isFullscreen` | Put the host element in full screen and back, also when it is inside shadow DOM. Browsers allow it only from a click or key press. The methods never throw: the promise rejects when the browser refuses, or has no full screen for elements (iPhone Safari), so add a `.catch()`. The pointer is hidden while it is still. |
| `unlockAudio()` | Turns sound on after `audioblocked`; call it from a click or key press. Does nothing when sound is not blocked. See [Sound](#sound). |
| `destroy()` | Stops, leaves full screen, aborts a running `load()`, empties the host element and removes every listener and observer. No events fire from then on. Call it when the player is no longer needed (single-page apps, Electron windows). |

### Events

`on()` returns a function that stops listening. Listeners may call the player, e.g. `pause()` after each
slide or `load()` the next reel on `ended`.

| Event | Value | |
| --- | --- | --- |
| `statechange` | `ReelPlayerState` | |
| `slidechange` | `{ index, id }` | Another slide is shown – during playback and after seeking. |
| `slideshown` | `{ slideId, seconds, audioPlayed, reel }` | A slide has been shown to its end, or left in its last half second (for statistics). `seconds` is how long it was on screen: less when playback started in the middle of it, and 0 when `seekToEnd()` or `next()` on the last slide skipped to its end. Only reported while playing – not for still frames after `load()`, `stop()` or a seek while paused. |
| `ended` | – | The reel has played to its end, or `seekToEnd()` or `next()` on the last slide ended it while playing. Fires once; the state is `ended`. Not fired when `loop` restarts the reel, nor when a seek while not playing shows the end (the state still becomes `ended` – watch `statechange` for that). |
| `error` | `{ kind: 'media-missing', src, slideId?, fatal: false }` | A file could not be loaded. Playback continues without it. Reported once per file per play. |
| `audioblocked` | – | The browser refused sound during playback, because the user has not interacted with the page yet. See [Sound](#sound). |

```ts
const stopListening = player.on('slidechange', slide => {
  pageNumber.textContent = `${slide.index + 1} / ${player.reel!.slides.length}`;
});
```

### Sound

Browsers refuse to play sound until the user has interacted with the page (a click, tap or key press).

- Call `play()` from a click handler, such as your Play button, and the sound plays.
- If playback starts without one (`autoplay`, or `load().then(() => player.play())` when the page opens), the
  browser refuses the sound and the player emits `audioblocked`. Pictures and text keep playing, and videos
  play without sound. Show a hint such as "Tap for sound".
- The player unlocks the sound for you on the next click on the player (a mouse press, or the end of a tap on
  a touch screen) or key press in the page, unless `unlockAudioOnInteraction` is false. Clicks on your own
  buttons or overlays outside the player do not count: call `player.unlockAudio()` in their handlers.
- After unlocking, the music and the videos' sound come back. Narration the browser already refused on the
  current slide is skipped – narration never starts in the middle of a sentence – and later clips play as
  usual. To hear it, go back to the start of the slide: `seekToSlide(player.currentSlide!.index)`.
- Showing a picture while not playing (after `load()`, `stop()` or a seek while paused) never starts sound,
  so `audioblocked` comes only during playback.

## Examples

### Controls

```ts
playButton.onclick = () => (player.state === 'playing' ? player.pause() : player.play());
nextButton.onclick = () => player.next();
fullscreenButton.onclick = () => player.toggleFullscreen().catch(() => {}); // not every browser allows it

document.addEventListener('keydown', e => {
  if (e.key === ' ') player.state === 'playing' ? player.pause() : player.play();
  if (e.key === 'ArrowRight') player.next();
  if (e.key === 'ArrowLeft') player.previous();
});

player.on('statechange', state => { playButton.textContent = state === 'playing' ? 'Pause' : 'Play'; });
```

### Errors

```ts
import { ReelLoadError, ReelPlayer } from 'reel-player';

try {
  await player.load(url);
} catch (err) {
  if (err instanceof ReelLoadError) console.log(err.errors); // [ 'slides[2].layers[0].src: required', … ]
}
```

### React

```tsx
const Story = ({ src }: { src: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const player = new ReelPlayer(ref.current!);
    // After destroy() the load resolves without loading, and play() does nothing.
    player.load(src).then(() => player.play(), console.error);
    return () => player.destroy();
  }, [src]);
  return <div ref={ref} style={{ width: '100%', aspectRatio: '16 / 9' }} />;
};
```

### Electron

- Set `webPreferences: { autoplayPolicy: 'no-user-gesture-required' }` and sound plays from the start.
- Stories on disk: read `reel.json` yourself and pass the file URL of `reel.json` as `baseUrl`, so media
  is found next to it:

  ```ts
  player.loadReel(JSON.parse(text), pathToFileURL('/stories/the-little-fox/reel.json'));
  ```

- Full screen: `BrowserWindow.setFullScreen(true)` with a host that fills the window, or `player.enterFullscreen()`.

### Without a bundler

`reel-player` imports `reel-format` by name. Map both in an import map:

```html
<script type="importmap">
  { "imports": {
      "reel-format": "https://cdn.jsdelivr.net/npm/reel-format@1/dist/index.js",
      "reel-player": "https://cdn.jsdelivr.net/npm/reel-player@1/dist/index.js" } }
</script>
```

## Styling

The player's CSS is inside the host element, so it looks the same in any page and inside shadow DOM. Class
names are stable and can be used for overlays (an editor's selection boxes, for example):
`reel-host` (your element) › `reel-stage` › `reel-canvas` (the 16:9 picture) › `reel-slide` › `reel-layer`.
Set `--reel-font-sans` and `--reel-font-serif` on the host to use other fonts.

## Other exports

`ReelLoadError` and the types `ReelPlayerOptions`, `ReelPlayerState`, `ReelPlayerEvents`, `SlidePosition`,
`SlideShown` and `ReelPlayerError` belong to the API above. Three advanced exports are stable in 1.x too,
but you do not need them to play reels:

| | |
| --- | --- |
| `PLAYER_CSS` | The CSS the player puts inside the host element. For tools that draw reel slides themselves and want the same look. |
| `visibilityKeyframes(layer, slideDuration)` | Web Animations keyframes for a layer's visibility over its slide: hidden before `start`, `fadeIn`, `opacity`, `fadeOut`, hidden after `end`. |
| `motionKeyframes(motion, layer, slideDuration)` | Keyframes for an image layer's slow zoom and pan (`motion`), over its slide. |

## Requirements

- **Browsers.** The code is published as ES2022 and is not transpiled. It uses private class fields and
  methods, `??=`, `Array.prototype.at`, `Object.hasOwn` (in reel-format), `Element.replaceChildren`, the Web
  Animations API, `fetch` and `AbortController`. That means an evergreen browser: Chrome/Edge 93+,
  Firefox 92+, Safari 15.4+, or Electron 15+. The import map route above needs Chrome/Edge 93+, Firefox 108+
  or Safari 16.4+.
- **Older TVs, kiosks and signage players** often have an older built-in browser (webOS, Tizen, Android
  WebView). Engines from Chromium 87 on (for example webOS 22+ and Tizen 7+) work when your bundler
  transpiles `reel-player` and `reel-format` to that target and you polyfill `Array.prototype.at`,
  `Array.prototype.flat`, `Object.hasOwn`, `Object.fromEntries` and `Element.prototype.replaceChildren`
  (core-js covers the first four). Without transpiling, the module does not load; without the
  polyfills, it throws when it plays. Older built-in browsers are not supported.
- **TypeScript** 5.0 or newer for the type definitions (they import each other with `.ts` extensions).
- **ES modules** only: use `import`, not `require()`.

## Documentation

- [Authoring guide](https://github.com/davidtoska/reel/blob/main/packages/reel-schema/GUIDE.md) – how to write reels that look good and are timed
  right, with copy-paste recipes. Written for people and AI agents.
- [Example reels](https://github.com/davidtoska/reel/blob/main/packages/reel-schema/examples) – complete `reel.json` documents.
- [JSON Schema and package specification](https://www.npmjs.com/package/reel-schema) – also for other languages.
- [Changelog](https://github.com/davidtoska/reel/blob/main/CHANGELOG.md)

## License

MIT
