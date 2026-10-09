---
description: "Write a traceability report: requirement to tasks to files and @spec anchors, plus drift"
---

# Traceability report

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). It may name a feature directory (pass `--feature <dir>`) or an output path (pass `--out <path>`).

## Steps

1. From the repository root, run:

   ```bash
   python3 .specify/extensions/xref/scripts/python/xref.py report --json
   ```

   (`python` on Windows.) It writes `<feature>/xref-report.md`: every requirement with its tasks, the files those tasks touched or that were linked to it, its `@spec` anchors, uncovered and unclear requirements marked, then the drift findings and the requests that went beyond the spec.

2. Tell the user where the report is and summarise it in three lines: drift level, coverage, the most important finding. Do not change any file besides the report.
