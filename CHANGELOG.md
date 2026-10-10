# Changelog

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
