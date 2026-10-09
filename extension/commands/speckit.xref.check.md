---
description: "Check the code against the active spec: unplanned changes, anchors, coverage, and the user's intent"
---

# Check for drift

Drift is the distance between what the user wanted, what the spec says, and what the code now does. This command measures it: the deterministic part with a script (changed files against the files `tasks.md` plans, `@spec` anchors, the coverage ladder, requirements whose text changed since they were proven), the semantic part with your judgement (does the change still match the user's words and the spec?). The drift level and the CI exit code rest on the deterministic part only; your verdict is recorded as advice.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). It may name a git base to compare against (e.g. `origin/main`): pass it as `--base <ref>`. Uncommitted changes always count.

## Steps

1. From the repository root, run:

   ```bash
   python3 .specify/extensions/xref/scripts/python/xref.py check --json
   ```

   (add `--base <ref>` when given; `python` on Windows). The output holds `level` (green, yellow or red), `findings` (`unplanned`, `dangling`, `orphan-test`, `re-verify`), `notes` (spec gaps such as a user story without acceptance scenarios), every changed file with its verdict (`planned` or `task-linked` for a task, `linked`, `unclear` for manifests and config, `unplanned`, `untracked`; lockfiles and build output are left out), the coverage ladder (`levels`), the spec's summary and `openIntents`: requests the user typed during implementation, logged by the speckit-xref Claude Code mod (may be empty).

2. Judge the intent. Read `spec.md`, the `openIntents`, what the user asked for in this conversation, and the diff of the changed files (`git diff` against the same base, plus the content of new files). Ask: does the change match the user's intent and the spec? Did the user ask for something the spec does not cover (`extends`) or rules out (`contradicts`)?

3. Write your verdict as one JSON object to a temporary file **with your file-editing tool**:

   ```json
   {"score": 0, "verdict": "aligned | minor | drift", "reasons": ["at most 3 short reasons"], "intent_changes": [{"text": "short quote of the request", "kind": "extends | contradicts"}]}
   ```

   `score` runs from 0 to 100, where 100 means the change matches both the intent and the spec. `intent_changes` holds only requests the user made (in `openIntents` or this conversation) that the spec lacks or rules out, never a quote of the spec itself; code that contradicts the spec without the user asking for it belongs in `reasons` and lowers `score`. An empty `intent_changes` list is the normal case. Then record it and delete the file:

   ```bash
   python3 .specify/extensions/xref/scripts/python/xref.py record-check <that file> --json
   ```

4. Report the drift level, the findings and your verdict in a few lines. Then offer, and do only what the user approves:
   - for each `unplanned` file: tie it to the task, requirement or scenario it serves (`xref.py link --file <path> --id <T###, FR-### or US1-AS1>`), or treat it as scope creep to undo; files that are never drift (generated code, say) go into `.xrefignore`;
   - for each request beyond the spec: fold it into the spec with `__SPECKIT_COMMAND_XREF_REVISE__` (or `__SPECKIT_COMMAND_CLARIFY__` while the spec is still a draft);
   - for each `dangling` anchor or `orphan-test`: move it to the requirement that replaced it, or remove it;
   - for each `re-verify`: run `__SPECKIT_COMMAND_XREF_VERIFY__`, or re-map the requirement if its meaning changed;
   - for uncovered requirements: `__SPECKIT_COMMAND_XREF_MAP__`.

In CI, run the script alone: `xref.py check --base origin/main --no-write --fail-on red` exits 1 when that level is reached, 2 on a usage or feature error, and never counts the intent verdict.
