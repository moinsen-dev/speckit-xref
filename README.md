# speckit-xref

**Keep the code on the spec.** speckit-xref ties a [GitHub Spec Kit](https://github.com/github/spec-kit) feature and its code together and measures the drift between what the user asked for, what the spec says, and what the code does.

It comes in four parts that share one contract ([`docs/contract-0.4.md`](docs/contract-0.4.md)) and one record per feature:

| | What | For |
| --- | --- | --- |
| [**Claude Code mod**](mod/) | Live, inside the agent loop: the spec in the system prompt, the current task and the next Spec Kit step on every prompt, every edit booked against a task (Bash writes included), unplanned edits flagged to the model at once, an intent check after each turn, a band and a pane. An autopilot runs the workflow by itself, gated by your review of the spec and by the tests, and stops only for decisions that are yours. | Claude Code (terminal and desktop, and `claude -p`) |
| [**Spec Kit extension**](extension/) | Batch: `/speckit.xref.map`, `check`, `verify`, `report`, `revise`, hooks after `tasks` and `implement`, and a deterministic CI check. | Every agent Spec Kit supports, and CI |
| [**Spec Kit preset**](preset/) | Spec Kit's own `tasks` and `implement` commands, told to name every task's files and requirements and to prove each task with tests. | Spec Kit 1.1.2+ |
| [**GitHub Action**](action/) | The CI check on every pull request, with a job summary: requirement → tasks → files and how far each is proven. | GitHub Actions |

```
           specs/NNN-feature/spec.md · tasks.md · .specify/memory/constitution.md   (Spec Kit, untouched)
                                         │
       specs/NNN-feature/xref.json  (committed: requirement ↔ task ↔ file, accepted files, fingerprints)
       .specify/xref/local/NNN-feature.json  (git-ignored: your prompts, intent verdicts, test results, the run)
                         ▲                                   ▲
     Claude Code mod (live, per turn)       Spec Kit extension · GitHub Action (per command, per pull request)
```

## Why

Spec Kit gives the agent a spec, but nothing keeps the agent on it while it works. Requests the user adds halfway through ("also allow passwords") never flow back into `spec.md`. Files appear that no task planned, and `tasks.md` names the user story of each task but not the requirement it serves. Existing drift tools run afterwards, once the code has settled. speckit-xref works while the code is written, and keeps the record for CI afterwards.

## Install

**Claude Code mod**, at the prompt of a terminal session (Claude Code 2.1.287 or later):

```text
/plugin install speckit-xref --marketplace moinsen-dev/speckit-xref
```

**Spec Kit extension**, in a Spec Kit project (Spec Kit 0.12.17 or later):

```bash
specify extension add xref --from https://github.com/moinsen-dev/speckit-xref/releases/download/v0.4.0/speckit-xref-extension-v0.2.0.zip
```

**Spec Kit preset** (Spec Kit 1.1.2 or later), optional but recommended: tasks then name their files and requirements, so nothing has to be guessed.

```bash
specify preset add --from https://github.com/moinsen-dev/speckit-xref/releases/download/v0.4.0/speckit-xref-preset-v0.1.0.zip
```

**GitHub Action**, in a workflow on `pull_request` (see [`action/`](action/)):

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: moinsen-dev/speckit-xref/action@v0.4.0
```

## Try it

[`examples/demo`](examples/demo) is a small Spec Kit feature, a magic-link login with eight tasks, one `@spec` anchor, one requirement still waiting on clarification and passwords out of scope:

```bash
cd examples/demo && claude --plugin-dir ../../mod
```

Or, in a repository without Spec Kit, say *"set up Spec Kit here"*: the `speckit` skill takes it from there.

In the demo, ask Claude for a password fallback. The spec in its prompt names passwords out of scope, so it should push back and offer `/speckit-clarify`. If you insist, the intent check after the turn turns the band red.

## How drift is measured

Red has to mean something, and "done" has to be proven.

- **Unplanned edits:** a changed file that no task plans, links or anchors. A folder a task names counts only while the task is open. Lockfiles, build output and generated code never count; manifests, configs and Markdown are listed as *unclear*, not as drift. `.xrefignore` adds your own (`unclear: <pattern>` for the second kind).
- **Dangling anchors:** `// @spec 001-login/FR-009` where the spec has no FR-009, or where FR-009 was retired or superseded. In a test file it is an *orphan test*.
- **Re-verify:** a requirement whose text changed since it was mapped, linked or proven.
- **Intent:** a model compares your own words (logged prompt by prompt, kept on your machine), the spec and the diff. It advises the mod live; it never fails a CI build.

The levels: **● ok**, **▲ watch** (one unplanned edit, a dangling anchor, a requirement to re-verify, a request beyond the spec), **✖ off-spec** (three unplanned edits, an intent score below 50, a request the spec rules out).

Each requirement climbs a **proof ladder**: *specified* → *planned* (a task names it) → *implemented* (its task is done and non-test code shows it) → *tested* (a test with real tests in it anchors it; `test.todo` does not count) → *passing* (the test run proved it, for the text it has now). Acceptance scenarios get ids too (`US1-AS2`), and tests and anchors may name them.

## Develop

```bash
claude plugin test ./mod                               # mod tests, contract cases included
claude plugin validate --strict ./mod
python3 -m unittest discover -s extension/tests        # extension tests
python3 -I extension/scripts/python/xref.py selftest   # the contract cases, Python side
node --experimental-strip-types scripts/parity.mjs     # Python readers == TypeScript readers
node scripts/build-fixture.mjs                         # after editing examples/demo or scripts/fixtures/cases.json
scripts/package-extension.sh                           # dist/: extension and preset archives
```

A change to a shared rule starts in [`docs/contract-0.4.md`](docs/contract-0.4.md) and `scripts/fixtures/cases.json`; both implementations must then pass the cases.

When you release, bump the version in all five places: `mod/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (top level and the plugin entry), `extension/extension.yml` and `preset/preset.yml`.

Design notes, in German: [`docs/research.de.md`](docs/research.de.md).

Tested on Claude Code 2.1.294 and Spec Kit 1.1.2. The Claude Code mods API is early access and can change between releases.

## License

MIT
