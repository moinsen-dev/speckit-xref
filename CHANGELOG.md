# Changelog

## 0.10.0 — 2026-10-14

The deputy: between its steps the autopilot now thinks the way the person would, instead of switching on file states. Mod 0.10.0, extension 0.10.0 (unchanged but for the version); preset 0.3.0 unchanged.

### The deputy

- **Every step that builds, repairs, tries or restyles the app is reviewed.** That is implement, repair, the user test, polish, a bug, and a rework. A deputy on Opus at high effort reads the step as its lead would: the agent's whole report (taken from the Agent tool's result, not the session's five-line relay), the step's diff against the commit it started from (without lockfiles, generated files and test or polish shots), the test run, the tasks it checked off and the requirements they serve. It looks for:
  - claims the diff and the tests do not show;
  - results written down earlier, or weakened or skipped tests;
  - work no task asked for, or a deviation from the plan or a contract;
  - TODOs, and what the report says was left open.
  At the end of a phase it also asks whether this is still the right thing to build.
- **Its verdict:**
  - **go**, with a note the next step carries (into the agent's brief where an agent does it);
  - **rework**, which hands the same step back to the same agent with a concrete list, before anything else, at most twice in a row, then it is your call;
  - **ask**, which pauses the run with one clear question and the deputy's recommendation.
  A failing suite still goes to its repair step first.
- **Claude's questions are answered for you.** A question through `mcp__speckit-xref__ask` is answered in the same turn, and a question at the end of an answer is answered before the next step. The deputy decides from the spec, the product brief, the constitution, your own words and your earlier decisions, and gives one reason. The decision is kept as **decided for you by the deputy**: in the pane under **For you** with **Change** (your answer replaces it and becomes yours, or "Ask me when it comes up"), in the Away card, the dashboard and the handoff. It is never shown as yours.
- **What stays yours, enforced in code and not only in the prompt.** The deputy never approves the spec, the plan, a design direction or a release. A permission the rails stopped never reaches it. What a question names as money, keys, credentials, deleting, publishing or releasing, a measurement, a check by hand, a simulator, emulator or real device, or real users or data goes to you with its recommendation, whatever the model says, in English and German.
- **Your profile.** From your own words only, not from its own decisions, the deputy notes how you work (at most three lines a step) in `.specify/xref/local/person.md`. That file is git-ignored like your prompts, and you may edit or delete it.
- **Bounded and visible.** Each call runs on a clock (two minutes for a review, a minute and a half for an answer) and shows "the deputy reviews step N…" in the status line. No reply means the autopilot goes on as before. Every verdict is a `deputy` row in the run log.
- Option `deputy`: `full` (default), `review` (reviews only, questions as before) or `off`.

### Live

- Two headless runs on the A/B base (the same 59 tasks, orchestrated, user test off).
- **Run 1 found a flaw.** The deputy's diff left out the spec's own files: it did not see a `DESIGN.md` change the step had made, and it sent the step back twice for it. It now sees every file the step changed, from git, besides the capped diff. A file that is only cut from the diff is no reason to send a step back. A test holds this.
- **Run 2: 8× go, each with a note for the next step, and one send-back.**
  - It noticed that one phase had already done half of a later task.
  - It confirmed that the quickstart validation was run now. Under 0.8.0 the same task had been checked off with an earlier version's results.
  - The one send-back was for focus and link calls the agent had skipped; the rework fixed them in 1.5 minutes.
  - Each review took 10 to 60 seconds, 4.6 minutes for the nine steps, at an estimated $0.10 each.
  - The native smoke test was really run on iOS and Android and stayed honestly open when the run's time limit ended it.

## 0.9.1 — 2026-10-14

Found live in the desktop app: a press in the pane between two turns now goes on by itself. Mod 0.9.1, extension 0.9.1; preset 0.3.0 unchanged.

### Autopilot

- **Approve, Resume, Polish and Ship go on at once in the desktop app.** The desktop app hosts a session that the mod sees as not interactive, so each step was handed over through the Stop hook at the end of a turn. A press in the pane or the band between two turns had no turn to end: the next step waited until the person typed something like "weiter" (found live: after **Approve spec** the run stood still overnight, and its analyze step began only with the person's "ok ist approved also weiter"). Now, in a session that draws somewhere, a press outside a turn starts the step itself, once; inside a turn the Stop hook still chains the steps, and a `-p` run, which draws nowhere, works as before.

## 0.9.0 — 2026-10-13

Polish: the first version is built plain on purpose, to prove that it works and makes sense; on your word a design lead then lifts its look and feel to the best apps of its platform, without changing what it does. Mod 0.9.0, extension 0.9.0; preset 0.3.0 unchanged.

### Polish

- **Polish** after a done feature with a user interface (the pane's Polish button, `/xref polish`, `/xref next polish`, or "make it beautiful" in your words). A design lead, the new `speckit-xref:designer` agent on Opus, uses the app and takes a "before" shot of every screen, writes `specs/<feature>/polish.md` (the direction, whose first line says the feel in one sentence, and a plan per screen) and brings `DESIGN.md` along. Before any code it appends `## Phase N: Design pass` to tasks.md, one task for the shared parts and one per screen, then builds the shared parts and two or three sample screens under their tasks, with before and after shots in `specs/<feature>/polish/`.
- **Your yes at the samples.** The design pass waits for **Approve direction** (or `/xref approve`), or for your words on what to change; the samples are in the app already, so nothing pretends to undo them. A review round written into polish.md does not ask again; a changed direction does. Once the design pass is done, other work clears the wish, so a later change or bug starts no new reviews.
- **The design pass.** The implementer (Sonnet, never Haiku for a design pass) builds the other screens with the design-pass rules: the look changes, the behaviour and every test stay; the platform's own components first. With the Expo plugin installed, its `expo-ui`, `expo-native-ui`, `expo-router` and `expo-animation` skills do the native parts. A package of the app's framework may be added; a change that needs a new native build becomes a task of its own.
- **Reviews of fresh shots.** The design lead takes a fresh shot of every screen, light and dark, under `polish/round-N/`, and compares each with the direction, DESIGN.md and the platform's conventions. HIGH and MEDIUM findings become a `## Phase N: Design review N`; three rounds at most, then the user test tries the whole app again before it is done.
- **What "best" means**, by convention rather than version. On iOS: content edge to edge under translucent material, large titles, sheets with detents, SF Symbols, Dynamic Type, semantic colours, haptics, springy motion and native controls. On Android: Material 3 in its expressive form. On the web: the same direction in CSS. Always: one primary action per screen, 44 pt targets, contrast AA, VoiceOver and TalkBack labels, Reduce Motion and Reduce Transparency honoured.
- **Kept apart from the rest:** the phases are called Design pass and Design review, because Spec Kit's own tasks already end with "Polish & Cross-Cutting Concerns", which stays an ordinary phase. A design pass starts no new converge. polish.md and the shots change nothing verified. A design pass brings its own verify rounds, so the round cap does not close it early. The phase strip shows a polish column.
- New skill `speckit-xref:polish`; extension command `/speckit.xref.polish` for every agent Spec Kit supports.

### The user test in a terminal

- **Without the desktop app's simulator tool** (in a terminal), the tester and the design lead use the iOS Simulator through `xcrun simctl`: booting, deep links, light and dark (`xcrun simctl ui <device> appearance`) and screenshots read with the Read tool. Taps and typing go through Maestro where it is installed. Without Maestro they say which screens they only looked at.

## 0.8.1 — 2026-10-13

The user test, played live for the first time, starts as a new user and then tries again as a returning one. Mod 0.8.1, extension 0.8.1; preset 0.3.0 unchanged.

### The user test

- **A new user first, then a returning one.** The tester starts with the app's stored data empty and its permissions not yet asked, so the first-run screens and the permission dialogs appear: it resets the permissions before the app starts, never while it runs, since the system ends the app then (iOS `xcrun simctl privacy <device> reset all <bundle id>`, Expo Go is `host.exp.Exponent`; Android `adb shell pm revoke`), and clears what an older build left, after keeping a copy (Expo Go keeps a project's data between builds). Then it tries once more with the data the first pass left; an older version's data that breaks the app is a finding. In the brief, the `speckit-xref:try` skill and `/speckit.xref.try`.

### Live

- The tester in the iOS Simulator of the Claude desktop app (Sonnet, 24 minutes, Expo Go, the app the orchestrated A/B run had built, started directly rather than by the autopilot): 16 screenshots, a `try.md` per story and five fix tasks that 160 green unit tests had missed. One was HIGH: onboarding's last button led back to its first card, because the layout redirected on the profile it had loaded before onboarding finished. Four were MEDIUM: an endless spinner and no error state with an older build's data, ten-minute ideas for a weekend, a reset without asking, and a home-place notice without a home place. It never saw the location dialog, because Expo Go had the permission already, and it met the older build's data by chance; hence this release. Not yet live: the try steps handed over by the autopilot, and the handoff.

## 0.8.0 — 2026-10-12

The mod orchestrates: the heavy steps run in subagents with a fresh context and a model per step, the app is used as a person would before it counts as done, and the tests shrink to what proves a requirement. Mod 0.8.0, extension 0.8.0, preset 0.3.0.

### Orchestration

- **Implement, repair and the user test run in subagents.** The mod decides the step, the model and the brief; the session relays: it calls the Agent tool with the mod's agent type (`speckit-xref:implementer`, `speckit-xref:tester`), and the mod's spawn hook gives the agent its model and its brief and runs it in the foreground. The session keeps the spec, your decisions and the agents' short reports instead of every phase's work, so its context stays small. While a step is delegated the session writes no code: a Write or Edit outside `specs/` and `.specify/`, a shell redirect, `tee` or an in-place `sed`/`perl` is refused with the reason.
- **A model per step** (option `models`, `auto`): Sonnet implements, repairs and tests; Opus takes over a repair that failed once already; Haiku does a phase whose files are all docs or configuration. The spec, the reviews, verify, converge and ship stay with the session's own model. `sonnet`, `opus` or `haiku` sets one model for every delegated step. The run log names the model of each step (`main` for the session), and a step the session did itself although it was delegated is logged as `not delegated`.
- Option `orchestrate` (`on`) switches it off: every step in the session, as before.
- **A check by hand counts only when done now.** A task that asks for the app on a simulator, an emulator or in a browser, for screenshots against the design or a measured time is checked off only when the implementer did it on this code; results written down earlier are no evidence. It looks for the tools first (the simulator and browser tools, maestro, adb, also outside PATH); when none here can do it, the task stays open and the person is asked, and the autopilot waits instead of handing the phase over again (found in the A/B run below: Sonnet checked off a validation, a native smoke test and a visual check with an earlier version's results).
- **A handoff when a feature is done.** `.specify/xref/local/handoff.md` holds what the next feature needs from the conversation (the done state, the decisions you made, where the spec, the plan and the runbook are, the roadmap's next feature); the done card says that `/clear` before the next feature keeps the context small.

### The user test

- **The app is used as a person would**, in the iOS Simulator of the Claude desktop app or in a browser (a short Playwright script with the installed Chrome where neither is there; nothing is downloaded): each story right after its phase is built, before the next phase builds on it, and the whole app before the feature counts as done. The tester follows the stories and the paths people take by accident (a permission denied, offline, back and forth, empty or long input, a second try), writes `specs/<feature>/try.md` with screenshots under `try/`, and turns each HIGH or MEDIUM finding into a task under `## Phase N: User test fixes`, built before the next step. Option `userTest` (`on`) switches it off.
- New skill `speckit-xref:try`; extension command `/speckit.xref.try` for every agent Spec Kit supports. The phase strip has a try column.
- **Scripted acceptance is off by default.** The user test is the check; the scripted drivers (Playwright and Maestro, scenario by scenario, accepted only by a fresh JUnit report) run with option `acceptance: auto`. This changes the default: a project that relied on acceptance before done sets `acceptance: auto`.

### Lean tests

- **Tests prove requirements, not tasks.** One test per requirement or acceptance scenario, at the boundary where its behaviour shows; no render-only tests, no tests of what the framework or the types guarantee, no test per task. A test whose result depends on the clock or on chance fixes them (a set date and time, a seeded random). The phase brief, the implementer and the preset (`speckit.implement`, `speckit.tasks`, preset 0.3.0) say so.

### Proof

- **Shell writes and commits within one turn are booked.** The mod remembers HEAD when a turn starts and books the turn's changes against it, so files written by Bash and committed in the same turn reach the ledger (touched tasks, unplanned files, intents); `@spec` anchors and the real tests are scanned again whenever the shell or a commit changed the repo, not only when the feature changes (found live: a feature written almost entirely by Bash and committed in the same turns ended with one booked task and no passing requirement).
- **A coordinate tap in a sub-flow counts too.** The check for flows that tap by screen coordinates follows Maestro's `runFlow` into the flows it includes, relative to the including flow (both implementations).

### Measured

The same feature built twice from the same spec and tasks: an Expo app for iOS, Android and the web, 59 tasks in 8 phases, Opus as the session's model, the user test and scripted acceptance off in both runs.

- **Orchestrated: 30 minutes and at most $7.17** (Opus relaying, $2.17; Sonnet doing the work, $5.00). **Opus alone: 68 minutes and about $26** (estimated from its token share for the same eight phases). Both type-check clean.
- Under the same lean-tests rule Sonnet wrote 160 tests (1,805 lines), Opus 388 (2,629 lines): Sonnet keeps closer to it. One of Sonnet's tests depended on the time of day (green in the afternoon, red from 18:00), hence the clock rule above.
- The ninth phase, checks by hand, is left out of the numbers: Opus ran the app for 49 minutes on the iOS Simulator and an Android emulator and fixed eight real faults (a back button labelled "index", a doubled safe area, a keyboard over the place search, location on Android, an emoji drawn red); Sonnet checked the same tasks off in a minute with results an earlier version had written down. The converge step, with the session's Opus, found all three and wrote them as new tasks; the implementer's new rule above closes the gap. The earlier results came from the test setup, but the trap is a real one.

## 0.7.1 — 2026-10-11

Friction from the first real runs of 0.7.0, and the parts so far proven by unit tests only, played live: the pane in a real terminal, and acceptance on an Android emulator. Mod 0.7.1, extension 0.7.1; preset 0.2.0 unchanged.

### Ship

- **Ship holds until the release.** The person's Ship is kept in the local ledger (`checkpoints.shipWanted`): through the readiness tasks and their verify and acceptance rounds, and across sessions, until the release step is handed over. Not now, or other work (a feature, a change, a bug, the roadmap's next), puts it aside.
- **No approve while a step runs.** While the autopilot's step still runs, the pane shows "Claude is still on this step" instead of Ship it, Check again and Not now (found live: an earlier release.md made the gate appear while the check was rewriting it). The same holds for every review card.
- **Not now asks again** what comes next; before, the band kept the release's question.

### Tests

- **Vitest's reports reach the anchors.** Vitest writes no `file` attribute but the test file's path as `classname`; a classname that is a source file's path is now the test's file (contract §9, both implementations, a new shared case), so a test's `@spec` anchors count, not only ids in its name. Playwright writes its reports the same way.

### Acceptance on mobile

- **Expo Go counts.** Mobile acceptance plays on what the emulator or simulator already has: a development build if one is installed, else Expo Go on the app's `exp://` link. Building a development build downloads native dependencies, so it is a task under `## Phase N: Acceptance setup`, never part of the step (found live: the old wording made the step leave out mobile because no development build existed).
- **Live data.** Maestro cannot stub network services as Playwright does: the step plays now what holds without live data, and asks for a fixture mode (an environment flag that makes the app's service adapters return the web tests' fixtures) as an Acceptance setup task for the rest. Leaving out the mobile platform as a whole while Maestro and a device are there is no longer an option.
- **The time box covers the driver's work** (about 20 minutes for bringing the app up and getting the flows to run); an element without a label or testID gets a setup task.
- **A tap on screen coordinates is no evidence**, in the mod and in `xref.py accept`: a testcase whose flow taps by coordinates (a Maestro `point:`, a Playwright `mouse.click(`) accepts nothing, and the person is told which flow (found live: a 53-minute step ended with flows that tapped by coordinates, and the mod accepted two scenarios from them).
- A failing test run reaches the repair step without the runner's colour codes.

### Live

- The pane in a real terminal, driven by keyboard and mouse: Ship, the release dialog that names its commands, the band, Not now; the spec review's Keep and Change (Change hands the person's words to Claude, and the spec changes).
- Acceptance with Maestro on an Android emulator (Expo Go): flows per scenario named by id, Maestro's JUnit report read and recorded, and a fixture-mode setup task for the scenarios that need live data. The two flows that passed tapped by coordinates, so under this release they would accept nothing; the fixture-mode round and the new time box have not run live yet.

## 0.7.0 — 2026-10-11

The done app can go out: a release check, a release plan you approve, and a rail that holds every deploy until then. Mod 0.7.0, extension 0.7.0; preset 0.2.0 unchanged.

### Ship

- **Ship** after a done feature (the pane's Ship button, `/xref ship`, `/xref next ship`, or "ship it" in your words): the tests run once more, then a **release check** with the new `speckit-xref:ship` skill writes `.specify/memory/release.md`: version and store fields, a usage text for every OS permission the code asks for, privacy (the stores' answers drafted for you), accessibility, tracked secrets (paths, never values), the production build run locally, each with its evidence; the exact release commands per platform (the static web host the project is set up for, Expo EAS for iOS and Android with the traps of a first iOS build, or what the project configured); and your part before and after the release, as boxes you tick. Nothing goes out in the check, and nothing is downloaded for it.
- **Gaps are built first.** A HIGH or MEDIUM finding becomes a task under `## Phase N: Release readiness`; the autopilot builds, verifies and plays it through, then checks again. What the check and the local build write (`release.md`, `dist/`, `web-build/`) does not reopen a done feature.
- **What holds a release, before any model looks:** failing tests, red drift, a failing acceptance scenario, an unapproved spec; then release.md itself: not ready, a failing check, an open box of your part before the release, no command. The pane lists them, with **Check again**.
- **Ship it is yours.** The pane shows the commands that will run and your part after the release; **Ship it** (or `/xref approve`) runs them in a release step, once each, stopping at a login or any prompt, and the result is logged under `## Releases`. The run ends with what went out, target by target. Every release asks anew. A release under way (a check for this tree that has not gone out) holds across sessions, so the gate comes back without a new check; **Not now** puts it aside.
- Pane: a Ship row (`v1.0.0 → web · 14 pass · 2 your part · last: out …`) and a ship column in the phase strip; dashboard: a Release section with the checks, the commands, your part and the releases.

### The release rail

- While the autopilot runs, deploys, store builds and submissions and publishes wait for you like a push does: `wrangler deploy`, `eas build|submit|update`, `vercel`, `netlify deploy`, `firebase deploy`, `fastlane`, `npm publish`, `npm run deploy|release|publish`, `gh release create`, `fly deploy`, `supabase functions deploy`, `docker push`, also behind `npx`, and MCP tools that deploy, publish or submit. Building locally (`npx expo export`, `npm run build`), reading (`eas whoami`, `list_deployments`), asking for help (`--help`) and a tool's name as an argument (`ls fastlane`) pass. `allowPush` never opens a release; your yes in the ask dialog opens one command once; **Ship it** opens, for the release step, exactly the commands it approved as written (wrapped in `cd … &&` or `| tail` they pass; another flag, another project, `npx` in front, an extra deploy or an MCP deploy tool do not). The pane, the band and the dialog show those commands before you say yes.

### Done stays done

- Committing the new files of a done feature no longer reopens it: the tree fingerprint writes an untracked file as git will once it is committed (found live, when the release check's own advice to commit led to a second verify and acceptance round).

### Extension

- `/speckit.xref.ship`: the same release check and plan for every agent Spec Kit supports.

### Develop

- `node scripts/bump.mjs <version> [--extension <version>]` sets the version in all its places and the download and Action links; bumping to the current version changes nothing.

## 0.6.1 — 2026-10-11

Acceptance reaches the pull request, and the spec review separates what you decided from what Claude assumed. Mod 0.6.1, extension 0.6.1; preset 0.2.0 unchanged.

### Acceptance in CI

- `xref.py accept --junit reports/acceptance-web.xml` records an acceptance run (contract §9, §12): each driver test counts for the scenario ids in its name, a failed one fails the scenario, several reports merge (accepted only when every one passed it). Exit 1 when a scenario failed. Shared with the mod through a new contract case.
- The GitHub Action takes `acceptance-junit` (paths or globs) and `fail-on-acceptance` (true): the job summary gets an Acceptance section with each scenario's state, and a failed scenario fails the job. The README shows a workflow that plays the Playwright tests with the runner's Chrome.
- Screenshots and reports of an acceptance run (`/e2e/acceptance/shots/`, `/reports/acceptance*.xml`) are exempt: evidence is no drift (contract §2).

### The spec review: decided or assumed

- The review card lists what you decided (the product brief's decisions, your answers in the ask dialog) beside each assumption Claude made. **Keep** marks an assumption as yours (it stays kept until its text changes); **Change** asks what should hold instead (drop it, make it an open question, or your own words) and hands it to Claude, so the spec changes before you approve it.

### Run log

- Why the autopilot waited or stopped is logged beside its steps (`⏸ waits`, `■ stopped` in the dashboard); the Away card still counts only the steps.

## 0.6.0 — 2026-10-11

The finished app is played through before it counts as done. Mod 0.6.0, extension 0.6.0; preset 0.2.0 unchanged.

### Acceptance

- **A new step after verify** (option `acceptance`, `auto`): a feature with a user interface (plan.md's Project Type) is played through as a person would use it, scenario by scenario, with the new `speckit-xref:accept` skill. Web first with Playwright (through npx), iOS and Android with Maestro where it is installed, a development build rather than Expo Go; the environment traps of the first live run (driver start-up time, permission names, IPv6, Expo Go's overlays) are in the skill, and what a step learns goes into the runbook.
- **One test per scenario stays in the repository**, under `e2e/acceptance/`, named by its id (`US1-AS1 …`), so it can be played again.
- **Only evidence accepts.** A scenario is `★ accepted` only by a JUnit report the driver wrote during the step (`reports/acceptance-*.xml`, newer than the step's start); what acceptance.md says is the model's word. A failed case fails the scenario, a changed scenario text asks for acceptance again. Results live in the local ledger (`acceptance`, contract §1, additive).
- **Fix loop.** A scenario that fails because of the app becomes a task under `## Phase N: Acceptance fixes` (no code changes in the acceptance step); the autopilot builds it, verifies and accepts again. Verify and acceptance share one round counter: after three rounds, **Call it done** or Resume is yours.
- **Your part**: what no driver here can check (a real device, real users, a paid service, a store review) is listed in `specs/<feature>/acceptance.md` with its steps, and shown in the pane and the dashboard.
- **Time box**: if the app is not up after about 20 minutes, the remaining scenarios go to your part instead of an endless setup.
- **Nothing is downloaded in the step.** Playwright drives the installed Google Chrome (`channel: 'chrome'`); without Chrome the web scenarios go to your part. A project without `@playwright/test` gets a setup task first (devDependency, config, npm script), built and verified like any task, and the next acceptance run plays the scenarios.
- Pane row `Accept 6/9 accepted · 1 failing · 2 your part`; a dashboard section with each scenario's state, flow, report and screenshot. The dashboard's matrix now gives SC rows their rung and scenarios their acceptance state.
- Extension command `speckit.xref.accept` does the same for any agent.
- What acceptance writes (tests, reports, screenshots, acceptance.md, the runbook) does not count as a change of the verified tree, so it cannot start another verify.
- Converge rates its gaps like verify: only HIGH and MEDIUM become tasks (live, a README gap had become another round of work).

Not in this release: replaying the acceptance tests in CI through the extension and the GitHub Action (it needs emulators there) follows in 0.6.1.

## 0.5.3 — 2026-10-11

A project can start from the PRD you wrote first, and verify stops finding one more thing forever. Mod 0.5.3, extension 0.5.0; preset 0.2.0 unchanged.

### Start from a PRD

- A PRD in the empty folder (a Markdown file with "PRD" or "product requirements" in its name), or `/xref prd <path>`, takes Validate's place. The folder still counts as a new project; before, a PRD made it "existing code" and skipped Validate and Shape.
- The mod imports it to `.specify/memory/prd.md`; PRDs are read as Markdown only. Claude reviews it with the new `speckit-xref:prd` skill: `prd-review.md` (contradictions, untestable criteria, gaps, the open decisions that block the first feature) and `roadmap.md` (features in build order: phase, the PRD's own ids, the PRD sections, the gate before each, the spec text). It neither rewrites nor re-researches the PRD.
- **You approve the roadmap** in the pane (it lists the features, their gates and the open decisions). Shape then asks only the blocking decisions, and the first feature is specified from the roadmap, with its PRD sections and ids named.
- Specs carry the PRD's ids (`FR-001 … (PRD F01)`, stories and scenarios theirs); the pane's PRD row counts the feature's PRD ids the spec carries and names the missing ones; the intent check reads the PRD sections the feature implements instead of a one-line request.
- When a feature is done, **Next from roadmap** specifies the next one in the PRD's words; the gate before it (a test with real users, a review) is named as your part.
- Extension command `speckit.xref.prd` does the review and the roadmap for any agent.
- The PRD ids a feature implements and its spec does not carry yet go to the spec review, the plan and the analysis as a note (live: 49 of 55 carried after specify, the six missing named).
- A roadmap changed after your approval asks for it again before the next feature comes from it.
- A `-p` run in a new project hands its first prompt the step it stands at; before, the first turn ran ahead of the PRD review and wrote the constitution.

### Verify sorts what it finds

- Each finding is rated HIGH, MEDIUM or LOW; only HIGH and MEDIUM become tasks, LOW ones are listed. In the live runs every verify found "one more thing" (an anchor, a test name).
- After two verify rounds in a run, closing the feature is your call: **Call it done** (pane, `/xref approve`) closes it for this tree, Resume asks for one more round.

## 0.5.2 — 2026-10-10

The autopilot no longer ends at "done", and it hands each step what it needs to know. Mod 0.5.2, extension 0.4.1; preset 0.2.0 unchanged.

### After done comes the next thing

- A feature that passed converge, verify and the tests **stays done** while its spec, its tasks and the content of the working tree stay as they are; committing what was verified changes nothing, any further edit or new file does. Starting the autopilot again no longer verifies once more: it asks what comes next. In the live run a finished feature was verified three times in a row, the third time with "nothing changed since the last check".
- **New feature, Change, Bug** in the pane, your own words in the prompt (a small model tells the three apart, and a question stays a question), or `/xref next feature|change|bug <words>`:
  - a new feature goes to `/speckit-specify` and becomes the next feature;
  - a change reaches the spec first, then its appended tasks are built;
  - a bug is reproduced with a failing test, fixed, recorded under `.specify/bugs/<slug>/` (Spec Kit's bug extension where it is installed) and gets a task of its own.

### Each step gets its brief

- An implement step hands over the phase's goal, its **Independent Test** and **Checkpoint** from tasks.md, the acceptance scenarios it has to prove (tests named after `US2-AS1`), the quickstart rows and the design's screens that show them, and the last test run; it ends by checking the checkpoint. Before, a step said only "run /speckit-implement for this phase", and the per-story checkpoints of tasks.md were never handed over.
- `.specify/memory/runbook.md`: a step that gets past a problem of the environment adds one line, and every later step that runs code starts from it.
- In a `-p` run the first prompt is the first step: handed over with its full prompt and logged.

### Your yes counts

- The rails' question for an action (`git push`, `reset --hard`, …) now goes through `mcp__speckit-xref__ask` with `allow`; your **yes** allows exactly that action once, for ten minutes. Before, a yes in the dialog changed nothing and the push stayed refused.
- Option `allowPush` (off): on lets the autopilot push a feature branch by itself once the tests are green; never main, master or trunk, never `--force`, never a deletion.
- The rules ask Claude to commit the feature's `xref.json` with its own commits.

### Fixes from the live runs

- **An answered decision is no request.** The intent check had turned the person's yes to a push and to wiping a test device into two new requirements, and the next step wrote them into the spec. Answers to the rails' questions no longer reach the check, and a reported change that only repeats an answered decision is dropped.
- **Every id after `@spec` counts** (contract §5, mod and extension): `@spec 001-x/FR-003 FR-004` anchors both, the feature prefix carrying to the bare ids. Before, only the first id counted, and a verify asked for anchors that were already there.
- The runbook keeps what is true of the project's environment, not what this session's tool permissions allowed.

## 0.5.1 — 2026-10-10

A feature people look at now gets its look before its tasks, and you see it before anything is built. Mod 0.5.1, extension 0.4.0, preset 0.2.0.

### Design

- **Design step** (option `design`, on): after the plan of a feature with a user interface (plan.md's **Project Type**: mobile, web app, desktop …, else its **Target Platform**), Claude writes `DESIGN.md` at the root, the design system in [Google Stitch's format](https://github.com/google-labs-code/design.md) (colours, type, spacing, radii as YAML tokens, the reasons in prose), from the product brief's design direction. Where the app already has a look, it writes that down instead of redesigning it; an existing DESIGN.md keeps its tokens. Then one static HTML mock per screen in `specs/<feature>/design/`, and `screens.md`, which traces each screen to the user stories, scenarios and FRs it serves.
- **Design review** (new default `review: spec+design`): the autopilot stops at the drawn design. **Open the mocks** (pane, dialog, `/xref web`) shows them on the dashboard; **Approve design** goes on, and a design changed after your approval asks again. Running `/speckit-tasks` yourself approves it too. A feature that changes no screen goes on without a stop. `review` now takes `spec+design`, `spec`, `spec+plan`, `spec+plan+design` or `none`; set `spec` for the 0.5.0 behaviour.
- The tasks and implement steps build to it: the tokens go into the app's theme, each screen into the story it serves. The preset's `/speckit-tasks` does the same for any agent.
- The dashboard has a **Design** section: DESIGN.md's colours and fonts, each screen with what it serves and its mock in a sandboxed frame. The pane shows a Design row with a **Mocks** button; the phase strip a `design` column.
- Extension command `speckit.xref.design` with an optional `after_plan` hook.
- `DESIGN.md` is a spec artifact (contract §3): editing it is never drift.
- The review states what git shows for DESIGN.md, not only what screens.md claims: in the first live run Claude wrote "Design system: extended" without touching the file, and the line now says so.

### Fixes

- A review sits in the strip's column of what it reviews (`▶plan`, `▶design`, `▶idea`), not under `spec`.
- The stall check counts a written idea brief, product brief or design as progress.
- `/speckit-plan` typed at a review of the idea no longer records an approval of it; Build is the way.

## 0.5.0 — 2026-10-10

A new project now starts at the idea, and everything the run knows is on one page. Mod 0.5.0, extension 0.3.0. Design (a DESIGN.md and screen mocks after the plan) follows in 0.5.1.

### Validate and Shape: the entrance

- **Validate** (new projects, option `validate`, on): before the first spec, the idea is researched on the web by an agent of the mod's own: who has the problem, what already exists, what makes the idea different, the riskiest assumption, kill criteria, success measures, and a weighted score. The result is `.specify/memory/idea-brief.md`. Alternatives count as verified only with a URL that was fetched; without web tools the brief says so. **You decide**: Build, Sharpen or Drop, in the pane, the band or a dialog. The decision is kept with the brief's fingerprint, so only your press counts and a rewritten brief asks again. The idea's wording goes to the web search Claude uses.
- **Shape** (option `shape`, on): Claude asks what the idea leaves open (first-version scope, platforms, language and internationalisation, design direction, data and accounts) and writes `.specify/memory/product-brief.md`. The constitution and the spec treat those decisions as yours, not as assumptions; the brief's success measures become SC-###.
- Extension commands `speckit.xref.validate` and `speckit.xref.shape` do the same for any agent.

### The dashboard

- `.specify/xref/local/dashboard.html`, regenerated after every step and on `/xref web` (which opens it): goal and vision, the workflow, every tasks.md phase with its progress, a traceability matrix (requirement → tasks → files → tests → rung), drift and decisions, the run log, and the Spec Kit documents rendered in place, ids linked throughout. Local and git-ignored: it holds your own words.

### Visibility

- The pane names the tasks.md phase that runs (`Phase 3 · 1/3 · ✓1 ▶3 ·4 ·5 · US1 …`), the band shows `P3`.
- On a subscription the band shows the usage windows (`5h 34% · 7d 12%`) instead of /cost's list price.
- Option `pane: auto | always | off`; a band button opens the pane while it is off screen. Projects can carry `pane: always` in their `.claude/settings.json`.
- The Tests row names the failing line of a run.

### Fixes from the live run

- **Wrapped bullets:** requirements, scenarios, scope, assumptions, tasks and the constitution keep their indented continuation lines (mod and extension). A requirement cut after its first line had made the intent check flag an answered decision as new scope.
- **Fingerprints move with the parser:** ledgers now carry `fingerprintVersion: 2`. An older ledger is re-baselined on load: a fingerprint the old parser stored moves to the full text, so a green project stays green after the upgrade; a real change still asks to be proven again.
- The intent check knows the decisions you already made.
- `/xref approve` and a pane button approve a spec that was never approved (`◌spec`).
- The focus stays in the running phase; each implement step starts on its first open task.
- A repository without a commit waits for the first one (Spec Kit branches per feature only from one); the press asks for a `.gitignore` first.
- Verify without the extension: Claude checks the code against the spec and your words by itself, and the mod's intent check follows.

## 0.4.1 — 2026-10-10

Fixes from the first live greenfield run (an Expo app, the autopilot from tasks into phase 1). Mod 0.4.1, extension 0.2.1.

### Autonomy

- **One step at a time.** Starting or resuming the autopilot while a turn runs, or typing while a step works, no longer leaves a second step queued behind the first: the next step goes out only when the session is free and no prompt is waiting. Before, a pause could come one step too late.
- **The test command is the project's.** A `test` script in `package.json` comes first (`npm test`, or pnpm, yarn, bun by lockfile; a watch-mode script never counts), then plan.md's Testing line, where a backticked span counts only when it is a command (`jest-expo` is a package, not a command).
- **A command that is not there is no failing test.** Exit 126/127 or "command not found" no longer start repair steps; the pane and a toast say the tests could not run.
- **Analyze is followed through.** An analysis that finds something no longer ends in a "shall I apply the changes?" the autopilot reads as small talk: a remediate step applies its fixes before the next task (twice a run at most), and product decisions go to you.
- **Scaffold files are no drift.** Images, icons, fonts, `assets/` and tooling dotfiles (`.gitignore`, `.prettierignore`, …) are *unclear*, not unplanned, and rules apply to what was booked before they changed: a scaffold no longer turns the drift red after phase 1.

### The spec gate

- The review card puts **Approve spec** first, before the requirements; at a review pause the band offers **Approve** instead of Resume.
- Your own `/speckit-plan` (typed, or in a message) approves the spec it plans, and `/speckit-tasks` the plan; the model's calls never do.
- A spec planned without your approval shows as `◌spec`, and the status tool tells the model it is not approved.

### Reading Spec Kit

- A multi-line `**Input**` is your whole text, without the quotes (before, the first line and a stray quote).
- A task that names files in backticks names all of them: prose such as "iOS/Android/Web" is no path.
- The run log names a task only for steps that work on tasks.

Known limit: Claude Code 2.1.296's terminal draws a plugin's prompt framed and in full, so the one-line fold of autopilot prompts shows only where a surface honours the rewrite.

## 0.4.0 — 2026-10-09

Red has to mean something, and "done" has to be proven. Mod 0.4.0, extension 0.2.0, preset 0.1.0, and a GitHub Action, all held to one contract ([`docs/contract-0.4.md`](docs/contract-0.4.md)) whose cases both implementations run (`contract.test.ts`, `xref.py selftest`).

### Proof instead of claims

- **Proof ladder** per requirement: specified → planned → implemented (its task is done and non-test code shows it) → tested (a test with real tests anchors it; `test.todo` does not count) → passing (the test run proved it). Shown in the pane, `/xref`, reports and the PR summary.
- **Acceptance scenarios** get ids (`US1-AS2`) from Spec Kit's numbered Given/When/Then lines; anchors, links and test names may name them. A story without scenarios is a note.
- **Test results:** the mod runs the test command after each implement step (option `testCommand`, else plan.md's `**Testing**:` line) and reads JUnit when `junitPath` is set; the extension's `verify --junit` does the same.
- **Fingerprints:** a requirement's text is hashed when it is mapped, linked or proven. A changed requirement drops back and raises *re-verify*; a test for a deleted requirement is an *orphan test*.

### Trust: fewer false alarms, deterministic CI

- **Noise budget:** lockfiles, build output and generated code never count; manifests, configs, workflows and Markdown are *unclear*, not drift; `.xrefignore` adds your own patterns.
- **Ledger split:** `specs/<feature>/xref.json` is committed (map, links, accepted files, fingerprints; sorted, no timestamps); `.specify/xref/local/<feature>.json` stays on your machine (your prompts, intent verdicts, test results, the run log). A 0.3 ledger migrates on load.
- **CI never depends on a model:** `--fail-on` counts only deterministic findings; `--no-write` leaves both files alone; the feature comes from the branch (`NNN-…`) or the diff, and CI refuses to guess among several.
- **One classification order** for mod and extension (it differed: the extension checked anchors before plans).
- Bash writes (sed, generators, npm) are booked at the end of the turn.

### Autopilot: autonomy with guard rails

- **Spec gate** (on by default, option `review: spec | spec+plan | none`): the run stops once the spec is written; the pane shows your words beside the requirements, the scope and the assumptions; **Approve spec**, `/xref approve` or the dialog lets it go on. An approval holds for that text only.
- Spec Kit's whole loop: analyze before the first task and after spec changes, open checklists as a wait point, **one phase per implement step**, converge until the tasks stop changing.
- **Test-gated progress:** a failing suite becomes a repair step, at most three in a row; the run ends only on a passing suite.
- Requests beyond the spec become a revise step (`/speckit-xref-revise`); contradictions always stop. A `Persistence model:` line in the constitution (flow-back, flow-forward, living) decides.
- The ask tool answers in the same turn where you are there (a dialog), and a question that blocks only some stories waits in the pane's **Decide** row while the rest goes on.
- **Guard rails** while it runs: `git push`, `reset --hard`, `rm -rf` and writes to `.env` files are refused and turned into a question; a permission prompt sends a notification.
- **Stop now:** `/xref-stop` and the Stop buttons end the running turn too.
- Run log, cost and time in the band (`auto ▶ 3/25 · $1.80 · 23m`), an **Away** card, a notification after five minutes of waiting.
- Off by default: `/xref auto night` (a long run that leaves `briefing.md`), `commitPerTask` (feature branches only), `parallel` (`[P]` tasks to `speckit-xref:task-runner` subagents), and headless runs (`SPECKIT_XREF_AUTOPILOT=on claude -p …`, driven by the Stop hook).

### Visibility

- The band shows the whole question while the autopilot waits, with Resume, Stop and Pane; the pane tab reads `Spec X-Ref ⏸`.
- States read ok / watch / off-spec with the glyphs ● ▲ ✖; color is only a hint.
- Drift cards: each unplanned file gets **Link to** (a task picker) and **Accept this**; **Accept all** asks first and lost its hotkey.
- Phase strip (`✓setup ✓const ✓spec ✓plan ✓tasks ▶impl 7/8 ·verify`), a proof row, a compact pane under 70 columns (`d` for details).
- Transcript chips on each booked write (`● T006 · FR-003`, `▲ unplanned`); autopilot prompts fold to one line.
- Spec Kit's own commands get the feature's state appended; a compaction keeps the task, your open requests and the decisions.

### Spec Kit side

- **Extension 0.2.0:** `check` (`--no-write`, `--junit`), `verify`, `summary`, `report` with metrics (unplanned edits caught and how they ended, the blind-accept share, requests that reached the spec), `migrate`, `selftest`; new commands `speckit.xref.verify` and `speckit.xref.revise` (new ids, `SUPERSEDED by`, `RETIRED`, `revisions.md`).
- **Preset `xref` 0.1.0:** `/speckit-tasks` names every task's files in backticks and its requirements as `(FR-###)`; `/speckit-implement` focuses tasks, writes anchors in code and tests, checks a task off only when its tests pass, and stops after one phase when asked.
- **GitHub Action** (`moinsen-dev/speckit-xref/action@v0.4.0`): the check on every pull request with a job summary, requirement → tasks → files with their rung.

### Fixed

- Strict mode let an edit through when its own hook failed; it now refuses.
- The autopilot went on after an API error or a refusal; it now waits.
- The drift check and the next autopilot step started in the same tick, so a contradiction could arrive too late; the check now runs first and any red stops the run.
- Turn state lived in module variables and was lost on a reload; it lives in state atoms.
- In repositories without Spec Kit the tools now wait behind ToolSearch and nothing polls.
- The pane opened unasked on the main screen; it now opens unasked only in fullscreen.
- The question classifier no longer runs inside `turn.complete`.

## 0.3.2 — 2026-10-09

### Changed

- The autopilot never sets Spec Kit up by itself. `specify init` and `specify integration install` are wait points: the person asks for them, or presses the pane's setup action, and the autopilot goes on afterwards. A switched-on autopilot is no longer read as approval (found when a stray start in the mod's own repository asked for `specify init`).
- `/xref pane` looks at the folder first, then opens the pane without taking the keyboard, so the next key cannot press a button, and says where things stand.

### Added

- Folder detection. An empty folder (only dotfiles, a README, a license) is told apart from existing code. The pane offers one fitting start: **Start from an idea**, **Set up Spec Kit here** or **Add Claude integration**. A press is the person's go and hands Claude the request in their words.
- The project root is the nearest folder upward with `.specify/`, as Spec Kit finds it. Claude started in a subfolder of a Spec Kit project works on that project and is never offered a nested setup.
- The person's words become the idea for `/speckit-specify` only where the autopilot waits for one (an empty folder, or Spec Kit without a feature); "yes, do it" in a repository with code is no idea. The idea resets when the autopilot starts or stops.

## 0.3.1 — 2026-10-09

### Changed

- The autopilot's switch moved into the pane's Auto row: **Start autopilot** while off, **Stop** while it runs, **Resume** and **Stop** while it waits (`p`, `r`). Resume after a spent budget starts a new one.
- `/xref pane` brings the pane forward and says whether it is shown, waits for room, or sits behind another tab.
- The status tool names the project root, so paths read right when the project is a folder of a larger repository.

### Fixed

- A stray `speckit-*` skill no longer passes for Spec Kit's Claude Code integration: its core commands (`plan` or `implement`) have to be there, otherwise the autopilot installs the integration first. Found when the autopilot asked for `/speckit-implement` in the demo, which had only a stub skill.
- `examples/demo` is now a project set up with Spec Kit 1.1.2 (`.specify/` and the `/speckit-*` skills), so the autopilot runs there.

## 0.3.0 — 2026-10-09

### Added

- Autopilot (`/xref auto on [steps]`, the plugin options `autopilot` and `autopilotMaxSteps`, a pane button): after every turn the mod hands the next Spec Kit step to Claude by itself. It stops only for the person: Claude calls the new `mcp__speckit-xref__ask` tool, or ends on a question a small model judges to be a real decision ("shall I go on?" is not one). It also stops when a feature idea is missing, when a request contradicts the spec, on Esc, after three steps without progress, at the step budget, and when every task is checked and verified. What the person says before a feature exists becomes `/speckit-specify` in their own words.
- Environment check: whether the `specify` CLI is installed or runs through `uvx`, which Spec Kit release the project uses, and whether its Claude Code integration is there (a new `integration` phase: `specify integration install claude`). The setup step names the exact `specify init` command.
- The skill covers the autopilot and the environment check.

### Fixed (found in a live autopilot run)

- A task that names Spec Kit's own documents ("justified in plan.md") no longer counts them as files it plans (mod and extension 0.1.3).
- A file planned by another task moves the focus to that task even when it carries an `@spec` anchor; anchors still count as coverage.

## 0.2.0 — 2026-10-09

### Added

- Skill `speckit-xref:speckit`: sets up Spec Kit for Claude Code (CLI found or run through `uvx`, `specify init`, constitution), walks the workflow phase by phase, and covers switching features, requests beyond the spec, unplanned edits, strictness, and the extension with its CI check.
- Model tool `mcp__speckit-xref__status`: whether Spec Kit is set up, the constitution, the active feature and its artifacts, coverage, drift, the phase, and the next command.
- The next Spec Kit step in the pane (`Next`), in `/xref`, and in the note on every prompt. In a repository without Spec Kit, the pane points to the setup skill.
- Commands are spelled as `.specify/integration.json` records them (`/speckit-plan` or `/speckit.plan`).
- The release carries the extension under a name without a version as well, so `releases/latest/download/speckit-xref-extension.zip` always resolves.

### Fixed (found in a live demo run)

- A drift check between turns counted changes outside the project when the Spec Kit project is one folder of a larger repository (`git status --porcelain` lists the whole repository from its root). Mod and extension now list changes relative to the project and inside it. The extension is now 0.1.2.
- The pane and band kept showing a task as current after it was checked off. The current task is now the focused one while it is open, else the first open one. An edit to a finished task's file reads as rework.
- The extension's tests copied `examples/demo` as it stood on disk, so a playground run there broke them. They now copy the committed demo.

## 0.1.1 — 2026-10-09

### Fixed

- `@spec` anchors in new, uncommitted files were missed on machines without ripgrep: the `git grep` fallback now searches untracked files too (mod and extension). Found by the first CI run on a runner without `rg`.

## 0.1.0 — 2026-10-09

First release: a Claude Code mod and a Spec Kit extension that share one ledger per feature, `specs/<feature>/xref.json`.

### Claude Code mod (`mod/`)

- The active spec in the system prompt (stable, cache-friendly), the current task and the drift status on every prompt.
- Intent log: the person's own words, prompt by prompt.
- Edit booking against `tasks.md`; unplanned edits reported to the model beside the tool result; optional strict mode.
- `@spec` anchors as coverage; dangling anchors as drift.
- Intent check after each turn that wrote files (`$.model.fork`, a completion fed by the intent log when there is nothing to fork).
- Band above the prompt, pane (Goal, Vision, Now, Todo, Status, Drift), `/xref`, tools `focus`, `where`, `link`.

### Spec Kit extension (`extension/`)

- `speckit.xref.map`, `speckit.xref.check`, `speckit.xref.report`; optional `after_tasks` and `after_implement` hooks.
- `xref.py` (standard library): `map`, `link`, `check` (with `--base` and `--fail-on` for CI), `record-check`, `report`, `dump`.
- A folder a task names counts as planned only while the task is open.
