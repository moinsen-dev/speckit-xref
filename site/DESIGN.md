---
name: speckit-xref site
description: A technical drawing of a spec — cool drafting film, navy ink, red pen for drift; blueprint at night.
colors:
  ink:      "#16233A"   # text, lines, the trace
  graphite: "#55627A"   # secondary text, captions
  paper:    "#EEF2F0"   # drafting film, the page
  grid:     "#D5DEDA"   # the sheet's fine grid and rules
  surface:  "#F7F9F8"   # panels that sit on the sheet
  redpen:   "#C62A2A"   # the one accent: drift, corrections, the hero's circle
  stamp:    "#1F4FA0"   # approval stamps on the gates only
  terminal: "#0F1B2D"   # the pane and code blocks
dark:
  ink:      "#E6EEF7"
  graphite: "#9FB3C8"
  paper:    "#0E2238"   # blueprint
  grid:     "#1C3654"
  surface:  "#132B45"
  redpen:   "#FF6B5E"
  stamp:    "#8FB4FF"
  terminal: "#081626"
typography:
  display:  '"DIN Condensed", "Bahnschrift Condensed", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif'
  body:     'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  mono:     'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace'
  scale:    { h1: "clamp(2.6rem, 6vw, 4.4rem)", h2: "clamp(1.8rem, 3.4vw, 2.5rem)", h3: "1.25rem", body: "1.0625rem", small: "0.875rem" }
rounded:
  none: "0"
  sm:   "4px"     # buttons, code blocks
  pill: "999px"   # balloons (item numbers) only
spacing:
  unit: "8px"
  section: "clamp(64px, 10vw, 120px)"
  measure: "72ch"
components:
  balloon: "a numbered circle on a leader line; refers to a note with the same number"
  stamp:   "an outlined, slightly rotated label in stamp blue; marks a decision that is the person's"
  redline: "a hand-drawn red circle or underline; marks drift"
  strip:   "the pane's phase strip (✓ done, ▶ now, · ahead); clickable, explains each phase"
---

# Visual theme & atmosphere

The page is a sheet from an engineering drawing set: a spec with its cross-references drawn in. speckit-xref traces each requirement to its tasks, files and tests, so the page shows exactly that — leader lines, item balloons, a title block with the revision, a parts list. Drift is what a reviewer marks with a red pen; decisions that only the person can make carry an approval stamp.

## Color roles

- **Ink** for everything that is the record: text, the trace's lines, tables.
- **Red pen** is the one accent and means drift or a correction. It never decorates and is never used for links or buttons.
- **Stamp blue** marks the person's decisions (approve the spec, ship it). Nothing else.
- At night the sheet turns into a blueprint: dark paper, light lines; the roles stay the same.

## Type

- Headlines in a condensed, DIN-like face, as drawing lettering; system fonts only (no web fonts: nothing loads from a third party).
- Body in the system UI face, measure under 72 characters.
- Monospace only for what is code: ids (`FR-002`, `T004`, `US1-AS2`), paths, commands.
- Sentence case everywhere; no all-caps eyebrows, no decorative labels.

## Layout

- Left-aligned, one column of text with the drawing beside it on wide screens; everything stacks on phones (16px gutter, no horizontal scroll).
- Numbers appear only where the content is a sequence (the workflow) or a reference (balloons to notes).

## Do / don't

- Do show the real thing: real ids, real commands, real pane output.
- Do keep motion to what a click causes (the strip's detail panel).
- Don't add gradient washes, card grids with identical shadows, or arrows appended to links.
- Don't use red for anything but drift.

## Accessibility

- Text contrast at least 4.5:1 in both themes: ink on paper 13.9:1, graphite 5.5:1, red pen 4.9:1 (blueprint: 13.8, 7.5, 5.8).
- Visible focus rings (stamp blue, 2px offset); the strip is keyboard operable.
- `prefers-reduced-motion` turns the one transition off.
