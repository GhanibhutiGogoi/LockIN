# Variant: design/taste — immersive

**Direction.** The slide is the only lit thing in the room. Each screen has one protagonist (the deck, the camera view, the slide, the clip, your focus figure), and layout, scale and space carry the hierarchy instead of labels and boxes. The chrome holds no colour: actions are ink, the one data hue marks the focus line, and the highlighter stays the product's signature. Rescue mode stays a black short-form phone column, so the format switch is sharper than before.

Made with the design-taste-frontend skill (app-screen run, `achromatic-ledger` style, seed 777630634). The shell was changed to "no sidebar" because LockIn has only two destinations. The brand type was kept: Atkinson Hyperlegible Next for all reading, and Archivo only for the wordmark, the rescue captions and the one big figure on a screen.

## System

- Removed: the cream-green paper ground, hairline dividers and 1px outlined cards, resting shadows on slides and cards, the monospace face (Atkinson Hyperlegible Mono, dropped from `package.json`), the gradient highlighter, glass/backdrop blur, and the blue primary button.
- Changed: there is now one reading family, set at 15–20px and never thinner than regular weight. Ground is a cool blue-grey (`#f1f2f4`), with a true neutral dark (`#0e0f11`). Buttons are fully round and ink-filled (inverted in dark). Surfaces are separated by tone steps. Only floating things (popover, settings sheet, toast, tooltip) get a shadow.

## Desk
- Removed: the explainer paragraph, the "How a session goes" steps, the privacy note, the example attention-span card with its dashed sparkline, the "Your decks" list with its rules and Sample badge, and the dashed dropzone card.
- Changed: the featured deck's slide is the hero (8 of 12 columns), with the title, the meta line, one Study button and the example-report link beside it. "Open slides" moved to the top bar, and a PDF dropped anywhere on the page opens it. Other decks appear as a thumbnail row only once they exist. The attention span appears as one figure only once there is real history. On a phone the slide is cropped like a photograph so its text stays readable.

## Setup (camera)
- Removed: the step indicator, the two "measures / never does" check lists, the figcaption, the "Processed on this laptop" chip and the helper paragraph.
- Changed: a dark viewfinder (live preview, or the four-signal drawing) is the protagonist. The privacy promise is one sentence under a shorter headline ("Where you look, not what you look like"). The blocked and missing states are plain text with numbered steps, not tinted boxes. The reading check is just a top progress line, the passage and Skip.

## Study
- Removed: the top bar (wordmark, deck title, focus gauge, elapsed time, dividers), the circled side arrows, the slide's own header label, and the dashed simulator pill.
- Changed: the slide fills the room. When you are focused and idle, all chrome fades to 0 except the camera indicator, which is always visible and still pauses on click. Notes, Settings and Finish sit top right, the progress rail, slide count and "D to look away" sit along the bottom, and the arrows are bare chevrons. They all return on pointer move or focus. Focus state is announced to screen readers only. The drifting glow is unchanged. "Coming back" is now a short line with a fill bar. The pause and break screens are opaque, with the break timer as one large figure. Elapsed time moved into the Finish popover.

## Rescue
- Removed: the "LockIn · Slide N · title" header and its scrim, the "Key term" and "Quick check" labels, the labels under Flag and Sound (now icon buttons with names), the duplicate 1–4 key hints, the loading subline, glass blur, and the phone frame shadow.
- Changed: the key term pops in rescue-caption type. Quiz options are numbered 1–4, so the shortcut is the label. The quiz backdrop is solid black. Esc / "I'm back" and the 1–4 and M keys work as before.

## Report
- Removed: the eyebrow meta line with its Example chip, the boxed memo card, the four-tile stat grid, the timeline's card, "hover" hint, single-series legend and threshold legend, the bordered question cards, the bottom action row, and the highlighter on the headline figure.
- Changed: the typical focused stretch is the protagonist as one large figure, with the delta in words and the personal-AI memo beside it. Three secondary figures sit in the timeline's header. Threshold lines are labelled at their ends. The chart is drawn at its real size, so ticks stay readable on a phone. "Study again" is in the top bar. Lost slides and questions are two plain columns.

## Settings
- Changed: no rules or borders, larger hints. The slang sample sits in a tone-step well. Two explanatory sentences were cut.

## Known exceptions
- The inspector warns about the 40px Desk title, because app screens usually stay at 32px or less. That size is deliberate: the title is the caption to the hero slide.
- It also warns about the blank band inside the sample slide. That is the slide's own whitespace, not a stretched card.
- `IntegrationsPanel.tsx` is untouched. Without the mono package it falls back to the system monospace.

## Finishing pass

Every state in the shared checklist was walked in light and dark at 1440 and 375, including the parts the redesign had skipped: the live camera, blocked and missing cameras, calibration, breaks, real PDF uploads (6 and 45 pages, corrupt, .pptx, .txt), and multiple decks. The full list is in `docs/UI-STATES.md`. The main changes:

- Desk: a full-window "Reading your slides" state; upload errors in plain words with the next step; error toasts you can dismiss; the attention span set as the screen's one figure.
- Setup: the live viewfinder shows a frame instead of fake landmarks; blocked and missing cameras show in the viewfinder.
- Study: text slides reflow at reading size on an upright phone; PDF decks suggest turning sideways; the recovering line clears the phone header; Tab order starts at the header; "Paused" when there is no camera.
- Rescue: the key-term card is sized to the word; the push-in no longer crops the slide; a flagged state; "I'm back" sits on a dark chip over bright gameplay; quiz focus no longer looks pre-chosen.
- Report and Settings: English dates; the settings sheet traps and returns focus; history deletion asks once more; the selected segment is visible in dark.
- `index.html`: title, description, theme-color, favicon.
