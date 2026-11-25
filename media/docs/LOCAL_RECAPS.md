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

## Script latency experiment (2026-11-25)

The `codex/faster-video-generation` branch is based on PR #8's conflict-resolution
commit `8e6a7f0`. The actual writer was verified by running the existing CLI path:
`gpt-6.2-sol`, OpenAI provider, low reasoning. The default is now explicitly pinned
instead of inheriting a future CLI default. `LOCKIN_LLM_MODEL` still overrides it.

The first optimization keeps the MP4 playback flow. It reduces the narration word
budget from 3.0 to 2.3 words per target second (adjusted by pacing), asks for concise
summary/quiz feedback, and lets the existing compositor select assets locally.
It no longer sends the asset catalog to the model by default. Set
`LOCKIN_LLM_SELECT_ASSETS=true` to restore model-directed asset selection.

Validated scripts are cached locally for one hour, up to 128 entries, in
`media/data/cache/script-*.json`. Keys cover the full request, model/provider,
reasoning configuration, prompt version and credentials; raw source text and
credentials are not stored in cache filenames or timing logs. Cache files contain
the generated educational text. Concurrent identical requests share a generation.
Failures are not cached. Set `LOCKIN_LLM_CACHE_SECONDS=0` to disable reuse or delete
these cache files while the studio is stopped. Changing content or generation
settings invalidates reuse. Media caching continues independently as before.

Run a repeatable synthetic-text benchmark from `media/`:

```powershell
.venv/Scripts/python.exe -X utf8 scripts/benchmark-scripts.py --runs 3 --output ../.runtime/windows/script-optimized.json
```

This performs three uncached real generations and a separate generation/cache-hit
pair. It uses temporary storage, does not require the narration server, and does
not send personal screen content. `--model` compares another available Codex model.

Measured on this workstation (small sample, not a latency guarantee):

| Configuration | Script latency |
| --- | --- |
| Original prompt, actual CLI default gpt-6.2-sol (one run) | 24.353 s |
| Shorter prompt, same model (three uncached API-handler runs) | 20.631 / 20.059 / 20.012 s |
| Same request, cached | 0.064 s |
| Shorter prompt, gpt-6-luna (one direct writer run) | 18.236 s |

The three-run median is 20.059 s, approximately 18% below the single current
baseline. The historical 123 s script latency was from a different run and should
not be used to attribute a six-fold gain to this change. The lighter model's small
single-run advantage was insufficient to change the default. Sample outputs kept
the 1.5 IQR fences and the distinction between potential outliers and errors.
Full uncached video readiness within 27 seconds has NOT yet been demonstrated.
The local narration endpoint on port 18114 refused connections during this test.

### Stage timings

Restart the studio after updating. Each `/scripts` and `/media` request writes one
JSON line to `media/data/timings.jsonl` (or the configured `LOCKIN_DATA_DIR`). Each
record has a UTC timestamp, request ID, HTTP status, total milliseconds, stages,
actual writer model when reported, and cache-hit metadata. It contains no prompts,
credentials, source text or generated speech text. Timings also appear in server
logs and `Server-Timing` / `X-Request-ID` response headers. Browser integration logs
show the headers and playback-start delay (including media loading).

Stages include `script_queue`, `llm`, `script_total`, `media_queue`,
`narration_request`, `voice_probe`, `captions`, `ffmpeg_encode`, `video_probe`, and
`composition`. Totals contain their sub-stages; do not add them all together.
Network/service wait is included in `narration_request`.

Update and restart the remote narration service too to obtain `remote_queue`,
`remote_tts`, `remote_pace`, `remote_audio_probe`, `remote_alignment` and
`remote_audio_encode`. Old narration servers remain compatible but supply only
the overall narration-request duration. Remote services log their own request
records and return `timings_ms` with the audio. Cache hits naturally omit stages
that did not execute. Keep window-focus/autoplay waiting separate from generation
latency when assessing the 30-second intervention target.
