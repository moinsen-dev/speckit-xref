---
description: "Fold a change request into the spec without losing history: new requirement ids, SUPERSEDED and RETIRED markers, appended tasks, revisions.md"
---

# Revise the spec

Requests change during implementation. Rewriting `spec.md` in place erases what the code, the tests and the ledger were proven against; this command folds a request in so the history stays readable: a new requirement gets a new id, a replaced one is marked superseded, a dropped one retired, and every revision is logged in `revisions.md`.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). It is the request to fold in. If it is empty, use the requests beyond the spec: run `python3 .specify/extensions/xref/scripts/python/xref.py check --no-write --json` and read `openIntents` (requests logged by the speckit-xref Claude Code mod) and `advice`.

## Rules

- **IDs are never reused.** A new requirement takes the next free number: one above the highest `FR-###` (or `SC-###`) anywhere in `spec.md`, superseded and retired ones included.
- **Replaced:** keep the old line and its id, and append ` SUPERSEDED by FR-00x` to its text (exactly this spelling, upper case). Add the new requirement as a new line.
- **Dropped:** keep the line and its id, and append ` RETIRED: <short reason>`.
- **Wording only** (a typo, no change of meaning): edit the text in place. The requirement then asks for new proof (`re-verify`) until it is mapped, linked or verified again.
- **Tasks are only appended.** Never renumber, reword or delete an existing task. New tasks take the next free `T###`, go under a new `## Revision <YYYY-MM-DD>: <summary>` heading at the end of `tasks.md`, name the requirement they serve (`(FR-00x)`) and their files in backticks.
- **Every revision is logged** at the end of `specs/<feature>/revisions.md` (create it if missing):

  ```markdown
  ## <YYYY-MM-DD> <summary>

  - FR-006 added: <text>
  - FR-002 superseded by FR-006
  - FR-004 retired: <reason>
  - T012 appended
  ```

## Steps

1. Run `python3 .specify/extensions/xref/scripts/python/xref.py map --json` (`python` on Windows). It lists every requirement with its `status` (active, superseded, retired), its tasks and its ladder level, and every task: you need the highest ids and what the request touches.

2. Work out the revision: which requirements it adds, which it replaces, which it drops, and which tasks it needs. If the request conflicts with the constitution or the spec's Out of Scope list, say so. Show the proposal in a few lines (the new requirement texts, the markers, the new tasks) and wait for the user's approval before you edit anything.

3. Edit `spec.md`, `tasks.md` and `revisions.md` as approved, following the rules above. Touch `plan.md` only if the revision changes the design, and say so.

4. Re-run `xref.py map --json`, then `xref.py check --json`. Superseded and retired requirements leave the coverage ladder; an `@spec` anchor or a test that still points at one now shows as `dangling` or `orphan-test`.

5. Report what changed (the `revisions.md` entry) and the follow-ups: anchors and tests to move to the new id, and the new tasks to implement (`__SPECKIT_COMMAND_IMPLEMENT__`). For a revision big enough to need new design, suggest `__SPECKIT_COMMAND_PLAN__` instead of appending tasks by hand.
