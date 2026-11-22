# LockIn media

For the web app, use the **[local recap studio and narration API](docs/LOCAL_RECAPS.md)**. The workstation writes scripts, assembles videos and stores them. A separate CPU service runs Kokoro and aligns captions.

## Single-server media service and model research

Ghani's part: self-hosted narration, caption alignment, original gameplay clips
and optional concept b-roll. The selected quality-first stack is **LTX-2.5 DFR**,
**Fish Audio Drama 3**, and **Qwen3-ForcedAligner-0.6B** for timestamps.
See [the research and assumptions](docs/MODEL_SELECTION.md) and
[the prompt guide](docs/PROMPTS.md).

**Installation scripts and local/server walkthrough:**
[Install and connect the AI service](docs/DEPLOYMENT.md).
The web app now accepts the API address under **Settings → Single-server AI connection** in
production as well as development; no UI rebuild is needed to change it.

The service implements Ray's existing `MediaProvider`. The UI composites the
slide, captions and gameplay; this service does not need to render a whole
20–60 second explainer. Slide ingestion and script generation remain upstream.

**Validation boundary:** the API, cache, adapters, caption mapping, MP3 encoding,
Range serving and loop processing can be tested without a GPU. Model loading,
generated quality, GPU memory, inference latency and GPU Docker images remain
unverified until hardware is available. Mock mode is explicitly identified in
health responses and returned provenance; it never claims to be a model result.

[Starter gameplay and music libraries](docs/MEDIA_LIBRARY.md) are downloaded by API setup or Compose.

## Run now, without a GPU

Install Python 3.12, [uv](https://docs.astral.sh/uv/) and FFmpeg. On macOS,
`brew install ffmpeg`; on Linux, `sudo apt-get install ffmpeg`.

```sh
cd media
uv sync --frozen --group dev
bash scripts/download-library.sh
cp .env.example .env
uv run lockin-media doctor
uv run lockin-media serve
```

In another terminal:

```sh
curl http://127.0.0.1:8011/healthz
curl -X POST http://127.0.0.1:8011/media \
  -H 'Content-Type: application/json' --data-binary @examples/rescue.json
```

The default `LOCKIN_MODE=mock` returns estimated captions without an audio URL
for API development. The normal UI rejects this as unavailable narration;
browser speech and procedural video are confined to explicit demo mode.
No weights are downloaded at startup.

Start the UI with the checked-in media connection profile:

```sh
cd web  # from the repository root, in a second terminal
npm ci
npm run dev:media
```

Open `http://localhost:5180`. This profile sets:

```dotenv
VITE_MEDIA_PROVIDER=http
VITE_MEDIA_URL=http://127.0.0.1:8011/
```

Use **Settings → AI connection → Test and save** after the real voice service
is ready. `npm run dev` starts the PDF reader without simulated AI. Set
`LOCKIN_CONTENT_URL` on the media server to forward script requests through the
same public URL. Without it, the connection supplies narration only and full
recaps remain unavailable. The developer Integrations panel still supports
separate content/media addresses for team testing. The URL must be absolute,
including for reverse-proxy setups.
The service allows the UI's actual port, **5180**, on localhost and 127.0.0.1.
Update `LOCKIN_CORS_ORIGINS` if the UI is served from another origin.

To verify browser MP3/video transport without model weights, stop the normal
API and run `uv run python examples/ui_fixture.py` from `media/`. From `web/`, run
`VITE_MEDIA_PROVIDER=http VITE_MEDIA_URL=http://127.0.0.1:8011/ npm run dev:demo`.
This explicitly enables demo scripts with the fixture HTTP service. It serves
a **synthetic test-pattern MP4 and silent
MP3**, with estimated captions and explicit mock provenance, from a temporary
directory that is deleted on exit. It tests file playback and the caption clock,
not voice quality or neural alignment. Open the development sample, press `D`, and
check that the video moves, captions advance and the quiz follows. Stop this
fixture before starting the normal API again.

```sh
uv run pytest -q
uv run ruff check .
uv run lockin-media generate-video --preset marble  # prints the real command; no GPU used
```

## Real model deployment: Linux, local workstation or remote host

These are deployment candidates based on upstream APIs, not a claim that the
models have been executed. **128 GB across several GPUs is not one 128 GB GPU.**
The initial profile assumes four roughly 32 GB NVIDIA cards. The precise GPU
architecture and driver still matter; see the hardware section in the research.
Reserve substantial system RAM for LTX offloading (256 GB is a planning target,
not a measured minimum) and ample disk for model/runtime snapshots (plan 300 GB).

1. Install system prerequisites and inspect the cards:

   ```sh
   sudo apt-get update
   sudo apt-get install -y ffmpeg git build-essential portaudio19-dev libsox-dev libsndfile1
   cd media
   uv sync --frozen
   uv run lockin-media doctor
   ```

2. Prepare **separate** environments. Without `--execute`, each command only
   prints its install plan. Model packages are intentionally absent from the API
   environment; Fish, LTX and Qwen pin incompatible Transformers versions.

   ```sh
   uv run lockin-media setup-runtime voice --execute
   uv run lockin-media setup-runtime video --execute
   uv run lockin-media setup-runtime aligner --execute
   ```

   Fish uses its pinned source and CUDA 12.6 profile. LTX uses its pinned upstream
   workspace lock and NATTEN extra, currently a CUDA 13.2 / PyTorch 2.13 stack.
   The aligner has a separate CPU environment so it does not compete with voice
   GPU memory. Source revisions and model revisions live in
   [models.json](src/lockin_media/models.json). Check driver support for both
   CUDA runtimes before installing. Do not remove dependency pins to force a
   failing installation to resolve.

3. Download the selected weights. This is a large, explicit operation. For
   gated LTX files, accept the model's terms on Hugging Face and authenticate
   with `uv run hf auth login`, or set `HF_TOKEN` in your server shell. No token
   belongs in a Vite variable or committed file.

   ```sh
   uv run lockin-media download voice
   uv run lockin-media download aligner
   uv run lockin-media download video
   ```

4. Generate the reusable video library **before** loading the voice server onto
   overlapping GPUs. LTX uses one selected GPU with CPU layer offloading; this
   preserves BF16 weights without incorrectly assuming VRAM is pooled. For
   independent video jobs on other cards, use separate `LOCKIN_DATA_DIR` values
   and enough host RAM for each process. Multiple jobs can multiply RAM use.

   ```sh
   LOCKIN_VIDEO_GPUS=0 uv run lockin-media generate-video --preset marble --seed 42 --execute
   # Review data/review/<id>/candidate.mp4 and generation.log.
   uv run lockin-media publish-video <id>
   ```

   The default output is 1280×1024, 121 frames at 24 fps. It starts as a roughly
   five-second DFR take, then loses half a second to a tail/head crossfade.
   Crossfading does not guarantee a perfect seam; watch several repetitions.
   For locally generated clips, `publish-video` adds a reviewed candidate to `GET /library/gameplay`.
   Runner, parkour, kinetic-sand and marble presets are included. Generated
   video audio is omitted from the final gameplay asset; narration is separate.

5. Start the persistent voice server and aligner in separate terminals or
   supervised processes. These commands keep running; they must not be run
   serially in one terminal expecting them to exit.

   ```sh
   uv run lockin-media serve-voice --devices cuda:0,cuda:1,cuda:2,cuda:3
   ```

   ```sh
   uv run lockin-media serve-aligner
   ```

   The Fish runtime's documented device list distributes its model; the final
   card holds its audio tower and codec. This placement is not interchangeable
   with LTX's sequence-parallel mode. No `--compile` is passed to Drama 3.

6. Set `LOCKIN_MODE=real` in `.env`. Create persistent **synthetic** reference
   voices, listen to each, and retain the ones that sound right. The reference
   waveform anchors later generations; a random seed alone does not fix timbre.
   The command refuses to overwrite an existing reference.

   ```sh
   LOCKIN_REQUEST_TIMEOUT=300 uv run lockin-media create-voice hype --seed 42
   LOCKIN_REQUEST_TIMEOUT=300 uv run lockin-media create-voice chill --seed 73
   # Listen to data/voices/hype.wav and data/voices/chill.wav.
   LOCKIN_REQUEST_TIMEOUT=300 uv run lockin-media render examples/rescue.json
   uv run lockin-media serve
   curl http://127.0.0.1:8011/readyz
   ```

   Prewarm every required script/voice/speed variant through `render` before a
   demo. Ray's HTTP adapter times out after 60 seconds. We have no basis yet to
   promise a cold Drama 3 generation plus alignment will fit that deadline.
   Cached requests avoid inference. The API has a bounded lock wait and returns
   503 when busy, rather than building an unlimited queue. A failed real request
   never silently substitutes mock output. The UI handles the failure.

## Remote access

The same commands run on a remote Linux GPU server. From your laptop:

```sh
ssh -L 8011:127.0.0.1:8011 user@gpu-server
```

Keep the tunnel open and enter `http://127.0.0.1:8011/` in Settings locally.
The browser must receive a URL it can reach; a server's private container
hostname is not a valid browser media URL.

For a shared HTTPS deployment, put the built web app and `/media-api/*` behind
one origin using [the Caddy example](deploy/Caddyfile.example), then build the UI:

```sh
cd web  # from the repository root
npm run build
```

Enter `https://YOUR-DOMAIN/media-api/` in **Settings → Single-server AI connection**.
Build-time Vite variables remain optional deployment defaults; saved user
connections override them. Returned `assets/...` URLs
are deliberately relative, so the existing UI resolves them under that prefix.
Keep raw Fish/aligner servers private. A generic public TTS service also has
different Fish licensing conditions from narration inside LockIn.

## Containers

Docker and the NVIDIA Container Toolkit are needed for GPU profiles. The
Docker targets isolate the same three environments. Their builds and inference
have **not** been tested on a GPU host.

```sh
docker compose --profile mock up --build mock
```

After downloading the weights into `media/models` as above, stop the mock
profile. Use the video profile first; do not run it over voice GPUs in use:

```sh
docker compose --profile video run --build --rm video \
  generate-video --preset marble --seed 42 --execute
docker compose --profile video run --rm video publish-video <id>
docker compose --profile real up --build -d
docker compose --profile real exec -e LOCKIN_REQUEST_TIMEOUT=300 api lockin-media create-voice hype
docker compose --profile real exec -e LOCKIN_REQUEST_TIMEOUT=300 api lockin-media create-voice chill
docker compose --profile real exec -e LOCKIN_REQUEST_TIMEOUT=300 api lockin-media render examples/rescue.json
```

`LOCKIN_VOICE_DEVICES` can change the four-card default. The host API port is
bound to loopback. Model-server ports are only exposed to the container network.
Model downloads and Docker dependency builds can be done separately from
runtime startup. The API image contains no PyTorch or model weights.

## B-roll and music

B-roll is an offline job too. Pass the exact `key_terms[].broll_prompt` from
the script to `--prompt`, and its term to `--term`:

```sh
uv run lockin-media generate-video --term glycolysis \
  --prompt 'One stylized glucose molecule divides into two smaller groups representing pyruvate. This is a simplified conceptual animation, not an atomically accurate structure.' \
  --execute
uv run lockin-media publish-video <id>
```

It is attached only when both the term and prompt match. The first occurrence
of a multiword term sets `at`. It must be reviewed for factual accuracy; video
models do not guarantee scientifically correct diagrams. If no reviewed clip
exists, `broll` is empty and the UI keeps the slide.

Optionally set `LOCKIN_MUSIC_FILE` to a local file you have rights to use.
FFmpeg ducks it beneath speech in the MP3. No third music-generation model is
implemented, and the UI plays no separate music endpoint.

## Endpoints and storage

| Endpoint | Purpose |
| --- | --- |
| `POST /media` | Current UI request → MP3, aligned words, duration and reviewed b-roll |
| `GET /library/gameplay` | Published MP4 loops, category and energy |
| `GET /voices` | `hype` / `chill` profiles |
| `GET /library/music` | Installed MP3 beds, BPM, tags, attribution and playable URLs |
| `GET /assets/{file}` | Final media, HTTP Range support |
| `GET /healthz` | API liveness and explicit mode |
| `POST /scripts` | Optional proxy to the configured content-team API |
| `POST /feedback/wrong-fact` | Forward content feedback to that API |
| `GET /readyz` | In real mode, model-server health and reference-voice availability |

Readiness is not a measured quality or memory test. `data/cache` holds private
metadata; `data/voices` holds reference WAVs; `data/review` holds unpublished
video takes and logs. Only `data/assets` is served. Cache identities include
the request, voice reference hash, speed, model revisions, prompt revision and
music hash. Restart the API after replacing deployed models or changing config.
Cache/asset retention and per-user deletion need product-level integration.

The first implementation is English-only for alignment. Slang stays in the
spoken text. The pace multiplier is applied before alignment, and source
punctuation is reattached to one caption per whitespace word. Duration is
measured from the delivered audio; `target_seconds` is a script-writing target,
not a promise that arbitrary text will fit exactly. The service does not chop
off speech or silently alter facts to hit a duration.
