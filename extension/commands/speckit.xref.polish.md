---
description: "Lift a working app's look and feel to its platform's best without changing what it does: a design direction with sample screens to approve, a design pass, reviews of fresh screenshots"
---

## User Input

```text
$ARGUMENTS
```

# Lift the look of a working app

The first version of an app is built plain on purpose: it has to prove that it works and makes sense. Once it has, this step lifts its look and feel to the level of the best apps on its platform, without changing what it does. A design lead sets the direction with two or three sample screens, the person approves it there, the other screens are built as a design pass, and the design lead reviews fresh screenshots of every screen until a round finds nothing (three rounds at most).

## 1. What "best" means

- **iOS**: content runs edge to edge, and navigation and controls sit on translucent material that floats above it (tab bar, toolbars, floating buttons), not on opaque bars; large titles that collapse as the content scrolls; sheets with detents for secondary tasks; system symbols (SF Symbols) with or instead of text; Dynamic Type text styles, no fixed font sizes; semantic system colours and materials that follow light and dark mode; haptics when something is committed; springy, interruptible motion; native controls (segmented control, menu, picker, switch) over home-made ones; swipe actions and context menus where a list invites them; designed empty, loading and error states.
- **Android**: Material 3 in its expressive form: dynamic colour, large shapes, motion that carries meaning, edge to edge, predictive back.
- **Web**: the same direction in CSS: backdrop-filter materials, the system font stack, `prefers-color-scheme` and `prefers-reduced-motion`, a visible focus ring.
- **Always**: one clear primary action per screen, touch targets of at least 44 pt, contrast AA, labels for VoiceOver and TalkBack, Reduce Motion and Reduce Transparency honoured.

Build with the platform's own components first: for Expo the `expo-ui`, `expo-native-ui`, `expo-router` and `expo-animation` skills where they are installed; for Flutter Cupertino and Material 3; for SwiftUI the system materials and controls. Adding a package of the app's framework is fine (with the project's package manager, e.g. `npx expo install`); a change that needs a new native build becomes a task of its own with the reason.

## 2. What stays

The same screens, flows and the texts that carry meaning, and every test green: run the test command after each change. A test that checks only the old look may follow the new one. Only what you saw on this build counts: a "before" shot may come from the user test (`specs/<feature>/try/`), every "after" shot is taken now.

## 3. The direction (first step)

1. Use the app (the iOS Simulator tool of the Claude desktop app; without it `xcrun simctl` for shots and deep links and Maestro for taps; a browser for the web) and take a "before" shot of every screen, light and dark, under `specs/<feature>/polish/before/`.
2. Write `specs/<feature>/polish.md`: `## Direction` (its first line says the feel in one sentence; then materials, type, colour, symbols, motion and haptics, and what stays), `## Screens` (per screen: what changes and with which native components), `## Samples`, `## Rounds` (empty). Bring `DESIGN.md` to the new direction, in its own format.
3. Before any code, append `## Phase N: Design pass` to `tasks.md`: one task for the shared parts (theme, type, components, navigation), then one task per screen, each with its files in backticks and the story it serves.
4. Build the shared task and two or three screens that show the direction best, each under its task, and check those tasks off once the tests pass. Take "after" shots under `specs/<feature>/polish/after/` and list before → after per sample under `## Samples`.
5. Leave the other screens' tasks open: the person approves the direction at the samples first (**Approve direction** in the pane, or `/xref approve`).

## 4. The review (after the design pass is built)

Change no code. Take a fresh shot of every screen, light and dark, under `specs/<feature>/polish/round-N/`, and compare each with `polish.md`, `DESIGN.md` and the platform's conventions. Rate each finding: **HIGH** (a screen still looks as before, or the new look breaks something: text cut off, contrast below AA, a control hidden under material, a flow that no longer works), **MEDIUM** (a deviation from the direction a person notices), **LOW** (taste). HIGH and MEDIUM findings become tasks under `## Phase N: Design review N`; add `### Round N` under `## Rounds` in `polish.md` with the date, per screen OK or its findings, and the shot paths. Without a way to tap, say which screens you only looked at. No HIGH or MEDIUM finding: the design pass is done.

Start servers, simulators and browsers in the background and stop the ones you started. End with a report of at most eight lines.
