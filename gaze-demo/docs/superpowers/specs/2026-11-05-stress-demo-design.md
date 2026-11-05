# Webcam tension-estimation demo

## Authorized outcome

User approved autonomous overnight implementation, model selection, local training, verification and code review on 2026-11-05. Use free services and local compute, at most about 3 GB cumulative new public model/dataset downloads. Preserve the existing main UI. Create a NEW branch and PR against `GhanibhutiGogoi/LockIN`; do not merge or push main. Never add agent/AI authorship or co-authorship.

Build a separate, inspectable webcam-based **possible tension** estimator and cute, dismissible cat/dog relaxation animations. This is an experimental behavioral estimate, not a diagnosis or a calibrated psychological stress index. Distraction and tension are separate states; being focused does not imply being relaxed.

## Data and model selection

Reuse frozen pretrained facial extraction where possible. Prefer actual public participant data with self-reported stress labels (EmpathicSchool/StressID); inspect access, license, files and label coverage before downloading. No paid services, human agreement acceptance, restricted-data applications, webcam activation, desktop capture or human participation while user sleeps. Retain download manifest, source URLs, license, hashes, sizes, exclusions and cumulative budget.

Offline training and browser inference MUST use the same feature definitions, normalization, ordering, units and causal time windows. Never train a model on dlib coordinates and silently feed it MediaPipe coefficients. If video access cannot fit the budget, a compatible smaller face feature/emotion extractor is permitted; record this choice and its limitations. Never use FER emotion-to-stress mappings, synthetic examples, physiological-only inputs or task identity as ground truth stress observations. Synthetic fixtures are permitted for software tests, labelled as such.

Compare at least a majority/dummy baseline, regularized logistic classifier and a small nonlinear classifier when usable data permits. Split by participant (and prevent overlapping intervals crossing splits); fit scalers and choose thresholds on training/validation participants only. Report macro-F1, balanced accuracy, confusion matrix, coverage and subject variation rather than inflated random-frame accuracy. Model selection must not inspect final held-out test performance. Persist reproducible seeds, input manifests, split identities and fitted artifacts. Prefer portable JSON coefficients/trees over executable pickle uploads.

If no eligible data or no useful predictive signal is established, deliver the pipeline and record the blocker/results; keep the unvalidated estimator disabled/unknown rather than fabricate success. A replay-only animation demo may remain available, unmistakably synthetic. A model trained from real public labels remains experimental until tested on this project's users; offline benchmark performance is not a causal animation-effect claim.

## Runtime and boundaries

Separate modules: facial feature adapter, causal temporal aggregation, model inference/artifact validation, tension trigger/cooldown, local relief animation, feedback and memory, training/evaluation tools. Raw webcam frames stay local; backend receives only bounded derived features/events. Require explicit camera start and handle permission denial, ended/muted/frozen frames, stale/future/duplicate timestamps, gaps, low quality, cancellation, resizing and user/session changes. Do not create another camera stream when an existing source can be shared safely.

Use a per-user neutral baseline as an experimental personalization step, without fitting it on future evaluation samples. Missing input or absent/incompatible model produces unknown. A continuous high estimate and sufficient valid coverage may emit a relief suggestion; cooldown prevents repeated popups. Exact engineering time/threshold defaults are implementer choices to document, not clinical constants.

Relief suggestions use small local cat/dog animations (yawn/stretch), with dismiss, stop and reduced-motion behavior. They do not block work or require a quiz. They must not appear over the learning-video/quiz flow; postpone or suppress competing interventions. Local study videos remain unchanged. Main UI unchanged; all new controls/results go in an independent `/stress-debug` entry, with a link from existing debug page if needed.

Per-user memory records model/version, evidence window, confidence/quality, baseline, selected animation, trigger reason, dismissal and user feedback. Never infer that a smile alone proves relaxation. Explicit brief pre/post self-report is the primary demo feedback; expression changes are separately named observations. Replay data never changes real preferences. Corrections retract tentative learned preferences. Reuse existing user-token isolation and SQLite transaction boundaries.

## Acceptance and deliverables

- Independent demo shows input source/quality, facial features, possible-tension output or unknown, trigger/cooldown, animation, per-user memory read/update and feedback/correction.
- Training command, honest dataset/model cards, frozen split/manifest, actual result report and portable artifact when supported by evidence.
- Automated tests exercise model/feature parity, invalid inputs, user isolation, actual trigger lifecycle and feedback semantics; original frontend/backend checks remain green.
- Fresh-context independent whole-branch review; fix Important/Critical findings with regression evidence; record deferred limitations.
- New PR containing existing runnable demo under `gaze-demo/` plus this module, while preserving root README/team content. Exclude secrets, private banks, raw participant data, caches, dependency directories and downloaded model binaries not licensed for redistribution. Provide reproducible downloads instead.
- Morning handoff: PR link, exact run commands, actual experiments and limits, remaining human validation steps. No claim of human-camera accuracy or stress reduction without corresponding data.

## Implementation choices / current evidence

The remote currently has only README; local prototype is not a Git checkout. Work in a separate cloned repository on `feat/stress-demo`, preserving the original running prototype and reusing ignored local dependencies. Native worktree tool rejected this nested repository as not a declared root; the dedicated clone supplies isolation without altering the original folder.

EmpathicSchool paper: https://www.nature.com/articles/s41597-025-05812-0 . Official code: https://github.com/CPHSLab/EmpathicSchool . Dataset DOI: https://doi.org/10.5281/zenodo.7372497 . These are candidates, not a claim of accessible downloaded training data.

Builder review: no further user decisions required. Freeze these implementer choices before any training: MediaPipe 0.10.18 blendshape schema (52 named scores, [0,1]), causal 20-second mean/std windows (104 ordered features), maximum gap 1500ms, minimum 80% window coverage. Personal baseline is inspection-only and never changes model input until a matching offline protocol exists. At least 12 labelled participants and both classes in each train/validation/test partition are required to call the benchmark eligible. Seed 42, participant partitions 60/20/20; training-only scaling and validation-only selection. A useful-signal flag requires validation balanced accuracy >=0.60 and macro-F1 >= dummy+0.05, fixed before seeing scores; this is an engineering gate, not evidence of validity in our users. Final test results are always reported and cannot change the chosen candidate.

Runtime defaults: 30-second visible baseline collection, 20-second feature window, >=10 seconds continuous high score (>=0.75) before suggesting relief, 180-second cooldown, 8-second dismissible animation. Scores are uncalibrated classifier outputs, not psychological percentages. Unknown/invalid input resets dwell. A missing, ineligible or incompatible artifact never emits automatic live relief. Synthetic replay explicitly overrides states in replay sessions only. Self-report ratings 0..10 before/after are optional evaluation data; no smile-derived automatic success.
