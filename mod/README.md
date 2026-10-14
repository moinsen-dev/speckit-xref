# Spec Kit X-Ref for Claude Code

A Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps a [GitHub Spec Kit](https://github.com/github/spec-kit) feature and its code tied together while the agent works: the spec rides every request, every edit is booked against a task, and after each turn a drift check asks whether the change still matches what the user said and what the spec says.

It complements read-only viewers such as SpecKit Companion: they show the run; this one keeps the run on the spec.

## What it does

| | How |
|---|---|
| **Spec in the system prompt** | `prompt.compose` adds one section: active feature, the user's original words, user stories, constitution MUST rules, out of scope, open `NEEDS CLARIFICATION`, and the rules of the game. It changes only when the spec does, so the prompt cache survives. |
| **Current task on every prompt** | `prompt.submit` attaches a note: current task, its planned files, the requirements it serves, the next tasks, the drift status. |
| **Intent log** | Every prompt the person types is logged (`intents` in `xref.json`): their own words, the ground truth of the idea. |
| **Edit booking** | `tool.call` on Edit/Write/NotebookEdit books the file against the current task (paths come from `tasks.md`). A file planned for another task makes that task current. A file planned for none is drift: the model reads a note beside the tool result right away. Files Bash changed during a turn (sed, a generator, npm) are found at its end and booked the same way. Lockfiles and build output never count; manifests and configs are *unclear*, not drift; `.xrefignore` adds your own patterns. |
| **Strict mode** | Optional: refuses an unplanned edit and names the way forward (focus another task, link the file, or extend the spec). If the guard itself fails, it refuses too. |
| **Proof ladder** | Each requirement is *specified*, *planned*, *implemented*, *tested* or *passing*. Tested means a test file with real tests anchors it; passing means the test run proved it for its current text. A changed requirement drops back and asks to be re-verified. |
| **Anchors** | `// @spec 001-feature/FR-003` comments count as coverage; one that names a requirement the spec no longer has is drift. |
| **Intent check** | After a turn that wrote files, one tool-less `$.model.fork` over the session compares the user's words, the spec and the diff. It returns a score, reasons and requests the spec lacks. With no transcript to fork yet, one completion fed by the intent log stands in. |
| **Fix it from the pane** | *To spec* runs `/speckit-clarify` with the request; *As task* appends a `[Drift]` task to `tasks.md`; *Map FR→tasks* lets a small model map requirements to tasks once and keeps the map. |
| **Band and pane** | A line above the prompt (`▲ xref T004 · tasks 3/8 · FR 4/5 · watch (1)`) that stacks with other mods' bands; while the autopilot waits, it shows the whole question with Resume, Stop and Pane. The pane: a phase strip, Goal, Vision, Now, Todo, Status, Proof, Next, a review card at the spec gate, "Away" after an autopilot run, open decisions, Auto, Tests and Drift. Each unplanned file is a card with **Link to** (a task picker) and **Accept this**; **Accept all** asks first. Under 70 columns the pane is compact; `d` shows the rest. |
| **Transcript** | Each booked write carries a chip (`● T006 · FR-003`, `▲ unplanned`), and the autopilot's long prompts fold to one line (`▶ auto 3/25 · implement · …`); ctrl+o shows them whole. |
| **Spec Kit's own commands** | `/speckit-implement`, `-plan`, `-tasks`, `-clarify`, `-analyze` and `-converge` get the current task, its files, coverage and drift appended. A compaction keeps the task in focus, your open requests and the decisions. |

The model gets five tools: `mcp__speckit-xref__status` (CLI, setup, integration, workflow phase, autopilot and the next command), `mcp__speckit-xref__ask` (a question for the person, answered in place where they are there; `blocks` names the stories it holds up), `mcp__speckit-xref__focus` (make a task current), `__where` (which tasks and requirements a file belongs to) and `__link` (tie a file to a task, requirement or scenario). In a repository without Spec Kit they wait behind ToolSearch, and nothing polls.

What the mod keeps per feature lives in two files:
- **`specs/<feature>/xref.json`**, committed: which tasks serve which requirement, which files are linked to what, which unplanned files were accepted, and each requirement's fingerprint. Sorted, without timestamps, so it merges and reviews cleanly.
- **`.specify/xref/local/<feature>.json`**, git-ignored by a `.gitignore` of its own: your logged prompts, the intent verdicts, test results, approvals, decisions, and the autopilot's run log (`<feature>.run.jsonl`). Your words stay on your machine.

A 0.3 `xref.json` is migrated on first load.

## Install

In a terminal (the marketplace is added on the way):

```bash
claude plugin install speckit-xref --marketplace moinsen-dev/speckit-xref
```

## Autopilot

`/xref auto on [steps]` lets the work run: after every turn the mod hands the next Spec Kit step to Claude by itself, so nobody has to answer "next is X, shall I go on?". It follows Spec Kit's whole loop: constitution, specify, clarify, **your review of the spec**, plan, tasks, map, analyze (and the fixes it finds), implement **one phase per step**, converge until the tasks stop changing, verify. One step at a time: started while a turn runs, or while you type, the next step waits until the session is free.

It stops only for what is yours:
- the product idea;
- **the spec gate:** once the spec is written, the pane shows your words beside the requirements, the out-of-scope list and the assumptions Claude added. **Approve spec** (in the pane or the band, `/xref approve`, the dialog, or running `/speckit-plan` yourself) lets it go on; the plugin option `review` sets `spec+plan` or `none`. An approval holds for that text: a changed spec asks again;
- a `[NEEDS CLARIFICATION]` question, or open checklist items;
- a request that contradicts the spec (one that only extends it becomes a revise step);
- destructive or irreversible actions: while it runs, `git push`, `reset --hard`, `rm -rf` and writes to `.env` files are refused and turned into a question. Your **yes** in that dialog allows exactly that action once; `allowPush: on` lets it push a feature branch by itself once the tests are green (never main, never `--force`).
- releasing the app: deploys, store builds and submissions, publishes (`wrangler deploy`, `eas build|submit|update`, `vercel`, `netlify deploy`, `firebase deploy`, `fastlane`, `npm publish`, `npm run deploy`, `gh release create` …, and MCP tools that deploy, publish or submit) are refused the same way. Only **Ship it** opens them: for the release step it approves, and only the commands it approves, as written (another flag, another project, `npx` in front or an MCP deploy tool still waits for you).

Claude asks through `mcp__speckit-xref__ask`. Where you are there, the question opens as a dialog and the run goes on with your answer in the same turn. A question that blocks only some stories waits in the pane's **Decide** row while the rest goes on. When an answer ends on a question anyway, a small model decides whether it is a real decision or just "shall I go on?".

**Tests gate the progress.** After each implement step the mod runs the test command: the `testCommand` option, else the project's `test` script (`npm test`, or pnpm, yarn, bun), else what plan.md's `**Testing**:` line names. A command that is not there counts as "could not run", not as a failure. A failure becomes a repair step, at most three in a row; then it is your call. A passing suite proves every requirement with a real test (with `junitPath`, each one by the tests that name or anchor it; for Vitest and Playwright, whose reports carry the test file as the classname, anchors count too). The run ends only when the suite passes once more.

**Each phase gets its brief.** An implement step does not just say "run /speckit-implement": it hands over the phase's goal, its **Independent Test** and **Checkpoint** from tasks.md, the acceptance scenarios it has to prove (tests named after `US2-AS1`), the quickstart rows and the screens that show them, and the last test run. What a step learns about the environment (a port, a flag, a permission's name) goes into `.specify/memory/runbook.md`, and every later step starts from it.

**Verify sorts what it finds.** Only HIGH and MEDIUM findings (a requirement, a scenario or a point of your words not met, or met only in part) become tasks; LOW ones (polish, wording) are listed, not built. After two verify rounds in a run that each found new work, closing the feature is your call: **Call it done**, or Resume for one more round.

**The mod orchestrates (0.8).** The heavy steps run in subagents with a fresh context: each implement phase, each repair and each user test. The mod decides the step, the model and the brief; the session only relays (it calls the Agent tool, the mod's spawn hook gives the agent its model and brief and runs it in the foreground) and writes no code meanwhile. So the session keeps the spec, your decisions and short reports instead of every phase's work, and the context stays small. The model per step (option `models`, `auto`): Sonnet implements, repairs and tests, Opus takes over a repair that failed once already, Haiku does phases of docs and configuration; the spec, the reviews, verify and ship stay with the session's own model. The run log names the model of each step. Option `orchestrate` (`on`) switches it off. When a feature is done the mod writes `.specify/xref/local/handoff.md`, and `/clear` before the next feature keeps the context small.

**Tests prove requirements.** One test per requirement or acceptance scenario, at the boundary where its behaviour shows; no render-only tests, no tests of what the framework or the types guarantee, no test per task (the phase brief, the implementer and the preset say so).

**The user test.** A feature with a user interface is used as a person would, in the iOS Simulator of the Claude desktop app or in a browser (or a short Playwright script with the installed Chrome where neither is there): each story right after it is built, before the next phase builds on it, and the whole app before it counts as done. It follows the stories and the paths people take by accident (a permission denied, offline, back and forth, empty input), with screenshots in `specs/<feature>/try/` and a log in `try.md`; a HIGH or MEDIUM finding becomes a fix task. Option `userTest` (`on`) switches it off.

**The deputy (0.10).** While the autopilot runs, a deputy on Opus thinks between the steps the way you would. After each step that builds, repairs, tries or restyles the app it reads the agent's whole report, the step's diff, the test run and the requirements behind the checked tasks. It looks for claims without evidence, weakened tests, work outside the tasks, and what was left open, and at the end of a phase it asks whether this is still the right thing to build. Then it sends the step on with a note for the next one, back to the same agent with a concrete list (twice at most), or to you with one question and its recommendation. It answers Claude's questions for you from the spec, the briefs, your own words and your earlier decisions, and shows each one under **For you** in the pane, with **Change**. It never approves a gate, and money, keys, deletions, releases, measurements, checks by hand and real devices stay yours, in code. It learns how you work from your own words into `.specify/xref/local/person.md` (git-ignored). Option `deputy`: `full`, `review` or `off`.

**Polish (0.9).** The first version is built plain on purpose: it has to prove that it works and makes sense. **Polish** in the pane after done (or `/xref polish`, or "make it beautiful") then lifts its look and feel to the level of the best apps on its platform, without changing what it does. A design lead (Opus, the `speckit-xref:designer` agent) uses the app, writes `specs/<feature>/polish.md` (the direction, a plan per screen) and brings `DESIGN.md` along, appends a `## Phase N: Design pass` with a task per screen, and builds the shared parts and two or three sample screens, with before and after shots in `specs/<feature>/polish/`. You approve the direction at the samples (**Approve direction**), or say what to change; then the implementer builds the other screens, every test still green, and the design lead reviews fresh shots of every screen, light and dark (HIGH and MEDIUM findings become a `Design review` phase, three rounds at most), before the user test tries the whole app again. On iOS that means the current design language: content edge to edge under translucent material, large titles, sheets, SF Symbols, Dynamic Type, system colours, haptics and motion, with native controls; Material 3 on Android, the same direction in CSS on the web. With the Expo plugin installed, its `expo-ui`, `expo-native-ui`, `expo-router` and `expo-animation` skills do the native parts. Once the design pass is done, other work clears the wish, so a later change or bug starts no new reviews. Without the desktop app's simulator tool (in a terminal), the tester and the design lead use the iOS Simulator through `xcrun simctl` for shots and links, and Maestro for taps.

**Scripted acceptance, on request.** With option `acceptance: auto`, a feature with a user interface is also played through after verify by a scripted driver: one test per acceptance scenario under `e2e/acceptance/`, Playwright for the web with the installed Google Chrome (nothing is downloaded; a project without Playwright gets a setup task first), Maestro for iOS and Android where it is installed, a development build rather than Expo Go. Only the driver's fresh JUnit report accepts a scenario (`★ accepted` in the pane and the dashboard, with its screenshot); a scenario whose text changes has to be accepted again. A scenario that fails because of the app becomes a fix task, built before the next acceptance run (three rounds, then it is your call). What no driver here can check (a real device, real users, a paid service) is listed in `acceptance.md` as **your part**. Since 0.8 it is off by default: the user test is the check.

**Decided or assumed.** At the spec review the pane puts what you decided (the product brief, your answers) beside what Claude assumed: **Keep** marks an assumption as yours, **Change** asks what should hold instead and hands it to Claude, and the spec changes before you approve it. Why the autopilot waited or stopped is in the run log beside its steps.

**After done comes the next thing.** A feature that passed converge, verify and the tests stays done while its spec, its tasks and the working tree stay as they are: the next start does not verify again, it asks what comes next. Press **New feature**, **Change** or **Bug** in the pane and say it in your own words, or type it, or `/xref next feature|change|bug <words>`:
- a new feature goes to `/speckit-specify` and becomes the next feature;
- a change reaches the spec first (new requirements, appended tasks), then gets built;
- a bug is reproduced with a failing test, fixed and recorded (with Spec Kit's bug extension where it is installed), with a task of its own in the trace.

**Ship.** **Ship** in the pane (or `/xref ship`, or "ship it") releases the done app, in three steps. First a release check with the `speckit-xref:ship` skill, after the tests passed once more: version and store fields, a usage text for every OS permission the code asks for, privacy, accessibility, tracked secrets (paths, never values), the production build run locally. It writes `.specify/memory/release.md`: the checks with their evidence, the exact release commands per platform (a static web host the project is set up for, Expo EAS for iOS and Android, or what the project configured), and your part before and after the release. Nothing goes out in the check, and nothing is downloaded for it. A HIGH or MEDIUM gap becomes a task under `## Phase N: Release readiness`; the autopilot builds, verifies and plays it through, then checks again. The release waits on the tests, the drift, failing acceptance scenarios and your open boxes before the release. Then **Ship it** is yours: the release step runs the commands as written, once each, stops at a login or a prompt, and logs the result under `## Releases`. Every release asks anew. Your Ship holds until the release is handed over, through the readiness rounds and across sessions (a check for the same tree is not repeated); **Not now** puts it aside. While a step still runs, the pane offers nothing to approve. The pane's Ship row and the dashboard's Release section show the checks and what went out.

It also stops on Esc or `/xref-stop` (both end the running turn), on an API error or a refusal, when the drift turns red, after three steps without progress, at the step budget (25 by default) and when the feature is done. After five minutes of waiting it sends a notification. The band shows `auto ▶ 3/25 · 5h 34% · 7d 12% · 23m` while it runs (on a subscription, the usage windows; with an API key, `/cost`'s dollars) and the whole question when it waits; the pane tab reads `Spec X-Ref ⏸`. Back at the keyboard, the pane's **Away** card says what happened.

More, all off by default:
- `/xref auto night`: a night run of up to 100 steps; it writes `.specify/xref/local/briefing.md` when it stops.
- `commitPerTask: on`: a step whose tests pass commits the tasks it checked off, on a feature branch only; nothing you staged is mixed in, and files outside the plan or `.env` files stop it.
- `parallel: on`: a phase's open `[P]` tasks go to `speckit-xref:task-runner` subagents, one per task.
- Headless: `SPECKIT_XREF_AUTOPILOT=on|night|<steps> claude -p "…"` runs the autopilot in a `-p` session; each next step rides the Stop hook.

The pane's **Auto** row switches it:
- off: **Start autopilot** (`p`);
- running: **Stop** (`p`);
- waiting: **Resume** (`r`) and **Stop**. A spent budget restarts on Resume.

Click the buttons, or give the pane the keyboard with `ctrl+x tab` (once more if the band takes it first). `/xref pane` looks at the folder first, opens the pane without taking the keyboard (so the next key never presses a button), and says where things stand.

The autopilot never sets Spec Kit up by itself: `specify init` and `specify integration install` write into the repository, so it waits there for you. To start every session with the autopilot on, set the plugin options `autopilot: on` and `autopilotMaxSteps`. It is off by default, because every step is a model turn.

## A new project starts at the idea

In an empty folder the autopilot does not go straight to a spec:

1. **Validate.** The idea is researched on the web by an agent of the mod's own: who has the problem, what already exists, what makes the idea different, the riskiest assumption, when to stop. The result is `.specify/memory/idea-brief.md`, with a score out of 5 and a recommendation. Alternatives count as verified only with a URL that was fetched. You decide in the pane, the band or a dialog: **Build**, **Sharpen** (say what should change, it is researched again) or **Drop**. The idea's wording goes to the web search Claude uses.
2. **Shape.** Claude asks what the idea leaves open (first-version scope, platforms, language, design direction, data) and writes `.specify/memory/product-brief.md`.
3. Then the constitution and the spec, which treat those decisions as yours.

Options `validate` and `shape` (both `on`) switch the two off; a project that already has a feature skips them.

## A project that starts from a PRD

Wrote a PRD first? Put it in the empty folder as Markdown (`PRD_Show.md`; a file with "PRD" or "product requirements" in its name), or import it from anywhere with `/xref prd <path>`. Instead of Validate:

1. **Import.** The mod copies it to `.specify/memory/prd.md`.
2. **Review and roadmap.** Claude reads it as the one who has to build it: `.specify/memory/prd-review.md` (contradictions, untestable criteria, gaps, the open decisions that block the first feature) and `.specify/memory/roadmap.md` (the features in build order, each with its phase, the PRD's own ids, the PRD sections it implements, and the gate before it). It does not rewrite the PRD or research it again.
3. **Your approval.** The pane shows the roadmap and the open decisions: **Approve roadmap**.
4. Shape asks only the blocking decisions; the PRD's other decisions are yours already. Then the constitution, and the first feature is specified from the roadmap.

Every requirement carries the PRD id it comes from (`(PRD F01)`), stories and scenarios theirs; the pane's PRD row counts the feature's PRD ids its spec carries, and the intent check reads the PRD sections the feature implements. When a feature is done, **Next from roadmap** specifies the next one; a gate before it (a test with real users, a review) is named as your part.

## A feature's look: Design

A feature with a user interface (plan.md's Project Type says mobile, web app, desktop …) gets its look after the plan and before the tasks:

1. **Design.** Claude writes `DESIGN.md` at the root, the design system in [Google Stitch's format](https://github.com/google-labs-code/design.md) (colours, type, spacing, radii as YAML tokens, the reasons in prose), from the product brief's design direction. Where the app already has a look, it writes that down instead of redesigning it; an existing DESIGN.md is kept. Then one static HTML mock per screen in `specs/<feature>/design/`, and `screens.md`, which says which screen serves which user story and FR.
2. **Your look.** The autopilot stops: open the mocks (**Open the mocks** in the pane or the dialog, or `/xref web`), then **Approve design**, or say what to change. A design changed after your approval asks again. Running `/speckit-tasks` yourself approves it too.
3. The tasks then build to it: the tokens go into the app's theme, each screen into the story it serves.

A feature that adds no screen writes "No screen changes" and goes on without a stop. Option `design` (`on`) switches the step off; `review: spec` keeps the step but drops the stop.

## The dashboard

`/xref web` opens `.specify/xref/local/dashboard.html` in the browser; the autopilot rewrites it after every step and the page reloads itself. It shows what the pane has no room for: your words and the constitution, every tasks.md phase with its progress, a traceability matrix (requirement → tasks → files → tests → rung), drift, decisions, the run log, the design (DESIGN.md's colours and fonts, each screen with its mock in place), and spec, plan, tasks and the other Spec Kit documents rendered in place, with every FR and task id linked. It is local and git-ignored: it holds your own words.

## Before Spec Kit is there

`/xref pane` and the status tool tell the folder apart, and the pane offers the one fitting start:

| Folder | Pane offers | What Claude then does |
| --- | --- | --- |
| empty (only dotfiles, a README, a license) | **Start from an idea** | asks what you want to build, sets Spec Kit up, writes the spec in your words |
| existing code, no `.specify/` | **Set up Spec Kit here** | runs `specify init`, drafts the constitution from the code, asks which change comes first |
| Spec Kit without its Claude Code commands | **Add Claude integration** | runs `specify integration install claude` |
| inside a Spec Kit project | the project itself | the mod looks upward for `.specify/`, as Spec Kit does |

Pressing one of these counts as your go. Without a press or your request nothing is written. A repository without Spec Kit stays quiet otherwise, with no band and no unasked pane.

## The `speckit` skill

`/speckit-xref:speckit`, or any request to set up or run Spec Kit, loads a skill that:

- **sets Spec Kit up:** finds the `specify` CLI or runs it through `uvx`, says what `specify init` writes before it runs, then moves on to the constitution;
- **walks the workflow:** constitution → specify → clarify → plan → tasks → map → implement → verify, steered by the status tool rather than by guesswork;
- **handles the day-to-day:** switching features, requests beyond the spec, unplanned edits, strict mode, and the Spec Kit extension with its CI check.

## Use

```text
/xref                  status of the active feature
/xref check            run the intent check now
/xref map              map requirements to tasks with a small model
/xref ack              accept every edit outside the plan
/xref approve          approve what the autopilot waits on (spec, plan, open checklists)
/xref focus T004       make a task current
/xref auto on [n]      autopilot: work through Spec Kit by itself (night: a night run, off: stop)
/xref next feature|change|bug <words>   what comes after a done feature
/xref polish           lift the done app's look to its platform's best (a direction with samples first)
/xref ship             check the done app for release; its commands run after your Ship it
/xref pane             open the pane
/xref web              open the dashboard in the browser
/xref-stop             stop the autopilot now, mid-turn
```

**The pane at start.** By default it opens by itself where it is a sidebar (fullscreen); the band shows a **Pane** button while it is not on screen. With the option `pane: always` it opens with every session in a Spec Kit project. To make that the project's own choice, put it into the project's `.claude/settings.json`:

```json
{ "pluginConfigs": { "speckit-xref@speckit-xref": { "options": { "pane": "always" } } } }
```

The terminal seats a pane nobody asked for from 144 columns (110 once you have opened it); narrower, it waits and the Pane button opens it.

Options (`/config` or `pluginConfigs` in settings): `mode` (`advisory` | `strict`), `driftCheck` (`fork` | `off`), `mapModel` (default `haiku`), `autopilot` (`off` | `on`), `autopilotMaxSteps` (default 25), `review` (`spec+design` | `spec` | `spec+plan` | `spec+plan+design` | `none`), `testCommand`, `junitPath`, `commitPerTask` (`off` | `on`), `parallel` (`off` | `on`), `pane` (`auto` | `always` | `off`), `validate` (`on` | `off`), `shape` (`on` | `off`), `design` (`on` | `off`), `allowPush` (`off` | `on`), `acceptance` (`off` | `auto`), `orchestrate` (`on` | `off`), `models` (`auto` | `sonnet` | `opus` | `haiku`), `userTest` (`on` | `off`), `deputy` (`full` | `review` | `off`).

The active feature is found as Spec Kit finds it, then by the git branch (`001-…`), else the spec written last.

## Develop

```bash
claude --plugin-dir ./mod                 # load this checkout, reloading on save
claude plugin validate --strict ./mod
claude plugin test ./mod
node scripts/build-fixture.mjs            # after changing examples/demo or scripts/fixtures/cases.json
```

`examples/demo` is a small Spec Kit project (magic-link login) to try it on. In the desktop app's Code tab, name the folder in `CLAUDE_CODE_PLUGIN_DIRS` under `env` in `~/.claude/settings.json`.

Tested on Claude Code 2.1.295 and Spec Kit 1.1.2. The mods API is early access and can change between releases.
