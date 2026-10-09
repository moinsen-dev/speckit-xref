---
name: speckit
description: Set up and run GitHub Spec Kit in this repository with speckit-xref, step by step or on autopilot. Covers checking whether Spec Kit and its CLI are there, initialising Spec Kit for Claude Code, writing the constitution, starting or switching a feature, naming the next Spec Kit step, resolving drift between the user's intent, the spec and the code, choosing how strictly edits are held to the spec, and adding the speckit-xref Spec Kit extension and its CI drift check. Use when the user wants spec-driven development here, asks what comes next in a Spec Kit project, or asks how to handle Spec Kit.
---

# Spec Kit with speckit-xref

The speckit-xref mod is loaded in this session. It reads Spec Kit's files, puts the active spec into your system prompt, attaches the current task to every prompt, books every edit against a task, and checks for drift after each turn. This skill gets a repository there and keeps the work on the spec.

**Start with `mcp__speckit-xref__status`.** It reports:
- whether the `specify` CLI is installed, or can run through `uvx`;
- whether Spec Kit is set up, which release, whether its Claude Code integration is there, and how its commands are invoked;
- whether the autopilot is on, and what it waits for;
- the constitution, the active feature and its artifacts;
- coverage, drift, the current phase and the next command.

Act on that report rather than on assumptions. Call it again after every step. If the tool is not available, read `.specify/` and `specs/` yourself, or ask the user to run `/xref`.

Spell commands the way the status report does: `/speckit-plan` in the skills layout Claude Code gets by default, `/speckit.plan` in a commands layout.

## Autopilot: maximum autonomy

The person can let the work run: `/xref auto on [steps]` (or the plugin option `autopilot: on`). From then on the mod hands the next Spec Kit step to you after every turn: setup, constitution, specify, plan, tasks, map, implement, verify. While it runs:

- **Never ask whether to continue**, never end with "Next is X, shall I?": end your turn and the autopilot moves on.
- **Decide what the person left open** from the spec, the constitution and the repository, and record those choices as assumptions in the artifact you write (spec, plan, constitution).
- **Stop only for what is theirs:**
  - the product idea;
  - a `[NEEDS CLARIFICATION]` question;
  - a conflict between their request and the spec;
  - anything destructive or irreversible;
  - credentials or payments.

  Then call `mcp__speckit-xref__ask` with the question, put the question in your answer, and end your turn. The autopilot waits for their answer and goes on after it.

The autopilot also stops when:
- a turn is interrupted (Esc);
- three steps pass without progress;
- the step budget (25 by default) is used up;
- every task is checked and verified;
- the intent check finds a request that contradicts the spec.

`/xref auto` shows its state, and `/xref auto off` ends it.

## Phase `setup`: Spec Kit is not set up yet

1. **Find the CLI.** The status report says whether `specify` is installed or `uvx` can run it (`uvx --from 'specify-cli>=1.1,<2' specify …`, nothing installed). If neither is there, the person has to install uv (<https://docs.astral.sh/uv/>) or run `pipx install specify-cli`: tell them, then stop.
2. **Say what it writes, and get the user's go.**
   - It writes `.specify/` (scripts, templates, `memory/constitution.md`, `integration.json`) and `.claude/skills/speckit-*/` (Spec Kit's commands as skills).
   - It touches no source file, `CLAUDE.md` or `.claude/settings.json`, and it keeps an existing constitution.
   - In a git repository, suggest committing first so the change can be reviewed.
3. **Run** `specify init --here --force --non-interactive --integration claude`. `--force` only skips the "directory is not empty" question.
4. If `/speckit-constitution` is not offered afterwards, the new skills load with the next session: ask the user to restart Claude Code in this folder and continue there.

Spec Kit set up for another agent only (phase `integration`): `specify integration install claude` adds the Claude Code skills next to it.

## The workflow, phase by phase

| Phase | Command | What matters here |
| --- | --- | --- |
| `constitution` | `/speckit-constitution` | 3 to 7 principles, each a short, checkable MUST rule (tests, dependencies, privacy, …). Ask the person, or on autopilot draft them from the repository and mark them as assumptions. The mod puts every MUST rule into every prompt, so few and sharp beats many. |
| `specify` | `/speckit-specify <the user's idea>` | Pass the user's words **verbatim**. They become the spec's `Input` line, which every drift check compares the code against. Do not polish them. |
| `clarify` | `/speckit-clarify` | Settles `[NEEDS CLARIFICATION]` markers before planning. |
| `plan` | `/speckit-plan <technical choices>` | Stack, storage and structure, as the user decides them. |
| `tasks` | `/speckit-tasks` | Each task should name the files it touches (`… in src/auth/token.ts`). The mod books edits by those paths, and a task without paths cannot be checked. |
| `map` | `/speckit-xref-map` or `/xref map` | Records which task serves which requirement, once. Spec Kit does not keep this. |
| `implement` | `/speckit-implement` | Call `mcp__speckit-xref__focus` before you start a task. Mark code that implements a requirement with `@spec <feature>/FR-###` at file or function level. Tick a task in `tasks.md` only once its requirements are met. |
| `verify` | `/speckit-xref-check` or `/xref check`, then `/speckit-converge` | Checks the code against the user's words and the spec, then turns what is missing into new tasks. |

## Handling

- **Switch features.** Spec Kit tracks the active feature in `.specify/feature.json`. Write `{"feature_directory": "specs/NNN-name"}` there and the mod follows within seconds. `/speckit-specify` creates a new feature and points the file at it.
- **The user asks for something the spec lacks or rules out.** The mod logs the request, and the intent check marks it `extends` or `contradicts`. Do not build it silently. Name the conflict, then offer:
  - fold it into the spec with `/speckit-clarify`;
  - start a new feature with `/speckit-specify`;
  - or record a task.

  Spec Kit leaves the choice to the team. Ask once whether they keep a *living spec* (amend `spec.md`) or work *flow-forward* (a new feature per change), and keep to the answer.
- **An edit outside the plan.** If the file serves the spec, tie it with `mcp__speckit-xref__link` (a task `T###` or a requirement `FR-###`). Otherwise say so and offer to undo it.
- **Drift.**
  - `/xref` shows the status.
  - `/xref check` runs the intent check now.
  - `/xref ack` accepts the edits outside the plan.
  - The pane's *To spec* and *As task* buttons resolve a request beyond the spec.
- **Strictness.** The plugin option `mode` is `advisory` by default. Set to `strict`, the mod refuses edits outside the current task's planned or linked files. `driftCheck: off` skips the model-based intent check. The user sets both with `/config` (the speckit-xref rows) or under `pluginConfigs` in settings.

## Other agents and CI (optional)

The speckit-xref Spec Kit extension keeps the same record for any agent and for CI. Install it with:

```bash
specify extension add xref --from https://github.com/moinsen-dev/speckit-xref/releases/latest/download/speckit-xref-extension.zip
```

The CLI asks for confirmation before installing from a URL. Show the user the URL and let them confirm. After their yes you may pipe `y` into the command.

It adds `/speckit-xref-map`, `/speckit-xref-check` and `/speckit-xref-report`, and hooks after `tasks` and `implement`. For a pull request check in GitHub Actions, check out with `fetch-depth: 0`, then:

```yaml
- name: Spec drift
  run: python3 .specify/extensions/xref/scripts/python/xref.py check --base origin/${{ github.base_ref || 'main' }} --fail-on red
```

## Never

- Run `specify init`, or install the extension, without the user's go. Switching the autopilot on counts as that go for `specify init`, but not for the extension.
- Overwrite an existing `spec.md`, `plan.md` or constitution.
- Tick a task you did not finish.
- Paraphrase the user's idea into the spec's `Input` line.
