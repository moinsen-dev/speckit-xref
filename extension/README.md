# Spec X-Ref: a Spec Kit extension

Traceability and drift checks for [GitHub Spec Kit](https://github.com/github/spec-kit) features, for every agent Spec Kit supports and for CI. It records which task implements which requirement, books the changed files against the tasks that plan them, finds `@spec` anchors in the code, reads test results, and asks the agent whether the change still matches what the user wanted.

The speckit-xref Claude Code mod (`../mod`) keeps the same ledger live while Claude works, so a map made here shows in the mod's pane and a request the mod logged shows in a check here. Both follow `docs/contract-0.4.md`.

## Install

```bash
specify extension add xref --from https://github.com/moinsen-dev/speckit-xref/releases/download/v0.5.0/speckit-xref-extension-v0.3.0.zip
```

From a checkout: `specify extension add --dev /path/to/speckit-xref/extension`.

Requires Spec Kit 0.12.17 or later and `python3` 3.9+ (standard library only). `git` finds the changed files; `rg` finds anchors faster.

## Commands

| Command | What it does |
| --- | --- |
| `/speckit.xref.map` | Lists requirements, tasks and the coverage ladder, then has the agent map each uncovered FR to the tasks that implement it, and records the map. Optional `after_tasks` hook. |
| `/speckit.xref.check` | Classifies every changed file, checks anchors, coverage and changed requirements, then has the agent judge the change against the user's words and the spec and records the verdict as advice. Optional `after_implement` hook. |
| `/speckit.xref.validate` | Before a new project's first spec: researches the idea (who has the problem, what exists, what differs, the riskiest assumption, kill criteria, a score) into `.specify/memory/idea-brief.md`; you decide Build, Sharpen or Drop. Alternatives count as verified only with a fetched URL. |
| `/speckit.xref.shape` | Settles the first version with you (scope, platforms, language, design, data) into `.specify/memory/product-brief.md`, so the spec treats it as decided. |
| `/speckit.xref.verify` | Runs the tests with JUnit output and records which requirements pass or fail. |
| `/speckit.xref.revise` | Folds a change request into the spec: new requirement ids, `SUPERSEDED by FR-###` and `RETIRED` markers, tasks only appended, a dated entry in `revisions.md`. |
| `/speckit.xref.report` | Writes the traceability report: the ladder per requirement, findings, notes, metrics. |

The command names render the way your agent invokes them, for example `/speckit-xref-check` for Claude Code skills.

## The ledger: what to commit

| File | Holds | Commit it? |
| --- | --- | --- |
| `specs/<feature>/xref.json` | requirement → tasks map, file links, accepted files, requirement fingerprints. Sorted, no timestamps: the same state is the same bytes. | **Yes**, with the spec. |
| `.specify/xref/local/<feature>.json` | touched files, open drift, the user's logged requests, intent verdicts, test results. | No. `.specify/xref/.gitignore` (written for you) keeps `local/` out. |

A 0.1 ledger (one `xref.json` with everything) is read as before and split on the next write; `xref.py migrate` does it at once. Keys another tool wrote into either file are kept.

## Rules

- **Planned:** a task plans a file its description names. A folder it names (`src/auth/`) counts only while the task is open, so a finished setup task does not wave every later file through.
- **Linked:** a file tied to a task, requirement or scenario (`xref.py link`), or one that carries an anchor such as `// @spec 001-login/FR-003` or `// @spec US1-AS2`.
- **Exempt** (never drift, not shown): lockfiles, `node_modules/`, `/dist/`, `/build/`, `/coverage/`, `*.min.js`, `*.map`, generated files.
- **Unclear** (listed, not drift): manifests (`package.json`, `pyproject.toml`, …), `*.config.*`, `tsconfig*.json`, `Dockerfile`, `/.github/workflows/`, `*.md`.
- **`.xrefignore`** at the project root adds your own, one gitignore-style pattern per line: `src/generated/` is exempt, `unclear: *.sql` is unclear. `#` starts a comment.
- **Drift levels:**
  - **yellow:** an unplanned file, an anchor or test pointing at a requirement the spec no longer has (or retired), a requirement whose text changed since it was proven (`re-verify`).
  - **red:** three or more unplanned files.
  - The agent's intent check (score, requests beyond the spec) is shown as advice. It never decides the level of `check`, `report` or `summary`, nor an exit code.

## Coverage ladder

Each functional requirement climbs: **specified** (in spec.md) → **planned** (a task names it or the map lists one) → **implemented** (an owning task is done and non-test code anchors, links or touches it) → **tested** (a test file with real tests, not only `test.todo`, anchors or links it) → **passing** (its tests passed against its current text). When a requirement's text changes, it drops to planned until it is proven again. Success criteria stop at planned. Superseded and retired requirements leave the ladder. A user story without acceptance scenarios is a note.

Acceptance scenarios get ids from their position: the first `1. **Given** …` line under `### User Story 2` is `US2-AS1`.

## Tests

`xref.py verify --junit report.xml` maps each test case to the ids in its name or class name (`FR-002`, `SC-001`, `US1-AS2`) and to the `@spec` anchors in its file (`file` attribute). A requirement fails if any of its tests failed. Without JUnit output, `verify --exit-code <code>` marks the requirements already at tested as passing when the suite exits 0.

## CI

The deterministic part needs no model:

```yaml
- name: Spec drift
  run: |
    python3 .specify/extensions/xref/scripts/python/xref.py check --base origin/main --no-write --fail-on red
    python3 .specify/extensions/xref/scripts/python/xref.py summary --base origin/main --junit junit.xml >> "$GITHUB_STEP_SUMMARY"
```

- `--base` counts the committed diff since the merge base; without it, the working tree.
- `--no-write` leaves both ledger files alone.
- `summary` prints the job summary: requirement → tasks → files with their level, unplanned and unclear files, re-verify, notes. It never reads the user's logged requests. `--junit` (on `summary` and `check`) shows test results without storing them.
- The feature comes from `--feature`, then `SPECIFY_FEATURE_DIRECTORY`, `.specify/feature.json`, `SPECIFY_FEATURE`, the branch (`GITHUB_HEAD_REF` or the current one, `001-login` or `feature/001-login`), with `--base` the one feature the diff touches, else the spec written last. Under `CI` that last guess is an error that names the candidates.

**Exit codes:** 0 ok; 1 the `--fail-on` level was reached (or `verify` saw a failing test); 2 a usage or feature resolution error, the message on stderr.

## Script

`scripts/python/xref.py` exposes `map`, `link`, `check`, `verify`, `record-check`, `report`, `summary`, `migrate`, `dump` and `selftest`. Every subcommand takes `--json`, `--feature <dir>` and `--root <dir>`; run it with `--help` for the rest.

## Develop

```bash
python3 extension/scripts/python/xref.py selftest     # the shared cases, scripts/fixtures/cases.json
python3 -m unittest discover -s extension/tests
node --experimental-strip-types scripts/parity.mjs   # Python readers == the mod's TypeScript readers
```
