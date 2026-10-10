# Writing reels – an authoring guide

How to write a `reel.json` that looks good on a screen and is timed right: picture books with
narration, family albums, lessons, screens in a hallway. For people and for AI agents.

The rules of the format are in [`reel-1.schema.json`](reel-1.schema.json) (every field has a
description with its unit, range and default) and in the [README](README.md). This guide is about
using them well. Complete documents are in [`examples/`](examples).

## 1. The mental model

```
reel
├── music            one file under the whole reel; loops; lowered while narration plays
├── defaults         a text style and a transition, set once for every slide
└── slides[]         played in order; each lasts `duration` seconds
    ├── layers[]     image | video | text | shape, drawn back to front
    └── audio[]      narration and sounds, timed from the start of the slide
```

A reel contains no code and no HTML: a player draws exactly what the document says. The smallest
reel:

```json
{
  "$schema": "https://unpkg.com/reel-schema@1/reel-1.schema.json",
  "format": "reel/1",
  "title": "Hello",
  "slides": [
    { "id": "hello", "duration": 5, "background": "#1d3557",
      "layers": [{ "type": "text", "text": "Hello!", "x": 5, "y": 40, "w": 90, "align": "center", "style": { "size": 9 } }] }
  ]
}
```

`$schema` is optional; with it, editors complete fields and show their descriptions as you type.

## 2. The canvas and units

- The canvas is **16:9**. Players fit it into any screen, with black bars if needed.
- `x` and `w` are **percent of the width**, `y` and `h` **percent of the height**, 0–100. A layer
  without them covers the whole canvas (0, 0, 100, 100); a text layer without `h` is as tall as
  its text.
- Because the canvas is wider than tall, a square or circle has `w : h = 9 : 16`, e.g.
  `"w": 18, "h": 32`.
- Text `size`, `padding`, `radius` and `strokeWidth` are **percent of the canvas height**. Size 5 is
  about 54 px on a 1080p screen and scales with the screen.
- Times are **seconds from the start of the slide**, decimals allowed.
- **Safe area:** keep text, faces and anything important within 5–95 % in both directions. TVs and
  projectors may cut the edges.
- The slide's `credit` is drawn small in the **lower right corner** (1.8 % of the height). Keep other
  text out of that corner.
- **Layer order:** the first layer is at the back. A typical slide is picture → band or dimming
  shape → text.

How much text fits:

- Characters per line ≈ 3.5 × `w` ÷ `size`. With `w` 84 and size 5.5, about 53.
- A **text layer without `h` grows downward from `y`**. Its height ≈ lines × `size` × `lineHeight`
  (1.25) + 2 × `padding`. Two lines at size 5.5 with padding 1.2 are about 16 high, so start a
  two-line caption at `y` ≤ 78 to end above 95.
- With `h`, the text is placed inside the box with `valign` (`top`, `middle`, `bottom`) – useful
  to centre text on a card or band.

## 3. Readable text

- **Sizes:** body text ≥ 4.5 (5–6 on a TV seen from a sofa), titles 6–9, a single word up to 12–14.
  Small labels (3–3.5) only for a word or two.
- **Short:** at most 2–3 lines per caption, about 15 words. Split longer text over several slides
  or let lines appear one after the other.
- **Contrast on pictures:** give the text a `background` (e.g. `"#00000099"` with `"padding": 1.2`
  and `"radius": 1`), or rely on the shadow, which is on by default when there is no background.
  For a band across the full width, put a `rect` shape with a translucent `fill` under the text.
- **Contrast on colour:** on a light slide `background`, use dark text with `"shadow": false` (a
  dark shadow under dark letters looks blurred).
- **Set the style once** in `defaults.text.style`; layers only change what differs. A layer can
  turn an inherited background off with `"background": "#00000000"` – add `"shadow": true` if it
  sits on a picture.
- Fonts are the device's own `sans` or `serif`: serif suits stories, sans suits information.
- Text is plain: `\n` is a line break; nothing is HTML or Markdown. Runs of spaces show as one space,
  so use `\n`, a separator such as " – ", or two text layers side by side to line things up.

## 4. Timing

- **Narrated slide:** `duration` = narration `start` + narration length + about 1.5 s. Start
  narration at 0.5–1 s, after the slide has appeared. Example: start 1, length 8.6 → duration 11–12.
- **Silent slide:** about 2 s + words ÷ 2.5 (people read about 2.5 words per second; use ÷ 2 for
  children and older viewers). A photo needs at least 5–8 s.
- **Transitions** are part of the slide's own time: a 1 s fade uses the slide's first second.
  Fades of 0.5–1.5 s feel calm. `{ "type": "cut" }` changes at once.
- **Layers** appear at `start` and disappear at `end` (default: the end of the slide); `start` must
  be less than the slide's duration. `fadeIn` 0.5–1 s is soft. A layer that lasts to the end of
  the slide needs no `fadeOut`: the next slide's fade covers it.
- **Words appearing as they are read:** one text layer per sentence or line, each with the `start`
  at which the narration says it (listen, or use the word timings from your text-to-speech
  service).
- **Audio clips** must end within the slide: `start + duration ≤` the slide's `duration`. A clip
  still playing when the slide ends is cut off. A viewer who jumps into the middle of a slide does
  not hear narration that has already begun, so several short narrated slides work better than one
  long one.

## 5. Motion

- `motion` zooms and pans an image slowly from `from` to `to`, during the time the layer is
  visible.
- `scale` 1 is the picture as fitted; 1 → 1.1–1.2 over a slide is calm. Up to 2 is allowed, but
  more than 1.3 starts to feel fast and blurry.
- `x` and `y` are the **focus point in percent of the picture as it is shown** in the layer's box
  (with `cover`, the visible part of the picture): the zoom moves towards it. 50, 50 is the centre.
  Zoom towards faces or the thing the text talks about.
- Zoom out by going from 1.15 to 1. Pan by keeping the scale (e.g. 1.2) and moving `x` from 20
  to 80.
- One moving thing at a time: no motion on slides with a lot of text.

## 6. Transitions

- Set one in `defaults.transition`, e.g. `{ "type": "fade", "duration": 1 }`, and override it on
  single slides.
- Use a cut between cards of the same layout (a programme, a list) and fades between pictures.
- A transition is always an object: `"transition": "fade"` is an error.

## 7. Sound

- **Music** plays under the whole reel and loops. Give its real `duration`. `volume` 0.25 is the
  default; 0.15–0.3 works under speech.
- **Ducking:** while an audio clip with `duck` (default true) plays, the music glides down to
  `music.duckTo` (default 0.08) and back up afterwards. Use `"duck": false` for short sound
  effects.
- At most 4 clips per slide: narration, a voice, an effect.
- **Video** layers are muted by default when the slide has audio clips, and play their own sound
  otherwise. Set `"muted": true` for a silent screen; avoid two voices at the same time.

## 8. Accessibility

- `alt` on every picture that carries meaning: what it shows, in one sentence.
- `transcript` on every spoken clip: exactly what is said. For picture books, also show the words
  on screen as text layers.
- `credit` for photos, illustrations and voices that are not your own.
- `language` with the BCP 47 tag of the text and speech (`en`, `nb`, `pt-BR`).
- Large text, strong contrast, a calm pace, no flashing or fast cuts. Older viewers need more
  time and larger text than you think.

## 9. Packaging

A reel is a folder or a `.zip` with `reel.json` at the root and the files under `media/`:

```
my-reel/
├── reel.json
└── media/
    ├── page-1.jpg
    └── page-1.mp3
```

- A `src` is either `media/…` – the exact path in the package, case-sensitive – or an
  `https://` URL. Not `http://`, not `../`, not `/media/…`.
- Use plain file names: `a–z`, `0–9`, `-`, `_` and one `.` before the extension, e.g.
  `media/page-01.jpg`. No `\`, `?` or `#`; avoid spaces and `%`.
- File types: images jpg, jpeg, png, webp, svg, gif; audio mp3, m4a, aac, wav; video mp4 (H.264
  and AAC). Convert other video with
  `ffmpeg -i in.mov -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart media/clip.mp4`.
- **Durations must be the real file lengths** (music, audio clips, video), rounded to 0.1 s. Measure
  them; do not estimate from the text:

  ```bash
  ffprobe -v error -show_entries format=duration -of csv=p=0 media/page-1.mp3
  # 8.613
  ```

  In a browser: `const a = new Audio(url); a.onloadedmetadata = () => console.log(a.duration);`
- Zip the contents of the folder, not the folder itself. Files nothing refers to only give a
  warning.

## 10. Checklist before saving

- [ ] `"format": "reel/1"` and a `title`.
- [ ] Every slide has a unique `id`, a `duration` of 1–600 s and 1–12 layers.
- [ ] Every `src` starts with `media/` or `https://`, has the right type, and the file exists.
- [ ] Audio and video `duration`s are measured; every clip's `start + duration` fits in its slide.
- [ ] Text is ≥ 4.5, inside 5–95 %, at most 2–3 lines, with a background or shadow on pictures.
- [ ] Colours are `#rrggbb` or `#rrggbbaa`.
- [ ] `alt` on pictures, `transcript` on speech, `credit` where due, `language` set.
- [ ] The document passes `validateReel()` from `reel-format`, or the JSON Schema plus the rules in
      the README.

## 11. Common validation errors

Every error starts with the path to the field.

| Error | Fix |
| --- | --- |
| `slides[0].layers[1]: unknown field "fontSize"` | Only reel/1 fields are allowed. Text size is `style.size`. A near miss is suggested: `unknown field "fadein" – did you mean "fadeIn"?` |
| `slides[0].layers[1].style.color: must be #rrggbb or #rrggbbaa – use "#ffffff"` | Write all six digits; no `#fff`, `white` or `rgb()`. |
| `music.src: must start with media/ or https:// – use https://` | `http://` is not allowed. |
| `slides[0].layers[0].src: must start with media/ or https:// – put the file under media/ (e.g. media/photo.jpg)` | Move the file into `media/` and refer to it from there. |
| `slides[2].layers[0].src: .mov is not a video type – use mp4` | Convert the file (see Packaging). |
| `slides[0].layers[0].src: must be a clean relative path (…)` | No `..`, `./`, `//`, `\`, `?` or `#` in the path. |
| `slides[0].transition: must be an object like { "type": "fade", "duration": 1 } or { "type": "cut" }` | Write the object, not `"fade"`. |
| `slides[1].audio[0]: ends after the slide: start + duration = 13.4 s, but the slide lasts 12 s – …` | Make the slide longer, start the clip earlier, or check the measured `duration`. |
| `slides[2].layers[3].start: must be less than the slide's duration (8 s)` | The layer would never be seen; lower `start` or lengthen the slide. |
| `slides[2].layers[3].end: is after the end of the slide (8 s)` | Lower `end`, or leave it out to mean the end of the slide. |
| `slides[4].id: "page-1" is used by an earlier slide` | Give every slide its own `id`. |
| `slides[0].layers: must be a list of 1–12 layers` | Split a crowded slide in two. |
| `slides[0].layers[2].shape: required` | A shape layer needs `"shape": "rect"` or `"ellipse"`. |
| `slides[0].layers[0].duration: required` | A video layer needs the clip's real `duration`. |

## 12. Recipes

Each recipe is one slide: paste it into `"slides"` and change the texts, files and times. The last
one also shows the reel-level `music`.

### Title card

```json
{
  "id": "title", "duration": 6, "background": "#1d3557",
  "layers": [
    { "type": "text", "text": "Our Trip to the Sea", "x": 5, "y": 34, "w": 90, "align": "center", "fadeIn": 1,
      "style": { "font": "serif", "size": 9, "weight": "bold" } },
    { "type": "text", "text": "Summer 2024", "x": 5, "y": 52, "w": 90, "align": "center", "start": 1, "fadeIn": 1,
      "style": { "size": 5, "italic": true } }
  ]
}
```

### Photo with a caption and a slow zoom

```json
{
  "id": "harbour", "duration": 8,
  "layers": [
    { "type": "image", "src": "media/harbour.jpg", "alt": "Fishing boats in a small harbour at sunrise",
      "motion": { "from": { "scale": 1 }, "to": { "scale": 1.15, "x": 60, "y": 45 } } },
    { "type": "text", "text": "The harbour at sunrise", "x": 8, "y": 80, "w": 84, "align": "center", "start": 0.8, "fadeIn": 0.8,
      "style": { "size": 5.5, "background": "#00000099", "padding": 1.2, "radius": 1 } }
  ],
  "credit": "Photo: Ana"
}
```

### Narrated picture-book page, words appearing as they are read

```json
{
  "id": "page-3", "duration": 9,
  "layers": [
    { "type": "image", "src": "media/page-3.jpg", "alt": "The bear knocking on the rabbit's door",
      "motion": { "from": { "scale": 1 }, "to": { "scale": 1.1, "x": 50, "y": 40 } } },
    { "type": "text", "text": "Knock, knock!", "x": 8, "y": 66, "w": 84, "align": "center", "start": 1, "fadeIn": 0.4,
      "style": { "font": "serif", "size": 6, "weight": "bold", "background": "#00000099", "padding": 1.2, "radius": 1 } },
    { "type": "text", "text": "“Who is there?” asked the rabbit.", "x": 8, "y": 78, "w": 84, "align": "center", "start": 3.2, "fadeIn": 0.4,
      "style": { "font": "serif", "size": 5.5, "background": "#00000099", "padding": 1.2, "radius": 1 } }
  ],
  "audio": [{ "src": "media/page-3.mp3", "start": 1, "duration": 6.4,
              "transcript": "Knock, knock! “Who is there?” asked the rabbit." }]
}
```

### Pointing something out with an ellipse

```json
{
  "id": "the-nest", "duration": 9,
  "layers": [
    { "type": "image", "src": "media/oak.jpg", "alt": "An old oak with a bird's nest high up on the left" },
    { "type": "shape", "shape": "ellipse", "x": 22, "y": 14, "w": 13.5, "h": 24, "stroke": "#ffd27a", "strokeWidth": 0.6,
      "start": 2, "end": 8, "fadeIn": 0.5, "fadeOut": 0.5 },
    { "type": "text", "text": "The nest", "x": 37, "y": 22, "w": 30, "start": 2.3, "end": 8, "fadeIn": 0.5, "fadeOut": 0.5,
      "style": { "size": 4.5, "weight": "bold" } }
  ]
}
```

### Text card on colour (a programme, a list)

```json
{
  "id": "today", "duration": 12, "background": "#f4efe6",
  "layers": [
    { "type": "text", "text": "Today", "x": 8, "y": 8, "w": 84,
      "style": { "size": 8, "weight": "bold", "color": "#2f5d50", "shadow": false } },
    { "type": "shape", "shape": "rect", "x": 8, "y": 26, "w": 84, "h": 62, "fill": "#ffffff", "radius": 2 },
    { "type": "text", "text": "10:30 – Coffee and the newspaper\n13:00 – Lunch\n15:00 – Singing in the garden room",
      "x": 12, "y": 26, "w": 76, "h": 62, "valign": "middle",
      "style": { "size": 5.5, "lineHeight": 1.6, "color": "#1f2933", "shadow": false } }
  ]
}
```

### Video with a subtitle

```json
{
  "id": "waves", "duration": 12,
  "layers": [
    { "type": "video", "src": "media/waves.mp4", "duration": 14.5, "trimStart": 2 },
    { "type": "text", "text": "Listen – the waves are coming in.", "x": 8, "y": 80, "w": 84, "align": "center",
      "start": 1, "end": 11, "fadeIn": 0.5, "fadeOut": 0.5,
      "style": { "size": 5, "background": "#00000099", "padding": 1, "radius": 1 } }
  ]
}
```

The video plays its own sound here, because the slide has no audio clips.

### Closing credits

```json
{
  "id": "credits", "duration": 10, "background": "#111111",
  "transition": { "type": "fade", "duration": 1.5 },
  "layers": [
    { "type": "text", "text": "Thank you for watching", "x": 5, "y": 24, "w": 90, "align": "center", "fadeIn": 1,
      "style": { "font": "serif", "size": 7 } },
    { "type": "text", "text": "Story and voice: Maria\nPictures: Jonas\nMusic: “Evening Song”, played by Erik",
      "x": 10, "y": 44, "w": 80, "align": "center", "start": 1.5, "fadeIn": 1,
      "style": { "size": 4.5, "lineHeight": 1.5, "color": "#d9d9d9" } }
  ]
}
```

### Music with ducking under narration

```json
{
  "music": { "src": "media/music.mp3", "duration": 125.4, "volume": 0.3, "duckTo": 0.08 },
  "slides": [
    {
      "id": "garden", "duration": 10,
      "layers": [{ "type": "image", "src": "media/garden.jpg", "alt": "Sunflowers taller than the garden fence" }],
      "audio": [
        { "src": "media/bee.mp3", "start": 0.3, "duration": 1.2, "volume": 0.6, "duck": false },
        { "src": "media/garden.mp3", "start": 1, "duration": 6.8,
          "transcript": "Grandpa grew sunflowers taller than the fence." }
      ]
    }
  ]
}
```

The music plays at 0.3, glides down to 0.08 while the narration plays (the bee does not duck it)
and comes back up for the last two seconds.
