---
description: "Run the tests and record which requirements they prove: passing or failing, per requirement"
---

# Verify requirements with tests

A requirement is only proven at the top of the coverage ladder, `passing`: a test that names it (`FR-002` in the test's name) or carries its `@spec` anchor passed, against the requirement's current text. This command runs the project's tests and records the result in the feature's local ledger, so `check`, `report` and the speckit-xref Claude Code mod show it.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). It may name the test command, a JUnit XML file that already exists, or a feature directory (pass `--feature <dir>`).

## Steps

1. Find the test command: the `Testing` entry in `plan.md`'s technical context, then the project's own files (`package.json` scripts, `pyproject.toml`, `go.mod`, `pubspec.yaml`, `Cargo.toml`). If it stays unclear, ask the user. Do not install a test runner or reporter without the user's approval.

2. Run the tests so they write JUnit XML to a temporary file outside the repository, for example:

   - pytest: `pytest --junitxml=<tmp>/junit.xml -o junit_family=xunit1` (`xunit1` keeps the `file` attribute)
   - vitest: `npx vitest run --reporter=junit --outputFile=<tmp>/junit.xml`
   - jest with `jest-junit`: `JEST_JUNIT_OUTPUT_FILE=<tmp>/junit.xml JEST_JUNIT_ADD_FILE_ATTRIBUTE=true npx jest --reporters=default --reporters=jest-junit`
   - any other runner that writes JUnit XML

   A test proves a requirement through its name or class name (`FR-002`, `SC-001`, `US1-AS2`), or through an `@spec` anchor in its file, which needs the `file` attribute on `<testcase>`. A failing run still writes the report; continue with it.

3. Record the results:

   ```bash
   python3 .specify/extensions/xref/scripts/python/xref.py verify --junit <tmp>/junit.xml --json
   ```

   (repeat `--junit` for several reports; `python` on Windows). It prints `passing` and `failing` requirement ids, the tests behind each, and the ladder (`levels`). It exits 1 when a test mapped to a requirement failed.

   If the runner cannot write JUnit XML, run the test command as it is and pass its exit code instead: `xref.py verify --exit-code <code> --json`. A 0 proves the requirements that already stand at `tested` (a real test carries their anchor); any other code records nothing.

4. Delete the temporary files. Report in a few lines: which requirements pass, which fail (with the failing tests), and the ladder line. Then offer, and do only what the user approves:
   - for each failing requirement: look into the failing test and fix the code;
   - for requirements at `implemented` (code, but no real test): write a test that names the requirement or carries `@spec <feature>/FR-###`;
   - for a `re-verify` finding from `__SPECKIT_COMMAND_XREF_CHECK__`: the requirement's text changed since it was proven, so this run is its new proof.

   Do not edit `spec.md` or `tasks.md` here.
