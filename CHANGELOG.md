# Changelog

What changed in each release of the packages in this repository. The packages follow
[semantic versioning](https://semver.org); the `reel/1` format itself never changes (see
[Stability](README.md#stability)).

## 1.0.1 – 2026-10-10

`reel-format` 1.0.1, `reel-player` 1.0.1, `reel-schema` 1.0.1: bug fixes and documentation. The
`reel/1` format is unchanged, and every valid reel plays as before.

**Stricter validation.** `validateReel()` now rejects some documents that 1.0.0 accepted:

- unknown or misspelled fields, and a transition without `type`. The specification never had such
  fields, and the 1.0.0 JSON Schema already rejected them.
- relative `src` paths with `?`, `#`, control characters or percent-encoded dot segments
  (`media/%2e%2e/…`), and `https://` sources that are not valid URLs (no host, or spaces or control
  characters in them). Both the 1.0.0 validator and the 1.0.0 schema let some of these through, and an
  `https://` URL with a space even played.

`reel-player` 1.0.1 refuses to load such documents with a `ReelLoadError`. If you store reels, check
them with `validateReel()` before you upgrade.

One rule is looser: an `https://` `src` no longer needs a media file extension (see below). Reels that
use such URLs pass 1.0.1 but are still refused by 1.0.0.

### reel-format

Fixes:

- Unknown fields are errors at every level, with a hint for misspellings:
  `slides[0].layers[1]: unknown field "fadein" – did you mean "fadeIn"?`. A top-level `"$schema"` is
  allowed and ignored, so editors can offer autocompletion.
- A transition without `type` is an error (`required – fade or cut`). Before, it passed and played as a
  cut, not as the documented fade.
- A relative `src` must be a clean path under `media/`: no `?`, `#`, `\` or control characters, and no
  `.` or `..` segments, also when percent-encoded – `media/%2e%2e/x.jpg` pointed outside `media/`.
- An `https://` `src` must be a URL that parses and has a host, without spaces or control characters.
  Its path is no longer checked: 1.0.0 rejected URLs whose last segment ended in an unlisted extension
  (`…/photo.heic`, `…/page.php`), although the schema allowed them. Players can still only show the
  listed media types.
- The "did you mean" hint is worked out for the first 20 unknown fields of a document, so validating a
  huge document full of unknown fields stays fast.
- Text lengths are counted in Unicode code points, as the schema counts them (an emoji is one
  character).
- Lists with holes (sparse arrays built in JavaScript) are reported (`slides[2]: missing`) instead of
  skipped.
- Inherited names such as `constructor` are no longer accepted as media file extensions.
- Messages say how to fix the problem: `use "#ffffff"` for `#fff`, `use https://` for `http://`, where
  to put a file, how to fix a clip that ends after its slide. `end must be after start` is reported only
  when `end` is written.
- `readReelPackage` never unpacks a deflated entry beyond the size the zip declares, so a small zip
  cannot fill the memory (zip bomb). A `reel.json` that declares a size over the limit is refused
  before unpacking.
- `readReelPackage` limits that are `undefined`, `NaN`, negative or infinite use the default instead
  of switching the limit off. Size messages read like "1 MB" or "10 bytes".
- Files under `media/` that nothing uses and that have another extension (`.gitkeep`, `notes.txt`) give
  a warning, as the package specification says, instead of failing the package.
- A file name that matches only in another Unicode form (NFD names in zips made on macOS) gets its own
  hint. Names are still compared exactly.
- `writeReelPackage` throws a clear `Error` for an invalid reel, a path that is not clean, or a zip that
  would need ZIP64, instead of writing a zip that cannot be read. Its zips keep non-ASCII names
  (`blåbær.jpg`) when extracted with Info-ZIP `unzip`, and carry a valid date.
- `resolveReel`: style fields set to `undefined` no longer hide the defaults. A relative `baseUrl`
  throws a `TypeError` that says it must be absolute, instead of `Invalid URL`.
- `engines` is now Node 20.12+: `DecompressionStream('deflate-raw')`, used for deflated zips, is
  missing in older versions.
- The package is compiled without Node's types, so Node-only APIs cannot slip into this browser-safe
  code.

Docs:

- README: examples validate before resolving; requirements (Node 20.12+, browsers, ES modules only,
  TypeScript 5.0+); `baseUrl` must be absolute; package limits; `writeReelPackage` errors; the
  low-level helpers in the API table.
- `src/format.ts`, the specification, states every limit, range and default that the validator
  enforces.
- The README and the comment in `index.js` of 1.0.0 named the player `reel-dom`, which was never
  published; they now say `reel-player`.

### reel-player

Fixes:

- At the end of the reel, the music and looping videos stop. Before, music kept playing after `ended`,
  and `pause()` could not stop it.
- Showing a still frame (after `load()`, `stop()` or a seek while paused) no longer starts media. When
  the browser blocked sound, a video used to play muted in `ready` and the first narration was lost.
- `play()` right after pausing in the last moments of the reel no longer leaves the player stuck in
  `playing`; with `loop`, it starts again. `play()` after the end starts from the first slide, as
  `stop()` and then `play()` would.
- `ended` and `slideshown` fire only during playback. A seek while not playing no longer fires them,
  and `ended` no longer repeats on every seek or comes before `slidechange`; in an editor that seeks
  when the reel ends, this recursed until the stack overflowed.
- Listeners may call the player. `destroy()`, `load()`, `loadReel()`, `seek()` or `stop()` from
  `slideshown` used to throw a `TypeError` or leave a stray slide in the canvas. `pause()` from
  `slideshown` holds the slide that just ended, and `next()` then goes on to the following slide.
  `pause()` or `play()` from `statechange` or `slidechange` during a seek or a restart are respected.
  `destroy()` from a listener also stops the remaining listeners of that event.
- `loadReel()` takes a relative `baseUrl` (relative to the page). Errors from resolving become
  `ReelLoadError`, and the state becomes `empty`. `load()` with a malformed URL rejects with
  `ReelLoadError` instead of staying in `loading`.
- A newer `load()` or `loadReel()`, or `destroy()`, aborts a running `load()`; the older call resolves
  without changing anything, also when its download fails.
- `slidechange` follows the picture: it is emitted when the next slide is drawn, never before. The
  engine's timer can fire a little after the player's, and `currentSlide` then named a slide that was
  not on screen yet – or never, when a listener paused at that moment.
- A host element with padding letterboxes the picture inside the padding instead of cropping it.
- Slides no longer depend on the CSS `inset` shorthand, so older TV browsers without it still fill the
  canvas.
- Tapping the player unlocks sound on touch screens (the end of a tap counts; a mouse press and a key
  press still do).
- `audioblocked` also fires when the reel was loaded again (a playlist, an editor) while sound was
  blocked. Before, the app never heard of it and playback stayed silent.
- Full screen: `isFullscreen` is right inside shadow DOM; `enterFullscreen()` and `exitFullscreen()`
  reject instead of throwing when the browser has no full screen for elements; `destroy()` leaves full
  screen.
- `seekToSlide()` throws `RangeError` for an index that is not an integer, or `NaN`, instead of going
  to the start.
- With `loop`, `next()` on the last slide while playing goes to the first slide instead of ending the
  reel.
- Requires `reel-format` ^1.0.1.
- The npm description and keywords no longer mention a `<reel-player>` custom element and a function
  API, which do not exist.

Docs:

- README: loading and aborting, events with their full values and when they fire, a section on sound,
  full screen, `destroy()`, the advanced exports (`PLAYER_CSS`, `visibilityKeyframes`,
  `motionKeyframes`), and requirements: browser versions, ES modules only, TypeScript 5.0+, older TV
  and kiosk browsers.

### reel-schema

Fixes:

- A top-level `"$schema"` is allowed, so `reel.json` files can point editors at the schema.
- The `src` patterns use no lookahead, so Go's `regexp` (RE2) compiles them; the README's Go example
  failed before. They now reject `media/../x.mp3`, `media/./x.mp3` and `media//x.mp3`, and `?`, `#`
  or `\` in a path; accept extensions in any case (`.Jpg`); require a host and no spaces or control
  characters in `https://` URLs, spelled out as character classes instead of `\s`, which means
  different things in different regex engines; and reject a trailing newline in engines where `$`
  matches before one (Python, .NET, PCRE). With ECMA-262 regular expressions, the dialect JSON Schema
  specifies, they agree with `validateReel()` except for rules 5 and 6 of the README's list of rules a
  schema cannot express.
- Named definitions for every part (`imageLayer`, `textStyle`, `transition` …), and a description with
  unit, range and default for every field, plus examples – for editors, code generators and AI agents.

Docs:

- New [authoring guide](packages/reel-schema/GUIDE.md): layout, readable text, timing, motion, sound,
  accessibility, packaging, common validation errors and recipes.
- New example documents in [`examples/`](packages/reel-schema/examples), importable as
  `reel-schema/examples/*.json`.
- README: editor autocompletion with `$schema`; the corrected list of rules the schema cannot express;
  the package specification says that unused files only give a warning, that names are compared
  exactly and not normalized, and that `src` is not percent-decoded; Go (`jsonschema/v6`) and Python
  examples.

### Example app (Reel Studio, not published)

- Imports use the zip-bomb protection of `reel-format`, and the 100 MB limit per reel also covers
  files copied from the library.
- Serving files: an aborted download or a failed read no longer crashes the server or leaks file
  handles; a malformed URL gives 400.
- A malformed WAV header no longer breaks the reel's API, and WAV durations are read from the headers
  only.
- Media from imported packages (sub-folders, upper case) can be deleted, folders named like media
  files are ignored, and wrong JSON types or broken percent-encoding give 400 instead of 500.
- Concurrent creates with the same id and concurrent resets no longer overwrite or delete each other's
  reels.
- The gallery shows only thumbnails from the reel's own files.
- The editor no longer loses edits after a failed save, and keeps an empty `motion.from` or `to`.
- Works from a folder whose path has spaces or non-ASCII characters.
- `GET /api` has a complete `reel/1` example, a link to the authoring guide, and says how to get
  audio durations.

### Repository

- A root `LICENSE` (MIT), this changelog, and `engines` in the root `package.json`: the tests and the
  studio run TypeScript directly and need Node 22.18+ or 23.6+.
- Tests: `reel-format` has tests that keep `validateReel()`, the JSON Schema and every example document
  in agreement, plus hostile and damaged zips; `reel-player` has its first test suite, run in Node
  against a fake DOM with a manual clock, with a test for every fix above. `npm test` runs both, and so
  does CI.
- README: the first example works when pasted into a page (import map), a recipe for building a story
  in code, a section on writing reels for people and AI agents, the stability of the JavaScript API,
  and release steps with notes from this changelog.

## 1.0.0 – 2026-10-10

First release of `reel-format`, `reel-player` and `reel-schema`: the frozen `reel/1` format, its
validation and `.zip` packages, the browser player, and the JSON Schema.

npm records commit 40b7139 as the source of all three packages. `reel-player` was published from the
files of the next commit, 557b31d, which renamed it from `reel-dom`.
