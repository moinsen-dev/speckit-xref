# speckit-xref GitHub Action

Checks a pull request against its [Spec Kit](https://github.com/github/spec-kit) feature and writes a job summary. It runs the speckit-xref extension's script (`extension/scripts/python/xref.py`) from this repository. It needs only Python 3, which GitHub's runners have. It installs nothing.

## Workflow

```yaml
name: Spec drift
on: pull_request

permissions:
  contents: read

jobs:
  xref:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # the diff needs the base commit
      - uses: moinsen-dev/speckit-xref/action@v0.4.0
```

With test results:

```yaml
      - run: npx vitest run --reporter=junit --outputFile="$RUNNER_TEMP/junit.xml"
      - uses: moinsen-dev/speckit-xref/action@v0.4.0
        if: ${{ !cancelled() }}   # write the summary even when a test failed
        with:
          junit: ${{ runner.temp }}/junit.xml
```

Write test reports outside the checkout, or into a git-ignored folder. An untracked file in the working tree counts as a change.

## Inputs

| Input | Default | What |
| --- | --- | --- |
| `fail-on` | `red` | Fail the job at this drift level: `none`, `yellow` or `red`. |
| `base` | the pull request's base sha, else `HEAD~1` | The git ref or sha to compare against. |
| `feature` | from the branch name or the diff | The feature folder, e.g. `specs/001-magic-link-login`. Set it when a pull request touches several features. |
| `junit` | none | JUnit XML paths or globs, separated by spaces, e.g. `reports/*.xml`. A pattern that matches nothing is a warning. |
| `working-directory` | `.` | The Spec Kit project root, relative to the workspace. |

## Steps

1. **Verify** (only with `junit`): `xref.py verify --junit … --no-write` maps each test to the requirements and scenarios its name or anchors carry, and logs which ones pass and which fail.
2. **Check**: `xref.py check --base … --fail-on … --no-write` classifies the changed files and lists the findings.
3. **Summary**: `xref.py summary --base … [--junit …]` goes to the job summary. It reads the same JUnit reports as verify, in memory, and runs even when the check fails.

`--no-write` leaves `xref.json` and the local ledger alone, so CI never rewrites a committed file.

## Exit behaviour

The job ends with the check's exit code:

| Exit | Meaning |
| --- | --- |
| 0 | No finding at or above `fail-on`. |
| 1 | Findings reached `fail-on`. |
| 2 | Usage error, a base that is not in the checkout, or a feature that cannot be resolved. With one feature in `specs/` that one is checked; with several, the branch name (`NNN-…`), the diff or `feature` has to say which. |

Only deterministic findings fail a build:
- **yellow:** a changed file no task plans, links or anchors; an `@spec` anchor to an id the spec lacks, or to a retired or superseded requirement; a requirement whose text changed since it was last proven (re-verify).
- **red:** three or more unplanned files.

The LLM's intent verdict never fails a build. A failing test does not fail this action either: your test step already does. Verify and summary errors show up as annotations.

## The summary

For the feature of the pull request it shows:
- requirement → tasks → files, with each requirement's level: specified, planned, implemented, tested or, with `junit`, passing;
- the unplanned and unclear files of the diff;
- requirements to re-verify;
- notes, such as a user story without acceptance scenarios.

It reads only committed files. The prompts the speckit-xref Claude Code mod logs while you work stay in `.specify/xref/local/`, which is git-ignored. That is by design: they hold your own words, and they never reach CI or the pull request.
