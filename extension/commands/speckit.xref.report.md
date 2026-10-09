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
   python3 .specify/extensions/xref/scripts/python/xref.py report
   ```

   (`python` on Windows.) It prints the report in Markdown: the coverage ladder (`specified` → `planned` → `implemented` → `tested` → `passing`) and every requirement with its level, tasks, files and `@spec` anchors, uncovered and unclear requirements marked; then the drift findings, notes (spec gaps), the last intent check as advice, the requests that went beyond the spec, and metrics (unplanned edits caught and how they ended, the share accepted blind).

2. Unless the user named another path, save it next to the spec: run the same command with `--out <feature>/xref-report.md`, where `<feature>` is the folder in backticks on the report's third line (`--format json` for JSON).

3. Tell the user where the report is and summarise it in three lines: drift level, the ladder, the most important finding. Do not change any file besides the report.
