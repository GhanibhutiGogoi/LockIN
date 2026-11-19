# Run LockIN with a separate voice host

The browser opens the PDF on the learner's computer. When a recap starts, a loopback studio sends the current slide to the learner’s configured LLM. The studio sends the resulting spoken text, voice ID and pace to the narration API. That service returns an MP3 and word timings. The writer also chooses gameplay and music IDs from the local catalog. The studio resolves them against installed files, picks an excerpt, and uses FFmpeg to render the captioned portrait MP4. The studio also serves saved MP4s when the voice host is offline.

## Workstation

Install Node.js 22+, uv and FFmpeg with ffprobe, libass, libx264 and the AAC encoder. Run these commands from the repository root.

```sh
media/scripts/setup.sh api
media/scripts/start-studio.sh
```

Setup downloads and verifies the starter gameplay and music. The studio listens on `127.0.0.1:8013`. In another terminal, start the web app.

```sh
cd web
npm ci
npm run dev -- --host 127.0.0.1
```

The default writer uses a signed-in Codex CLI with support for `exec --ephemeral --ignore-user-config`. Run `codex login` on this computer before starting a recap. The studio invokes it from a temporary directory. To choose another writer, edit `media/.env` and restart the studio.

| Writer | Workstation configuration |
| --- | --- |
| Codex | `LOCKIN_LLM_PROVIDER=codex`. Optional model override in `LOCKIN_LLM_MODEL`. |
| Claude Code | `LOCKIN_LLM_PROVIDER=claude` and a signed-in Claude Code CLI on PATH. |
| Chat Completions API | `LOCKIN_LLM_PROVIDER=api`, `LOCKIN_LLM_BASE_URL` including the provider's version prefix, `LOCKIN_LLM_MODEL`, and `LOCKIN_LLM_API_KEY` when required. The endpoint must support JSON object responses. |

Credentials stay on the workstation. A hosted LLM provider receives the selected slide’s text. For on-device inference, point API mode at a compatible local model server.

## Narration host

Install uv, FFmpeg and ffprobe on the computer that will run Kokoro and the Whisper English word aligner. Both run on CPU. From the repository root run

```sh
media/scripts/setup-narration.sh
media/scripts/start-narration.sh
```

The setup script installs a separate Python 3.11 environment and verifies the six weight files by SHA-256. The service listens on loopback port 18114 by default. The workstation can reach it through a private tunnel

```sh
ssh -NT -o ExitOnForwardFailure=yes -L 127.0.0.1:18114:127.0.0.1:18114 USER@VOICE_HOST
```

The API implements `GET /readyz` and `POST /narration`. A narration request accepts `{"text":"Your spoken script.","voice_id":"hype","pacing":1.0}` and returns `audio_base64` (MP3), word-level `captions`, and `duration_sec`. Each request cleans up its working files. Use a private tunnel or an access-controlled gateway for remote hosting. The service itself has no authentication.

## Connect, play and delete

1. Open `http://127.0.0.1:5180/`. In **Settings → Local video recaps**, enter the narration API base address. Use `http://127.0.0.1:18114/` with the tunnel above. **Connect narration** checks the voice host and local libraries and saves the connection in this browser.
2. Open a text-based PDF, start studying, then choose **Recap slide**. The local default targets 30 seconds. A shorter narration can leave time for a recall question over gameplay and music. A long take can run past the target to preserve intelligibility.
3. Use **Settings → View saved videos** to replay a recap, see its disk use, or delete it after a session. Each published recap has an MP4 and metadata beneath `media/data/recaps/` (relative to `LOCKIN_DATA_DIR` if configured). Deleting a recap removes that directory. Shared source clips and music are reusable across decks.

A connection check uses no model tokens. If the voice check succeeds but the first recap cannot write a script, check the selected CLI login or API configuration. [Starter library sources and size limits](MEDIA_LIBRARY.md)
