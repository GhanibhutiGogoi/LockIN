# Independent whole-branch stress demo review

Reviewer: fresh-context independent review, read-only; base 483c96b, baseline import fccd25b, stress change through ba8d809. No private records, cloud calls or devices inspected. No Critical; seven Important findings plus one optional UI issue. The absence of a trained pressure model is an honestly disclosed data blocker, not a disguised successful training run.

Important findings to fix with regression tests:

1. `gaze.js`: advancing video playback time does not prove a new presented frame. Need frame callback/counter and fail-closed fallback.
2. `stress.js` / service getter: persisted high state can survive camera-off restore or failed backend requests. Need explicit current-input freshness, timeout and unknown display.
3. `training.py`: row-level incompatible extractor/source/label/coverage declarations bypass top-level manifest. Need per-row agreement and causal aggregation evidence.
4. `training.py`: binary 0.5 validation can pass while 0.35–0.75 runtime abstains on all windows. Need actual runtime coverage/hit metrics and eligibility gate, validation-only.
5. `model.py`: huge integers or tiny scales can crash startup or overflow numeric intermediates into fake high scores. All malformed artifacts and nonfinite math must fail closed.
6. `service.py`: ranking only previously rated animations repeats the first unhelpful cat forever. Compare unseen candidates with the same neutral prior.
7. `stress.js`: a learning video begun after a relief offer/display can overlap the remaining animation, especially without active replay capture. Need independent status coordination, including request failure.

Additional UI finding: optional before/after ratings exist in API but are not connected to the animation feedback UI. Regraded Important for this implementation pass because the design promises an inspectable self-report outcome interface; adding it does not claim causal effect. User can leave ratings blank and provide only helpful/not helpful.

Reproductions used only software-generated fixtures and temporary databases: all-incompatible rows could train an eligible artifact; .4/.6 scores yielded all unknown despite binary validation .60; malformed integer 10**400 crashed model load; tiny scale with zero coefficients returned fake score1; first cat-unhelpful feedback selected cat again. Frozen-frame and cross-tab findings are code-timing findings requiring browser regression after fixes.

Declined scope: human-camera generalization, clinical stress validity, actual restricted data access, causal animation effect, production cloud deployment. These remain outside this overnight engineering deliverable; no claims are made for them.

## Fix verification

All Important findings were reproduced in regression tests before fixes. Original camera-clock test now independently advances playback time while presented-frame count stays fixed; stale sample rejected. Model overflow fixtures return unknown rather than crash or fake a high state. Incompatible row source/extractor/labels or false coverage are rejected, and canonical aggregation is recomputed from timestamped derived-score frames. A classifier with only .4/.6 outputs cannot pass the runtime gate. Unhelpful cat feedback permits untried dog selection. Optional animation-linked retrospective ratings are now exposed.

Browser evidence after fixes (no webcam): actual pretrained worker on public static face returned 52 canonical scores; actual GazeCapture with a canvas-generated MediaStream and requestVideoFrameCallback produced a valid first frame, rejected a frozen stream, then accepted a newly presented frame. A hidden/background harness initially timed out; actively presenting/redrawing the synthetic source resolved the harness limitation. This is not a camera accuracy benchmark. Cross-tab regression: synthetic animal visible, same QA identity starts learning-video intervention in another tab, animal becomes hidden. Synthetic feedback and exclusion continue to update/retract only replay memories.

Final source checks: original main UI entry/style files match pre-work SHA-256. Public face/gaze binary weights use a source/hash-verified fetch script; private configuration, tokens, bank, dependency links, cached models, raw data and ignored public-face fixture are outside the PR.
