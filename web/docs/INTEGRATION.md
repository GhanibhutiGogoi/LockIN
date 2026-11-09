# Plugging into the LockIn UI

> **中文摘要**：UI 已經可以獨立跑（每一組都有 mock）。每組只要實作 `src/contracts/providers.ts` 裡屬於自己的那一個介面，
> 或是照下面的 HTTP / WebSocket 格式開一個服務，然後在畫面右下角的 **Integrations**（或按 `` ` ``）把自己那組從 `mock` 切到 `http` / `ws`、
> 填上網址、按 **Run contract check**。格式不對的話，面板會直接列出是哪個欄位錯。

| Team | Interface | How you connect | Default URL |
|---|---|---|---|
| 視線追蹤 Gaze tracking | `AttentionProvider` | WebSocket **or** in-browser plugin | `ws://localhost:8765` |
| AI 分析 AI analysis | `ContentProvider` | HTTP | `http://localhost:8000` |
| 做影片 Video | `MediaProvider` | HTTP | `http://localhost:8001` |
| 個人化 AI Personal AI | `AdaptiveProvider` | HTTP | `http://localhost:8002` |

All shapes are defined once in [`src/contracts/types.ts`](../src/contracts/types.ts).
That file is the source of truth; this page explains it.

---

## How the pieces fit

```
               ┌──────────── UI (this repo) ────────────┐
 webcam ─▶ [Gaze] ─ FocusSample 10 Hz ─▶ smoothing ─▶ state machine ─▶ lapse
                                          window focus ┘                │
                                                                         ▼
                  [Personal AI] ◀── RescueContext ── chooseVariant ── rescue
                        │                                                │
                        └── Variant ─▶ [AI analysis] getScript ─▶ RescueScript
                                                  │
                                       [Video] renderMedia ─▶ RescueMedia
                                                  │
                                       rescue player + quiz (UI)
                                                  │
                     RescueOutcome (60 s later) ─▶ [Personal AI] reportOutcome
                     SessionLog (on Finish)     ─▶ [Personal AI] endSession
```

The UI owns: the camera stream, window focus, smoothing, the state machine
(thresholds from the proposal), the pack cache, playback, quiz, and the report.
Every team owns one box and talks to the UI only through its interface.

**Wire conventions (all HTTP + WS):**

- JSON. Send `snake_case` or `camelCase`; the UI converts both ways
  (requests are sent as `snake_case`).
- Times inside media are **seconds**; timestamps (`t`, `started_at`) are **ms since epoch**.
- Relative URLs in responses (`audio_url`, `pdf_url`, b-roll `url`) are resolved against your base URL.
- Enable CORS for the UI origin (`http://localhost:5173` in dev).
- A `GET /health` returning `200` is appreciated, not required.

Runnable stubs for every service are in [`examples/`](../examples). Start from them.

---

## 視線追蹤 · Gaze tracking → `AttentionProvider`

**You produce:** a focus score from the camera only, ~10 times a second.
The UI adds window focus, smooths over 1 s, and decides drifting / lapse.

```ts
interface FocusSample {
  t: number;            // ms since epoch
  score: number;        // 0–100, camera only
  confidence: number;   // 0–1; < 0.3 = ignored (glare, dark), never counted as drift
  signals?: { gaze?: number; head?: number; eyesOpen?: number; facePresent?: number }; // each 0–1
  gazePoint?: { x: number; y: number }; // optional, viewport 0–1
}
```

- `signals.eyesOpen < 0.25` for 3 s ⇒ the UI treats it as drowsy and starts a rescue.
- Low `confidence` is how you say "I can't tell". Use it rather than guessing.
- **Please re-check the score weights.** With the proposal's formula, someone
  looking down at a phone with eyes open scores exactly 45, which is right on
  the drift threshold (it needs to be < 45). The simulator renormalises the
  camera terms; your model should make "on phone" land well below 45.

### Option A: WebSocket (any language, recommended to start)

Run your model as its own process and stream samples.

```
server → UI  {"t": 1730620800123, "score": 82, "confidence": 0.9,
              "signals": {"gaze": 0.9, "head": 0.95, "eyes_open": 1, "face_present": 1}}
             {"type": "status", "status": "running" | "error", "detail": "…"}
             {"type": "calibrate_point_done", "id": "…"}

UI → server  {"type": "start"}  /  {"type": "stop"}
             {"type": "calibrate_point", "id": "…", "x": 0.06, "y": 0.08}   // look-at dot, viewport 0–1
             {"type": "finish_calibration"}
             {"type": "probe", "t": …, "focused": true}                    // "were you focused just now?"
```

Calibration: the UI shows a dot, sends `calibrate_point`, and waits up to 4 s
for `calibrate_point_done` with the same `id` before moving on. Five dots
(centre, then corners), then 20 s of normal reading.

In WS mode your process opens the camera itself, so the browser does not.
Example: [`examples/gaze_ws_stub.py`](../examples/gaze_ws_stub.py).

### Option B: in-browser plugin (the production path)

Implement `AttentionProvider` in TypeScript (MediaPipe Tasks + WebEyeTrack in a
Web Worker), set `needsCamera = true`, and the UI hands you its `MediaStream`.
Register it in [`src/providers/plugins/index.ts`](../src/providers/plugins/index.ts):

```ts
registerAttentionPlugin('mediapipe', 'MediaPipe + WebEyeTrack', () => new MediaPipeAttention());
```

It then appears in the Integrations mode dropdown. A working skeleton is in
[`src/providers/plugins/attentionTemplate.ts`](../src/providers/plugins/attentionTemplate.ts).
Never upload or store frames.

**Test:** Integrations → Gaze tracking → *Run contract check* (expects ~15 samples in 1.5 s).

---

## AI 分析 · AI analysis → `ContentProvider`

**You produce:** slides from a file, and for each slide a brain-rot script + quiz,
fact-checked against the slide.

### `POST /decks` (multipart, field `file`) → `Deck`

```json
{
  "id": "deck_8f2c",
  "title": "Cellular respiration",
  "source_type": "pptx",
  "slide_count": 40,
  "pdf_url": "/decks/deck_8f2c/render.pdf",
  "slides": [
    { "index": 0, "title": "Glycolysis", "text": "…", "notes": "…", "image_url": "/decks/deck_8f2c/0.png", "difficulty": 0.45 }
  ]
}
```

`pdf_url` is what the UI renders (for PPTX, your LibreOffice conversion).
If you only have images, send `image_url` per slide.

### `POST /scripts` → `RescueScript`

Request:

```json
{
  "deck_id": "deck_8f2c",
  "slide_index": 2,
  "slide": { "index": 2, "title": "…", "text": "…", "notes": "…" },
  "deck_title": "Cellular respiration",
  "neighbour_titles": ["Stage 0", "Stage 2"],
  "variant": { "id": "20s·memes·runner", "target_seconds": 20, "slang_level": "unhinged",
               "humour_style": "memes", "voice_id": "hype", "pacing": 1.1,
               "gameplay_type": "runner", "recap_or_preview": "recap", "quiz_count": 1 },
  "profile_memo": "Analogies land better than memes on hard slides.",
  "depth": 1
}
```

Response (the proposal's output schema):

```json
{
  "variant": { "target_seconds": 20, "slang_level": "unhinged", "humour_style": "memes" },
  "hook": "POV: you're a glucose molecule…",
  "script": "That's glycolysis, bestie…",
  "key_terms": [{ "term": "glycolysis", "broll_prompt": "cartoon glucose splitting, neon, portrait" }],
  "quiz": [{ "question": "…", "options": ["…","…","…","…"], "answer_index": 1,
             "if_right": "W. …", "if_wrong": "Not quite, chief. …" }],
  "plain_summary": "Two sentences, no slang.",
  "fact_checked": true,
  "sensitive": false
}
```

- `depth: 2` = the deeper second clip on the same slide (user didn't refocus). Make it shorter and slower.
- The UI caches by deck · slide · length · slang · humour · quiz count · depth,
  and asks for the current slide plus two ahead. Respond from your own cache when you can (Gate 2: rescue starts in < 2 s).
- `if_wrong` must include the correction. Roast the answer, never the person.
- If `variant.slang_level` is `plain` or the slide is sensitive, no slang.

Optional: `POST /decks/{id}/prewarm {"slide_index": n}` and
`POST /feedback/wrong-fact {"deck_id","slide_index","variant_id","note"}` (the flag button). The flag is a toggle: pressing it
again on the same clip sends the same body with `"retracted": true`, so drop that report.

Example: [`examples/services_stub.py`](../examples/services_stub.py) (content routes).

---

## 做影片 · Video → `MediaProvider`

**You produce:** narration audio, word timings for captions, key-term b-roll,
and the shared gameplay / music library. The UI **composes live**: it layers
captions and b-roll over a gameplay loop in real time, so you never render a
full video for playback.

### `POST /media` → `RescueMedia`

Request: `{ "deck_id", "slide_index", "script": RescueScript, "variant": Variant }`

```json
{
  "audio_url": "/media/abc123.mp3",
  "duration_sec": 21.4,
  "captions": [
    { "word": "POV:", "start": 0.12, "end": 0.48 },
    { "word": "you're", "start": 0.52, "end": 0.71 }
  ],
  "broll": [
    { "term": "glycolysis", "url": "/media/broll/gly.mp4", "kind": "video", "at": 6.2 }
  ]
}
```

- `captions` must be sorted and cover the **exact spoken text**
  (`hook + " " + script`), one entry per word, in seconds. The UI groups them
  into 1–3-word captions and highlights the current word.
- `at` is optional; without it the UI cuts to the b-roll when the term is spoken.
- No `audio_url` ⇒ the UI falls back to the browser's voice (that's the mock).

### Library

- `GET /library/gameplay` → `[{ "id", "type": "parkour|runner|kinetic-sand|marble|…", "energy": 0–1, "url": "/loops/p1.mp4" }]`
  Portrait (9:16) MP4/WebM, muted, seamless. The UI starts each at a random point.
- `GET /library/music` → `[{ "id", "tempo", "energy", "url" }]`
- `GET /voices` → `[{ "id": "hype", "label": "Hype narrator" }]` (ids the bandit may pick)

Example: [`examples/services_stub.py`](../examples/services_stub.py) (media routes).

---

## 個人化 AI · Personal AI → `AdaptiveProvider`

**You produce:** per-user timing, the style of each rescue, rewards, and the
session review + profile memo.

| Endpoint | When the UI calls it | Body → Response |
|---|---|---|
| `POST /config` | session start | `{user_id, settings}` → partial `SessionConfig` (e.g. `{"drift_to_lapse_sec": 7, "cooldown_sec": 240}`) |
| `POST /choose` | every lapse, **1.5 s timeout** | `{context: RescueContext}` → `VariantChoice` |
| `POST /outcomes` | 60 s after the user is back on the slide | `RescueOutcome` → 204 |
| `POST /sessions` | user presses Finish | `SessionLog` → `SessionReview` |
| `GET /profile/{user_id}` | session start | → `{ "memo": "…" }` (fed to `/scripts`) |

`RescueContext` (bandit features): `minutes_into_session, lapse_depth, slide_difficulty,
trigger (gaze|window|drowsy), rescue_in_row, rescues_so_far, recent_variant_ids, hour_of_day, slide_index, deck_id, user_id`.

`VariantChoice`: `{ "variant": Variant, "is_holdout": false, "is_explore": true, "action": "clip" | "skip" }`
— `action: "skip"` runs the "no clip, plain reminder" control arm.

`RescueOutcome` carries everything the reward needs:
`attention_after` (A_after, share of the 60 s after return spent Focused),
`quiz[]`, `clip_seconds`, `skipped`, `time_to_refocus_sec`, plus `context` and `variant_id`.
The UI does **not** compute the reward; you do.

`SessionLog.samples` is the 1 Hz trace `{t (s since start), score, state, slide_index}`.
`SessionReview.score` must include `sustained_episode_median_sec`; the report
also shows `on_task_share`, `lapses_per_30_min`, `time_to_refocus_median_sec`,
`quiz_accuracy`, `focused_minutes`, `delta_vs_baseline`, plus `profile_memo` and `tips[]`.
If `/sessions` fails, the UI computes the score locally (`src/session/metrics.ts`).

**Guardrails the UI enforces regardless of your choice:** the user's slang
level and roast toggle, a "glow only" setting, a 3-minute cooldown, max two
clips in a row, then a break suggestion, and a 15% clip-time cap.

Example: [`examples/services_stub.py`](../examples/services_stub.py) (adaptive routes).

---

## Checking your integration

1. `npm run dev`, open http://localhost:5173, press `` ` ``.
2. Switch your module to `http` / `ws`, enter your URL, **Save**.
3. **Run contract check.** It calls you with a known input and validates the
   output; problems are listed by field.
4. Start a session on the sample deck. With the simulator, press `D` to look away;
   a rescue starts after ~8 s. Every call and its latency shows under **Calls**.
5. **Open example report** shows the report with realistic data.

Defaults can also be set in `.env.local` (see `.env.example`), which is handy
when your teammates run the UI against your service.
