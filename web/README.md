# LockIn: web UI

The study app from the *LockIn proposal*. It watches attention while you read
slides and, when focus slips, turns the current slide into a short narrated
clip with gameplay underneath and one quiz question, then hands you back.

This folder is the **web app**. The normal build reads real PDFs, saves them in
IndexedDB and records actual study activity. Gaze tracking, script generation,
narration and personalization plug in through typed interfaces. Disconnected
features are labelled unavailable; they never silently substitute demo output.

```bash
cd web
npm ci
npm run dev        # app: http://localhost:5180 · pilot sign-up page: http://localhost:5180/pilot/
```

Use Node.js 24 (also used by CI).

Choose **Open your slides** or drop one PDF (up to 50 MB, 500 pages). Study with
the arrow keys, pause with `P`, and choose **Finish → See my report**. Reloading
restores your saved decks and completed reports; reopening a deck restores the
last slide. Saved PDFs stay in this browser, not a cloud account. Remove decks
from the library, and delete local report history in Settings.

Without a gaze tracker, reports show study time and slides visited, without
claiming an attention score. Without content and media services, AI recaps are
unavailable. With both connected, **Recap slide** works without a gaze tracker;
automatic recaps can also respond to app switches or real gaze measurements.
Scanned/image-only PDFs remain readable but need OCR before text-based recaps.

Open **Settings → AI connection**, paste your local or hosted LockIn API base
address, and choose **Test and save**. The app checks model readiness and saves
the address in this browser, including in production builds. No rebuild is
needed. Use `http://127.0.0.1:8011/` locally or through an SSH tunnel, or an HTTPS
server address such as `https://YOUR-DOMAIN/media-api/`. HTTPS pages require an
HTTPS API. **Disconnect** restores slide-only study. Changes require finishing
the current session, so its requests cannot be split between servers.

The [deployment guide](../media/docs/DEPLOYMENT.md) includes `.sh` installation,
weight-download and launch scripts. Configure `LOCKIN_CONTENT_URL` on that
server for scripts and quizzes through the same API address. The media models
alone cannot write a recap. The UI's connection check confirms media readiness
and configured script routing; it does not perform model inference.

## For the other teams

Read **[docs/INTEGRATION.md](docs/INTEGRATION.md)**. In short:

| Team | Implement | Connect via |
|---|---|---|
| 視線追蹤 Gaze tracking | `AttentionProvider` | WebSocket, or an in-browser plugin |
| AI 分析 AI analysis | `ContentProvider` | HTTP |
| 做影片 Video | `MediaProvider` | HTTP |
| 個人化 AI Personal AI | `AdaptiveProvider` | HTTP |

Press `` ` `` in the app for the **Integrations** panel. There you switch your
module from local/off to your service, run a contract check that names any bad
field, and watch every call with its latency. Production ignores old developer
overrides, but honours connections explicitly saved through Settings.
Working stub servers are in [`examples/`](examples).

For deployment defaults with separate team APIs, set `VITE_CONTENT_PROVIDER=http`,
`VITE_MEDIA_PROVIDER=http` and their browser-reachable URLs before `npm run build`.
The public Settings form can instead connect both through one media gateway.
Set attention to `ws`
and adaptive to `http` only when those services are available. PDF import itself
stays local; slide text is sent for AI scripts. PowerPoint appears in the picker
only when the content conversion service is configured. Legacy `.ppt` requires
exporting to PDF. Real model deployment remains subject to GPU validation.

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
    packs.ts         on-demand rescue-pack cache, invalidated when services change
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
| `npm run dev:media` | dev server connected to the media API on `127.0.0.1:8011` ([setup](../media/README.md)) |
| `npm run dev:demo` | explicit synthetic development mode, sample deck and focus simulator; its reports are not saved |
| `npm run build` | type-check and production build (panel hidden unless `VITE_SHOW_INTEGRATIONS=true`) |
| `npm test` | upload/storage, UI flow, session lifecycle, provider, contract and playback tests |

## Known limits of the web build

- **Snap-back:** a browser tab can't bring itself to the front. When you're in
  another app, the narration starts as a sound cue and the tab title changes.
  The Electron shell from the proposal fixes this; the UI code is ready for it.
- **Storage** is browser-local. A full/private/unavailable storage area shows a
  warning; the current file can still be studied. Clearing site data deletes
  saved files. Completed reports can be downloaded as JSON. An unfinished
  session is not recovered after reload; its deck and last slide are saved.
- **PowerPoint** needs the connected conversion service. No local PPTX renderer
  or OCR service is bundled.
- **Development demos** require `npm run dev:demo`; their generated quizzes,
  simulated focus, procedural video and browser speech are not production AI.
  The UI integration test uses a PDF parser fixture; actual PDF rendering was
  separately checked in Chrome. Real GPU inference remains unverified.
