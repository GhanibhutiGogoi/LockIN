# Install and connect the AI service

The same LockIn API serves a local GPU workstation or a remote Linux GPU
server. **Settings → AI connection → API address → Test and save** works in
both the development and production web app. The address is saved in that
browser; rebuilding the UI is unnecessary. Use the LockIn API base URL, not
the raw Fish server, a Hugging Face model page, or a `/media` endpoint.

The GPU runtimes and Docker images have not yet been validated on our hardware.
The scripts are supplied and tested without downloading or running the models.
The initial placement is four 32 GB cards; 128 GB total VRAM is not pooled.

See the [media library catalog](MEDIA_LIBRARY.md) for asset sizes, source links and credits.

## Files provided

All scripts accept `--dry-run` and work regardless of your current directory.

| Script under `media/scripts/` | What it does |
| --- | --- |
| `setup-system.sh` | Install Ubuntu/Debian prerequisites with apt; no NVIDIA driver changes |
| `setup.sh api` | Create the API environment and install the starter gameplay and music libraries |
| `download-library.sh` | Verify the starter library and download missing or corrupt files |
| `setup.sh all` | Also install isolated Fish, LTX and alignment runtimes at pinned revisions |
| `download-models.sh all` | Download pinned voice, video and alignment weights; rerunnable/resumable |
| `generate-video.sh` | Print a video job plan; add `--execute` to generate a candidate |
| `start-local.sh` | Run real voice, aligner and gateway together; Ctrl-C stops this stack |
| `start-server.sh` | Build and start persistent Docker services; needs NVIDIA Container Toolkit |
| `initialize-voices.sh local` | Generate persistent synthetic reference voices; keep existing references |
| `initialize-voices.sh server` | Same operation inside the running API container |

`setup.sh` and `download-models.sh` also accept `voice`, `video` or `aligner`
individually. Model revisions and selected filenames are in
[`models.json`](../src/lockin_media/models.json); environments use frozen uv locks.
No startup command automatically downloads weights. No script overwrites `.env`.

Plan roughly 300 GB of disk and 256 GB host RAM for the selected video offloading
profile. These are planning allowances, not measured minimums. Verify the
drivers support both the pinned Fish CUDA 12.6 and LTX CUDA 13.2 runtime stacks.

## Local GPU workstation (Linux)

From the repository root:

```sh
media/scripts/setup-system.sh
media/scripts/setup.sh all
```

Accept any gated model terms on Hugging Face. Authenticate once using
`cd media && uv run hf auth login`, or export `HF_TOKEN` in the server shell.
If uv was bootstrapped by setup, its executable is `media/.tools/bin/uv`.
Never put model-download credentials into the browser settings.

```sh
media/scripts/download-models.sh all
media/scripts/generate-video.sh --preset marble --seed 42 --execute
```

Review `media/data/review/<id>/candidate.mp4`, then publish it:

```sh
cd media
uv run lockin-media publish-video <id>
```

Generate other gameplay presets before starting the voice model on overlapping
GPUs. LTX is an **offline library builder**, not a per-slide live video server.
Unpublished candidates never appear in the UI. Missing gameplay keeps the slide
visible while narration plays.

Edit `media/.env`:

```dotenv
LOCKIN_MODE=real
LOCKIN_VOICE_DEVICES=cuda:0,cuda:1,cuda:2,cuda:3
# Set this to the content team's running script API; omit only for media-only use.
LOCKIN_CONTENT_URL=http://127.0.0.1:8010/
# Include the exact origin of the UI, without a path or trailing slash.
LOCKIN_CORS_ORIGINS=["http://localhost:5180","http://127.0.0.1:5180"]
```

From the repository root:

```sh
media/scripts/start-local.sh
```

Keep that terminal open. Once the model servers finish loading, in another terminal:

```sh
media/scripts/initialize-voices.sh local
curl --fail http://127.0.0.1:8011/readyz
```

Listen to both files under `media/data/voices/`. In the UI, enter
**`http://127.0.0.1:8011/`** and select **Test and save**. Existing study sessions
must be finished before changing their connection.

## Remote GPU server (Docker)

Install Docker Compose, NVIDIA drivers and NVIDIA Container Toolkit on the
Linux server. Clone/copy this repository there. The API environment downloads
weights; the Docker build installs model runtimes, so host `setup.sh all` is
unnecessary for this path.

```sh
media/scripts/setup.sh api
media/scripts/download-models.sh all
cd media
docker compose --profile video run --build --rm video generate-video --preset marble --seed 42 --execute
# Inspect data/review/<id>/candidate.mp4 before publishing:
docker compose --profile video run --rm video publish-video <id>
cd ..
media/scripts/start-server.sh
# Wait for voice and aligner health checks; inspect docker compose logs if needed.
media/scripts/initialize-voices.sh server
```

Configure `.env` before starting the server. `LOCKIN_CONTENT_URL` must be
reachable **from inside the API container**. A host loopback address points to
the container itself; use a shared Docker network/service name or a reachable
host address for the content team's deployment. For example,
`http://content:8010/` only works after attaching both services to the same network.
The current Compose file does not include a content-model container.

Only port 8011 is published, on host loopback. Fish and the aligner stay on the
private container network. Models are mounted read-only from `media/models`;
assets and reference voices persist in `media/data`. Native launchers support
custom storage paths; the supplied Compose file deliberately uses these fixed
host mounts. Stop the deployment with `cd media && docker compose --profile real down`;
this retains models and generated files.

To use it from a laptop, open a tunnel:

```sh
ssh -N -L 8011:127.0.0.1:8011 user@gpu-server
```

Keep the tunnel open and enter **`http://127.0.0.1:8011/`** in the locally served UI.

For shared hosting, use the [Caddy example](../deploy/Caddyfile.example) with
your actual domain, web build path and password hash. Serve the web app and API
under the same HTTPS origin. Enter **`https://YOUR-DOMAIN/media-api/`** in
Settings. Audio/video URLs stay relative to that prefix. An HTTPS web page
requires an HTTPS API; for a separate API origin, include the web origin in
`LOCKIN_CORS_ORIGINS`. The example's browser login works through the same-origin
gateway; the app does not store HTTP credentials or provider keys.

## What one API link enables

- `/healthz`, `/readyz`, `/voices`, `/library/gameplay`: checked without sending
  slides or generating audio. Mock/unready servers are rejected; a failed check
  leaves the previous connection intact.
- `/media` and `/assets/*`: voice, aligned captions and published gameplay/b-roll.
- `/scripts` and `/feedback/wrong-fact`: forwarded to `LOCKIN_CONTENT_URL` when
  configured. An optional `LOCKIN_CONTENT_API_KEY` stays on the server.

**A content/script model is still required for full recaps.** Voice and video
models do not write slide explanations or quizzes. The UI discovers whether the
gateway has this upstream configured; it does not run script inference during
the connection check. Actual script errors are shown when generating a recap.
The content team must implement the existing
[script contract](../../web/docs/INTEGRATION.md). This gateway does not implement
PPTX conversion or OCR; PDF import stays local.

After startup, prewarm required scripts using `lockin-media render` if needed.
The UI's media request timeout is 60 seconds, and cold generation latency has
not been measured. Setting the server's timeout higher does not change the
browser timeout. API readiness checks do not establish output quality, actual
multi-GPU fit or acceptable inference latency; those still require GPU testing.
