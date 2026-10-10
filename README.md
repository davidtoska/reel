# Reel

**An open format for telling stories on screens.**

A reel is a story made of pictures, drawings, text, narration and music, played over time on a
screen: a picture book read aloud to a child at bedtime, a grandmother's photo album on the TV in a
care home, a fairy tale with a narrator and soft music, a museum screen, a lesson, a quiz, or a
greeting from the family. Anyone can make one by hand, a program can generate one, and an AI can
write one. It plays the same way in a browser, on a TV, in a kiosk or in an Electron app.

Reel has two parts that never change once released:

- **The format** (`reel/1`): a small JSON document, `reel.json`, that says what is shown and heard,
  where, and when. It contains no code and no HTML, so stories made by others are safe to play.
- **The player**: draws a reel on a 16:9 canvas inside any element you give it, and plays it with
  pause, seek, next/previous slide and full screen.

A story and its files travel together as a **package**: a folder, or a `.zip`, with `reel.json` and
a `media/` folder. Put the folder on any web server and play it from anywhere.

## What it is for

| | |
| --- | --- |
| **Stories for children** | Picture books with a narrator reading each page, pictures that slowly zoom, words that appear as they are read, a melody underneath. |
| **Stories for adults** | Family history, travel stories, memories told with old photos and the voices of the people in them. |
| **Screens in care homes and homes for the elderly** | Photo albums from the family, today's programme, music and greetings – large text, calm pace, readable from the sofa. |
| **Generated stories** | An AI or a script writes `reel.json` and picks or generates the images and narration. The format is strict and checked, so mistakes are caught before anything is shown. |
| **Exhibitions, classrooms, signage** | Timed shows with narration and subtitles that run by themselves in a loop. |

## The format in two minutes

A **reel** is a list of **slides**. Each slide lasts a number of seconds and has up to 12 **layers**,
drawn on top of each other, and up to 4 **audio clips**. **Music** can play under the whole reel.

- Layers are `image`, `video`, `text` or `shape`. Their place and size (`x`, `y`, `w`, `h`) are
  **percent of the canvas**, so a reel looks the same on a phone and on a 4K TV.
- Every layer can appear and disappear at its own time (`start`, `end`) with soft fades
  (`fadeIn`, `fadeOut`). Images can slowly zoom and pan (`motion`).
- Audio clips start at a time in the slide: narration, a sound effect, a voice. While a clip plays,
  the music is lowered automatically (`duck`).
- Slides fade into each other (or `cut`). Text styles and transitions can be set once in `defaults`.

A two-page bedtime story:

```json
{
  "format": "reel/1",
  "title": "The Little Fox",
  "language": "en",
  "music": { "src": "media/lullaby.mp3", "duration": 94, "volume": 0.25 },
  "defaults": {
    "text": { "style": { "font": "serif", "size": 5.5, "background": "#00000088", "padding": 1.2, "radius": 1 } },
    "transition": { "type": "fade", "duration": 1.5 }
  },
  "slides": [
    {
      "id": "page-1", "duration": 12,
      "layers": [
        { "type": "image", "src": "media/forest.jpg", "alt": "A forest at dusk",
          "motion": { "from": { "scale": 1 }, "to": { "scale": 1.15, "x": 40, "y": 60 } } },
        { "type": "text", "text": "Once upon a time, a little fox lived at the edge of the forest.",
          "x": 8, "y": 78, "w": 84, "align": "center", "start": 1, "fadeIn": 0.8 }
      ],
      "audio": [{ "src": "media/narration-1.mp3", "start": 1, "duration": 8.6,
                  "transcript": "Once upon a time, a little fox lived at the edge of the forest." }]
    },
    {
      "id": "page-2", "duration": 10,
      "layers": [
        { "type": "image", "src": "media/fox.png", "fit": "contain" },
        { "type": "shape", "shape": "ellipse", "x": 58, "y": 20, "w": 20, "h": 30,
          "stroke": "#ffd27a", "strokeWidth": 0.6, "start": 4, "end": 9, "fadeIn": 0.5, "fadeOut": 0.5 },
        { "type": "text", "text": "Every evening, she watched the stars.", "x": 8, "y": 78, "w": 84, "align": "center", "start": 1 }
      ],
      "audio": [{ "src": "media/narration-2.mp3", "start": 1, "duration": 3.9 }],
      "credit": "Illustrations: the author"
    }
  ]
}
```

The full specification – every field, unit, default and limit – is
[`packages/reel-format/src/format.ts`](packages/reel-format/src/format.ts) (TypeScript types with
comments) and [`packages/reel-schema`](packages/reel-schema) (JSON Schema, package specification).

## Packages

| Package | Runs in | What it is |
| --- | --- | --- |
| [`reel-player`](packages/reel-player) | Browsers, Electron | The player: `new ReelPlayer(element)`. |
| [`reel-format`](packages/reel-format) | Node and browsers | Types for `reel/1`, `validateReel`, `resolveReel`, reading and writing `.zip` packages. No DOM. |
| [`reel-schema`](packages/reel-schema) | Anywhere | JSON Schema and package specification – for validators in Go, Python, Rust … |

None of them has dependencies besides each other. In a browser app you install `reel-player` and
`reel-format`. On a server, `reel-format` is enough.

```bash
npm install reel-player reel-format
```

## Getting started: play a story in a page

The player takes a real DOM element – not a selector – and takes full control of it. **The element's
size decides how large the story is drawn**: the 16:9 picture is fitted inside it, with black bars if
the shapes differ. Give the element a size with CSS.

```html
<div id="screen" style="width: 100%; aspect-ratio: 16 / 9"></div>

<script type="module">
  import { ReelPlayer } from 'reel-player';

  const host = document.getElementById('screen');        // the element the story is drawn in
  const player = new ReelPlayer(host);

  await player.load('https://example.com/the-little-fox/reel.json');
  player.play();
</script>
```

Or create the element in code, here filling the whole window:

```ts
import { ReelPlayer } from 'reel-player';

const host = document.createElement('div');
host.style.cssText = 'position: fixed; inset: 0';
document.body.append(host);

const player = new ReelPlayer(host, { loop: true });
await player.load('/stories/the-little-fox/reel.json');
player.play();

player.pause();
player.seek(30);                 // seconds
player.next();                   // next slide
player.seekToSlide('page-2');
player.on('slidechange', s => console.log('now showing', s.id));
button.onclick = () => player.enterFullscreen();

player.destroy();                // when you are done: empties the element, removes all listeners
```

The full API is in [`packages/reel-player`](packages/reel-player).

## Checking stories on a server

```js
import { validateReel, readReelPackage } from 'reel-format';

const result = validateReel(JSON.parse(text));
if (!result.ok) console.log(result.errors);
// [ 'slides[0].audio[0]: ends after the slide: start + duration = 13.4 s, but the slide lasts 12 s' ]

const pkg = await readReelPackage(zipBytes);      // an uploaded .zip
if (pkg.ok) console.log(pkg.reel.title, [...pkg.files.keys()]);
else console.log(pkg.errors);                      // e.g. 'media/fox.png: not in the package – did you mean media/Fox.png?'
```

## The example app: Reel Studio

[`examples/studio`](examples/studio) shows how to build an application for making stories:

- a **visual builder** for people: drag pictures and text on the real player, set times, add
  narration and music, upload files
- an open **HTTP API** for scripts and AI agents, which describes itself at `/api`
- **templates** (photo album, day plan, quiz) that turn simple input into a reel
- import and export of `.zip` packages, and a full-screen player page

All demo images and sounds are generated and mean nothing.

```bash
git clone https://github.com/davidtoska/reel.git && cd reel
npm install
npm run build
npm run dev          # http://localhost:8080
```

Requires Node 22.18+ or 23.6+ (the studio server runs TypeScript directly; Node 24 recommended).

## Repository

```
packages/reel-player      the player (browser)
packages/reel-format   format, validation, packages (Node + browser)
packages/reel-schema   JSON Schema + package specification
examples/studio        example app: API, builder, templates, demo library
```

```bash
npm run build       # all packages and the studio
npm run typecheck
npm test
```

## Releasing

Packages are published to npm by GitHub Actions ([`publish.yml`](.github/workflows/publish.yml)) with
trusted publishing – no npm token is stored anywhere. To release:

```bash
npm version patch -w reel-player --no-git-tag-version   # bump the packages that changed
git commit -am "reel-player 1.0.1" && git push
gh release create v1.0.1 --generate-notes               # starts the publish workflow
```

The workflow builds, type-checks and tests everything, then publishes each package whose version is
not on npm yet, in dependency order.

## Stability

`reel/1` is frozen: fields are never added, removed or given a new meaning, and a given story always
plays the same way. Anything new becomes `reel/2`, and players for 2 will keep playing 1. A story
made today will still play in ten years.

## License

MIT
