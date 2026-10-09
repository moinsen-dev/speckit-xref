# Spec Kit X-Ref for Claude Code

A Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps a [GitHub Spec Kit](https://github.com/github/spec-kit) feature and its code tied together while the agent works: the spec rides every request, every edit is booked against a task, and after each turn a drift check asks whether the change still matches what the user said and what the spec says.

It complements read-only viewers such as SpecKit Companion: they show the run; this one keeps the run on the spec.

## What it does

| | How |
|---|---|
| **Spec in the system prompt** | `prompt.compose` adds one section: active feature, the user's original words, user stories, constitution MUST rules, out of scope, open `NEEDS CLARIFICATION`, and the rules of the game. It changes only when the spec does, so the prompt cache survives. |
| **Current task on every prompt** | `prompt.submit` attaches a note: current task, its planned files, the requirements it serves, the next tasks, the drift status. |
| **Intent log** | Every prompt the person types is logged (`intents` in `xref.json`): their own words, the ground truth of the idea. |
| **Edit booking** | `tool.call` on Edit/Write/NotebookEdit books the file against the current task (paths come from `tasks.md`). A file planned for another task makes that task current. A file planned for none is drift: the model reads a note beside the tool result right away. |
| **Strict mode** | Optional: refuses an unplanned edit and names the way forward (focus another task, link the file, or extend the spec). |
| **Anchors** | `// @spec 001-feature/FR-003` comments count as coverage; one that names a requirement the spec no longer has is drift. |
| **Intent check** | After a turn that wrote files, one tool-less `$.model.fork` over the session compares the user's words, the spec and the diff. It returns a score, reasons and requests the spec lacks. With no transcript to fork yet, one completion fed by the intent log stands in. |
| **Fix it from the pane** | *To spec* runs `/speckit-clarify` with the request; *As task* appends a `[Drift]` task to `tasks.md`; *Map FR→tasks* lets a small model map requirements to tasks once and keeps the map. |
| **Band and pane** | A line above the prompt (`● xref T004 · tasks 3/8 · FR 4/5 · drift yellow (1)`) that stacks with other mods' bands, and a pane: Goal, Vision, Now, Todo, Status, Next, Drift. |

The model gets five tools: `mcp__speckit-xref__status` (CLI, setup, integration, workflow phase, autopilot and the next command), `mcp__speckit-xref__ask` (the autopilot waits for the person), `mcp__speckit-xref__focus` (make a task current), `__where` (which tasks and requirements a file belongs to) and `__link` (tie a file to a task or requirement).

Everything the mod keeps lives in one file per feature, `specs/<feature>/xref.json`: tasks touched and linked, requirement map, unplanned edits, intents, anchors, the last intent check. It is derived and safe to delete.

## Install

At the prompt of a terminal session:

```text
/plugin install speckit-xref --marketplace moinsen-dev/speckit-xref
```

## Autopilot

`/xref auto on [steps]` lets the work run: after every turn the mod hands the next Spec Kit step to Claude by itself, so nobody has to answer "next is X, shall I go on?". It stops only for what is yours:
- the product idea;
- a `[NEEDS CLARIFICATION]` question;
- a request that contradicts the spec;
- destructive or irreversible actions.

Claude flags those through the `mcp__speckit-xref__ask` tool. When an answer ends on a question anyway, a small model decides whether it is a real decision or just "shall I go on?".

It also stops on Esc, after three steps without progress, at the step budget (25 by default) and when every task is checked and verified. The band shows `auto ▶ 3/25` while it runs and `auto ⏸ waiting for you` when it waits. To start every session with the autopilot on, set the plugin options `autopilot: on` and `autopilotMaxSteps`. It is off by default, because every step is a model turn.

## The `speckit` skill

`/speckit-xref:speckit`, or any request to set up or run Spec Kit, loads a skill that:

- **sets Spec Kit up:** finds the `specify` CLI or runs it through `uvx`, says what `specify init` writes before it runs, then moves on to the constitution;
- **walks the workflow:** constitution → specify → clarify → plan → tasks → map → implement → verify, steered by the status tool rather than by guesswork;
- **handles the day-to-day:** switching features, requests beyond the spec, unplanned edits, strict mode, and the Spec Kit extension with its CI check.

## Use

The active feature is read the way Spec Kit's scripts read it: `SPECIFY_FEATURE_DIRECTORY`, then `.specify/feature.json`, then `SPECIFY_FEATURE`, else the spec written last.

```text
/xref              status of the active feature
/xref check        run the intent check now
/xref map          map requirements to tasks with a small model
/xref ack          accept every edit outside the plan
/xref focus T004   make a task current
/xref auto on [n]  autopilot: work through Spec Kit by itself (off: stop)
/xref pane         open the pane
```

Options (`/config` or `pluginConfigs` in settings): `mode` (`advisory` | `strict`), `driftCheck` (`fork` | `off`), `mapModel` (default `haiku`), `autopilot` (`off` | `on`), `autopilotMaxSteps` (default 25).

## Develop

```bash
claude --plugin-dir ./mod                 # load this checkout, reloading on save
claude plugin validate --strict ./mod
claude plugin test ./mod
node scripts/build-fixture.mjs            # after changing examples/demo
```

`examples/demo` is a small Spec Kit project (magic-link login) to try it on. In the desktop app's Code tab, name the folder in `CLAUDE_CODE_PLUGIN_DIRS` under `env` in `~/.claude/settings.json`.

Tested on Claude Code 2.1.294 and Spec Kit 1.1.2. The mods API is early access and can change between releases.
