# Spec X-Ref: a Spec Kit extension

Traceability and drift checks for [GitHub Spec Kit](https://github.com/github/spec-kit) features, for every agent Spec Kit supports and for CI. It records which task implements which requirement, books the changed files against the tasks that plan them, finds `@spec` anchors in the code, and asks the agent whether the change still matches what the user wanted.

Everything lands in one file per feature, `specs/<feature>/xref.json`. The speckit-xref Claude Code mod (`../mod`) keeps the same file live while Claude works, so a map made here shows in the mod's pane and a request the mod logged shows in a check here.

## Install

```bash
specify extension add xref --from https://github.com/moinsen-dev/speckit-xref/releases/download/v0.2.0/speckit-xref-extension-v0.1.2.zip
```

From a checkout: `specify extension add --dev /path/to/speckit-xref/extension`.

Requires Spec Kit 0.12.17 or later and `python3` (standard library only). `git` finds the changed files; `rg` finds anchors faster.

## Commands

| Command | What it does |
| --- | --- |
| `/speckit.xref.map` | Lists requirements, tasks and coverage, then has the agent map each uncovered FR to the tasks that implement it, and records the map. Runs as an optional `after_tasks` hook. |
| `/speckit.xref.check` | Classifies every changed file: `planned` by a task, `linked`, `unplanned`. Checks anchors and coverage, then has the agent judge the change against the user's words and the spec and records the verdict. Runs as an optional `after_implement` hook. |
| `/speckit.xref.report` | Writes `<feature>/xref-report.md`: requirement → tasks → files and anchors, then the drift findings. |

The command names render the way your agent invokes them, for example `/speckit-xref-check` for Claude Code skills.

## Rules

- **Planned:** a task plans a file its description names. A folder it names (`src/auth/`) counts only while the task is open, so a finished setup task does not wave every later file through.
- **Linked:** a file tied to a task or requirement (`xref.py link`), or one that carries an anchor such as `// @spec 001-login/FR-003`.
- **Drift levels:**
  - **yellow:** an unplanned file, an anchor to a requirement the spec no longer has, an intent check from 50 to 79, or a request the spec does not cover.
  - **red:** three or more unplanned files, an intent check below 50, or a request the spec rules out.
- **Coverage** counts functional requirements (`FR-###`) that have a task, a linked file or an anchor.

## CI

The deterministic part needs no model:

```yaml
- name: Spec drift
  run: python3 .specify/extensions/xref/scripts/python/xref.py check --base origin/main --fail-on red
```

`--fail-on yellow|red` exits 2 once that level is reached. `report --stdout` prints the matrix for a job summary.

## Script

`scripts/python/xref.py` exposes `map`, `link`, `check`, `record-check`, `report` and `dump`. Run it with `--help` for the options. Every subcommand takes `--json`, `--feature <dir>` and `--root <dir>`. The active feature is read as Spec Kit reads it: `SPECIFY_FEATURE_DIRECTORY`, then `.specify/feature.json`, then `SPECIFY_FEATURE`, else the spec written last.

## Develop

```bash
python3 -m unittest discover -s extension/tests
node --experimental-strip-types scripts/parity.mjs   # Python readers == the mod's TypeScript readers
```
