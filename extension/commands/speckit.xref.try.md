---
description: "Use the app as a person would, story by story and off the happy path (iOS Simulator, a browser, or a headless browser script); findings with screenshots in try.md, HIGH and MEDIUM ones as fix tasks"
---

## User Input

```text
$ARGUMENTS
```

# Try the app as a person would

Unit tests prove the parts and scripted flows replay what someone wrote down. The bugs people meet show up when someone uses the app: a spinner that never stops, a dead end after denying a permission, a number that is wrong, a button off screen. This step is that someone.

## 1. Where to run it

- **iOS**: the Claude desktop app's iOS Simulator tool (`mcp__Claude_Code_iOS_Simulator__control`): `attach`, start the app (Expo: `npx expo start`, then `open_url` with its `exp://` URL in Expo Go; a development build if one is installed), then `screenshot`, `tap`, `swipe`, `text` like a finger would.
- **Web**: the browser tools when they are there (the desktop app's browser pane, Claude in Chrome), on the app's dev server. Without them: a short Playwright script with `channel: 'chrome'` (the installed Chrome; never download a browser) that clicks through like a person and saves screenshots.
- **No tool for a platform**: that platform is the person's part, with the steps to try.
- Read `.specify/memory/runbook.md` first; add a line for each new thing the environment taught you.

## 2. What to try

- **A new user first, then a returning one**: start with the app's stored data empty and its permissions not yet asked, so the first-run screens and the permission dialogs appear. Reset the permissions before the app starts, never while it runs (the system ends it): iOS `xcrun simctl privacy <device> reset all <bundle id>` (Expo Go: `host.exp.Exponent`), Android `adb shell pm revoke <package> <permission>`. Data an older build left (Expo Go keeps a project's data between builds) is cleared after you keep a copy. Then try once more as a returning user, with the data the first pass left; data of an older version that breaks the app is a finding.
- Each user story's goal, start to end, as the spec's stories and quickstart describe it.
- Then the paths people take by accident: deny a permission, go offline (where the tool allows), go back and forth, leave a field empty or type a very long text, try twice, rotate or resize.
- Look for: crashes and red screens, dead ends, endless spinners, wrong numbers, dates or currencies, text cut off or unreadable, a control that does nothing, a screen that contradicts the spec or its design.
- Time box: about 10 minutes for a story just built, about 20 for the whole app.

## 3. Findings

Take a screenshot of every finding and of each story's end state, under `specs/<feature>/try/`. Rate each one:

- **HIGH**: a story cannot be completed, data is wrong or lost, a crash.
- **MEDIUM**: a person would stumble or misread.
- **LOW**: polish.

Each HIGH or MEDIUM finding becomes a task under `## Phase N: User test fixes` in `specs/<feature>/tasks.md`: the next free T### id, the steps to reproduce, the files it likely touches in backticks, the story id. LOW ones stay in the log. **Do not change the app's code in this step.**

## 4. `specs/<feature>/try.md`

```markdown
# User test: <feature>

## 2026-10-12 · iOS Simulator (iPhone 17) · whole app

| Story | Result | Evidence |
|---|---|---|
| US1 | passed | try/us1-end.png |
| US2 | HIGH → T070: the spinner never stops when location is denied | try/us2-spinner.png |

Low: the weekend chip wraps at large text sizes (try/us3-chip.png).
Your part: a real iPhone with location services off.
```

Start servers, simulators and browsers in the background and stop the ones you started. End with one sentence: stories passed, findings by rating, tasks added.
