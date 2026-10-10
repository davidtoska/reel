# reel-schema

The **JSON Schema** (draft 2020-12) for Reel 1.0 documents (`"format": "reel/1"`), the
specification of the **reel package** (`.zip`), an **authoring guide** and **example documents**.
Language-neutral: use it to generate types or validators in Go, Python, Rust, C# … Its patterns
work in ECMA-262 and RE2 (no lookaround), so Go's `regexp` compiles them.

| File | |
| --- | --- |
| [`reel-1.schema.json`](reel-1.schema.json) | The schema. Every field has a description with its unit, range and default. Also at `https://unpkg.com/reel-schema@1/reel-1.schema.json`. |
| [`GUIDE.md`](GUIDE.md) | How to write a reel that looks good and is timed right: layout, text sizes, timing, sound, accessibility, packaging, copy-paste recipes. For people and AI agents. |
| [`examples/`](examples) | Complete documents: [`the-little-fox.json`](examples/the-little-fox.json) (a narrated picture book), [`family-album.json`](examples/family-album.json) (photos, captions, music, a voice), [`welcome-screen.json`](examples/welcome-screen.json) (text cards, shapes, a video, no sound). |

```bash
npm install reel-schema
```

```js
import schema from 'reel-schema' with { type: 'json' };
import example from 'reel-schema/examples/the-little-fox.json' with { type: 'json' };
```

In JavaScript, [`reel-format`](https://www.npmjs.com/package/reel-format)'s `validateReel()` checks
everything the schema checks plus the rules below, with messages that say how to fix each problem.

## Editor autocompletion

Put `$schema` first in `reel.json`. Editors such as VS Code and JetBrains IDEs then complete field
names, show each field's description and mark mistakes as you type:

```json
{
  "$schema": "https://unpkg.com/reel-schema@1/reel-1.schema.json",
  "format": "reel/1",
  "title": "My first reel",
  "slides": [{ "id": "hello", "duration": 5, "layers": [{ "type": "text", "text": "Hello!" }] }]
}
```

`$schema` at the top level is allowed and ignored by players; it is the only field that is not part
of the format. Without it, VS Code can map the schema to file names in `.vscode/settings.json`:

```json
{
  "json.schemas": [
    { "fileMatch": ["reel.json", "*.reel.json"], "url": "https://unpkg.com/reel-schema@1/reel-1.schema.json" }
  ]
}
```

In JetBrains IDEs: Settings › Languages & Frameworks › Schemas and DTDs › JSON Schema Mappings.

## Rules the schema cannot express

A validator should also check these. They are what makes a document playable:

1. Slide `id`s are unique within the reel.
2. For every layer: `start < slide.duration`, `end > start` (when `end` is given), and
   `end ≤ slide.duration + 0.05`. Missing `start` means 0; missing `end` means the end of the slide.
3. For every audio clip: `start + duration ≤ slide.duration + 0.05`. Missing `start` means 0.
4. For a video layer: `trimStart < duration`.
5. No segment of a relative `src` is a percent-encoded dot segment: no segment matches
   `/^(\.|%2e){1,2}$/i` (URL parsers read `%2e%2e` as `..`). The schema checks the rest of the path
   rule: `media/` first, no empty, `.` or `..` segments, no `\`, `?`, `#` or control characters, and
   an extension listed for the use, in any case.
6. An `https://` `src` is a valid absolute URL with a host: it parses with a WHATWG URL parser
   (`new URL(src)` in JavaScript). The schema checks only its shape (a host, no spaces or control characters).

Notes for implementers:

- Lengths count Unicode code points, as `maxLength` does: an emoji is one character.
- JSON has no holes in arrays. `validateReel()` also rejects JavaScript arrays with holes
  (`slides[2]: missing`) and treats fields set to `undefined` as left out.
- `default` is set only where a missing field always means that value: music `volume` and `duckTo`,
  audio clip `start`, `volume` and `duck`, slide `background`. The other defaults depend on other
  fields (text styles cascade, video `muted` depends on the slide's audio), or sit inside `oneOf`,
  so they are stated in the descriptions. Ajv's `useDefaults` works with the schema.
- A layer is a `oneOf` of `imageLayer`, `videoLayer`, `textLayer` and `shapeLayer`, told apart by
  the `type` constant; a transition is a `oneOf` of `fadeTransition` and `cutTransition`.
- The `src` and `color` definitions add `"not": { "pattern": "\\n" }`, because in some regex engines
  (Python, .NET, PCRE) `$` also matches before a final newline. Character classes are spelled out
  (no `\s`, `\d` or `\w`), because those shorthands mean different things in different engines.
- The schema and `validateReel()` agree exactly with ECMA-262 regular expressions, the dialect JSON
  Schema specifies. Other engines can still differ in rare edge cases: Java's `$`, for example, also
  matches before a final `\r`, U+0085, U+2028 or U+2029.

## Units and defaults

| | |
| --- | --- |
| `x`, `y`, `w`, `h` | Percent of the canvas width (`x`, `w`) and height (`y`, `h`), 0–100. Default 0, 0, 100, 100. A text layer without `h` grows with its content. |
| text `size`, `padding`, `radius`, `strokeWidth` | Percent of the canvas height. Text size 5 ≈ 54 px on a 1080p screen. |
| times | Seconds from the start of the slide. `start` default 0, `end` default the end of the slide. |
| canvas | 16:9. Players letterbox it into the screen. |
| text style | Player default → `defaults.text.style` → the layer's `style`. Player default: sans, size 5, regular, white, no background, line height 1.25, shadow when there is no background. |
| transition | The slide's own, else `defaults.transition`, else a 1 s fade. A fade without `duration` lasts 1 s. |
| video `muted` | Default `true` when the slide has audio clips, else `false`. |
| music | `volume` 0.25, `duckTo` 0.08. Loops. |
| audio clip | `start` 0, `volume` 1, `duck` true. |
| slide `background` | `#000000`. |

## Media types

| Use | Extensions players must support | MIME type |
| --- | --- | --- |
| image | jpg, jpeg, png, webp, svg, gif | image/jpeg, image/png, image/webp, image/svg+xml, image/gif |
| audio (music, clips) | mp3, m4a, aac, wav | audio/mpeg, audio/mp4, audio/aac, audio/wav |
| video | mp4 (H.264 + AAC) | video/mp4 |

A relative `src` must end in one of the extensions for its use, in any case (`.JPG` is fine). An
`https://` URL may have any path, with or without an extension, but the file should be of a listed
type.

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
   zips. Streamed zips (data descriptors) are allowed: take sizes from the central directory. Entry
   names are UTF-8. Folder entries (names ending in `/`) are skipped.
3. Paths are relative and clean: no leading `/`, no drive letter, no `..`, `.` or empty segments, no `\`.
   No path occurs twice. Paths are compared exactly: case-sensitive and without Unicode
   normalization (zips made on macOS may store names in NFD; write the names in `reel.json` the same
   way, or use plain ASCII names).
4. Every relative `src` in `reel.json` exists in the package at exactly that path. The `src` is not
   percent-decoded: `media/a%20b.jpg` is the file `media/a%20b.jpg`. Because web servers decode `%`
   in URLs, avoid `%` in file names; plain names (`a–z`, `0–9`, `-`, `_`, `.`) work everywhere.
5. Each entry's content matches its CRC-32 and size.
6. Files that nothing refers to are allowed but should produce a warning. This includes files
   under `media/` with an extension that is not a media type, such as `media/notes.txt`.
7. Files that operating systems add by themselves are ignored: `__MACOSX/…`, `._*`, `.DS_Store`,
   `Thumbs.db`, `desktop.ini`.
8. Readers may refuse packages above a size they choose. The reference reader's defaults are 200 MB of
   files, 20 000 entries and 1 MB for `reel.json`.

Published as a folder on a web server, `reel.json` is fetched by URL and every relative `src` is
resolved against that URL. Serve media with `Accept-Ranges` so players can seek in audio and video.

## Validating in Go

With [`santhosh-tekuri/jsonschema/v6`](https://pkg.go.dev/github.com/santhosh-tekuri/jsonschema/v6),
which uses Go's `regexp`:

```go
package main

import (
	"fmt"
	"os"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

func main() {
	compiler := jsonschema.NewCompiler()
	sch, err := compiler.Compile("reel-1.schema.json") // a local copy of this package's file
	if err != nil {
		panic(err)
	}
	f, err := os.Open("reel.json")
	if err != nil {
		panic(err)
	}
	defer f.Close()
	inst, err := jsonschema.UnmarshalJSON(f)
	if err != nil {
		fmt.Println("not JSON:", err)
		os.Exit(1)
	}
	if err := sch.Validate(inst); err != nil {
		fmt.Println(err) // not a valid reel/1 document; lists every problem with its path
		os.Exit(1)
	}
	// Then check the rules the schema cannot express (above).
}
```

## Validating in Python

With [`jsonschema`](https://pypi.org/project/jsonschema/):

```python
import json
from jsonschema import Draft202012Validator

with open("reel-1.schema.json", encoding="utf-8") as f:
    validator = Draft202012Validator(json.load(f))
with open("reel.json", encoding="utf-8") as f:
    doc = json.load(f)

for error in validator.iter_errors(doc):
    print("/".join(map(str, error.absolute_path)) or "document", error.message)
# Then check the rules the schema cannot express (above).
```

## Changelog

[CHANGELOG.md](https://github.com/davidtoska/reel/blob/main/CHANGELOG.md)

## License

MIT
