# speckit-xref

**Keep the code on the spec.** speckit-xref ties a [GitHub Spec Kit](https://github.com/github/spec-kit) feature and its code together and measures the drift between what the user asked for, what the spec says, and what the code does.

It comes in two parts that share one file per feature, `specs/<feature>/xref.json`:

| | What | For |
| --- | --- | --- |
| [**Claude Code mod**](mod/) | Live, inside the agent loop: the spec in the system prompt, the current task on every prompt, every edit booked against a task, unplanned edits flagged to the model at once, an intent check after each turn, a band and a pane. | Claude Code (terminal and desktop) |
| [**Spec Kit extension**](extension/) | Batch: `/speckit.xref.map`, `/speckit.xref.check`, `/speckit.xref.report`, hooks after `tasks` and `implement`, and a CI check that fails the build on drift. | Every agent Spec Kit supports, and CI |

```
           specs/NNN-feature/spec.md · tasks.md · .specify/memory/constitution.md   (Spec Kit, untouched)
                                         │
                       specs/NNN-feature/xref.json   ← requirement ↔ task ↔ file, intents, drift
                         ▲                                   ▲
     Claude Code mod (live, per turn)            Spec Kit extension (per command, per CI run)
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
specify extension add xref --from https://github.com/moinsen-dev/speckit-xref/releases/download/v0.1.1/speckit-xref-extension-v0.1.1.zip
```

## Try it

[`examples/demo`](examples/demo) is a small Spec Kit feature, a magic-link login with eight tasks, one `@spec` anchor, one requirement still waiting on clarification and passwords out of scope:

```bash
cd examples/demo && claude --plugin-dir ../../mod
```

Then ask Claude for a password fallback. The spec in its prompt names passwords out of scope, so it should push back and offer `/speckit-clarify`. If you insist, the intent check after the turn turns the band red.

## How drift is measured

- **Unplanned edits:** a changed file that no task plans, links or anchors. A folder a task names counts only while the task is open.
- **Dangling anchors:** `// @spec 001-login/FR-009` where the spec has no FR-009.
- **Coverage:** functional requirements that have a task, a linked file or an anchor.
- **Intent:** a model compares the user's own words (logged prompt by prompt), the spec and the diff, and records a score and any request the spec lacks or rules out.

The levels:
- **yellow:** an unplanned edit, a dangling anchor, an intent score below 80, or a request beyond the spec.
- **red:** three unplanned edits, an intent score below 50, or a request the spec rules out.

## Develop

```bash
claude plugin test ./mod                               # 31 mod tests
claude plugin validate --strict ./mod
python3 -m unittest discover -s extension/tests        # extension tests
node --experimental-strip-types scripts/parity.mjs     # Python readers == TypeScript readers
node scripts/build-fixture.mjs                         # after editing examples/demo
scripts/package-extension.sh                           # dist/speckit-xref-extension-v<version>.zip
```

When you release, bump the version in all four places: `mod/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (top level and the plugin entry) and `extension/extension.yml`.

Design notes, in German: [`docs/research.de.md`](docs/research.de.md).

Tested on Claude Code 2.1.294 and Spec Kit 1.1.2. The Claude Code mods API is early access and can change between releases.

## License

MIT
