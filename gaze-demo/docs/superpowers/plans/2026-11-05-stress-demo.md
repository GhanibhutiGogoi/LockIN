# Stress demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a separately debuggable, honestly evaluated webcam tension/relief prototype and a new PR.

**Architecture:** Frozen facial extractor feeds a versioned causal feature pipeline and small locally trained classifier. Tension/relief has its own state and per-user evidence/feedback, sharing existing auth, persistence and capture lifecycle safeguards.

**Tech Stack:** Existing TypeScript/WebEyeTrack/MediaPipe browser worker, Python/FastAPI/SQLite, numpy/scikit-learn, local SVG/CSS animation, pytest/Node tests.

**Spec:** `docs/superpowers/specs/2026-11-05-stress-demo-design.md`.

## Global Constraints

- Free, local; at most about 3 GB cumulative new public model/dataset downloads.
- Main UI unchanged; local video retained; independent `/stress-debug` entry.
- No unattended webcam/screenshare, private data/secret uploads, agent/AI attribution, main push or merge.
- No pseudo-label emotion-to-stress or synthetic data used as real stress evidence; unknown when data/model/input is insufficient.
- Participant-isolated splits; same features offline/live; inspect license and provenance; preserve source repository content.

## Review Focus

- Old/frozen/duplicate camera frames cannot remain valid tension evidence or extend a trigger.
- Offline and live feature extraction must be identical; no mixing incompatible landmark/score representations.
- Held-out users and future samples must not leak into normalization, baseline fitting, threshold selection or model choice.
- User changes, replay data and feedback corrections cannot contaminate another user or real preferences.
- Missing assets/model/permissions or low validation quality must degrade explicitly, not silently activate a fake stress model.

### Task 1: Repository baseline and data/model feasibility

**Files:** root README (append only), `gaze-demo/.gitignore`, `scripts/stress-data.py`, `docs/stress/data-manifest.json`, `docs/stress/model-selection.md`.
**Interfaces:** Produces data manifest (source/license/hash/byte count/feature schema/label semantics/subject/session), chosen representation and data paths. No training consumer may assume a dataset before this record exists.
- [ ] Verify original backend tests (54 Python + 14 JS), frontend 28 tests and build in isolated clone.
- [ ] Inspect actual candidate data metadata/files, prefer real labels and compatible public inputs; account for every new download within 3 GB.
- [ ] Define exact versioned feature schema from accessible data and extractor. Write data-validation tests before implementation (unknown labels excluded; mixed subject split rejected; incompatible schema rejected).
- [ ] Implement bounded/restartable data acquisition and manifest, tests pass. Document rejected models and access/label limitations.
- [ ] Commit baseline and data tools to feature branch only; no push without PR creation at finish.

### Task 2: Train and evaluate portable estimator

**Files:** `backend/lockin/stress/features.py`, `model.py`, `scripts/train-stress.py`, `backend/requirements-stress.txt`, `backend/tests/test_stress_model.py`, `docs/stress/training-report.json`.
**Interfaces:** Consumes Task 1 manifest/schema. Produces `StressModel.predict(features, quality)` and versioned JSON artifact with schema, coefficients/trees, train-only preprocessing, provenance and validation status; unknown on missing/incompatible model.
- [ ] RED tests: causal aggregation/freshness/coverage, offline/live parity fixtures, schema mismatch, nonfinite/range rejection, JSON/sklearn prediction parity and subject split integrity.
- [ ] Implement minimal feature pipeline and portable inference; GREEN tests.
- [ ] Run dummy/logistic/nonlinear candidates with subject-isolated validation; freeze selection before final test. Record raw outcomes, failures, split membership and uncertainty; do not invent a success threshold after seeing results.
- [ ] Save safe artifact and actual report, or explicit no-model blocker. Commit implementation and reproducibility instructions, not raw participant data.

### Task 3: Per-user tension and relief lifecycle

**Files:** `backend/lockin/stress/service.py`, `backend/lockin/stress/schemas.py`, `backend/lockin/app.py`, `backend/tests/test_stress_service.py`, `test_stress_api.py`.
**Interfaces:** Auth-scoped start/feature-observation/status/relief-feedback/correction/export. Events carry evidence and server emission time, source real/replay, model and feature version; storage is existing Store transactions.
- [ ] RED tests: invalid camera inputs reset dwell; cooldown/suppression during study video/quiz; replay never learns real preferences; feedback correction retracts; token/user isolation and idempotency.
- [ ] Implement separate state machine and tentative per-user animation preferences with provenance. Self-reported relief, not smiles alone, supplies outcome evidence.
- [ ] GREEN new tests and full existing backend suite; commit.

### Task 4: Independent browser demo and local animation

**Files:** `backend/static/stress.html`, `stress.js`, `stress.css`, reusable capture adapter as needed, worker bounded feature export, `backend/tests/js/stress.test.mjs`.
**Interfaces:** Uses same extraction contract as Task 2 and scoped endpoints from Task 3. User explicitly starts webcam; local synthetic replay labelled as such remains available independently of trained model availability.
- [ ] RED tests: source freshness and user/session resets, training/live vector parity, cancel/dismiss/reduced-motion, competing intervention suppression.
- [ ] Implement independent `/stress-debug` with inspection of feature quality, model status, trigger reason, memory, feedback and small local cat/dog stretch/yawn animation. Preserve main UI checksums.
- [ ] GREEN tests, original frontend suite and build. Exercise independent entry with synthetic fixtures and no user devices. Commit.

### Task 5: Independent review and PR handoff

**Files:** `docs/reviews/2026-11-05-stress-demo-review.md`, `docs/stress/README.md`, GitHub PR.
**Interfaces:** Consumes actual source diff, report, frozen manifests and test outputs; produces actionable review, fixes and runnable morning handoff.
- [ ] Run all checks and training reproduction/smoke appropriate to actual available data; inspect outputs and secrets/ignored-file boundary.
- [ ] Dispatch fresh whole-branch reviewer against spec and Review Focus. Fix Important/Critical findings with RED→GREEN tests and rerun full suite.
- [ ] Final source/data/license audit; commit with existing user identity, no agent attribution.
- [ ] Push ONLY new branch and immediately create NEW PR via connected GitHub tools if CLI auth remains unavailable. Do not merge. Attach PR to this chat and record verified URL.
- [ ] Report exact model/dataset, actual metrics, demo entry, limits and pending human validation. Stop overnight heartbeat on delivery.
