# reel-format

Reel 1.0 for **Node and browsers**: TypeScript types for `reel/1` documents, validation, resolving,
and reading/writing `.zip` reel packages. No DOM, no dependencies.

The player is in [`reel-player`](https://www.npmjs.com/package/reel-player); the JSON Schema is in
[`reel-schema`](https://www.npmjs.com/package/reel-schema).

```bash
npm install reel-format
```

Requires Node 20.12+, or Chrome/Edge 93+, Firefox 92+ or Safari 15.4+ (the same as `reel-player`).
For deflated zip entries, `readReelPackage` also needs `DecompressionStream('deflate-raw')`
(Chrome/Edge 103+, Firefox 113+, Safari 16.4+); without it, those entries are reported as "could not be
unpacked", while stored entries and everything else work. ESM only. The type definitions need
TypeScript 5.0 or newer (the `.d.ts` files import each other with `.ts` extensions).

## Validate a document

```ts
import { validateReel, type Reel } from 'reel-format';

const result = validateReel(JSON.parse(text));   // accepts anything – never throws
if (result.ok) {
  const reel: Reel = result.reel;
} else {
  console.log(result.errors);
  // [ 'slides[0].duration: must be 1–600',
  //   'slides[1].layers[0].style: unknown field "colour" – did you mean "color"?',
  //   'slides[1].audio[0]: ends after the slide: start + duration = 13.4 s, but the slide lasts 12 s – make the slide longer or start the clip earlier' ]
}
```

`validateReel` checks everything the JSON Schema checks, plus the rules a schema cannot express
(times within the slide, unique slide ids, `https://` URLs that parse). Unknown fields are errors at
every level – a misspelled field is reported instead of being ignored by the player. The only extra
field allowed is a top-level `"$schema"`, so editors can offer autocompletion; it is ignored.

## Resolve for playing

`resolveReel` merges `defaults` into slides and layers and resolves `media/…` references against the
URL of `reel.json`, so a package plays wherever it is published. It expects a valid document, so
validate anything that comes from outside first (`ReelPlayer.load()` and `loadReel()` in
`reel-player` already do both).

```ts
import { resolveReel, validateReel } from 'reel-format';

const res = await fetch('https://cdn.example.com/my-reel/reel.json');
const checked = validateReel(await res.json());
if (!checked.ok) throw new Error(checked.errors.join('\n'));
const resolved = resolveReel(checked.reel, { baseUrl: res.url });
resolved.duration;              // seconds
resolved.slides[0].layers[0];   // { type: 'image', src: 'https://cdn.example.com/my-reel/media/a.jpg', … }
```

`baseUrl` must be an absolute URL (such as `res.url`, or a `file:` URL in Node). A relative one such
as `/reels/x/reel.json` throws a `TypeError`; make it absolute first, e.g.
`new URL(path, document.baseURI)`.

## Packages (.zip)

A package is a zip with `reel.json` at the root and the media under `media/`.

```ts
import { checkPackageFiles, readReelPackage, validateReel, writeReelPackage } from 'reel-format';

// Read and check: zip structure, paths, checksums, reel.json, and that every file it uses is there.
const pkg = await readReelPackage(bytes);          // Uint8Array or ArrayBuffer
if (pkg.ok) {
  pkg.reel;                                         // the document
  pkg.files;                                        // Map<'media/a.jpg', Uint8Array>
  pkg.warnings;                                     // [ 'media/old.jpg is not used by reel.json' ]
} else {
  pkg.errors;   // [ 'reel.json must be at the root – zip the contents of the folder, not the folder itself …' ]
}

// Write (stored, no compression – media is already compressed):
const files = { 'media/a.jpg': jpegBytes };
const { errors } = checkPackageFiles(reel, Object.keys(files));   // [] when every file reel uses is there
const zip: Uint8Array = writeReelPackage(reel, files);
```

`readReelPackage(zip, limits?)` never throws for bad input. Its limits default to
`REEL_PACKAGE_DEFAULTS` (200 MB of files, 20 000 files, 1 MB for `reel.json`); a limit that is
missing, negative or not a finite number uses the default. Entries are never unpacked beyond the
size the zip declares, so a small zip cannot expand to fill the memory.

`writeReelPackage` throws an `Error` if the reel is not valid (with the errors of `validateReel`), if
a path is not clean and relative, or if the zip would need ZIP64. It does not check that the files
cover the reel's references – `checkPackageFiles` does that.

For packages stored as folders, `checkPackageFiles(reel, paths)` runs the same file checks.

## API

| Export | |
| --- | --- |
| `Reel`, `Slide`, `Layer`, `ImageLayer`, `VideoLayer`, `TextLayer`, `ShapeLayer`, `AudioClip`, `Music`, `TextStyle`, `Transition`, `Motion`, `ResolvedReel` | Types. `src/format.ts` documents every field, unit, limit and default – it is the specification. |
| `validateReel(input)` | `{ ok: true, reel }` or `{ ok: false, errors }` |
| `checkMediaSrc(src, kind)` | The problem with one media reference, or `null` |
| `extensionOf(src)` | The lower-case file extension, without query or fragment (`''` if there is none) |
| `resolveReel(validReel, { baseUrl?, id? })` | What the player plays |
| `reelDuration(reel)`, `slideStarts(slides)` | Timing helpers |
| `readReelPackage(zip, limits?)`, `writeReelPackage(reel, files)`, `ReelPackageResult` | Zip packages |
| `checkPackageFiles(reel, paths)`, `reelMediaRefs(reel)`, `isSystemFile(path)` | Package checks for folders |
| `crc32(bytes)` | The CRC-32 zip uses |
| `REEL_FORMAT`, `REEL_MANIFEST`, `REEL_MEDIA_DIR`, `REEL_MEDIA_TYPES`, `REEL_PACKAGE_DEFAULTS` | Constants |

## Documentation

- [Authoring guide](https://github.com/davidtoska/reel/blob/main/packages/reel-schema/GUIDE.md) – how to write reels that look good and are timed
  right, with copy-paste recipes. Written for people and AI agents.
- [Example reels](https://github.com/davidtoska/reel/blob/main/packages/reel-schema/examples) – complete `reel.json` documents.
- [JSON Schema and package specification](https://www.npmjs.com/package/reel-schema) – also for other languages.
- [Changelog](https://github.com/davidtoska/reel/blob/main/CHANGELOG.md)
- [Building a story in code](https://github.com/davidtoska/reel/blob/main/README.md#building-a-story-in-code) – a typed `Reel`, checked, zipped and played.

## License

MIT
