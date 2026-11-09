# UI states — Taste variant (`design/taste`)

Every reachable state from the shared checklist, walked in headless Chrome (fake
camera device for the live path) in **light and dark, at 1440 and 375 wide**,
on the dev server, plus the main flow again on the production build.
Generated sample files: a 6-page and a 45-page landscape PDF, a corrupt PDF
(a text file renamed `.pdf`), a fake `.pptx` and a `.txt`.

✅ checked, looks finished · 🔧 fixed in this pass (what changed) · ⚠️ could not be verified (why)

## Desk

- ✅ First run (sample deck only): slide hero, title, Study, example-report link.
- ✅ After an upload (2+ decks): the new deck becomes the hero, earlier decks move to the "Other decks" row (checked with 2 and 3 decks).
- 🔧 With history (2+ finished sessions): the attention span is now set as the screen's one figure (Archivo, 44px). Before, Atkinson's slashed zero rendered "1m Ø2s". The "+72% since your first" delta is shown in words.
- ✅ Upload drag-over: the whole window dims to "Drop to start reading". 🔧 Added an upload icon and "A PDF of your lecture slides", so the overlay also says what it accepts.
- 🔧 Parsing / loading: the only sign was a greyed-out "Reading x.pdf" in the top bar that looked disabled. It is now a full-window "Reading your slides" state with the file name and a progress line.
- 🔧 Error, `.pptx`: the provider's message tells you to "connect the service in Integrations", a panel that does not exist in production. In production it now reads "PowerPoint isn't supported yet. Export the deck as PDF and open that." Dev builds keep the provider's hint.
- 🔧 Error, non-PDF: "notes.txt isn't a slide deck. LockIn opens PDF slides."
- 🔧 Error, corrupt PDF: it showed PDF.js's raw "Invalid PDF structure." It now names the file and says what to do. Password-protected PDFs get their own message.
- 🔧 Error toasts carry a close button, and the same file can be picked again after an error (the input is reset).
- ✅ A 40+ page PDF: 45 pages parse in about 3 s behind the reading state; the 45-segment rail fits at 1440 and 375.

## Setup (camera)

- ✅ Pre-prompt: drawn viewfinder, one-sentence privacy promise, "Turn on camera", "Study without the camera".
- ✅ Waiting for browser permission: "Waiting for your browser" plus "Click Allow near the address bar".
- 🔧 Blocked (with recovery steps): the viewfinder now dims and says "Camera blocked" with a camera-off mark. Before, it kept showing the four-signals drawing as if nothing was wrong. The numbered steps, Try again and the no-camera path are unchanged.
- 🔧 Missing camera: same treatment, "No camera".
- 🔧 Camera on (preview): the live picture showed fake eye ellipses, a head-direction line and "Face present / Eye gaze" labels at fixed positions over your real face. Now it shows only a frame to sit in plus "Keep your face in the frame". 🔧 The "Head direction" label in the drawing no longer collides with the frame.
- ✅ Calibration: five dots with "n of 5", the centre-dot instruction, Skip calibration.
- ✅ Reading check: top progress line, countdown, passage at 20px, Skip.
- ✅ Skip ("Study without the camera"): goes straight to study with "Camera off" in the indicator.
- ⚠️ The real browser permission prompt and a real blocked or unplugged camera can't be produced in headless Chrome, so those were forced through `useApp.setState({ camera })`. The live path ran on Chrome's fake camera (test pattern), not a face.

## Study

- ✅ Focused and idle: after 4 s everything fades except the camera indicator.
- ✅ Chrome visible (pointer at the top edge): focus gauge, time, camera, Settings and Finish in one capsule top right (the notes button and N shortcut were removed); arrows; rail, count and the "D to look away" hint at the bottom.
- ✅ Drifting: amber edge glow.
- 🔧 Recovering: "Locking back in" with a fill bar. On a phone it sat on top of the header icons, so it now moves under the header below 768px.
- ✅ Camera paused (P): checked with the live fake camera. The camera is released, the opaque veil appears, and P again re-acquires the camera. 🔧 In no-camera mode the veil said "Camera paused"; it now says "Paused".
- ✅ Note-taking mode (N): highlighter chip with a 60 s countdown that stays visible while the rest of the chrome is quiet.
- ✅ Break card, repeated lapses ("Tired, not lazy"), the rescue cap ("Time for a real break"), the running timer as one big figure, and timer done ("Ready when you are" / "Back to the slides").
- ✅ Finish confirm: popover with the elapsed time, "See my report" / "Keep going".
- ✅ First and last slide: the matching arrow is disabled; the rail and count are right (8/8, 45/45).
- ✅ No-camera mode: "Camera off" indicator. Lapses come from the simulator and from app switches.
- ✅ Window or tab not focused: drift, then a clip after the inactive-window delay, and the tab title changes to "Come back to your slides · LockIn".
- ✅ Real uploaded PDF slide: rendered by PDF.js, filling the room, including a rescue clip and quiz built from a PDF page.
- 🔧 Phone held upright: the demo slides set body text at about 7px on a 16:9 slide. Text slides now reflow as a page at reading size (24 / 18 / 17px) when the room is tall and narrow. PDF pages keep their own layout, so PDF decks show a quiet "Turn your phone sideways for a bigger slide".
- 🔧 Tab order started at "Next slide" before the header; it now runs camera indicator → settings → Finish → arrows → rail.
- 🔧 With Settings open over study, the N, P and arrow keys no longer act on the session behind it.

## Rescue

- ✅ Loading: "Hold up" (or "Once more, shorter" for a second clip) with a progress line, I'm back available.
- ✅ Clip playing with captions: 1–3 word captions on the split line, the spoken word highlighted.
- 🔧 Key-term moment: the black card stretched the full column width with the word on the left. It is now sized to the word.
- 🔧 The slide's push-in reached 1.26× by the end of the clip and cropped the first letters ("tage 1 · Glycolysis"). It now tops out at 1.09×.
- ✅ Quiz with 1–4 numbered options. 🔧 Focus now lands on the answer group, not on option 1, which showed a focus ring that read like a pre-chosen answer. Tab still reaches every option.
- ✅ Right answer: highlighter fill, check, confetti, "W" plus the line, then auto-return.
- ✅ Wrong answer: struck-through red option, the right one highlighted, "Nah" plus the correction. 🔧 Added space between the correction and "Back to the slide".
- ✅ Skip with Esc / "I'm back": returns to study in the recovering state. 🔧 The "I'm back" label and its Esc key sat as white text on the gameplay's light-blue sky; they now sit on their own dark chip.
- 🔧 Flag wrong fact: the button never changed after a press. It is now a toggle: the first press fills it white (`aria-pressed`) and the toast confirms; a second press takes the report back (`retractWrongFact`, same endpoint with `"retracted": true`) and the toast says "Flag taken back." During a clip the toast sits above "I’m back".
- ✅ Mute (M or the button): the icon switches to muted and the label to "Unmute (M)".
- ✅ Clip ends → back to study (via the quiz countdown or the button).
- ⚠️ Narration audio: headless Chrome has no speech voices, so caption timing ran on the estimate fallback, and mute was verified by its state, not by ear.

## Report

- ✅ Report from a real short session you just finished (35 s, zero lapses): "That was a quick one", 100% / 0 times / dash, "None. Your focus held through every slide.", "No clips, so no questions."
- ✅ Report from a real 2 m 17 s session with one lapse: the "1m 02s" figure, the memo, the timeline with the lapse marker and clip band, the slide that lost you, the question.
- 🔧 The date rendered in the system locale ("11月5日週四 下午07:33") inside an English UI. It now reads "Thu 5 Nov, 19:52".
- 🔧 The missing "back on track" value printed a full-size ink dash; it is now a quiet grey dash.
- ✅ The timeline's table view ("View as table"): minute rows with right-aligned figures, wrapping cleanly at 375.
- ✅ "Study again" (goes through setup if the camera isn't settled), "Revisit" (opens that slide), and "Desk". 🔧 The Revisit buttons now name their slide for screen readers.
- ✅ The example report from the desk link.

## Settings sheet

- ✅ Every control: How clips talk (with a live sample), Roast wrong answers, Sensitivity (the seconds update), Glow only, Rest between clips, Theme, Recalibrate, Delete history. All values persisted to the store.
- ✅ Theme switch: System, Light and Dark each apply instantly. 🔧 The selected segment was nearly invisible in dark (darker than its track); there is now a `--seg-on` token. 🔧 The browser's `theme-color` follows a forced theme.
- 🔧 Clear history: one press wiped all history. It now asks "Press again to delete it for good" (pale red), then shows "Session history deleted".
- ✅ Nudge-only mode: with "Glow only" on, 14 s looking away stays at the glow and no clip starts.
- 🔧 Keyboard: Tab escaped the modal sheet into the page behind. Focus is now trapped inside, Esc closes the sheet, and focus returns to the button that opened it.

## Global

- ✅ Toasts: info (ink, e.g. "Flagged…", "Eyes back on the slide.") and error (ink with a red mark and a close button), in both themes.
- ✅ Keyboard-only traversal with visible focus rings (2px `--pen` outline) on Desk, Setup, Study, Report and Settings; Enter and Space activate.
- ✅ prefers-reduced-motion: animations collapse to 1 ms, the drift glow stays on without breathing, confetti is skipped, and gameplay runs at a quarter speed.
- ✅ No horizontal scroll at 375 on Desk (1–3 decks), Setup, Reading check, Report (with the table open) and in production.
- ✅ No console errors or warnings in any scenario. 🔧 The favicon 404 is gone.
- ✅ Production build (`npm run build && npx vite preview --port 4174`): the Integrations panel is absent and the backtick does nothing. The full flow (desk → no-camera → D → clip → Esc → Finish → report) works without the panel, and no UI text mentions Integrations (the .pptx message is rewritten in production). The "D to look away" hint stays, because D works in production and is the only way to trigger a lapse while gaze tracking is simulated.
- 🔧 `index.html`: real title, meta description, `theme-color` for light and dark, `color-scheme`, an SVG favicon (ink square with the highlighter "LI"), and `lang="en"` (it was `zh-Hant` on an English UI).
- ✅ design-taste-frontend gate on the production preview: `inspect.mjs --app` 0 FAIL, 2 WARN, both documented exceptions (the 40px desk title and the sample slide's own whitespace). `lint.mjs --app` 0 FAIL. Its warnings are clock zero-padding, shadows on floating surfaces only, and monospace only in the dev Integrations panel.

## Not changed, by rule

`src/contracts/`, `src/providers/`, `src/session/`, `src/store.ts` exports, `pilot/` and `IntegrationsPanel.tsx` are untouched. Error wording for uploads is rewritten in the UI layer (`DeskScreen.tsx`), not in the provider.

## Later changes (desk and setup)

- Setup's camera page ("Where you look, not what you look like") is removed. Study goes straight in; on the first session the browser's permission prompt asks for the camera. Allowed → "Camera on"; blocked or missing → camera stays off, focus falls back to app switches, and one toast says so. Checked headless with a fake camera and with prompts denied.
- `SetupScreen` now only runs calibration and the reading check, reached from Settings → Recalibrate. If the camera can't be opened there, it returns to the desk with an error toast.
- Desk, first visit: the import surface is the hero (Choose a PDF, or drop anywhere; the drop hint is hidden on touch screens), the sample deck sits beside it. After an upload: the deck is featured and "Your decks" starts with an Add slides tile; Add slides also sits in the top bar. Checked with a real 9-page PDF at 1440×900 (light and dark) and 390×844.

