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
  "$schema": "https://unpkg.com/reel-schema@1/reel-1.schema.json",
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

The first line, `$schema`, is optional: with it, editors such as VS Code and JetBrains IDEs complete
field names, show what each field means and mark mistakes as you type. Players ignore it.

The full specification – every field, unit, default and limit – is
[`packages/reel-format/src/format.ts`](packages/reel-format/src/format.ts) (TypeScript types with
comments) and [`packages/reel-schema`](packages/reel-schema) (JSON Schema, package specification).

## Writing reels (for people and AI)

- **[The authoring guide](packages/reel-schema/GUIDE.md)** explains how to make a reel that looks good
  and is timed right: the canvas and safe area, how much text fits, timing narration, music, motion,
  accessibility, packaging, the common validation errors and copy-paste recipes. It is written so an
  AI agent can follow it too: give it the guide and the schema, and ask for a `reel.json`.
- **Complete examples:** [a narrated picture book](packages/reel-schema/examples/the-little-fox.json),
  [a family album](packages/reel-schema/examples/family-album.json) and
  [a welcome screen](packages/reel-schema/examples/welcome-screen.json).
- **The JSON Schema**, [`reel-1.schema.json`](packages/reel-schema/reel-1.schema.json), describes every
  field with its unit, range and default – for editors (`$schema` above) and for validators in other
  languages.
- **`validateReel()`** in `reel-format` checks a document and says how to fix each problem, e.g.
  `slides[0].layers[1]: unknown field "fadein" – did you mean "fadeIn"?`.

## Packages

| Package | Runs in | What it is |
| --- | --- | --- |
| [`reel-player`](packages/reel-player) | Browsers, Electron | The player: `new ReelPlayer(element)`. |
| [`reel-format`](packages/reel-format) | Node and browsers | Types for `reel/1`, `validateReel`, `resolveReel`, reading and writing `.zip` packages. No DOM. |
| [`reel-schema`](packages/reel-schema) | Anywhere | JSON Schema, package specification, [authoring guide](packages/reel-schema/GUIDE.md) and example reels – for editors and for validators in Go, Python, Rust … |

None of them has dependencies besides each other. In a browser app you install `reel-player` and
`reel-format`. On a server, `reel-format` is enough.

```bash
npm install reel-player reel-format
```

`reel-format` and `reel-player` are ES modules only (`import`, not `require()`), and their type
definitions need TypeScript 5.0 or newer. `reel-format` runs in Node 20.12+ and in browsers.
`reel-player` is published as untranspiled ES2022 and needs Chrome/Edge 93+, Firefox 92+ or
Safari 15.4+; for older TV and kiosk browsers, see its
[requirements](packages/reel-player#requirements).

## Getting started: play a story in a page

The player takes a real DOM element – not a selector – and takes full control of it. **The element's
size decides how large the story is drawn**: the 16:9 picture is fitted inside it, with black bars if
the shapes differ. Give the element a size with CSS.

This page works as it is, with no build step: the import map loads both packages from a CDN.

```html
<div id="screen" style="width: 100%; aspect-ratio: 16 / 9"></div>

<script type="importmap">
  { "imports": {
      "reel-format": "https://cdn.jsdelivr.net/npm/reel-format@1/dist/index.js",
      "reel-player": "https://cdn.jsdelivr.net/npm/reel-player@1/dist/index.js" } }
</script>

<script type="module">
  import { ReelPlayer } from 'reel-player';

  const host = document.getElementById('screen');        // the element the story is drawn in
  const player = new ReelPlayer(host);

  await player.load('the-little-fox/reel.json');         // a package folder next to this page
  player.play();                                         // browsers may hold back sound until a click
</script>
```

Serve the page and the package from a web server (any static server, e.g. `python3 -m http.server`);
browsers do not fetch files from `file://` pages. A `reel.json` on another site must be served with
CORS headers.

With a bundler (Vite, webpack, esbuild …), leave out the import map:
`npm install reel-player reel-format` is enough. Here the element is created in code and fills the
whole window:

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
button.onclick = () => player.enterFullscreen().catch(() => {});   // the browser may refuse

player.destroy();                // when you are done: empties the element, removes all listeners
```

The full API is in [`packages/reel-player`](packages/reel-player), including how browsers handle
[sound](packages/reel-player#sound).

## Building a story in code

A script, a server or an AI agent's tool can build the document as a typed object, check it, and write
a package. In Node 22.18+ this file runs as it is (`node make-story.ts`):

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { validateReel, writeReelPackage, type Reel, type Slide } from 'reel-format';

// Your pages: a picture, its text, and a narration file with its length in seconds.
const pages = [
  { image: 'forest.jpg', alt: 'A forest at dusk', voice: 'page-1.mp3', seconds: 8.6,
    text: 'Once upon a time, a little fox lived at the edge of the forest.' },
  { image: 'fox.png', alt: 'A fox looking at the stars', voice: 'page-2.mp3', seconds: 3.9,
    text: 'Every evening, she watched the stars.' },
];

const reel: Reel = {
  format: 'reel/1',
  title: 'The Little Fox',
  defaults: { text: { style: { font: 'serif', size: 5.5 } } },
  // `: Slide` makes TypeScript report misspelled fields (fadein) inside the map, too.
  slides: pages.map((p, i): Slide => ({
    id: `page-${i + 1}`,
    duration: Math.ceil(1 + p.seconds + 1.5),             // the voice starts at 1 s; 1.5 s of quiet after it
    layers: [
      { type: 'image', src: `media/${p.image}`, alt: p.alt },
      { type: 'shape', shape: 'rect', x: 0, y: 74, w: 100, h: 26, fill: '#00000099' },
      { type: 'text', text: p.text, x: 8, y: 78, w: 84, align: 'center', start: 1, fadeIn: 0.8 },
    ],
    audio: [{ src: `media/${p.voice}`, start: 1, duration: p.seconds, transcript: p.text }],
  })),
};

// Types cannot check ranges, times within a slide or unique ids – validateReel does.
const checked = validateReel(reel);
if (!checked.ok) throw new Error(checked.errors.join('\n'));

const files: Record<string, Uint8Array> = {};
for (const p of pages) for (const name of [p.image, p.voice]) files[`media/${name}`] = await readFile(`assets/${name}`);
await writeFile('the-little-fox.zip', writeReelPackage(reel, files));
```

Unzip the package into a folder on a web server and play it with `player.load('…/reel.json')`. Or
give the object straight to the player in a page, with the URL its `reel.json` would have, so the
media is found next to it:

```ts
player.loadReel(reel, '/stories/the-little-fox/reel.json');   // plays /stories/the-little-fox/media/…
```

The [authoring guide](packages/reel-schema/GUIDE.md) explains the layout, text sizes and timing used
here. `writeReelPackage` throws on an invalid reel too, but it does not check that `files` holds every
file the reel uses; `checkPackageFiles(reel, Object.keys(files))` does.

## Checking stories on a server

```js
import { validateReel, readReelPackage } from 'reel-format';

const result = validateReel(JSON.parse(text));
if (!result.ok) console.log(result.errors);
// [ 'slides[0].layers[1]: unknown field "fadein" – did you mean "fadeIn"?',
//   'slides[0].audio[0]: ends after the slide: start + duration = 13.4 s, but the slide lasts 12 s – make the slide longer or start the clip earlier' ]

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
packages/reel-player   the player (browser)
packages/reel-format   format, validation, packages (Node + browser)
packages/reel-schema   JSON Schema, package specification, authoring guide, example reels
examples/studio        example app: API, builder, templates, demo library
CHANGELOG.md           what changed in each release
```

```bash
npm run build       # all packages and the studio
npm run typecheck
npm test
```

## Releasing

One command makes a real release – a GitHub release and the packages on npm:

1. Write what changed under `## Unreleased` at the top of [`CHANGELOG.md`](CHANGELOG.md). Those lines
   become the release notes. Commit and push.
2. Run one of:

   ```bash
   npm run release -- patch     # bug fixes and docs:          1.0.1 → 1.0.2
   npm run release -- minor     # new things, nothing breaks:  1.0.1 → 1.1.0
   npm run release -- major     # breaking JS API changes:     1.0.1 → 2.0.0
   ```

   Add `--dry-run` to see what would happen without changing anything.

The script ([`scripts/release.ts`](scripts/release.ts)) checks that `main` is clean and the same as on
GitHub, gives all three packages the new version (and `reel-player` the matching `reel-format`
range), dates the changelog section, builds, type-checks and tests, commits and pushes, and creates
the GitHub release `vX.Y.Z`. That starts [`publish.yml`](.github/workflows/publish.yml), which
publishes to npm with trusted publishing – no npm token is stored anywhere. The script waits until
npm shows the new version and prints the links. If a step fails, nothing is released.

Needs the GitHub CLI logged in (`gh auth login`). Version 1.0.0 has no git tag; to add one:
`git tag v1.0.0 557b31d && git push origin v1.0.0`.

## Stability

`reel/1` is frozen: fields are never added, removed or given a new meaning, and a given story always
plays the same way. Anything new becomes `reel/2`, and players for 2 will keep playing 1. A story
made today will still play in ten years.

The packages follow [semantic versioning](https://semver.org). Everything `reel-format` and
`reel-player` export is public API, including the player's events and CSS class names and
`ReelLoadError.errors`; changing or removing any of it needs a new major version. The wording of error
and warning messages is meant for people and may change in any release. Bug fixes may make
validation stricter where it let through documents the specification never allowed (as 1.0.1 does),
but a valid `reel/1` document stays valid – in `validateReel()` and in the schema at `reel-schema@1` –
and plays the same way.

## License

MIT – see [LICENSE](LICENSE).
