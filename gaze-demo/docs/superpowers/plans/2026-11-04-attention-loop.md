# Attention Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Run a complete personal attention-intervention loop with local media and defensible recovery measurements.

**Architecture:** Pure TypeScript domain modules consume timestamped observations and media lifecycle events. A browser controller connects gaze, manual screen labels, a local video adapter and IndexedDB; the existing gaze UI remains the acquisition layer.

**Tech Stack:** Existing Vite/TypeScript, browser media APIs, IndexedDB, Node test runner. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-04-attention-loop.md`

## Global Constraints

Webcam pixels remain local. Single-screen only. Unknown data never establishes distraction/recovery. 120-second recovery window; 4-second recovery hold; 60% minimum coverage and 30 seconds of valid observation for empirical memory. Local profile isolation. Manual labels explicitly marked as such. No trained attention classifier claims. No Git operations in this non-Git checkout.

## Review Focus

- Stale, hidden, missing or out-of-order gaze must not inflate task time or trigger interventions.
- A finished download or paused video must not count as watched media or recovered attention.
- Session termination, playback error, lost camera and incomplete observation must censor results.
- Profile switching, false-alarm corrections and storage failures must not mix or silently lose records.
- An answered written question has no fabricated accuracy; all user strings must render as text.

### Task 1: Evidence and recovery

**Files:** `src/core/types.ts`, `attention.ts`, `recovery.ts`, `analysis.test.ts`.
**Interfaces:** `classify(Observation) -> Evidence`; `AttentionDetector.push(Observation) -> Detection`; `RecoveryTracker` consumes playback/quiz/observation events and returns `RecoverySummary`.
- [x] Write tests for unknown evidence, sustained triggers, out-of-order/gapped observations, playback/quiz boundaries, complete and censored recovery, relapse and coverage.
- [x] Run `npm test`; expected failures for missing domain behavior.
- [x] Implement timestamp-based integration, excluding stale intervals and separating viewing from post-return observation.
- [x] Run `npm test`; expect all domain cases and existing gaze rules to pass.

### Task 2: Personal memory and storage

**Files:** `src/core/memory.ts`, `memory.test.ts`, `src/storage.ts`.
**Interfaces:** profile preferences plus `EpisodeRecord[] -> memoryForGoal`; `makeGenerationRequest`; asynchronous profile/session/episode read and write methods.
- [x] Write tests for profile isolation, false-alarm/censored exclusion, insufficient evidence, explicit preferences and serializable requests preserving last study context.
- [x] Run tests red, implement and run green.
- [x] Add IndexedDB storage and persistence-error reporting; verify actual IndexedDB roundtrip in browser integration checks.

### Task 3: Session and local-video integration

**Files:** `src/core/session.ts`, `session.test.ts`, `src/local-video.ts`, `src/study-ui.ts`, `index.html`, `src/main.ts`, `src/study.css`.
**Interfaces:** `StudySession.observe`, `requestIntervention`, playback/quiz lifecycle, `end`; `VideoProvider.prepare(GenerationRequest) -> VideoAsset`.
- [x] Write and run failing state-machine tests: single request, no early quiz exit, actual playback timing, 120-second observation, cooldown and abort.
- [x] Implement pure session orchestration and local-video provider; run all tests green.
- [x] Mount goals, profiles, preferences, manual screen context, media registration, gated player, live metrics, annotations and exports.
- [x] Connect calibrated gaze to observation input; end/censor on tracking stop, preserve safe resource cleanup.
- [x] Provide an original local sample lesson with a matching scored quiz and a manually testable trigger.

### Task 4: Verification and documentation

**Files:** `tests/attention-smoke.html`, `README.md`, execution ledger.
- [x] Run a browser integration check using real domain modules, IndexedDB and real local-video events. Synthetic observation timestamps must be labeled test input; never claim human accuracy.
- [x] Run full `npm test` and `npm run build`.
- [x] Conduct a fresh code review, address important findings, and document actual limits and future adapter contracts.
- [x] Keep localhost preview ready and show the updated page in Chrome without enabling the user's camera.
