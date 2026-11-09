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
npm run dev        # app: http://localhost:5173 · pilot sign-up page: http://localhost:5173/pilot/
```

Try it: **Try the sample deck** on the home screen (or open your own PDF), then
press `D` to simulate looking away. The edges glow, and ~8 s later a clip starts.
Answer the question, then **Finish** for the report.

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
