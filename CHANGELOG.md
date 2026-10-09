# Changelog

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
