# Pretrained expression MVP — independent review and regression evidence

Base: `3c95b1d`. Separate read-only reviewer inspected the new diff and upstream contract. No Critical findings. Three Important findings: a late FER reply could revive a newer invalid face, slower polling could drop intermediate neutral/ambiguous evidence, and a degenerate narrow face box was accepted. All have reproducing RED→GREEN regression tests and fixes.

The browser adapter now preserves bounded chronological expression observations and invalid boundaries, cancels stale pending-source evidence, fails closed on queue overflow/old chronology, and clears on mute/end/worker failures. Upload drains all observations in order; no animation is shown from an intermediate high if the final observation is unknown/low. The crop requires a usable minor axis as well as overall size.

Model notes were regraded Important for usability/truthfulness: idle shows installed pretrained resources; replay explicitly runs no classifier; every required runtime/worker asset is checked. First high posterior is labelled observed, not sustained. Baseline copy states the existing 30s window / >=80% valid-coverage contract accurately. Tests for model notes and partial assets reproduced failures before fixes.

Deferred minor: the proxy service currently computes then replaces a legacy pressure-model prediction. This is redundant bounded arithmetic; its result never participates in proxy dwell or returned pressure score. No behavior or validation claim relies on it.

Actual browser inference, before review fixes: official hash-verified FER+ on pre-existing public face via real MediaPipe crop returned 8 finite normalized probabilities (neutral about .923), observed inference133.1ms. Actual GazeCapture plus synthetic canvas MediaStream returned paired expression results, rejected frozen video and accepted resumed presented frames. Full real debug UI + real backend established baseline, showed no-negative-expression state, changed to unknown on track stop, and ended cleanly. No physical webcam or stress-labelled participant data used. Repeat after the continuity fix is recorded in the plan ledger.

Real human camera accuracy, demographic robustness, thresholds and causal relief efficacy were explicitly not assessed; emotion probabilities are not stress measurements. Public fixture and private runtime bank remain ignored, not part of the PR.

Final repeat after review fixes passed the real UI/backend/pretrained chain with a synthetic stream and public face fixture. Baseline established, neutral-expression state displayed, stop returned unknown and hid pet; physical webcam false. Final software checks:100 Python+32 backend JS+31 frontend=163, production build green.
