# Spec Kit community catalog: submission

Spec Kit takes community extensions through an issue, not a pull request. Open
<https://github.com/github/spec-kit/issues/new?template=extension_submission.yml>
and fill in the fields below. A maintainer labels the issue, and a workflow then
opens a draft PR that adds the entry to `extensions/catalog.community.json` and
`docs/community/extensions.md`.

| Field | Value |
| --- | --- |
| Extension ID | `xref` |
| Extension Name | `Spec X-Ref` |
| Version | `0.4.1` |
| Description | `Requirement-to-task-to-code traceability and drift checks: unplanned changes, @spec anchors, coverage, intent` |
| Author | `moinsen-dev` |
| Repository URL | `https://github.com/moinsen-dev/speckit-xref` |
| Download URL | `https://github.com/moinsen-dev/speckit-xref/releases/download/v0.5.2/speckit-xref-extension-v0.4.1.zip` |
| License | `MIT` |
| Homepage | `https://github.com/moinsen-dev/speckit-xref` |
| Documentation URL | `https://github.com/moinsen-dev/speckit-xref/blob/main/extension/README.md` |
| Changelog URL | `https://github.com/moinsen-dev/speckit-xref/blob/main/CHANGELOG.md` |
| Required Spec Kit Version | `>=0.12.17` |
| Number of Commands | `3` |
| Number of Hooks | `2` |
| Tags | `traceability, drift, requirements, quality` |

**Required Tools**

```text
- python3 - required (standard library only)
- git - optional (finds the changed files)
- rg - optional (finds @spec anchors faster)
```

**Key Features**

```text
- Records which task implements which requirement (FR -> tasks), which Spec Kit's tasks.md does not
- Classifies every changed file against the files tasks.md plans: planned, linked or unplanned
- @spec anchors in code count as coverage; an anchor to a requirement the spec no longer has is drift
- Intent check: the agent compares the user's own words, the spec and the diff, and records a score and any request beyond the spec
- CI: `xref.py check --base origin/main --fail-on red --no-write` exits 1 on drift (2 on a usage error), deterministic, without a model
- Traceability report: requirement -> tasks -> files and anchors
- Shares specs/<feature>/xref.json with the speckit-xref Claude Code mod, which keeps it live inside the agent loop
```

**Testing checklist**: the extension installs from the download URL (`specify extension add xref --from <url>`, Spec Kit 1.1.2). The three commands ran headless with Claude Code. The documentation is in `extension/README.md`.
