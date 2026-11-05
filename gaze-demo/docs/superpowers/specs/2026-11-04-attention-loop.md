# Attention loop scope

User authorization: implement distraction analysis, post-video recovery evaluation and a personal memory bank in the existing local WebEyeTrack demo. Video generation API is unavailable: use local videos. User can enter a learning goal; Jiaqi and Yingwen will later supply trial annotations. Automatic learning-goal/screen interpretation is a future adapter.

- Keep webcam pixels and eye crops in the browser. Persist derived samples and summaries only.
- Maintain pretrained gaze and personal calibration. Do not claim a trained attention classifier or validated accuracy.
- Classify task evidence from valid gaze geometry plus explicit manual screen labels (study/entertainment/unknown). Unknown and hidden/stale tracking must never count as task attention or distraction.
- Accumulate sustained evidence; trigger one local-video request at a time. Include the learning goal, last study context and personal preferences in a serializable generation request.
- Local video must finish and a question must be answered before normal return. Permit ending/aborting the study session; an abort is never scored as success.
- On-screen viewing during playback is separate from attention after return. Evaluate a 120-second return window, 4-second sustained task return, subsequent 2-second off-task relapse, and valid-data coverage. Missing or interrupted windows are censored.
- Update empirical style evidence only from complete automatic episodes with >=60% coverage and >=30 seconds of valid observation; exclude false alarms. These are initial engineering thresholds, not scientific guarantees. Explicit preferences remain distinct from observed outcomes.
- IndexedDB persistence scoped to a local profile; no account/cloud sync. Files themselves are not persisted. Provide profile switching, explicit preferences, episode annotations and JSON export.
- Preserve original sample traces and corrections for later supervised training; no automatic training in this implementation.
- Existing gaze preview continues to work. A bundled original educational sample video permits an end-to-end trial without external media.
- No Git repository exists in this local demo folder. Do not invent commits or push; any later GitHub push must use a branch and PR, with no agent co-author credit.

Timing defaults: distraction uses the existing adjustable duration (2 seconds initially); recovery hold 4 seconds; post-return window 120 seconds; cooldown 15 seconds after an episode. No repeated intervention during an observation window.

Video adapter output includes media URL and either a scored multiple-choice question or an unscored written recall question. No invented quiz correctness for written answers.
