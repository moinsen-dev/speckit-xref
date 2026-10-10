---
name: design
description: Settle the look of a Spec Kit feature that has a user interface, after its plan and before its tasks - DESIGN.md at the project root (Google Stitch's format - YAML tokens plus the reasons in prose) and one static HTML mock per screen in specs/<feature>/design/, with screens.md saying which screen serves which user story. Use when the speckit-xref autopilot hands over a design step, or before /speckit-tasks for a feature people look at.
---

# Design a feature's look

A spec says what the app does; nobody has seen it yet. Without a shared look every screen re-invents colours, spacing and tone, and the person sees the result only when all tasks are built. Draw it now, once: a design system the whole app uses, and a mock of each screen this feature adds or changes. The person looks at both at the design review before the tasks are written.

Do not ask the person in this step. Decide what is open and write it down as an assumption: they judge the result at the review.

## 1. Read first

- `.specify/memory/product-brief.md`: its **Design** line is the person's decision (mood, references, dark mode, accessibility). Follow it.
- The constitution, the spec (user stories, FR-###, the person's own words in **Input**) and plan.md (platform, framework, screens it names).
- `DESIGN.md` at the project root, if it exists: the project's design system. Keep its tokens.
- The code, if there is UI already: its theme (`theme.ts`, `colors.ts`, Tailwind config, CSS variables, a component library's theme). That is the look the app has.

## 2. DESIGN.md (the design system)

- **No DESIGN.md, UI code exists**: write down the look that is there (its colours, fonts, spacing, radii) instead of redesigning it. Record "Design system: created".
- **No DESIGN.md, no UI yet**: create it from the product brief's direction. Record "Design system: created".
- **DESIGN.md exists**: keep it. Add a token only where this feature needs one and nothing fits; record "Design system: extended" and name the token in screens.md, else "unchanged".

The format (Google Stitch's DESIGN.md, https://github.com/google-labs-code/design.md): YAML frontmatter with the tokens, then the reasons in prose.

```markdown
---
name: <product name>
description: <the atmosphere in one line>
colors:
  primary: "#1D1D1F"      # text and the main action
  secondary: "#5B6270"    # supporting text, borders
  tertiary: "#2F5BD3"     # the one accent: links, focus, the key action
  neutral: "#FAFAF7"      # page background
  surface: "#FFFFFF"      # cards, sheets
  surfaceAlt: "#F2F2EE"
  border: "#E3E1DB"
  success: "#1F7A3F"
  warning: "#8A6100"
  error: "#B3261E"
typography:
  h1: { fontFamily: Inter, fontSize: 2rem, fontWeight: 700, lineHeight: 1.15 }
  h2: { fontFamily: Inter, fontSize: 1.375rem, fontWeight: 650, lineHeight: 1.25 }
  body-md: { fontFamily: Inter, fontSize: 1rem, fontWeight: 400, lineHeight: 1.5 }
  body-sm: { fontFamily: Inter, fontSize: 0.875rem, fontWeight: 400, lineHeight: 1.45 }
  label: { fontFamily: Inter, fontSize: 0.8125rem, fontWeight: 600, letterSpacing: 0.02em }
rounded: { sm: 6px, md: 10px, lg: 16px, full: 9999px }
spacing: { xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 40px }
---

## Visual Theme & Atmosphere
<two or three sentences: the mood, and why it fits these users>

## Color Palette & Roles
<each colour's job; the one accent and where it may appear; dark mode values if the product has dark mode>

## Typography
## Spacing & Layout
## Components
<buttons, cards, inputs, lists: their states (default, pressed, disabled, focus)>

## Accessibility
<contrast at least WCAG AA (4.5:1 for text), touch targets at least 44 pt, text that scales, never colour alone>

## Voice & Copy
<the language(s), the tone, how the app addresses the person>

## Assumptions
<what nobody decided and you did, one line each>
```

Colour values are hex (`#RRGGBB`) or `rgb()`/`hsl()`. If `npx` works here, check the file with `npx --yes @google/design.md lint DESIGN.md` and fix every error it reports; if it cannot run, say so in one line and go on.

## 3. specs/<feature>/design/screens.md

```markdown
# Screens: <feature title>

**Design system**: created | extended | unchanged

| Screen | Serves | Mock | Notes |
|---|---|---|---|
| Start | US1, FR-001, FR-003 | [start.html](start.html) | the first thing a new user sees |
| Result | US1-AS2, FR-004 | [result.html](result.html) | 3–5 cards, one action each |
```

- One row per screen this feature adds or changes, in the order a person meets them. **Serves** names the user stories (`US1`), scenarios (`US1-AS2`) and requirements (`FR-003`) the screen makes visible: that is how the screens stay traceable to the spec.
- Every P1 story should be reachable through at least one screen; say so in Notes when a story has none on purpose.
- A feature that adds or changes no screen (a background job, a data change) writes the heading, `**Design system**: unchanged` and the line `No screen changes.`, and no mocks.

## 4. One mock per screen

`specs/<feature>/design/<screen>.html`, beside screens.md, the file name in the Mock column:

- Static and self-contained: inline `<style>`, **no `<script>`**, nothing loaded from the network (system fonts as the fallback of DESIGN.md's fonts). The dashboard shows it in a sandboxed frame.
- DESIGN.md's tokens as CSS variables on `:root` (`--color-primary`, `--space-md` …), and only those.
- The main platform's frame: a phone app at 390 × 844 CSS px, a web app at 1280 px wide (it should still read at 390).
- Real content: the copy in the app's language, sample data a real user would have, never lorem ipsum. The main state first; an empty, loading or error state below it when the spec names one.
- Semantic HTML (`header`, `main`, `nav`, `button`, labelled inputs), `<title>` = the screen's name.
- No `@spec` anchors in mocks: screens.md is the trace.

## 5. End

End the turn with one sentence: how many screens, whether DESIGN.md was created, extended or left, and where to look (the dashboard via `/xref web`, or the mock files). The design review comes next; the tasks follow once the person approves the look.
