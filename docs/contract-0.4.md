# speckit-xref 0.4 contract (mod ⇄ extension)

The mod (TypeScript, `mod/hooks/`) and the extension (Python, `extension/scripts/python/xref.py`) implement the same rules. This file defines them; `scripts/fixtures/cases.json` holds the expected outputs that both sides must reproduce (`logic.test.ts` and `xref.py selftest`). When code and this file disagree, this file wins; when this file is wrong, change it and the cases first.

Function names: TypeScript camelCase / Python snake_case of the same name.

## 1. Ledger v2: committed and local

The in-memory ledger keeps the v1 shape (`tasks{touched,linked}`, `requirements{tasks,files,sources}`, `unplanned[]`, `intents[]`, `anchors[]`, `semantic`) plus new fields `fingerprints{}`, `verification{}`, `approvals{}`, `decisions[]`, `semanticHistory[]`. Only persistence changes.

**Committed — `specs/<feature>/xref.json`** (reviewable, merge-friendly):
```json
{
  "schema_version": 2,
  "feature": "specs/001-magic-link-login",
  "map": { "FR-002": ["T004", "T007"] },
  "links": { "src/ui/theme.ts": ["FR-004", "T006"] },
  "accepted": ["src/x.ts"],
  "fingerprints": { "FR-002": "<sha256 hex>" }
}
```
- `map`: requirement → tasks (from `map --apply`, `link --req --task`, the mod's map). Only non-empty entries.
- `links`: file → ids it was tied to (`link --file --id`, the `link` tool): `FR-###`, `SC-###`, `T###`, `USn-ASm`.
- `accepted`: unplanned files the person accepted (`ack`, "Accept this").
- `fingerprints`: §6 hash of a requirement's text when it was last mapped, linked or verified.
- Serialisation: keys sorted at every level, every array sorted and de-duplicated, 2-space indent, `\n` at the end, **no timestamps, no summary**. Writing the same state twice yields identical bytes.

**Local — `.specify/xref/local/<feature-slug>.json`** (`<feature-slug>` = basename of the feature dir), with `.specify/xref/.gitignore` containing `local/`. Writers create both; the user's own `.gitignore` is never touched.
```json
{
  "schema_version": 2,
  "feature": "specs/001-magic-link-login",
  "touched": { "T004": ["src/auth/token.ts"] },
  "unplanned": [{ "file": "src/ui/theme.ts", "at": "<iso>", "task": "T004" }],
  "intents": [{ "at": "<iso>", "text": "…", "task": "T004", "status": "logged" }],
  "semantic": null,
  "semanticHistory": [],
  "verification": { "FR-002": { "status": "passing", "tests": ["…"], "at": "<iso>", "commit": "abc1234", "fingerprint": "<sha256>" } },
  "approvals": { "spec": "<spec fingerprint>" },
  "decisions": [{ "id": "D1", "question": "…", "options": [], "blocks": ["US2"], "at": "<iso>", "answer": null }],
  "anchors": []
}
```
`semanticHistory` keeps the last 10 verdicts; each verdict carries `at`, `head` (git HEAD, may be empty) and `diffHash`.

**Load (both sides):** read committed and local, merge into the in-memory ledger:
- `requirements[FR].tasks` ← `map[FR]`; `requirements[FR].files` ← files whose `links` contain FR (also SC, scenario ids); `tasks[T].linked` ← files whose `links` contain T.
- `unplanned` ← local `unplanned` (acknowledged false) + `accepted` (acknowledged true, `at` ""), `tasks[T].touched` ← local `touched`.

**Migration from v1** (`schema_version` 1 or absent, a single `specs/<feature>/xref.json`), done in memory on load; the next write produces v2:
- `map[FR]` ← `requirements[FR].tasks` (non-empty); `links[file]` += FR for every `requirements[FR].files`; `links[file]` += T for every `tasks[T].linked`.
- `accepted` ← files of `unplanned` with `acknowledged: true`; local `unplanned` ← the others (without `acknowledged`).
- local `touched` ← `tasks[T].touched` (non-empty); `intents`, `semantic`, `anchors` move to local; `fingerprints` start empty.

## 2. Path rules: exempt, unclear, tests

**Glob grammar** (`globToRegExp`): a small subset of gitignore, applied in this order:
1. Trim; strip a leading `./`.
2. A trailing `/` means a folder: remember it and strip the `/`.
3. A leading `/` anchors at the project root: strip it. Otherwise, when what is left contains no `/`, the pattern matches at any depth: prefix `**/`. (So `node_modules/` matches at any depth, `/dist/` and `src/generated/` only at the root.)
4. A folder pattern gets `/**` appended.
5. Convert left to right: `**/` → `(?:.*/)?`; `/**` at the very end → `(?:/.*)?`; any other `**` → `.*`; `*` → `[^/]*`; `?` → `[^/]`; every other character literally (escaped). Match the whole path (`^…$`). Paths are project-relative with `/`.

**`.xrefignore`** at the project root (`parseIgnore`): one pattern per line, trimmed; blank lines and lines starting with `#` are skipped; `unclear:` followed by a pattern (spaces after the colon are trimmed) adds an unclear pattern, any other line an exempt pattern. No negation.

**Rules** (`rulesFrom(ignoreText | null)`): `{exempt: DEFAULT_EXEMPT + file exempt, unclear: DEFAULT_UNCLEAR + file unclear}`. A case with `"rules": null` uses the defaults alone.

**Default exempt** (never drift, not shown): `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `Gemfile.lock`, `go.sum`, `composer.lock`, `Podfile.lock`, `pubspec.lock`, `node_modules/`, `/dist/`, `/build/`, `/coverage/`, `/.next/`, `/out/`, `/target/`, `__snapshots__/`, `*.min.js`, `*.map`, `*.generated.*`, `*.g.dart`.

**Default unclear** (not drift, listed as "unclear"): `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pubspec.yaml`, `Gemfile`, `requirements*.txt`, `*.config.*`, `tsconfig*.json`, `.eslintrc*`, `.prettierrc*`, `Dockerfile`, `docker-compose*.yml`, `/.github/workflows/`, `.env.example`, `*.md`, and (0.4.1) tooling dotfiles and media: `.*ignore`, `.editorconfig`, `.nvmrc`, `.node-version`, `.tool-versions`, `/assets/`, `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.svg`, `*.ico`, `*.icns`, `*.ttf`, `*.otf`, `*.woff`, `*.woff2`, `*.mp3`, `*.wav`, `*.mp4`, `*.lottie`.

**Test files** (`isTestFile`): `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`, `*_test.go`, `*_test.dart`, `/tests/`, `/test/`, `__tests__/`.

**Real tests** (`hasRealTests(text)`): at least one match of
`\b(?:it|test|describe)\s*\(|\bdef test_|\bfunc Test[A-Z_]|\btestWidgets\s*\(` — `test.todo(`, `it.skip(`, `xit(` do not match.

## 3. Classification (`classifyCore`)

Input: project-relative path, snapshot (tasks with `id`, `done`, `paths`, `reqs`), ledger, rules (exempt/unclear), optional new file content. First match wins:

| # | Verdict | When | Task |
|---|---|---|---|
| 1 | `spec` | `isSpecArtifact`: under `specs/`, `.specify/`, `.claude/`, `.github/` except `.github/workflows/`, or `CLAUDE.md` / `AGENTS.md` | null |
| 2 | `exempt` | matches an exempt pattern | null |
| 3 | `task-linked` | `links[path]` contains a task id | that task |
| 4 | `planned` | a task plans it (`plans`: a file path it names always; a folder only while the task is open) | first open match, else first match |
| 5 | `linked` | new content holds an `@spec` anchor (any feature), or `links[path]` holds a requirement/scenario id, or an anchor in the ledger sits in this file | null |
| 6 | `unclear` | matches an unclear pattern | null |
| 7 | `untracked` | the snapshot has no tasks | null |
| 8 | `unplanned` | otherwise | null |

The live mod maps `planned` to `in-scope` (task is the focused task, or nothing is focused) or `other-task`, and `task-linked` to `linked` with the task; `unplanned` carries the focused task. Batch (`xref.py check`) reports the core verdict.

## 4. Coverage ladder (`levelOf`)

Per functional requirement; each level requires the one before:

1. `specified` — the requirement is in spec.md.
2. `planned` — a task names it (`task.reqs`) or `map` lists tasks for it.
3. `implemented` — an owning task (naming it or mapped) is done **and** non-test code shows it: a non-test anchor for it, a non-test file linked to it, or a non-test file touched by an owning task.
4. `tested` — a test file with real tests carries an anchor for it, or a test file with real tests is linked to it.
5. `passing` — `verification[FR].status` is `passing` and its `fingerprint` equals the requirement's current fingerprint.

Signature: `levelOf(id, snap, ledger)`. The snapshot carries `featureDir`, `tasks`, `reqs` (parsed text) and `realTests`: the test files, among those anchored, linked or touched, whose content passes `hasRealTests` (the IO side reads them). Anchor ids compare through `localId` (`001-x/FR-002` counts for feature `specs/001-x` only). The current fingerprint of a requirement is `fingerprint(req.text)` of the parsed (clipped, unbolded) text. In `cases.json` the ledger of each `levelOf`/`evaluate` case is given as v2 parts (`map`, `links`, `fingerprints`, `accepted` committed; `touched`, `unplanned`, `verification`, `anchors` local) and is built with the load/merge function of §1.

**Retired requirements** (§11) are not on the ladder and not in `total`.

**Stale:** when `fingerprints[FR]` exists and differs from the current fingerprint, the level is capped at `planned` and a `re-verify` finding is raised. Success criteria are reported as `specified`/`planned` only. `Report.covered` stays "FRs at planned or above" for compatibility; reports add a count per level.

## 5. Acceptance scenarios

**Input** (`inputOf`, 0.4.1): the text after `**Input**:` (and an optional `User description:`); when it opens a quote it does not close on that line, the following lines (each right-trimmed, joined with `\n`) belong to it up to the first line ending in `"`, or up to a heading. A leading quote and its closing quote are dropped; the result is trimmed and clipped to 2000.

**Task paths** (`extractPaths`, 0.4.1): when a task names any path in backticks, those are its paths; bare words in its prose count only in a task without backticked paths.

A story section starts at its `### User Story N …` heading and ends at the next heading of level 1–3 (`^#{1,3}\s`). Inside it, a line matching `^\s*(\d+)\.\s+(\*\*Given\*\*.*)$` is scenario `USN-AS<number>` (the list number as written, without leading zeros). Its text is group 2 with bold and backticks removed, trimmed, clipped like requirement text (300). `parseSpec` returns `stories[{id, title, priority, scenarios: [{id, text}]}]` and `reqs[{id, kind, text, needsClarification, status, supersededBy}]` (§11). Snapshots in `cases.json` may give reqs without `kind`/`status`: treat them as `FR` and take the status from `reqStatus(text)`. Anchors and links may name scenarios: the anchor regex is
`@spec\s+((?:[\w.-]+/)?(?:(?:FR|SC)-\d{3,}|T-?\d{3,}|US\d+-AS\d+))`.

## 6. Fingerprints

`normalizeText`: Unicode NFKC, lower-case, collapse whitespace to one space, trim, drop trailing `.;:!`, trim. `fingerprint(text)` = lower-case hex SHA-256 of the UTF-8 of the normalised text (TypeScript: a pure synchronous SHA-256 in `mod/hooks/rules.ts`, since the mod's sandbox has no WebCrypto guarantee; Python: `hashlib`). The **spec fingerprint** (for the spec gate) is the fingerprint of the `Input` line, then every requirement text in spec order, then every scenario text in story order, joined with `\n` (a missing input is the empty string).

## 7. Feature resolution

Order: `--feature` (extension) → `SPECIFY_FEATURE_DIRECTORY` → `.specify/feature.json` → `SPECIFY_FEATURE` → the git branch (`GITHUB_HEAD_REF`, else `git rev-parse --abbrev-ref HEAD`) → (extension with `--base`) the single feature whose `specs/` folder or planned files the diff touches → the spec written last. Under `CI` set to any non-empty value, the last fallback takes a lone feature as it is, and with two or more candidates it is an error naming them instead (the mtime of a fresh checkout says nothing).

`featureFromBranch(branch, dirs)`: take the number from `(?:^|/)(\d{3,})-` in the branch; return the one feature dir whose basename starts with that number and `-`; none or several → null.

## 8. Drift level and exit codes

`evaluate(snap, ledger, { semantic })`:
- Deterministic findings, in this order: each open unplanned file (one the snapshot's rules now mark exempt or unclear no longer counts: rules apply to what was booked before they changed) → `unplanned` yellow, then with three or more one more `unplanned` red; each anchor of this feature to an id that the spec, the tasks and the scenarios lack, or to a retired/superseded requirement → `orphan-test` yellow when the file `isTestFile`, else `dangling` yellow; each requirement whose stored fingerprint differs → `re-verify` yellow.
- `Report` adds `levels` (count per ladder level over active FRs) and `notes` (spec gaps that do not raise the level: a user story without acceptance scenarios: `US2 has no acceptance scenarios`).
- With `semantic: true` (the live mod), the LLM verdict and intent changes count as before. **The extension's `--fail-on` always evaluates with `semantic: false`**; reports may show the LLM verdict as advice.

## 9. Test results (JUnit)

`parseJunit(xml)`: every `<testcase>` with `name`, `classname`, `file` (attributes may be absent) and a status: `failed` when it has a `<failure` or `<error` child, `skipped` with a `<skipped` child, else `passed`. Attribute values unescape `&amp; &lt; &gt; &quot; &apos;`.

`verificationFrom(cases, anchors, fingerprints, featureDir, at, commit)`: a test maps to every id found in its `name` or `classname` (`FR-###`, `SC-###`, `USn-ASm`) and to every anchor id (through `localId`, so other features' anchors drop out) in its `file`. Per id: `failing` if any mapped test failed, else `passing` if at least one passed; skipped-only maps to nothing. Each entry records the test names (`classname.name`, else `name`) sorted by code point and cut to the first 10, `at`, `commit`, and `fingerprints[id]` (else `""`).

`verificationFromExit(exitCode, ids, fingerprints, at, commit)`: without JUnit, a test command that exits 0 proves every id in `ids` (the FRs at `tested`) `passing` with `tests: ["<suite>"]`; any other exit code records nothing (the run is a failure of the suite, not of a known requirement).

## 10. Implement scope (mod)

The autopilot runs `/speckit-implement` for one phase at a time: the first `##` phase in tasks.md with an open task. The prompt names the phase heading and tells Claude to stop after it.

## 11. Revisions (`speckit.xref.revise`)

A requirement line whose text (unbolded, before clipping) contains `SUPERSEDED by FR-###` is `status: "superseded"` with `supersededBy`; one containing `RETIRED` is `status: "retired"`; otherwise `"active"` (`reqStatus(text)`, both sides, also in `parseSpec`'s `reqs[]`). IDs are never reused: a new requirement takes the next free number. Every revision appends a dated entry to `specs/<feature>/revisions.md`: `## <YYYY-MM-DD> <summary>` followed by bullets `- FR-006 added: …`, `- FR-002 superseded by FR-006`, `- FR-004 retired: …`, `- T012 appended`.

## 12. Extension CLI (0.2.0)

`python3 xref.py <command>`; every command takes `--root` (default `.`) and `--feature`. Exit codes: 0 ok, 1 the `--fail-on` threshold was reached, 2 usage or feature resolution error (message on stderr).
- `check [--base REF] [--fail-on none|yellow|red] [--no-write] [--json] [--junit FILE…]`: classifies the changed files (with `--base`: the committed diff `REF...HEAD` only, no untracked files; without: the working tree against HEAD plus untracked files), evaluates with `semantic: false`, prints the findings; `--no-write` leaves both ledger files alone (the Action always passes it).
- `verify --junit FILE [--junit FILE…] [--no-write]`: `parseJunit` + `verificationFrom`, stores `verification` in the local ledger, records the requirements' fingerprints in the committed one, prints passing/failing per id; exit 1 when a mapped test failed.
- `report [--format md|json] [--out FILE]`: coverage ladder per FR, findings, notes, metrics (§13); the LLM verdict appears only as advice.
- `summary [--base REF] [--junit FILE…]`: the PR job summary (JUnit results are turned into verification in memory, never written, so `passing` shows in CI) in Markdown on stdout (requirement → tasks → files with ladder level, unplanned and unclear files of the diff, re-verify, notes). Never reads the local ledger's intents.
- `map --apply`, `link`, `record-check`, `dump [--spec|--tasks|--constitution FILE]` as before; `dump --spec` includes scenarios and statuses.
- `migrate`: rewrites a v1 ledger as v2 (idempotent).
- `selftest [--cases FILE]`: runs every section of `cases.json` (default `../../../scripts/fixtures/cases.json` from the script), prints `ok`/`FAIL` per case, exit 1 on any failure.

## 13. Metrics (report, no telemetry)

From the ledger alone: unplanned edits caught (open + accepted + linked later), how they ended (`accepted` count, linked count, open count), the blind-accept share (accepted ÷ caught), and, in the local report only, intents beyond the spec (`extends` + `contradicts`) and the share that reached the spec (`resolved`).
