# Shared-screen study on Windows

## Start

Run from the repository root in PowerShell:

```powershell
.\gaze-demo\.venv\Scripts\python.exe scripts/windows/start.py
.\gaze-demo\.venv\Scripts\python.exe scripts/windows/start.py --check
```

Open `http://127.0.0.1:5181/`. The launcher starts missing services in the background and retains occupied ports. Logs and process IDs are under `.runtime/windows/`. A listening port is not proof that its service is healthy; use `--check` and inspect the logs. Restart an existing service after changing its Python code. The launcher does not kill unrelated processes.

| Service | Port | Purpose |
| --- | --- | --- |
| OCR backend | 8000 | PaddleOCR and relevance API |
| Local Qwen model | 8005 | Bilingual content relevance |
| Video studio | 8013 | Script, narration connection, library and MP4 composition |
| Web app | 5181 | Calibration, capture, attention and report |

Before starting a session, open **Settings → Local video recaps**. Enter the teammate's narration API address and click **Connect narration**. The studio must report a connected writer and installed gameplay/music. The address is the remote voice service, not the local OCR backend. The workstation's configured writer still needs valid CLI login or API credentials. Production gaze mode does not silently substitute mock videos.

For a fresh Windows checkout, first install the existing gaze/OCR environment, then run:

```powershell
.\gaze-demo\.venv\Scripts\python.exe scripts/windows/setup.py
```

This installs pinned, SHA-256 verified Qwen3 4B Q4 weights (about 2.5 GB), llama.cpp CPU runtime, FFmpeg, an isolated `media/.venv`, and the existing verified starter library. Models live under `gaze-demo/.models/screen-activity`; video tools under `media/.tools`; media assets and generated videos under `media/data`. No model files belong in Git. The setup handles Chinese workspace paths and resumes interrupted downloads.

## Manual acceptance checklist

1. Connect narration before starting. Enter a concrete study goal, such as “Data mining: outlier detection and boxplots”. Choose **Share your screen**, select the **entire display**, accept the disclosure and complete gaze calibration on that display.
2. Open WPS or another browser tab on the same display. Read a clearly relevant page for 45–60 seconds. Expect extracted text and a related classification. Switching applications alone must not trigger a video. Keep the camera unobstructed; avoid moving to another monitor.
3. Flip or scroll to a different page. Expect a new screen moment, with a temporary pending/unknown interval. Slow OCR should be assigned to that moment in the eventual report, not to its response time.
4. Briefly look away for 4–5 seconds, then return. Preparation may start, but a video must not interrupt after recovery. A completed same-topic render can remain cached for a later, independently confirmed lapse.
5. In a fresh session, read relevant material first, then look away while the tracker still has valid evidence. Preparation starts after about 3 seconds. A playback request requires at least 30 seconds of observed distraction **and** a ready video. Brief unknown intervals pause the dwell and retain the generation task; they never authorize playback. More than five seconds without valid risk evidence resets the dwell, while the render stays reusable. One second of confirmed study recovery cancels the pending intervention. First-time script/narration generation can take several minutes; 30 seconds is a minimum evidence threshold, not a guaranteed delivery time.
6. Allow the notification or listen for the cue, return to LockIn, and watch the video. If autoplay is blocked, click the playback button. Answer the question and return to WPS. A web page cannot reliably force itself above another application; video waits for LockIn to be visible and focused.
7. In another fresh session, read relevant material first, then keep looking at clearly unrelated content (for example, a shopping cart). Expect an off-topic classification, preparation, and the same sustained-dwell video/quiz flow. Ambiguous or mixed content must remain uncertain. The recap uses the last recognized study-related material, not the unrelated page.
8. Cover the camera or click **Taking notes** (60 seconds of grace). Missing gaze and note-taking must not create an automatic video. Pause/resume and stop sharing must also stop the associated intervention timers. Use a new session for each trigger test to avoid the existing three-minute recovery cooldown and repeated-rescue limit.
9. Finish the session. Capture stops immediately; queued analysis has up to 90 seconds to settle. Expect measured-interval totals, a focus curve where evidence is sufficient, the gaze trajectory, five-second evidence windows, questions and rescue outcomes. Unknown intervals remain unknown; no interpolation claims full-session focus.
10. Download the JSON and inspect the fields below. Every former `t` field must be named `timestamp`; OCR capture and completion times must remain distinguishable.

## Report contract

Downloaded reports have `schemaVersion: 2` and `timestampUnit: "unix-ms"`. Every `timestamp` is an absolute Unix timestamp in milliseconds, including focus samples, gaze diagnostics, gaze trajectory samples and geometry events. Compute elapsed seconds as `(timestamp - log.startedAt) / 1000`. Existing provider/adaptive wire protocols and old in-browser reports retain their legacy fields internally; the export adapter converts both old and new reports without changing those APIs.

Low-level gaze diagnostics retain the tracker's own timing counters, including
its native `capturedAt`. Use gaze-trajectory `timestamp` for precise screen/gaze
joins, and diagnostic `timestamp` for the one-second diagnostic log.

- `log.screenAnalysis.scenes`: capture timestamp, last confirmed observation, OCR completion/classification times, text, polygons, confidence, relevance and processing status.
- `log.screenAnalysis.measurements`: time-weighted gaze evidence linked by `sceneId`; OCR-region overlap is diagnostic, not a cognitive-attention label.
- `log.screenAnalysis.windows`: five-second totals for focused, looking-away, off-topic, unknown and excluded time.
- `log.screenAnalysis.events`: preparation, cancellation, readiness, playback, quiz and return events.
- `log.screenAnalysis.summary`: exact measured durations, continuous focus stretches, and unknown-time reasons. Report headlines use these intervals rather than counting chart points.
- `log.gazeTrace`: independently recorded coordinates and calibration metadata.
- `log.samples`: compatible 1 Hz focus curve reconstructed from historical evidence. A chart second requires at least 800 ms of supported measurements; shorter measured intervals still count in the summary. Actual unknown intervals break measured focus stretches.

Screenshots are transient and bounded in memory. Recognized text and polygons are intentionally included in the downloaded report. Only the study-text excerpt needed for a recap goes to configured script/video services; gaze coordinates remain local. A screenshot is not an instruction to the classifier or writer.

For a scene, `processingStartedAt - timestamp` measures queue delay;
`ocrDurationMs` is the backend's recognition duration; `completedAt - timestamp`
is capture-to-OCR latency. `classifiedAt` records the later relevance response.

## Implementation boundaries

- `src/screenStudy/`: pure temporal analysis, screen-change detection, bounded OCR queue and continuous-dwell policy.
- `src/lib/screenShare.ts`: browser capture and publishing current/historical scene results.
- `src/session/engine.ts`: provider lifetime, preparation ownership, playback/quiz orchestration and report finalization.
- `src/session/reportExport.ts`: timestamp migration at the report boundary.
- `scripts/windows/`: workstation installation, service startup and real-service verification.

Capture checks run independently of OCR, nominally every 750 ms. Change detection ignores the top 12% and bottom 6% (toolbars and clocks), and requires more than 0.6% changed pixels in the remaining region. The comparison stays anchored to the original scene frame so gradual scrolling accumulates. These tolerances can miss small changes; they are not proof of pixel-identical content. A recent page is held until the next capture establishes a change; capture gaps longer than 2.5 seconds and pauses break continuity.

Stable scenes reuse OCR, with a two-minute refresh. The queue retains one active and at most four waiting frames, removing the shortest waiting visit first when full. A stable current scene is prioritized during learning; longer visits are prioritized while finalizing the report. Finalization waits at most 90 seconds for remaining analysis. Unprocessed scenes remain explicitly unknown. Historical results stay aligned to their original capture timestamps.

Consecutive valid gaze samples with the same state support the interval between them only when they are less than 1.2 seconds apart. Unknown or conflicting samples are never filled as focused. Other samples have at most 350 ms of forward support. The report shows total measured coverage, unknown-time reasons, and focused/unknown time after the latest recap.

This is a coarse, webcam-based estimate. Pixel-change thresholds can miss tiny changes or over-segment animations. Monitor identity cannot be verified by the browser; share the display used for calibration. Text-box overlap uses calibration-error margins and is not used to penalize looking at diagrams or whitespace. Mixed-window relevance remains uncertain rather than claiming precise word-level attention.

## Automated checks

```powershell
cd web
npm test
npm run build
cd ..
.\gaze-demo\.venv\Scripts\python.exe -X utf8 scripts/windows/verify_flow.py --voice-url http://VOICE_HOST:18114/
node web/scripts/replay-screen-flow.mjs
$env:LOCKIN_TEST_VOICE_URL = 'http://VOICE_HOST:18114/'
node web/scripts/replay-screen-flow.mjs http://127.0.0.1:5181/ --real-media
```

The API check creates a real short video from synthetic bilingual text. The browser replay uses controlled gaze, real OCR/relevance and that verified MP4 to test both intervention paths, actual playback, quiz completion and report export. It replays the script/media responses to avoid regenerating the same validation video. Artifacts are saved under `.runtime/windows/`; this does not replace validation of a real person's gaze and calibration.

With `--real-media`, the browser also calls the actual script and media services. It injects a short tracking interruption after 35 seconds, verifies that generation is retained, then checks playback, quiz completion and report export. `real-playback-timing.json` records preparation-to-ready and ready-to-playback-request durations. Returning focus to LockIn is measured separately from media readiness.

The relevance model selects numbered OCR blocks; the server resolves evidence directly from those blocks. Known tracking overlays and application controls are filtered before classification and recap generation. Scene diagnostics retain the raw decision, resolved evidence and validation reason. Screen recap caches use normalized study text rather than observation indices, while retaining voice, style, pacing and connection boundaries.
