# speckit-xref preset

A [Spec Kit](https://github.com/github/spec-kit) preset that makes the cross-references certain at the source. Without it, speckit-xref guesses which files a task touches and which requirement it serves. With it, every task says so, and the code and tests say which requirement they serve.

It works on its own, with the speckit-xref Spec Kit extension, and with the speckit-xref Claude Code mod.

## What it changes

Four overrides. Each one is a copy of the Spec Kit 1.1.2 original with a few lines edited, so `diff` against the original shows the whole change.

| Override | Change |
| --- | --- |
| `speckit.tasks` command | Every task names its files in backticks and ends with the requirements it serves: ``- [ ] T005 [US1] Implement token service in `src/auth/token.ts` (FR-002)``. A test task also names the acceptance scenarios it proves: `(FR-002, US1-AS1)`. The completion report lists requirements no task names. |
| `tasks-template` | The sample tasks follow that format. |
| `speckit.implement` command | Make a task current with the `mcp__speckit-xref__focus` tool when it exists. Mark code with `@spec <feature>/FR-###` comments. Give each test the anchor of what it proves, and put the id in the test name. Check a task off only when its tests pass. A TDD test-writing task is done when its tests exist and fail. When the prompt names one phase, stop after that phase. |
| `plan-template` | The `**Testing**:` line asks for the framework and the command that runs the tests, in backticks: ``**Testing**: Vitest `npx vitest run` ``. The mod reads the test command from it. |

The spec template stays Spec Kit's own. Its numbered `1. **Given** … **When** … **Then** …` acceptance scenarios already give each scenario an id: scenario 2 of user story 1 is `US1-AS2`.

The ids follow Spec Kit's own: `FR-###` and `SC-###` from spec.md, `T###` from tasks.md. `<feature>` is the feature folder's name, e.g. `001-magic-link-login`.

## Install

You need Spec Kit 1.1.2 or later (below 2.0). Run the commands in your Spec Kit project.

From a clone of this repository:

```bash
git clone --depth 1 --branch v0.4.0 https://github.com/moinsen-dev/speckit-xref /tmp/speckit-xref
specify preset add --dev /tmp/speckit-xref/preset
```

`--dev` copies the folder into `.specify/presets/xref/`, so you can delete the clone afterwards.

From a release, once a preset archive is published:

```bash
specify preset add --from https://github.com/moinsen-dev/speckit-xref/releases/download/v0.4.0/speckit-xref-preset-v0.1.0.zip
```

Without the CLI installed, prefix each command with `uvx --from 'specify-cli>=1.1.2,<2'`.

Spec Kit rewrites `.claude/skills/speckit-tasks/` and `.claude/skills/speckit-implement/` (or the command files of your agent) at once. Templates resolve when a command runs. To check:

```bash
specify preset list
specify preset resolve tasks-template    # .specify/presets/xref/templates/tasks-template.md
```

Another preset that also replaces `speckit.tasks` or `speckit.implement` (such as `lean`) competes with this one. The lower `--priority` number wins.

## Remove

```bash
specify preset remove xref
```

Spec Kit restores its own commands, skills and templates. Files the commands already wrote (`tasks.md`, your code) stay as they are.

## Upgrading Spec Kit

The overrides are copies of 1.1.2. After a Spec Kit upgrade, compare them with the new originals in the `specify-cli` package (`core_pack/commands/tasks.md`, `implement.md`, `core_pack/templates/tasks-template.md`, `plan-template.md`) and carry the edits over.
