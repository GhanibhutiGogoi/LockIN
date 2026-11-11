# Pretrained expression-relief MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the independent camera-to-relief demo usable without training a stress classifier.
**Architecture:** Frozen ONNX Model Zoo FER+ (opset 8) runs locally in a browser worker on MediaPipe face crops. Its eight expression probabilities feed explicit sustained-negative-expression rules, never a pressure score. Existing stress classifier stays disabled; existing replay, self-report, isolation, feedback and correction remain.
**Tech Stack:** Existing WebEyeTrack/MediaPipe, ONNX Runtime Web WASM, FastAPI/SQLite.
**Spec:** Existing 2026-11-05-stress-demo-design.md plus user instruction to prefer pretrained models and deliver an MVP. Implementation choice: expression proxy rather than an unvalidated pretrained stress claim.

## Global Constraints
- Existing feature branch and PR #2; no main push/merge, agent attribution or main UI edits.
- Free local inference, total downloads <3GB; pinned official weights with SHA-256, no camera/device activation by automation.
- No raw camera images transmitted or saved. No emotion-to-stress labels, pressure accuracy or relief efficacy claims.
- 30s observed baseline remains inspection-only. 10s continuous valid high expression evidence, 180s cooldown, 8s dismissible relief; unknown/gaps/video/quiz reset/suppress.
- Explicit live inference selection: expression_proxy or existing stress_model. Legacy API defaults remain stress_model.

## Review Focus
- Face crop out-of-frame/tiny/NaN -> no inference, not a stretched background.
- Model-load/inference failure and stale/duplicate outputs -> unknown, no historical evidence reuse.
- Exact FER+ label order, unscaled grayscale NCHW64 and softmax -> reproducible contract.
- Proxy source/score/model identity retained in events; not mixed with stress-classifier predictions or replay preferences.
- Offline fresh checkout can fetch assets and build from pinned package lock; no private config or weights in Git.

### Task 1: Pretrained contract and real weight
- [x] Add failing crop/grayscale/softmax tests and backend proxy tests (threshold/abstention/provenance/schema/time).
- [x] Implement crop/preprocess helper, optional derived expression evidence and session inference selection.
- [x] Pin/fetch FER+ official revision 4c46cd00fbdb7cd30b6c1c17ab54f2e1f4f7b177, 35040571 bytes, SHA256 a2a2ba6a335a3b29c21acb6272f962bd3d47f84952aaffa03b60986e04efa61c. Run targeted tests.

### Task 2: Browser worker and live loop
- [x] Bundle isolated FER+ worker, local ORT WASM assets; optional GazeCapture expression pipeline and capture timestamp association.
- [x] Live demo selects expression_proxy, forwards probabilities plus paired derived MP features; UI explains facial-expression cues, not stress.
- [x] Test stale/failed results, session isolation, cooldown and feedback regressions. Build/test full suite.

### Task 3: Real inference smoke, review and delivery
- [x] Run actual pretrained FER+ in browser on pre-existing public static face / synthetic stream, never user webcam. Record finite outputs and actual pipeline results; scripted probabilities remain labelled software tests.
- [x] Fresh independent review per executing-plans; fix meaningful findings with regression tests.
- [ ] Update docs, notices, data/validation boundaries and PR2. Restart local demo preserving original private bank/config; verify available model and leave camera idle.

## Ledger
- Base 3c95b1d, clean existing isolated feat/stress-demo branch. Existing design approved; user delegates concrete pretrained model choice. No new clarification needed.
- Shared interface: worker -> GazeCapture -> FeatureFrame.expression (same capturedAt, eight canonical probabilities); service uses explicit session.inference. Existing 52-score training contract unchanged.

- Task 1 complete: backend schema/provenance/dwell tests RED→GREEN; pixel preprocessing/softmax tests RED→GREEN. Official 35,040,571-byte weight downloaded and SHA verified.
- Task 2: optional paired expression pipeline and UI contract RED→GREEN; previous full suite 94 Python +27 backend JS +30 frontend green. Real browser MediaPipe→crop→FER+ inference on public fixture returned finite eight-class probabilities, 133.1ms; no webcam used.

- Independent reviewer: three Important continuity/crop issues confirmed. Fixed late old-result revival, unseen intermediate neutral/invalid boundaries with a bounded chronological queue, and degenerate minor-axis crop acceptance; reproducing tests RED→GREEN. Worker/camera mute/error boundaries invalidate pending source frames.
- Regraded model status and duration wording as Important for a usable honest MVP: idle/replay/missing-runtime note tests RED→GREEN; all required assets checked; first high posterior says observed rather than sustained. Baseline coverage now explicitly says 30-second observation window with >=80% valid coverage, matching the original feature contract.
- Final: minor (deferred): proxy path computes the legacy pressure prediction before replacing it; small redundant computation, no pressure result is exposed or used by this path.
- Final: Ruling: real-user accuracy, thresholds, and relief efficacy remain unverified; delivered expression cue is not psychological stress inference. Cost: users must inspect false triggers and report their experience before interpreting effectiveness.

- Final verification after fixes: 100 Python +32 backend JavaScript +31 frontend =163 passing checks; production build passed. Actual debug UI+backend+frozen pretrained models repeat passed with public-face canvas stream: observed baseline, no-negative-expression state, then unknown on stop; all physical devices untouched. Camera source and all synthetic tests ended cleanly. Main entry/style files unchanged.
