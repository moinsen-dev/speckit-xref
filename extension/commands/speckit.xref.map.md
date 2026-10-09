---
description: "Map each functional requirement to the tasks that implement it and record the map in xref.json"
---

# Map requirements to tasks

Spec Kit's `tasks.md` names the user story of each task but not the requirement it serves, so "which task implements FR-003?" is answered afresh by every analysis and then forgotten. This command answers it once and records it in the feature's `xref.json`, where later drift checks, reports and the speckit-xref Claude Code mod read it.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). It may name a feature directory (e.g. `specs/002-export`); pass it as `--feature <dir>` below.

## Steps

1. From the repository root, run:

   ```bash
   python3 .specify/extensions/xref/scripts/python/xref.py map --json
   ```

   (`python` instead of `python3` on Windows.) It prints the active feature, every requirement with the tasks that already name it, its files and `@spec` anchors, the task list, and `coverage.uncovered`. If it reports that no feature exists, stop and point the user to `__SPECKIT_COMMAND_SPECIFY__`.

2. For every functional requirement (`FR-###`) in `coverage.uncovered`, and for any whose task list is clearly incomplete, decide which tasks implement it. Judge from the task text, its user story, its files, and `plan.md`. Use only task ids from the output. A requirement no task serves stays unmapped: that is a finding to report, not a gap to paper over.

3. Write the map as one JSON object, `{"FR-003": ["T006", "T007"], ...}`, to a temporary file **with your file-editing tool** (not through a shell `echo`: the text comes from the spec and may contain characters a shell would run), then record it:

   ```bash
   python3 .specify/extensions/xref/scripts/python/xref.py map --apply <that file> --json
   ```

   Delete the temporary file afterwards.

4. Report a short table, Requirement | Tasks, from the second run's output, and the coverage line (`FR covered n/m`). For each requirement that is still uncovered, suggest adding a task (`__SPECKIT_COMMAND_TASKS__`, or an edit to `tasks.md` the user approves). Do not edit `spec.md`, `plan.md` or `tasks.md` yourself.
