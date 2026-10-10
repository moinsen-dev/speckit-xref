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

The person can let the work run: `/xref auto on [steps]` (or the plugin option `autopilot: on`; in a `-p` run, `SPECKIT_XREF_AUTOPILOT=on`). From then on the mod hands the next Spec Kit step to you after every turn: for a new project validate (the idea, researched) and shape (the first version, settled with the person), then constitution, specify, clarify, the person's review of the spec, plan, tasks, map, analyze and its fixes, implement one phase at a time, repair when the tests fail, converge, verify. While it runs:

- **Never ask whether to continue**, never end with "Next is X, shall I?": end your turn and the autopilot moves on.
- **Decide what the person left open** from the spec, the constitution and the repository, and record those choices as assumptions in the artifact you write (spec, plan, constitution).
- **Stop only for what is theirs:**
  - the product idea;
  - a `[NEEDS CLARIFICATION]` question;
  - a conflict between their request and the spec;
  - anything destructive or irreversible;
  - credentials or payments.

  Then call `mcp__speckit-xref__ask` with the question (and `options`, and `blocks` with the stories or tasks it holds up). Where the person is there, it answers with their choice: go on with it. A question that blocks only some stories is queued; leave those alone and go on with the rest. Otherwise put the question in your answer and end your turn: the autopilot waits for their answer.
- **Implement only the phase the prompt names**, and stop when it is done. Check a task off only when its tests pass (a test-writing task in TDD is done when its tests exist and fail).
- **A repair step** carries the failing test output: fix the code, not the tests, unless a test contradicts the spec.
- **Never approve the spec yourself.** The spec gate is the person's: they approve it in the pane, with `/xref approve` or in the dialog.
- While it runs, `git push`, `reset --hard`, `rm -rf` and writes to `.env` files are refused: ask instead.

The autopilot also stops when:
- a turn is interrupted (Esc or `/xref-stop`), or ends with an API error or a refusal;
- the tests still fail after three repairs;
- the drift turns red, or the intent check finds a request that contradicts the spec;
- three steps pass without progress;
- the step budget (25 by default) is used up;
- every task is checked, converged, verified and the test suite passes.

`/xref auto` shows its state, `/xref auto off` ends it, `/xref auto night` starts a long run that leaves a briefing.

## Phase `setup`: Spec Kit is not set up yet

The status report says which folder you are in:
- **Empty** (only dotfiles, a README, a license): the person starts something new. Ask what they want to build (an app, a project, a problem to solve), then set Spec Kit up and specify it in their words.
- **Existing code**: bring the project under Spec Kit. Draft the constitution from the code and the README, marking assumptions, and make the next change the first feature.

A folder inside a Spec Kit project counts as that project: the mod looks upward for `.specify/`, as Spec Kit does. Never nest a second setup there.

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
| `validate` | skill `speckit-xref:validate` | New projects only: research the idea (who has the problem, what exists, what differs, the riskiest assumption) into `.specify/memory/idea-brief.md`. Never invent a source. The person decides Build, Sharpen or Drop; never write that decision. |
| `shape` | skill `speckit-xref:shape` | New projects only: ask the person what the idea leaves open (first-version scope, platforms, language, design, data) and write `.specify/memory/product-brief.md`. |
| `constitution` | `/speckit-constitution` | 3 to 7 principles, each a short, checkable MUST rule (tests, dependencies, privacy, …). Ask the person, or on autopilot draft them from the repository and mark them as assumptions. The mod puts every MUST rule into every prompt, so few and sharp beats many. |
| `specify` | `/speckit-specify <the user's idea>` | Pass the user's words **verbatim**. They become the spec's `Input` line, which every drift check compares the code against. Do not polish them. |
| `clarify` | `/speckit-clarify` | Settles `[NEEDS CLARIFICATION]` markers before planning. |
| `plan` | `/speckit-plan <technical choices>` | Stack, storage and structure, as the user decides them. |
| `review` | the person | The spec gate: the person compares the spec with their words and approves it (pane, `/xref approve`). Never approve it yourself. |
| `tasks` | `/speckit-tasks` | Each task names its files in backticks and the requirements it serves as `(FR-###)` (the speckit-xref preset makes `/speckit-tasks` do this). The mod books edits by those paths, and a task without paths cannot be checked. |
| `map` | `/speckit-xref-map` or `/xref map` | Records which task serves which requirement, once. Spec Kit does not keep this. |
| `analyze` | `/speckit-analyze` | Before the first task and after every spec change: spec, plan and tasks checked against each other. |
| `implement` | `/speckit-implement` | One phase per run. Call `mcp__speckit-xref__focus` before you start a task. Mark code that implements a requirement with `@spec <feature>/FR-###` at file or function level, and tests with the anchor of what they prove (`FR-###` or a scenario `US1-AS2`). Tick a task only once its tests pass. |
| `converge` | `/speckit-converge` | Once every task is checked: turns what is missing into new tasks, until the task list stops changing. |
| `verify` | `/speckit-xref-check`, or by yourself | Checks the code against the user's words and the spec. Without the extension, check by yourself (`/xref check` is the person's command) and add what is missing as tasks. |

Each requirement climbs a proof ladder: specified, planned, implemented, tested (a real test anchors it), passing (the test run proved it for its current text). `/xref` and the pane show where each stands.

## Handling

- **Switch features.** Spec Kit tracks the active feature in `.specify/feature.json`. Write `{"feature_directory": "specs/NNN-name"}` there and the mod follows within seconds. `/speckit-specify` creates a new feature and points the file at it.
- **The user asks for something the spec lacks or rules out.** The mod logs the request, and the intent check marks it `extends` or `contradicts`. Do not build it silently. Name the conflict, then offer:
  - fold it into the spec with `/speckit-xref-revise` (new requirements get new ids; replaced ones become `SUPERSEDED by FR-00x`, dropped ones `RETIRED`; every change lands in `revisions.md`), or `/speckit-clarify` without the extension;
  - start a new feature with `/speckit-specify`;
  - or record a task.

  Spec Kit leaves the choice to the team. Ask once whether they keep a *living spec* (amend `spec.md`) or work *flow-forward* (a new feature per change), and keep to the answer. A line `Persistence model: flow-back | flow-forward | living` in the constitution tells the autopilot: with flow-forward it asks before a request beyond the spec reaches the spec.
- **An edit outside the plan.** If the file serves the spec, tie it with `mcp__speckit-xref__link` (a task `T###`, a requirement `FR-###` or a scenario `US1-AS2`). Otherwise say so and offer to undo it. Generated files and caches belong in `.xrefignore` (`unclear: <pattern>` lists a file without calling it drift).
- **What to commit.** `specs/<feature>/xref.json` is meant to be committed (map, links, accepted files, fingerprints; no timestamps). `.specify/xref/local/` stays local: it holds the person's own words.
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

It adds `/speckit-xref-map`, `-check`, `-verify`, `-report` and `-revise`, and hooks after `tasks` and `implement`. The speckit-xref preset (`specify preset add --from …/speckit-xref-preset-v0.1.0.zip`) makes `/speckit-tasks` name files and requirements in every task.

For a pull request check, the GitHub Action checks out with `fetch-depth: 0`, then:

```yaml
- uses: moinsen-dev/speckit-xref/action@v0.5.0
  with:
    fail-on: red
```

Only deterministic findings fail a build; the intent verdict never does. Without the Action: `python3 .specify/extensions/xref/scripts/python/xref.py check --base origin/main --fail-on red --no-write`.

## Never

- Run `specify init`, `specify integration install`, or install the extension without the person's go. Switching the autopilot on is no such go: it waits at setup until the person asks for it.
- Overwrite an existing `spec.md`, `plan.md` or constitution.
- Tick a task you did not finish, or whose tests fail.
- Approve the spec or the plan on the person's behalf.
- Paraphrase the user's idea into the spec's `Input` line.
