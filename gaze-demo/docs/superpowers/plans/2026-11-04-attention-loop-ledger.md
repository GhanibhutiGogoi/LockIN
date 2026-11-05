# SDD ledger — plan: docs/superpowers/plans/2026-11-04-attention-loop.md

Ruling: execute inline under the user's explicit instruction to implement the agreed modules; no additional plan-approval round is needed.
Ruling: existing isolated local demo is not a Git checkout. Use tests, file inspection and a fresh review rather than Git-dependent task scripts or fabricated commits. Source backup: /private/tmp/lockin-gaze-before-core.tar.gz.
Ruling: memory uses IndexedDB in the current browser, with explicit local profiles and JSON export; remote persistence is outside the agreed local prototype.
Pre-flight: Task 1 produces Observation/Evidence/RecoverySummary consumed by Tasks 2/3; shared types reside in core/types.ts.
Pre-flight: Task 2 produces generation context and per-profile storage consumed by Task 3; video files remain transient and out of persisted records.
Pre-flight: Task 3 produces trace/episode records consumed by Task 4; test data is explicitly separate from human trial evidence.

Task 1: complete — npm test passed evidence/recovery and existing gaze rules.
Task 2: domain memory complete — profile/context isolation, false-alarm correction, censoring and cold-start tests pass; IndexedDB awaits browser integration.
Task 3: implementation complete — session state machine/local media/UI integrated; npm test 23/23 and npm run build passed.
Root cause/fix: cooldown previously let the detector latch a suppressed trigger, preventing subsequent continuous-off-task triggers. New failing regression reproduced 1 instead of 2 episodes; reset detector during ineligible phases/cooldown; full suite green.
Ruling: add a bundled original 12-second arithmetic lesson and scored quiz to allow immediate flow testing without user media; own videos use unscored written recall.

Final review: fresh read-only reviewer found four Important issues (unsaved profile cache, asynchronous profile loading, annotation write ordering, stale frame timestamps). No Critical issues.
Fix pass: ProfileBank preserves dirty per-profile caches and serializes all session/episode writes. Profile loading commits atomically and locks exports/edits. Export captures an immutable profile identity. Worker returns capture timestamps; freshness/ordering are checked and session timer/observation clocks are distinct. Added five regression tests, full suite 28/28 passed.
Task 4: browser attention integration passed all 13 checks using actual local MP4 events and a separate IndexedDB. UI persistence regression passed playback/quiz gating, simulated write failure, atomic profile switching and dirty-cache restoration; export-button check added and awaiting final run. These tests use synthetic gaze, not human accuracy data.
Ruling: retain 1 Hz derived traces (not every camera frame), capped at 20,000 samples with explicit truncation flag. Record startedAtT to align monotonic trace time with ISO session start.
Declined review items: remote generation/cloud accounts/automatic training are intentionally absent; real human accuracy awaits user trials; actual MP4 compatibility/autoplay has been checked in the in-app browser, and Chrome handoff is verified without camera access.

Final verification: npm test 28/28 passed; npm run build passed. Browser attention integration 13 checks passed. Browser actual-controller persistence test 9 checks passed, including the real export-button Blob content after failed writes and profile switching. Chrome updated demo verified with camera off. No human accuracy or causal efficacy claim.
