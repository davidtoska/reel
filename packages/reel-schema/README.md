# reel-schema

The **JSON Schema** (draft 2020-12) for Reel 1.0 documents (`"format": "reel/1"`), and the
specification of the **reel package** (`.zip`). Language-neutral: use it to generate types or
validators in Go, Python, Rust, C# … The schema is also served at
`https://unpkg.com/reel-schema@1/reel-1.schema.json`.

```bash
npm install reel-schema
```

```js
import schema from 'reel-schema' with { type: 'json' };
```

In JavaScript, [`reel-format`](https://www.npmjs.com/package/reel-format)'s `validateReel()` does
everything the schema does, plus the rules below.

## Rules the schema cannot express

A validator should also check these. They are what makes a document playable:

1. Slide `id`s are unique within the reel.
2. For every layer: `start < slide.duration`, `end > start`, and `end ≤ slide.duration + 0.05`.
   Missing `start` means 0; missing `end` means the end of the slide.
3. For every audio clip: `start + duration ≤ slide.duration + 0.05`.
4. For a video layer: `trimStart < duration`.
5. A relative `src` is a clean path: it starts with `media/`, has no `..`, `.` or empty segments and no `\`.

## Units and defaults

| | |
| --- | --- |
| `x`, `y`, `w`, `h` | Percent of the canvas width (`x`, `w`) and height (`y`, `h`). Default 0, 0, 100, 100. A text layer without `h` grows with its content. |
| text `size`, `padding`, `radius`, `strokeWidth` | Percent of the canvas height. Text size 5 ≈ 54 px on a 1080p screen. |
| times | Seconds from the start of the slide. |
| canvas | 16:9. Players letterbox it into the screen. |
| text style | Player default → `defaults.text.style` → the layer's `style`. |
| transition | The slide's own, else `defaults.transition`, else a 1 s fade. A fade without `duration` lasts 1 s. |
| video `muted` | Default `true` when the slide has audio clips, else `false`. |

## Media types

| Use | Extensions players must support |
| --- | --- |
| image | jpg, jpeg, png, webp, svg, gif |
| audio (music, clips) | mp3, m4a, aac, wav |
| video | mp4 (H.264 + AAC) |

## The reel package (.zip), version 1

A package is a reel and every file it uses, as a folder or as a zip with the same content:

```
my-reel.zip
├── reel.json        a reel/1 document, UTF-8, at most 1 MB, at the root of the zip
└── media/
    ├── photo.jpg
    └── voice.mp3
```

1. `reel.json` is at the root. A zip whose only `reel.json` is inside a folder is invalid; report it
   as "zip the contents of the folder, not the folder itself".
2. Entries are stored (method 0) or deflated (method 8). No encryption, no ZIP64, no multi-part
   zips. Streamed zips (data descriptors) are allowed: take sizes from the central directory.
3. Paths are relative and clean: no leading `/`, no drive letter, no `..`, `.` or empty segments, no `\`.
   No path occurs twice. Paths are case-sensitive.
4. Every relative `src` in `reel.json` exists in the package at exactly that path.
5. Each entry's content matches its CRC-32 and size.
6. Files that nothing refers to are allowed but should produce a warning.
7. Files that operating systems add by themselves are ignored: `__MACOSX/…`, `._*`, `.DS_Store`,
   `Thumbs.db`, `desktop.ini`.
8. Readers may refuse packages above a size they choose. The reference reader's defaults are 200 MB of
   files, 20 000 entries and 1 MB for `reel.json`.

Published as a folder on a web server, `reel.json` is fetched by URL and every relative `src` is
resolved against that URL. Serve media with `Accept-Ranges` so players can seek in audio and video.

## Validating in Go

```go
import "github.com/santhosh-tekuri/jsonschema/v6"

c := jsonschema.NewCompiler()
schema, err := c.Compile("reel-1.schema.json")   // a local copy of this package's file
// …
var doc any
_ = json.Unmarshal(data, &doc)
if err := schema.Validate(doc); err != nil { /* not a valid reel/1 document */ }
// then check the rules the schema cannot express (above)
```

## License

MIT
