# Spec Kit X-Ref for Claude Code

A Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps a [GitHub Spec Kit](https://github.com/github/spec-kit) feature and its code tied together while the agent works: the spec rides every request, every edit is booked against a task, and after each turn a drift check asks whether the change still matches what the user said and what the spec says.

It complements read-only viewers such as SpecKit Companion: they show the run; this one keeps the run on the spec.

## What it does

| | How |
|---|---|
| **Spec in the system prompt** | `prompt.compose` adds one section: active feature, the user's original words, user stories, constitution MUST rules, out of scope, open `NEEDS CLARIFICATION`, and the rules of the game. It changes only when the spec does, so the prompt cache survives. |
| **Current task on every prompt** | `prompt.submit` attaches a note: current task, its planned files, the requirements it serves, the next tasks, the drift status. |
| **Intent log** | Every prompt the person types is logged (`intents` in `xref.json`): their own words, the ground truth of the idea. |
| **Edit booking** | `tool.call` on Edit/Write/NotebookEdit books the file against the current task (paths come from `tasks.md`). A file planned for another task makes that task current. A file planned for none is drift: the model reads a note beside the tool result right away. Files Bash changed during a turn (sed, a generator, npm) are found at its end and booked the same way. Lockfiles and build output never count; manifests and configs are *unclear*, not drift; `.xrefignore` adds your own patterns. |
| **Strict mode** | Optional: refuses an unplanned edit and names the way forward (focus another task, link the file, or extend the spec). If the guard itself fails, it refuses too. |
| **Proof ladder** | Each requirement is *specified*, *planned*, *implemented*, *tested* or *passing*. Tested means a test file with real tests anchors it; passing means the test run proved it for its current text. A changed requirement drops back and asks to be re-verified. |
| **Anchors** | `// @spec 001-feature/FR-003` comments count as coverage; one that names a requirement the spec no longer has is drift. |
| **Intent check** | After a turn that wrote files, one tool-less `$.model.fork` over the session compares the user's words, the spec and the diff. It returns a score, reasons and requests the spec lacks. With no transcript to fork yet, one completion fed by the intent log stands in. |
| **Fix it from the pane** | *To spec* runs `/speckit-clarify` with the request; *As task* appends a `[Drift]` task to `tasks.md`; *Map FR→tasks* lets a small model map requirements to tasks once and keeps the map. |
| **Band and pane** | A line above the prompt (`▲ xref T004 · tasks 3/8 · FR 4/5 · watch (1)`) that stacks with other mods' bands; while the autopilot waits, it shows the whole question with Resume, Stop and Pane. The pane: a phase strip, Goal, Vision, Now, Todo, Status, Proof, Next, a review card at the spec gate, "Away" after an autopilot run, open decisions, Auto, Tests and Drift. Each unplanned file is a card with **Link to** (a task picker) and **Accept this**; **Accept all** asks first. Under 70 columns the pane is compact; `d` shows the rest. |
| **Transcript** | Each booked write carries a chip (`● T006 · FR-003`, `▲ unplanned`), and the autopilot's long prompts fold to one line (`▶ auto 3/25 · implement · …`); ctrl+o shows them whole. |
| **Spec Kit's own commands** | `/speckit-implement`, `-plan`, `-tasks`, `-clarify`, `-analyze` and `-converge` get the current task, its files, coverage and drift appended. A compaction keeps the task in focus, your open requests and the decisions. |

The model gets five tools: `mcp__speckit-xref__status` (CLI, setup, integration, workflow phase, autopilot and the next command), `mcp__speckit-xref__ask` (a question for the person, answered in place where they are there; `blocks` names the stories it holds up), `mcp__speckit-xref__focus` (make a task current), `__where` (which tasks and requirements a file belongs to) and `__link` (tie a file to a task, requirement or scenario). In a repository without Spec Kit they wait behind ToolSearch, and nothing polls.

What the mod keeps per feature lives in two files:
- **`specs/<feature>/xref.json`**, committed: which tasks serve which requirement, which files are linked to what, which unplanned files were accepted, and each requirement's fingerprint. Sorted, without timestamps, so it merges and reviews cleanly.
- **`.specify/xref/local/<feature>.json`**, git-ignored by a `.gitignore` of its own: your logged prompts, the intent verdicts, test results, approvals, decisions, and the autopilot's run log (`<feature>.run.jsonl`). Your words stay on your machine.

A 0.3 `xref.json` is migrated on first load.

## Install

At the prompt of a terminal session:

```text
/plugin install speckit-xref --marketplace moinsen-dev/speckit-xref
```

## Autopilot

`/xref auto on [steps]` lets the work run: after every turn the mod hands the next Spec Kit step to Claude by itself, so nobody has to answer "next is X, shall I go on?". It follows Spec Kit's whole loop: constitution, specify, clarify, **your review of the spec**, plan, tasks, map, analyze, implement **one phase per step**, converge until the tasks stop changing, verify.

It stops only for what is yours:
- the product idea;
- **the spec gate:** once the spec is written, the pane shows your words beside the requirements, the out-of-scope list and the assumptions Claude added. **Approve spec** (or `/xref approve`, or the dialog) lets it go on; the plugin option `review` sets `spec+plan` or `none`. An approval holds for that text: a changed spec asks again;
- a `[NEEDS CLARIFICATION]` question, or open checklist items;
- a request that contradicts the spec (one that only extends it becomes a revise step);
- destructive or irreversible actions: while it runs, `git push`, `reset --hard`, `rm -rf` and writes to `.env` files are refused and turned into a question.

Claude asks through `mcp__speckit-xref__ask`. Where you are there, the question opens as a dialog and the run goes on with your answer in the same turn. A question that blocks only some stories waits in the pane's **Decide** row while the rest goes on. When an answer ends on a question anyway, a small model decides whether it is a real decision or just "shall I go on?".

**Tests gate the progress.** After each implement step the mod runs the test command (the `testCommand` option, else derived from plan.md's `**Testing**:` line). A failure becomes a repair step, at most three in a row; then it is your call. A passing suite proves every requirement with a real test (with `junitPath`, each one by the tests that name or anchor it). The run ends only when the suite passes once more.

It also stops on Esc or `/xref-stop` (both end the running turn), on an API error or a refusal, when the drift turns red, after three steps without progress, at the step budget (25 by default) and when the feature is done. After five minutes of waiting it sends a notification. The band shows `auto ▶ 3/25 · $1.80 · 23m` while it runs and the whole question when it waits; the pane tab reads `Spec X-Ref ⏸`. Back at the keyboard, the pane's **Away** card says what happened.

More, all off by default:
- `/xref auto night`: a night run of up to 100 steps; it writes `.specify/xref/local/briefing.md` when it stops.
- `commitPerTask: on`: a step whose tests pass commits the tasks it checked off, on a feature branch only; nothing you staged is mixed in, and files outside the plan or `.env` files stop it.
- `parallel: on`: a phase's open `[P]` tasks go to `speckit-xref:task-runner` subagents, one per task.
- Headless: `SPECKIT_XREF_AUTOPILOT=on|night|<steps> claude -p "…"` runs the autopilot in a `-p` session; each next step rides the Stop hook.

The pane's **Auto** row switches it:
- off: **Start autopilot** (`p`);
- running: **Stop** (`p`);
- waiting: **Resume** (`r`) and **Stop**. A spent budget restarts on Resume.

Click the buttons, or give the pane the keyboard with `ctrl+x tab` (once more if the band takes it first). `/xref pane` looks at the folder first, opens the pane without taking the keyboard (so the next key never presses a button), and says where things stand.

The autopilot never sets Spec Kit up by itself: `specify init` and `specify integration install` write into the repository, so it waits there for you. To start every session with the autopilot on, set the plugin options `autopilot: on` and `autopilotMaxSteps`. It is off by default, because every step is a model turn.

## Before Spec Kit is there

`/xref pane` and the status tool tell the folder apart, and the pane offers the one fitting start:

| Folder | Pane offers | What Claude then does |
| --- | --- | --- |
| empty (only dotfiles, a README, a license) | **Start from an idea** | asks what you want to build, sets Spec Kit up, writes the spec in your words |
| existing code, no `.specify/` | **Set up Spec Kit here** | runs `specify init`, drafts the constitution from the code, asks which change comes first |
| Spec Kit without its Claude Code commands | **Add Claude integration** | runs `specify integration install claude` |
| inside a Spec Kit project | the project itself | the mod looks upward for `.specify/`, as Spec Kit does |

Pressing one of these counts as your go. Without a press or your request nothing is written. A repository without Spec Kit stays quiet otherwise, with no band and no unasked pane.

## The `speckit` skill

`/speckit-xref:speckit`, or any request to set up or run Spec Kit, loads a skill that:

- **sets Spec Kit up:** finds the `specify` CLI or runs it through `uvx`, says what `specify init` writes before it runs, then moves on to the constitution;
- **walks the workflow:** constitution → specify → clarify → plan → tasks → map → implement → verify, steered by the status tool rather than by guesswork;
- **handles the day-to-day:** switching features, requests beyond the spec, unplanned edits, strict mode, and the Spec Kit extension with its CI check.

## Use

```text
/xref                  status of the active feature
/xref check            run the intent check now
/xref map              map requirements to tasks with a small model
/xref ack              accept every edit outside the plan
/xref approve          approve what the autopilot waits on (spec, plan, open checklists)
/xref focus T004       make a task current
/xref auto on [n]      autopilot: work through Spec Kit by itself (night: a night run, off: stop)
/xref pane             open the pane
/xref-stop             stop the autopilot now, mid-turn
```

Options (`/config` or `pluginConfigs` in settings): `mode` (`advisory` | `strict`), `driftCheck` (`fork` | `off`), `mapModel` (default `haiku`), `autopilot` (`off` | `on`), `autopilotMaxSteps` (default 25), `review` (`spec` | `spec+plan` | `none`), `testCommand`, `junitPath`, `commitPerTask` (`off` | `on`), `parallel` (`off` | `on`).

The active feature is found as Spec Kit finds it, then by the git branch (`001-…`), else the spec written last.

## Develop

```bash
claude --plugin-dir ./mod                 # load this checkout, reloading on save
claude plugin validate --strict ./mod
claude plugin test ./mod
node scripts/build-fixture.mjs            # after changing examples/demo or scripts/fixtures/cases.json
```

`examples/demo` is a small Spec Kit project (magic-link login) to try it on. In the desktop app's Code tab, name the folder in `CLAUDE_CODE_PLUGIN_DIRS` under `env` in `~/.claude/settings.json`.

Tested on Claude Code 2.1.294 and Spec Kit 1.1.2. The mods API is early access and can change between releases.
