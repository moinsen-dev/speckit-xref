---
name: accept
description: Play a finished Spec Kit feature through as a person would - start the app and run each acceptance scenario (USn-ASm) with a driver that leaves a JUnit report (Playwright for the web, Maestro for iOS and Android), commit one test or flow per scenario under e2e/acceptance/, turn failures into fix tasks, and list in acceptance.md what only a person can check. Use when the speckit-xref autopilot hands over an accept step, or to accept a feature before calling it done.
---

# Accept a feature

Unit tests prove the parts; nobody has used the app yet. Here you use it: start it, and play each acceptance scenario of the spec the way a person would, with a driver that leaves evidence. The person sees the result scenario by scenario, and every scenario you play stays as a test in the repository, so it can be played again.

## 1. What to play

The acceptance scenarios of `specs/<feature>/spec.md` (`US1-AS1` …), in order; the quickstart rows that name them show the steps. A project from a PRD cites the PRD's acceptance criteria in its scenarios (`PRD AC04`): keep those ids in the test's name too.

## 2. Bring the app up

- Read `.specify/memory/runbook.md` first: what earlier steps learned about this environment. Add a line for each new thing you learn.
- **Web first** when the platforms include the web: it is the fastest. Expo: `npx expo start --web` (or `npx expo export -p web` and a static server); other stacks: the dev server the quickstart names.
- **Mobile** only when Maestro is installed and a simulator or emulator can come up. Build and install a development build (`npx expo run:ios`, `npx expo run:android`) rather than Expo Go: Expo Go adds its own dialogs and overlays.
- Start servers, simulators and emulators in the background, and stop the ones you started at the end.
- **Time box:** if the app is not up after about 20 minutes, stop setting up. The scenarios you could not play go under Your part with their steps.

Known traps (Expo, iOS Simulator, Android emulator):
- Maestro's iOS driver needs time on a fresh simulator: `MAESTRO_DRIVER_STARTUP_TIMEOUT=240000`.
- iOS permission values in `launchApp.permissions` are `inuse` and `never`, not `allow` and `deny`.
- Metro may listen on IPv6 only: open `exp://localhost:8081`, not `127.0.0.1`; wait for the "Open in …?" dialog and confirm it.
- Expo Go's developer menu can cover the app: dismiss it in a `repeat: while: visible:` loop.
- An emulator with no space left needs a wipe: that deletes everything on it, so ask the person first.

## 3. One test per scenario, named by its id

**Playwright (web)**, `e2e/acceptance/<id>.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('US1-AS1 Given a registered email, when the user requests a link, then …', async ({ page }) => {
  await page.goto('http://localhost:8081')
  await page.getByRole('button', { name: 'Inspirier mich' }).click()
  await expect(page.getByText('Das passt heute')).toBeVisible()
  await page.screenshot({ path: 'e2e/acceptance/shots/US1-AS1.png' })
})
```

Run: `PLAYWRIGHT_JUNIT_OUTPUT_NAME=reports/acceptance-web.xml npx playwright test e2e/acceptance --reporter=junit` (install the browser once with `npx playwright install chromium`).

**Maestro (iOS, Android)**, `e2e/acceptance/<id>.yaml`:

```yaml
appId: com.example.app
name: "US1-AS1 Given …, when …, then …"
properties:
  scenario: US1-AS1
---
- launchApp
- tapOn: "Inspirier mich"
- assertVisible: "Das passt heute"
- takeScreenshot: e2e/acceptance/shots/US1-AS1
```

Run: `maestro test --format junit --output reports/acceptance-mobile.xml e2e/acceptance`.

Select by role, label or `testID`, never by screen coordinates. Assert what the scenario's **Then** says, not just that a screen opened.

## 4. Failures

A scenario that fails because of the app is a finding, not something to fix here: append a task to `specs/<feature>/tasks.md` under `## Phase N: Acceptance fixes` (the next free T### id, the files it will touch in backticks, the scenario id), and the autopilot builds it before the next acceptance run. A scenario that fails because of the test itself (a wrong selector, a timing) is yours to fix now.

## 5. `specs/<feature>/acceptance.md`

```markdown
# Acceptance: <feature>

| Scenario | Driver | Flow | Result | Evidence |
|---|---|---|---|---|
| US1-AS1 | playwright | e2e/acceptance/US1-AS1.spec.ts | pass | e2e/acceptance/shots/US1-AS1.png |
| US2-AS3 | maestro | e2e/acceptance/US2-AS3.yaml | fail → T070 | e2e/acceptance/shots/US2-AS3.png |

## Your part
- US3-AS2 on a real iPhone: open the app with location off, tap "Ort wählen", expect the place search (no simulator shows the real permission sheet).
- SC-001 with five real testers: time from first open to the first suggestion; target under 60 s.
```

The Result column is your word; the mod counts only the driver's JUnit report. Your part lists what no driver here can check: a real device, real users, a paid or external service, a store review; each with the steps to do it.

End the turn with one sentence: how many scenarios passed, how many became fix tasks, and how many are the person's part.
