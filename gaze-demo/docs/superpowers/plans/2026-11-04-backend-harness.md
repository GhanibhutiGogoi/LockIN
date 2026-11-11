# LockIN Backend Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persistent per-user memory and observable intervention harness, with gaze/screen/gate boundaries independently debuggable.
**Architecture:** FastAPI routes orchestrate small Python domain modules backed by SQLite transactions. A separately served debug page reuses pretrained browser gaze and local media; existing main UI stays untouched.
**Tech Stack:** Python 3.12, FastAPI, SQLite, pytest/httpx; optional sentence-transformers E5 and compatible Qwen-VL provider.
**Spec:** docs/superpowers/specs/2026-11-04-backend-harness.md

## Global Constraints
- Main UI unchanged; local video; single-screen and computer-based distraction only.
- Separate user banks; raw camera images never leave browser; screen provider requires explicit debug consent.
- Synthetic evidence is labelled and excluded from real inference; failed/missing inputs remain unknown.

## Review Focus
- User identity guessing, cross-user resource IDs and unscoped semantic retrieval.
- Restart/concurrent request/retry causing double episodes or duplicated memories.
- Stale/model-invalid inputs creating false triggers or false recovery.
- Media seeks, missing quiz, aborted/low coverage episodes receiving success credit.
- Corrected evidence still influencing prompts; injection through screen or memory text.

### Task 1: Persistence and identities
Files: backend/lockin/{schemas,store}.py, backend/tests/test_store.py.
Interface: Store(path).create_user(name), authenticate(token), transaction(user_id); scoped document get/put/list.
- [x] Write isolation, restart, token and rollback tests; run pytest (expected missing implementation).
- [x] Implement SQL constraints/transactions and strict typed inputs; run tests (expected pass).

### Task 2: Signals, gate and recovery
Files: backend/lockin/{signals,recovery}.py, backend/tests/test_signals.py.
Interface: advance_gate(state, observation)->decision; summarize(samples, returned_at, window_ms=120000)->metrics.
- [x] Test sustained entertainment, task-related videos, missing/stale gaze, gap reset, relapse and censored coverage (expected failure).
- [x] Implement pure functions and configurable thresholds; test expected pass.

### Task 3: Memory and harness
Files: backend/lockin/{memory,harness}.py, backend/tests/test_harness.py.
Interface: Memory.retrieve(tx,query), Harness.start/observe/media/answer/correct/export; transaction-scoped identity.
- [x] Test end-to-end local media lifecycle, quiz gate, duplicate observations, per-user retrieval, automatic inference, correction and restart (expected failure).
- [x] Implement grounded prompt, memory provenance and post-return evaluation (expected pass).

### Task 4: Providers and APIs
Files: backend/lockin/{providers,app}.py, backend/tests/test_api.py, requirements files.
Interface: create_app(db_path,providers), bearer-scoped /v1 routes; screen provider returns validated Screen input.
- [x] Test HTTP isolation, malformed provider results, missing configuration, frame consent, schema errors and export (expected failure).
- [x] Implement service plus optional E5, explicit lexical fallback and Qwen adapter; verify tests and actual provider smoke where available.

### Task 5: Independent demonstration and documentation
Files: backend/static/{index.html,debug.js,gaze.js,style.css}, backend/README.md, scripts/start-backend.sh.
- [x] Use API integration fixtures to exercise two-user flow, traces and annotation/export (expected failure for missing routes).
- [x] Add separate debug page with replay and real capture modes; inspect in browser with camera off unless user enables.
- [x] Run backend suite, unchanged frontend suite/build, HTTP/browser smoke, then one fresh read-only code review and regression-tested fixes.

Git steps are omitted because this workspace is not a repository; preserve a source backup and ledger instead. User explicitly requested plan and completion, so execute inline without another approval round.
