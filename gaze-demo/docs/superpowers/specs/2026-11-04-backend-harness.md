# LockIN backend and personal agent harness

Approved scope: web, single-screen computer study. Preserve the existing main UI. Local videos only. Build a separate `/debug` entrance and module-level APIs.

## Modules
1. Gaze adapter: reuse frozen pretrained WebEyeTrack + personal calibration in the browser; send derived observations only. Missing/unvalidated gaze is unknown. Looking away is outside this iteration's distraction definition.
2. Screen adapter: consented screen sharing, sparse image interpretation with configurable Qwen-VL compatible endpoint. Return task relevance, content type, confidence and learning context. Screen changes are a visual activity proxy, never OS click/key logs. Model errors produce unknown, not distraction.
3. Attention gate: sustained high-confidence task-unrelated entertainment + valid on-screen gaze + visual activity. Configurable 8-second initial heuristic, max 4-second sample gap. Preserve latest task-related study context. Replay/manual sources are explicit and excluded from automatic preference learning.
4. Persistent memory: SQLite per-user episodic records, inferred style observations and corrections. Server-issued bearer identity scopes every query before retrieval. Store evidence rather than raw camera/screen recordings. Semantic E5 optional adapter with explicit unavailable status and transparent lexical fallback; no fabricated embeddings.
5. Harness: gated trigger → retrieve user memories → compose grounded video prompt → local video → quiz → 120-second recovery observation → evidence and automatic memory update. Video gaze measures engagement; returning to task measures recovery. Neither proves causal benefit. Insufficient/censored data never produces a preference inference. Inferred observations can influence subsequent prompts immediately with sample count/uncertainty; no user confirmation required.

## Debug and validation
Separate page shows provider status, real vs replay inputs, trigger reasons, retrieved memories, prompt, state transitions and memory updates. Create/switch local user identities without displaying bank in main UI. Record interval annotations for user/Yingwen, export JSON per user, and compute segment precision/recall plus false alarms per valid hour (descriptive small-sample evaluation only).

Recovery uses server-validated ordered media progress, ended, nonempty quiz answer and return-phase samples; minimum 60% valid coverage and 30 seconds valid within a full 120-second window. Playback completion, aborted runs, model failure and gaze loss must not be called recovery. Explicit corrections retract inferred memories and subsequent retrieval excludes them.

Local-only service at 127.0.0.1:8000. Identity tokens are a prototype access boundary, not full production account authentication. No Git checkout exists; no push/commit/PR claim is permitted. If code is eventually pushed, branch+PR and no AI contributor attribution.

Replay debugging has its own `replay_sandbox` memory namespace. Synthetic episodes may derive clearly labelled demo observations and retrieve them on the next replay, so the full memory cycle can be inspected without working model credentials. Live retrieval excludes this namespace; synthetic data never becomes a real preference.
