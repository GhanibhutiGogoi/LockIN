# Shared-screen gaze trajectories

Phase 1 records estimated gaze movement after calibration and displays it in the
completed screen-session report. It works even when OCR has no result and no
combined attention measurements are available. The recorder remains independent;
the [screen-study pipeline](SCREEN_STUDY_FLOW.md) separately aligns scenes and OCR,
reconstructs focus measurements and orchestrates video reminders.

## Layout

- `src/gazeTrace/types.ts`: versioned report and observation contracts.
- `src/gazeTrace/geometry.ts`: calibration viewport and display geometry.
- `src/gazeTrace/recorder.ts`: bounded sampling, validity, segmentation and smoothing.
- `src/gazeTrace/plot.ts`: SVG path construction and export.
- `src/components/GazeTraceSetup.tsx`: fullscreen or window-coordinate setup.
- `src/components/GazeTraceReport.tsx`: chart, time selection and recording coverage.

The existing local gaze provider supplies observations. The session engine records
them before OCR/confidence filtering and attaches the trace after the adaptive
service call, keeping coordinates out of that service's payload.

## Coordinates and recording

`log.gazeTrace` version 2 contains `coordinateSpace: "calibration-normalized"`, sampling/smoothing settings,
`calibrations`, `samples`, `geometryEvents` and dropped-record counts. Each calibration stores its ID,
timestamp, model, validation errors, viewport size, display size, window position,
device pixel ratio, fullscreen state and available display origin. Its
`coordinateSpace` is `screen` or `viewport`; older reports remain readable.
`geometryEvents` stores the time, calibration ID, before/after geometry, changed
fields and whether the new geometry invalidates the calibration.

Each sample contains:

| Field | Meaning |
| --- | --- |
| `timestamp` | Absolute Unix milliseconds in schema-v2 report downloads |
| `capturedAt`, `receivedAt` | Epoch milliseconds for capture and receipt |
| `calibrationId`, `segment` | Coordinate system and continuous path segment |
| `raw` | Unclamped calibrated coordinates, origin at the viewport's top-left |
| `display` | 150 ms exponential smoothing, reset at every segment boundary |
| `status`, `reason` | Valid, outside, invalid or stale observation and diagnostic reason |

The recorder uses actual camera observations, at most 10 samples per second. It
rejects duplicate/out-of-order captures. Invalid observations, pauses, calibration
changes and gaps of 1.2 seconds or more break the path. Outside coordinates remain
in JSON but are not clamped onto chart edges. Screen dimensions, display origin or
scale changes invalidate screen calibration until a new calibration succeeds.
Window-relative calibration still requires unchanged window geometry. Calibration
error is not per-frame confidence.

The internal recorder and legacy reports use `t` in elapsed milliseconds. The
report export adapter converts it to `timestamp = log.startedAt + t`; it also
converts other report traces from elapsed seconds to the same absolute timebase.

At most 72,000 samples are retained (about two hours at the maximum rate). Older
samples are removed in batches and reported as dropped. SVG detail is reduced for
long sessions; the JSON retains all remaining sampled coordinates. Screen-session
reports are held in memory: download them before refreshing or starting over.
No screenshots or webcam images are added to the trajectory report.

## Coordinate limits

Window-mode calibration gives viewport-relative positions, not desktop positions.
For the first screen-matching trial, use one monitor, choose that entire display
in the screen picker, and choose **Calibrate in fullscreen**. A shared-screen
calibration whose viewport covers the display locks its learned map to that
screen. After validation, exiting fullscreen, moving within the display or resizing
the browser does not change the map or cancel tracking. Keep the same display,
scale, zoom and camera position. The rules remain strict while calibration dots
are being collected. A quick recheck is allowed only in the original viewport;
otherwise a full calibration is required.

The selected shared display is not automatically matched to calibration. Available
screen-origin coordinates help detect monitor changes, but identical monitors
cannot always be distinguished when the browser omits this information. Use one
monitor for this trial. The report records the selected capture surface and capture
dimensions in `screenDiagnostics`; window/tab sharing cannot follow another app.

Background tabs may throttle or stop camera frames. The coverage bar and separate
path segments expose that loss; no coordinates are invented for those intervals.
Looking down to write may produce missing/outside estimates and does not, by itself,
establish distraction. Phase 1 does not change these attention rules.

## Start on Windows

No additional model or package is required beyond the existing gaze/OCR setup.
From the repository root, use separate PowerShell terminals:

```powershell
.\gaze-demo\.venv\Scripts\python.exe gaze-demo/scripts/ocr/start.py
```

```powershell
cd web
npm run dev:gaze
```

Open `http://127.0.0.1:5181/`. Reuse an already running server on ports 8000/5181;
do not start a second copy. OCR is needed for screen text but not for the trace.

## Manual acceptance check

1. Start a new shared-screen session, select the entire display, allow the camera,
   choose fullscreen calibration, and complete calibration and validation.
2. Start learning, then Alt+Tab to WPS on that display. Without moving your head,
   look at the upper-left, upper-right, lower-right, lower-left and center for
   approximately three seconds each. Repeat once and note the elapsed times.
   Chrome may leave webpage fullscreen on switching apps; tracking should continue
   in the original screen coordinate system.
3. Read normally for 15 seconds. Cover the camera for three seconds, uncover it,
   and continue reading. A missing interval must not become a continuous line.
4. Return to LockIn without changing its size. Finish and open the report. Scroll
   below the focus summary if present. **Gaze trajectory** must appear even if
   there are no combined attention measurements.
5. Check the time colors, start/end markers and availability strip. Select the
   corner exercise's time range and toggle **Smooth path**. The broad movement
   should roughly follow the exercise, allowing for webcam gaze error. Compare
   validation errors; do not expect pixel-accurate text selection.
6. Download both **trajectory SVG** and **report JSON**. Open the SVG in a browser;
   inspect `log.gazeTrace.samples`, calibration geometry and validation errors in
   JSON. Confirm timestamps increase, invalid samples have no display coordinate,
   and gaps have separate segment IDs.
7. In a separate short session with screen calibration, exit fullscreen or resize
   LockIn after several seconds. Valid points must continue; `geometryEvents`
   should record compatible changes. A real display/scale change must exclude
   subsequent points until recalibration. Window-relative mode still invalidates
   on window changes. A session with skipped calibration must show an empty
   state rather than a fabricated route.

The corner exercise checks physical mapping on your camera and screen. Automated
replays verify software behavior with known coordinates, not webcam accuracy.

## Automated verification

From `web`, run `npm test` and `npm run build`. With the development server running,
from the repository root run:

```powershell
node web/scripts/replay-gaze-trace.mjs
```

The replay uses Playwright/Chrome, a fake camera, known worker coordinates and fake
OCR responses. It exercises calibration, sharing, valid/missing/outside samples,
geometry changes, both report layouts, filtering, responsive layout and SVG/JSON
downloads. It does not access the user's webcam or test PaddleOCR inference.
Use `LOCKIN_PLAYWRIGHT_MODULE` for a custom Playwright installation and
`LOCKIN_TRACE_ARTIFACTS` to save replay reports and chart images.

Set `LOCKIN_NATIVE_SWITCH=1` for a visible Chrome test. At `NATIVE_SWITCH_READY`,
activate WPS and leave it in front for 12 seconds. The test requires valid gaze
samples during that interval, then checks fullscreen exit, resize and scale-change
handling. This mode disables Playwright's focus emulation and removes its default
background-throttling exemptions. Camera/worker and OCR inputs remain synthetic;
the Windows foreground/background transition is real.
