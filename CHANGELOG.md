# Changelog

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
