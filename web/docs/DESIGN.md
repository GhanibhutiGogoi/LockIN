# LockIn — UI design principles (Taste variant)

These are the rules this variant is built on. When a new screen or state is
added, check it against this page first. (The Original variant's "paper and
pen" principles live on its own branch; this page describes `design/taste`.)

## The idea in one line

**The slide is the only lit thing in the room. Rescue mode is a phone.**
Each screen has one protagonist and the chrome around it holds no colour. The
jump from the quiet room to a black 9:16 clip is the "format switch resets
attention" hypothesis from the proposal, so the UI keeps that contrast sharp
and everything else quiet.

| | Study mode | Rescue mode |
|---|---|---|
| Feels like | A dim room with one lit sheet | A vertical short-form video |
| Colour | Achromatic: cool blue-grey ground, near-black ink, white slide | True black, white captions, highlighter on the spoken word |
| Type | Atkinson Hyperlegible Next, 15–20px, never thinner than regular | Archivo, condensed black, uppercase |
| Motion | Almost none; the toolbar leaves while you read and returns when you reach for it | Fast cuts, word-by-word captions, gameplay |
| Sound | None | Narration |

The **highlighter** (`--highlight`) is the one signature shared by both modes:
the "In" of the wordmark, key terms on slides, the spoken caption word, the
right quiz answer. The one **data hue** (`--pen`, blue) marks the focus line in
the report's chart and the keyboard focus ring. Nothing else in the chrome
carries a hue.

## One protagonist per screen

| Screen | Protagonist | Everything else |
|---|---|---|
| Desk (home) | The name, Lock / In, on the paper ground; “In” under the highlighter like the wordmark | One sentence on what LockIn does beside the name; Open your slides and Try the sample deck; Example report, Settings in the top row; your decks right below once you have opened one |
| Calibration / reading check (Settings → Recalibrate only) | The dot / the passage | A count, a thin progress line, Skip |
| Study | The slide, filling the room | While reading: one camera dot, top right. Toolbar capsule (focus gauge, time, camera, settings, Finish) only when the pointer is at the top edge or on a tap; arrows and slide rail on pointer move |
| Pause / break | The word "Paused" / the break timer as one large figure | One or two actions |
| Rescue | The 9:16 column | One white “I’m back” pill at the bottom; sound and flag as two small icons under the progress line; captions on the split line |
| Report | Your typical focused stretch as one large figure | Timeline, three secondary figures, lost slides and questions as two plain columns |

## Principles and where they come from

1. **Stay in the periphery until needed** (calm technology, Weiser & Brown 1995;
   Amber Case), the way a full-screen reader app does it. The toolbar shows for
   2.5 s on arrival so you learn where it lives, then leaves. It comes back only
   when you reach for it: pointer within 88 px of the top edge (it stays while
   the pointer is there), a tap on a touch screen, or Tab. Moving the pointer
   over the slide brings back the arrows and the slide rail, not the toolbar.
   Drifting doesn't call it either: the edge glow is the only signal. The
   toolbar is one capsule of icons; words live in tooltips.
2. **Match the strength of an interruption to its importance** (Gluck et al.,
   CHI 2007). Three levels, never skipped: drifting → amber edge glow (no
   sound, no text) · lapse → full rescue takeover · repeated lapses → a calm,
   opaque break screen.
3. **Every interruption can be postponed or dismissed** (WCAG 2.2.4).
   `Esc` / "I'm back" skips a clip; `P` pauses; "Keep studying" dismisses the
   break; "Glow only, no clips" in settings disables takeovers entirely.
4. **Ask for the camera only when the user is ready** (Google Meet permission
   case study). A pre-prompt says what is measured in one sentence, names the
   device on the button, and offers a no-camera path. Blocked and missing
   cameras show in the viewfinder itself and get numbered recovery steps.
5. **Draw only what is really measured.** Before the camera is on, the four
   signals are drawn on a face diagram. Once it is live, the picture gets a
   frame to sit in and nothing else: no fake landmarks on a real face.
6. **The camera indicator is always visible and is also the off switch**
   (Portnoff et al., CHI 2015). While you read it is the only thing on screen
   besides the slide: an 8 px dot top right, like a menu-bar camera light, and
   clicking it pauses. In the toolbar it becomes the dot plus a pause button.
7. **The home is one screen.** This is a demo: the first screen says what
   LockIn is in one sentence beside the name, with Open your slides and Try
   the sample deck. Your decks appear right under it once you have opened one.
   There is no camera page: Study goes straight to the slide, the browser's own
   prompt asks for the camera, and a no means app switches only, said once in
   a toast. Calibration lives in Settings.
8. **Every wait and every failure says what is happening in words.** Reading a
   PDF dims the desk to "Reading your slides" with the file name. Upload errors
   name the file and the next step ("Export it from the original app again"),
   never a parser message. Error toasts carry a close button.
9. **Captions follow short-form conventions**: 1–3 words at a time, heavy
   condensed sans, dark stroke, on the split between slide and gameplay, the
   current word highlighted. Labels over gameplay sit on their own dark chip,
   because the gameplay can be bright sky.
10. **Roast the answer, never the person.** Wrong-answer copy always includes
    the correction.
11. **Reward focus, not watching.** The report leads with the focused stretch;
    clip time is shown as a band on the timeline, a cost.

## Rules (house style)

- One reading family. Atkinson Hyperlegible Next for everything you read, set
  15–20px, regular or heavier. Archivo only for the wordmark, rescue captions
  and the one big figure on a screen (break timer, report headline figure,
  desk attention span); Atkinson's slashed zero reads as Ø at that size.
- Headings are sentence case, weight 700 in Atkinson, no trailing period.
  No eyebrows, no tracked uppercase labels, no index numbering.
- No hairline dividers and no 1px outlined cards. Surfaces are separated by
  tone steps (`--paper` → `--raised` → `--sheet`). The only lines left are the
  chart grid, the minute table's row rules and form fields.
- Shadows only on what floats: settings sheet, popover, tooltip, toast.
- Buttons are fully round, decided once. The primary is ink (inverted in dark);
  the secondary is a `--raised` fill; text actions are underlined links.
- Icons are one outline set at a 1.5 stroke, 16 / 18 / 20px.
- Motion only marks a state change, and every move has a reduced-motion
  fallback (the drift glow stays on without breathing; confetti is skipped).
- Text slides reflow as a page on a phone held upright; PDF pages keep their
  layout and the phone suggests turning sideways.
- Dates and times are formatted in English to match the UI.

## Deliberate exceptions (not slop, keep them)

- Rescue captions are 900-weight condensed uppercase with a stroke. That is the
  short-form format the format switch relies on.
- The drifting edge glow breathes. It is a live state, not decoration.
- The camera indicator dot is static: a pinging dot fights the calm room.
- Confetti exists in exactly one place: a right quiz answer.
- The desk title is 40px, above the 32px app-screen ceiling, because it
  captions the hero slide. The inspector warns about it; keep it.
- The sample slide's own whitespace reads to the inspector as a blank band in
  a card. It is the slide, not a stretched panel.
- `IntegrationsPanel.tsx` is a developer tool, hidden in production, and keeps
  its system monospace. Its way in is a plug icon beside Settings in each top
  bar (inside the Study capsule), never a floating button over the slide.

## Things we deliberately avoid

- Beige or cream paper, serif + italic emphasis, tiny mono labels, hairlines.
- Purple/blue gradients, glassmorphism, glow on everything, emoji as icons.
- Explainer paragraphs, step indicators, tours. One sentence next to the
  action, at most.
- Gamified streaks on the study side.

## Tokens

All colours are CSS variables in `src/styles/tokens.css` with light and dark
values; dark mode is first-class (studying at 11 pm is the main use case) and
is a true neutral, not navy.

| Token | Role |
|---|---|
| `--paper` | Ground (light `#f1f2f4`, dark `#0e0f11`) |
| `--desk` | The room around the slide in study mode |
| `--raised` | One tone step: wells, hover, secondary buttons, segmented track |
| `--seg-on` | The chosen segment, one step up from its track |
| `--sheet` | Floating surfaces: settings sheet, popover, toast-adjacent cards |
| `--slide` | The slide itself |
| `--viewfinder` | The camera preview |
| `--ink` / `--graphite` / `--pencil` | Three text tiers (graphite ≥ 6.6:1, pencil ≥ 5:1 on ground) |
| `--pen` | The one data hue, and the focus ring |
| `--highlight` | The signature highlighter |
| `--ok` / `--warn` / `--lapse` (+ `-soft`) | Semantic focus colours: good change, drifting, lapse/error |
| `--rot-*` | Rescue mode, the same in both themes |
| `--shadow-float` | The only shadow |

`index.html` sets `theme-color` for both schemes, and the app updates it when
the theme is forced in settings.

## Keyboard

| Key | Action |
|---|---|
| ← / → / Space / PageUp / PageDown | Previous / next slide |
| P | Pause / resume (camera off while paused) |
| D | Look away / back (only while the focus simulator stands in for gaze tracking) |
| Esc | Skip the clip ("I'm back"); close settings |
| 1–4 | Answer the quiz |
| M | Mute the clip |
| ` | Integrations panel (dev builds only; also the plug icon beside Settings in every top bar) |

Tab order in study runs camera indicator → settings → Finish →
previous/next → slide rail. The settings sheet keeps focus inside while open
and returns it to the button that opened it.

## Sources

- Weiser & Brown, *Designing Calm Technology* (1995); Amber Case, *Calm Technology* (O'Reilly)
- Gluck, Bunt & McGrenere, *Matching attentional draw with utility in interruption*, CHI 2007
- WCAG 2.2 SC 2.2.4 Interruptions
- web.dev, *How Google Meet improved audio and video permissions*
- Portnoff et al., *Somebody's watching me? Assessing the effectiveness of webcam indicator lights*, CHI 2015
- Short-form caption guides (Opus Clip, Kapwing)
- design-taste-frontend (tasteskill v2), app-screen run, `achromatic-ledger` style

## Report

The first view is exactly one screen. The answer sits at the top: the deck and
duration on one line, the focused-stretch figure with its one-line label, and
what LockIn learned as one paragraph (on a phone this paragraph moves below the
chart). The whole session runs along the bottom edge: one line of facts
(locked-in share, slips, time back) and the chart. Slides that lost you and the
questions start below the fold, so scrolling is how you go deeper. The chart has no y-axis, threshold
labels or legend; the crosshair tooltip names any moment (score, "Lost you ·
clip", "Paused"), and a minute-by-minute table is there for screen readers.
