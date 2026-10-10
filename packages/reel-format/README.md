# reel-format

Reel 1.0 for **Node and browsers**: TypeScript types for `reel/1` documents, validation, resolving,
and reading/writing `.zip` reel packages. No DOM, no dependencies.

The player is in [`reel-player`](https://www.npmjs.com/package/reel-player); the JSON Schema is in
[`reel-schema`](https://www.npmjs.com/package/reel-schema).

```bash
npm install reel-format
```

## Validate a document

```ts
import { validateReel, type Reel } from 'reel-format';

const result = validateReel(JSON.parse(text));   // accepts anything – never throws
if (result.ok) {
  const reel: Reel = result.reel;
} else {
  console.log(result.errors);
  // [ 'slides[1].duration: must be 1–600',
  //   'slides[1].audio[0]: ends after the slide: start + duration = 13.4 s, but the slide lasts 12 s' ]
}
```

## Resolve for playing

`resolveReel` merges `defaults` into slides and layers and resolves `media/…` references against the
URL of `reel.json`, so a package plays wherever it is published.

```ts
import { resolveReel } from 'reel-format';

const res = await fetch('https://cdn.example.com/my-reel/reel.json');
const resolved = resolveReel(await res.json(), { baseUrl: res.url });
resolved.duration;              // seconds
resolved.slides[0].layers[0];   // { type: 'image', src: 'https://cdn.example.com/my-reel/media/a.jpg', … }
```

## Packages (.zip)

A package is a zip with `reel.json` at the root and the media under `media/`.

```ts
import { readReelPackage, writeReelPackage } from 'reel-format';

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
const zip: Uint8Array = writeReelPackage(reel, { 'media/a.jpg': jpegBytes });
```

For packages stored as folders, `checkPackageFiles(reel, paths)` runs the same file checks.

## API

| Export | |
| --- | --- |
| `Reel`, `Slide`, `Layer`, `ImageLayer`, `VideoLayer`, `TextLayer`, `ShapeLayer`, `AudioClip`, `Music`, `TextStyle`, `Transition`, `Motion`, `ResolvedReel` | Types. `src/format.ts` documents every field, unit and default – it is the specification. |
| `validateReel(input)` | `{ ok: true, reel }` or `{ ok: false, errors }` |
| `resolveReel(reel, { baseUrl?, id? })` | What the player plays |
| `reelDuration(reel)`, `slideStarts(slides)` | Timing helpers |
| `readReelPackage(zip, limits?)`, `writeReelPackage(reel, files)` | Zip packages |
| `checkPackageFiles(reel, paths)`, `reelMediaRefs(reel)` | Package checks for folders |
| `REEL_FORMAT`, `REEL_MANIFEST`, `REEL_MEDIA_DIR`, `REEL_MEDIA_TYPES`, `REEL_PACKAGE_DEFAULTS` | Constants |

Requires Node 18+ or a modern browser (`DecompressionStream` is used for deflated zip entries).

## License

MIT
