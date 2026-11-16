# LockIn: web UI

The study app from the *LockIn proposal*. It watches attention while you read
slides and, when focus slips, turns the current slide into a short narrated
clip with gameplay underneath and one quiz question, then hands you back.

This folder is the **UI**. The four other parts of the system (gaze tracking,
AI analysis, video, personal AI) plug in through typed interfaces. Every part
ships with a mock, so the whole product runs today without any of them.

```bash
cd web
npm install
npm run dev        # app: http://localhost:5180 · pilot sign-up page: http://localhost:5180/pilot/
```

Try it: **Try the sample deck** on the home screen (or open your own PDF). The
first time, a short consent screen says what is measured and kept. Then
press `D` to simulate looking away. The edges glow, and ~8 s later a clip starts.
Answer the question, then **Finish** for the report.

## Local gaze tracking

To prepare the browser worker and the pinned weights from the existing gaze demo,
start in the repository root:

```bash
cd gaze-demo
npm ci
python3 scripts/fetch-models.py --gaze-only
node scripts/build-worker.mjs
cd ../web
npm ci
npm run gaze:assets
npm run dev -- --host 127.0.0.1
```

In **Integrations → Gaze tracking**, select **BlazeGaze + MediaPipe** before
starting a study session. The same mode can be selected with
`VITE_ATTENTION_PROVIDER=local-gaze`. Open a deck, agree to camera use, and
follow the 9 calibration and 3 validation dots. The study page displays tracking
status and valid off-screen time. The rescue shows whether gaze or window focus
triggered it.

Pausing turns the camera off. Within the same session, resume uses a two-point
check when the camera and window match. A failed or timed-out check, or a changed
camera or window, starts full calibration. You can skip gaze calibration and
continue with window tracking. Camera frames are processed in the browser and
discarded. A qualified 30-second off-screen event can start one rescue per
excursion, subject to the session's cooldown and note-taking controls.

Run **Integrations → Run contract check** during a calibrated session to inspect
live samples. The separate [gaze demo](../gaze-demo/backend/README.md) also
contains the standalone calibration diagnostics, screen-sharing attention
classifier, and local memory harness.

### Try EyeTheia

EyeTheia is an optional choice in **Integrations → Gaze tracking**. Select
**EyeTheia + MediaPipe** before opening a deck, then follow the same calibration
flow. Select **BlazeGaze + MediaPipe** to switch back. The app saves this choice
in the browser.

To prepare EyeTheia on another machine, first set up the local gaze assets
above. From the repository root, use a Python environment with `torch`,
`scipy` and `onnx` installed:

```bash
python gaze-demo/scripts/prepare-eyetheia.py
cd web
npm run gaze:assets
```

The converter verifies the pinned upstream MPIIFaceGaze checkpoint and exports
it to ONNX. EyeTheia runs with ONNX Runtime Web WASM. The source revision and
GPL-3.0 license travel with the local model setup. See the [test results](docs/LOCAL-MODEL-RESULTS.md)
for the browser comparison and replay commands.

### Automated gaze replay

With the dev server running, run this from `web/`:

```bash
node scripts/replay-gaze.mjs http://127.0.0.1:5180/
```

The replay checks the exact source-time threshold, the standalone rules demo,
local pretrained asset loading, pause and calibration fallback, and the full
study rescue and quiz. Chrome runs in a fresh profile with a fake camera.
Playwright can be installed locally or supplied via `LOCKIN_PLAYWRIGHT_MODULE`.
The script also detects the bundled Codex Playwright runtime on this Mac.
Set `LOCKIN_CHROME_EXECUTABLE` to override the browser and
`LOCKIN_REPLAY_ARTIFACTS` to save screenshots of the synthetic run.

## Local user memory bank

Start the existing local backend and the Web dev server in separate terminals:

```bash
cd gaze-demo
./scripts/start-backend.sh
```

```bash
cd web
npm run dev -- --host 127.0.0.1
```

**Integrations → Personal AI → Local memory bank** is the default for the dev
server. A saved Integrations choice can override it. The bank uses the existing
SQLite file and an anonymous per-browser identity. Open the same localhost
address and keep the browser profile to use the same bank. The Web identity and
records are separate from the standalone debug-page identities.

Complete a recap and its quiz, then continue studying. Outcomes with an
unskipped clip and at least 45 usable samples in the next 60 seconds can inform
the next recap of the same deck. The bank rotates through available styles until
each has two usable outcomes, then prefers the style with stronger observed
recovery after accounting for sample size. Plain mode stays direct. The
bundled sample deck has direct, analogy and humor scripts. Uploaded decks in
template mode offer direct and humor. The report explains each choice, shows
how many prior outcomes were usable, and identifies exclusions.

The app passes a retrieved memo to the content provider as context. Simulator
records stay in the replay namespace. When the bank is unavailable, the study
flow uses its default recap and local report scores.

**Settings → Delete my session history** clears the Web bank for this browser
and its local history. The bank can also be checked from the Integrations panel.

Replay synthetic study sessions against a disposable backend database:

```bash
# From gaze-demo/, with the normal backend stopped
LOCKIN_DB=/tmp/lockin-memory-replay.sqlite ./scripts/start-backend.sh
```

```bash
# From web/, with the dev server running
node scripts/replay-memory.mjs http://127.0.0.1:5180/
```

The replay opens a new browser context and checks report details, evidence
exclusions and style rotation after page reloads. It uses the Playwright options documented above.

### Study from a shared screen

Run the local backend with `gaze-demo/scripts/start-backend.sh` and open
the Web demo in desktop Chrome. Choose **Share your screen**, then select a
learning tab, window, or display in Chrome's picker. A full-display or
window share skips capture while LockIn itself has focus. You can pause
reading or stop sharing during the session.

On macOS, the backend startup script builds the Apple Vision OCR helper
using the Xcode Command Line Tools. Screen images stay on the machine and
are discarded after recognition. Local memory can keep a short text
excerpt when a recap is recorded. OCR handles visible text, including
Chinese and English. Gaze indicates whether you are looking at the
calibrated display.

To replay synthetic shared content through real local OCR with a simulated
gaze signal, run `node web/scripts/replay-screen-study.mjs` from the
repository root with the Web dev server and backend running.

### Calibration diagnostics

Calibration attempts from the Web app write one JSON file per result under
`gaze-demo/backend/data/calibration-diagnostics/` on the local machine.
Reports include the outcome, the stage reached, camera error name and size,
per-point sample progress, frame-quality counts, and aggregate validation error.
They contain no camera or screen pixels, device identifiers, or gaze coordinates.
If the local API is unavailable, the browser queues up to 20 reports to retry
the next time the app loads. Set `LOCKIN_CALIBRATION_DIR` to override the backend path.

### Screen activity and study goals

Run `gaze-demo/scripts/start-screen-activity.sh` alongside the Web app and local
backend. The script uses a pinned Qwen3-4B-Instruct-2507 Q4_K_M weight file and
binds llama.cpp to `127.0.0.1:8005`. The backend sends visible OCR text and the
session goal to this loopback service.

Enter a goal in **What are you studying?** before choosing **Share your screen**. Leave it blank for
OCR and gaze-only mode. The model checks the OCR text about every five seconds.
Course material and task-related messages count as study. Sparse or ambiguous
pages, unopened inboxes, and model failures stay quiet. Two consecutive
off-topic checks can produce one soft reminder, subject to the session cooldown.
Activity classification also works with the camera off.

### EmbeddingGemma 2 and cross-deck recall

Start the local embedding and relevance services from `gaze-demo/` in
separate terminals:

```bash
./scripts/start-embeddinggemma.sh
```

```bash
./scripts/start-memory-reranker.sh
```

The scripts check the SHA-256 of the pinned Q8_0 weights and bind EmbeddingGemma
2 to `127.0.0.1:8003` and Qwen3-Reranker-0.6B to `127.0.0.1:8004`. Both can
use a compatible `LOCKIN_LLAMA_SERVER` binary. Set `LOCKIN_EMBEDDINGGEMMA_URL`
or `LOCKIN_MEMORY_RERANKER_URL` to point to a compatible loopback service, or
set either to an empty value to disable cross-deck recall.

For an eligible recap, the bank keeps the deck title, slide title, and up to
360 characters of slide text. The next recap can retrieve up to three related
observations from other decks in the same user and live/replay namespace.
EmbeddingGemma shortlists candidates and the relevance model verifies each
match. When no candidate meets the cutoff, the report shows no related
memories and the content provider receives no cross-deck context. The report
lists the source deck and slide for accepted matches. The retrieved context can inform
the content provider. The current deck's style rotation still uses that deck's
own outcomes. Older entries without topic text still contribute to same-deck
counts. If either model is offline, same-deck memory continues to work.

With both model services running, launch the Web memory replays from the
repository root. The runner creates and cleans up separate temporary databases.

```bash
node web/scripts/run-model-replays.mjs evaluation-results/memory-abstention/web - cross-deck memory-no-match memory-offline style-rotation
```

The replays check the actual rescue report, a similar-topic distractor with
no relevant history, user isolation, reranker failure and same-deck style rotation.
The conservative profile requires both embedding similarity and reranker
relevance to clear their configured thresholds before showing a match.

The regular Demo uses the conservative recall profile. To try the wider
shortlist, start the local backend with `LOCKIN_MEMORY_RERANK_PROFILE=wide`.
Use the same replay commands to inspect how the wider profile changes which
memories are shown.

### Run the offline model benchmarks

With the local model assets and EmbeddingGemma service ready, run
`web/scripts/evaluate-local-models.sh` from the repository root. The runner
uses FFmpeg, Chrome, and Playwright, and downloads the required public data.
It evaluates EOTT webcam recordings and the SciFact and MIRACL Chinese
retrieval splits, then runs the Web replays against temporary databases.
By default, the runner writes its reports and replay output under
`evaluation-results/reproduction/`.

## For the other teams

Read **[docs/INTEGRATION.md](docs/INTEGRATION.md)**. In short:

| Team | Implement | Connect via |
|---|---|---|
| 視線追蹤 Gaze tracking | `AttentionProvider` | WebSocket, or an in-browser plugin |
| AI 分析 AI analysis | `ContentProvider` | HTTP |
| 做影片 Video | `MediaProvider` | HTTP |
| 個人化 AI Personal AI | `AdaptiveProvider` | HTTP |

Press `` ` `` in the app for the **Integrations** panel. There you switch your
module from mock to your service, run a contract check that names any bad
field, drive the focus simulator, and watch every call with its latency.
Working stub servers are in [`examples/`](examples).

## Layout

```
src/
  contracts/         shared types + the four provider interfaces + runtime validators
  providers/
    mock/            stand-ins for every team (simulator, templates, browser voice, Thompson sampling)
    http/  ws/       adapters for real services
    plugins/         in-browser attention plugins (gaze team)
    registry.ts      picks mock / http / ws per team (.env or Integrations panel)
  session/
    machine.ts       pure state machine: focused → drifting → lapse → rescue → recovering (+ tests)
    engine.ts        runtime: samples, window focus, rescues, outcomes, session log
    metrics.ts       attention-span score (+ tests)
    packs.ts         rescue-pack cache, prefetches current slide + 2 ahead
  components/        screens: Desk (home), Study, Rescue, Report, Settings, Integrations; Setup is calibration only (Settings → Recalibrate)
  styles/            tokens (light + dark) and components
pilot/               static pilot sign-up page (Hallmark, Werkstatt theme) + app screenshots
docs/
  INTEGRATION.md     wire formats for each team
  DESIGN.md          UI principles and the research behind them
examples/            FastAPI + WebSocket stubs for each team
```

## Scripts

| | |
|---|---|
| `npm run dev` | dev server with the Integrations panel |
| `npm run build` | type-check and production build (panel hidden unless `VITE_SHOW_INTEGRATIONS=true`) |
| `npm test` | state machine and metrics tests |

## Known limits of the web build

- **Snap-back:** a browser tab can't bring itself to the front. When you're in
  another app, the narration starts as a sound cue and the tab title changes.
  The Electron shell from the proposal fixes this; the UI code is ready for it.
- **Uploaded PDFs** live in memory for the session; reloading the page drops them
  until the AI-analysis service stores decks.
- **Mock narration** uses the browser's speech voice. Caption timing follows
  word-boundary events when the voice provides them, otherwise an estimate.
