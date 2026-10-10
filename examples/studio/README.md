# Reel Studio (example)

An example application for making stories on screens, built on `reel-format` and `reel-player`. It shows two ways to make reels:

- **People** use the visual builder. They drag layers on the real player, set times, text,
  colours, audio and music, upload files or take them from the demo library, and save.
- **Scripts and AI agents** use the open HTTP API. `GET /api` describes everything needed, step by
  step, with the schema, a complete `reel/1` example, templates and limits. The
  [authoring guide](https://github.com/davidtoska/reel/blob/main/packages/reel-schema/GUIDE.md)
  explains the format in more depth.

Every reel is stored as a **package** (`data/reels/<id>/reel.json` + `media/`) and published as it is
at `/reels/<id>/reel.json`. It can be played at `/play.html?src=…`, played in any other page with
`new ReelPlayer(element)` from `reel-player`, downloaded as a `.zip`, and imported from a `.zip`.

The studio is open demo software: no login, CORS open for everyone, and demo data that may be reset.
Uploads are size-limited and served with a sandboxing CSP. All demo images and sounds are generated
(`npm run media -w reel-studio`) and mean nothing.

## Run

From the repository root:

```bash
npm install
npm run build
npm run dev                      # http://localhost:8080
```

`PORT` (default 8080) and `HOST` (default 127.0.0.1; `0.0.0.0` to expose) set where it listens.
The server runs TypeScript directly on Node 22.18+ (or 23.6+) and has no dependencies besides the Reel packages.

## Make a reel with the API

```bash
# 1. Create it, copying two files from the demo library into its media/ folder
curl -X POST localhost:8080/api/reels -H 'Content-Type: application/json' -d '{
  "document": {
    "format": "reel/1", "title": "Made by a script",
    "slides": [{ "id": "one", "duration": 6, "layers": [
      { "type": "image", "src": "media/fjord.svg" },
      { "type": "text", "text": "Hello", "x": 5, "y": 80, "w": 90, "align": "center" } ],
      "audio": [{ "src": "media/chime.wav", "start": 1, "duration": 3 }] }]
  },
  "media": [{ "from": "images/fjord.svg" }, { "from": "audio/chime.wav" }]
}'

# 2. Add your own file; use the returned "src" in the document. Audio and video need their length
#    as "duration": the response has it for WAV files only, so measure mp3/m4a/aac/mp4 yourself:
curl -X PUT --data-binary @voice.mp3 localhost:8080/api/reels/<id>/media/voice.mp3
ffprobe -v error -show_entries format=duration -of csv=p=0 voice.mp3      # e.g. 4.2

# 3. Replace the document (invalid documents are rejected with errors and paths)
curl -X PUT localhost:8080/api/reels/<id> -H 'Content-Type: application/json' -d @reel.json

# Or upload a finished package
curl -X POST --data-binary @my-reel.zip localhost:8080/api/reels/import
```

Templates (`reel-album/1`, `reel-dayplan/1`, `reel-quiz/1`) are simpler documents the server compiles
to `reel/1`. See `GET /api/templates` for complete examples. They belong to this example, not to the
Reel format.

## Layout

```
server/            node:http server: api.ts, store.ts (packages on disk), service.ts, templates/
web/src            builder (editor.ts), gallery, player page – compiled to web/public/app
web/public         HTML pages; an import map loads reel-format and reel-player from /vendor/
library/           generated demo media
scripts/           the media generator
```
