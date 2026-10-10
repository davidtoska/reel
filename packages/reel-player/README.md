# reel-player

The **Reel player** for browsers and Electron. It plays `reel/1` stories – pictures, drawings, text,
narration and music over time – on a 16:9 canvas inside an element you give it.

```bash
npm install reel-player reel-format
```

`reel-player` depends only on [`reel-format`](https://www.npmjs.com/package/reel-format).

## Quick start

```ts
import { ReelPlayer } from 'reel-player';

const host = document.getElementById('screen')!;   // an HTMLElement – not a selector
const player = new ReelPlayer(host);

await player.load('https://example.com/the-little-fox/reel.json');
player.play();
```

### The host element

You give the player a real DOM element, and the player takes full control of it: it replaces the
element's content with the canvas. **The element's size decides how large the story is drawn.** The 16:9
picture is fitted inside it and centred, with black bars when the element has another shape, and it
follows the element when it is resized.

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

## API

```ts
class ReelPlayer {
  constructor(host: HTMLElement, options?: ReelPlayerOptions);

  readonly host: HTMLElement;

  // Loading
  load(url: string | URL): Promise<void>;
  loadReel(reel: Reel, baseUrl?: string | URL): void;

  // Playback
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  seekToSlide(slide: number | string): void;
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
  unlockAudioOnInteraction?: boolean;  // unlock sound on the first click or key press (default true)
}
```

| | |
| --- | --- |
| `load(url)` | Fetches `reel.json`, checks it, and shows the first picture (state `ready`). Media is loaded relative to the URL, so a package works wherever it is published. Throws `ReelLoadError` (with `.errors`, a list of problems with paths) if the reel cannot be fetched or is not valid. |
| `loadReel(reel, baseUrl?)` | The same for a document you already have. `baseUrl` is the URL `reel.json` would have; media is resolved against it. |
| `play()` / `pause()` | Start or continue / hold. After the end, `play()` starts again from the beginning. |
| `stop()` | Pause and go back to the start (state `ready`). |
| `seek(seconds)` | Jump to a time. Keeps playing if it was playing, otherwise shows that picture. Narration that would start in the middle of a sentence is skipped. |
| `seekToSlide(i \| id)`, `next()`, `previous()`, `seekToEnd()` | Jump by slide. `previous()` goes to the start of the current slide, or to the previous one if the current slide has just begun. |
| `currentTime`, `duration` | Seconds. |
| `enterFullscreen()` | Puts the host element in full screen. Browsers allow it only from a click or key press. The pointer is hidden while it is still. |
| `unlockAudio()` | Browsers may refuse sound until the user has clicked or pressed a key (`audioblocked`). The player does this for you unless `unlockAudioOnInteraction` is false. |
| `destroy()` | Stops, empties the host element and removes every listener and observer. Call it when the player is no longer needed (single-page apps, Electron windows). |

### Events

`on()` returns a function that stops listening.

| Event | Value | |
| --- | --- | --- |
| `statechange` | `ReelPlayerState` | |
| `slidechange` | `{ index, id }` | Another slide is shown – during playback and after seeking. |
| `slideshown` | `{ slideId, seconds, audioPlayed }` | A slide has been shown to its end (for statistics). |
| `ended` | – | The last slide has been shown to its end (not when `loop` restarts). |
| `error` | `{ kind: 'media-missing', src, slideId? }` | A file could not be loaded. Playback continues without it. |
| `audioblocked` | – | The browser refused sound. |

```ts
const stopListening = player.on('slidechange', slide => {
  pageNumber.textContent = `${slide.index + 1} / ${player.reel!.slides.length}`;
});
```

## Examples

### Controls

```ts
playButton.onclick = () => (player.state === 'playing' ? player.pause() : player.play());
nextButton.onclick = () => player.next();
fullscreenButton.onclick = () => player.toggleFullscreen();

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

The player's CSS is inside the host element, so it looks the same in any page. Class names are stable
and can be used for overlays (an editor's selection boxes, for example):
`reel-host` (your element) › `reel-stage` › `reel-canvas` (the 16:9 picture) › `reel-slide` › `reel-layer`.
Set `--reel-font-sans` and `--reel-font-serif` on the host to use other fonts.

## License

MIT
