#!/usr/bin/env python3
"""speckit-xref: tie a Spec Kit feature and its code together, and measure drift.

The batch twin of the speckit-xref Claude Code mod. Both implement the rules of
``docs/contract-0.4.md`` and keep the same ledger in two halves: the committed
``specs/<feature>/xref.json`` (map, links, accepted files, fingerprints; sorted,
no timestamps) and the local ``.specify/xref/local/<feature>.json`` (touched
files, open drift, intents, verdicts, test results). A mapping made here shows
in the mod's pane, and a drift the mod logged shows in a check here.
``scripts/fixtures/cases.json`` holds both sides to the same outputs
(``xref.py selftest``); ``scripts/parity.mjs`` compares the readers.

Standard library only, Python 3.9+. Subcommands:

  map            requirements, tasks and the coverage ladder; --apply FILE records a FR -> tasks map
  link           tie a file to a task, requirement or scenario, or a requirement to a task
  check          classify changed files against the plan; drift level, exit code for CI
  verify         read JUnit XML: which requirements pass, which fail
  record-check   record an intent verdict (score, reasons, intent changes) from a JSON file
  report         traceability report: ladder, findings, notes, metrics (Markdown or JSON)
  summary        the pull request's job summary in Markdown
  migrate        rewrite a v1 ledger as v2
  dump           the parsed spec, tasks and constitution (for parity tests)
  selftest       run scripts/fixtures/cases.json against this file
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

A = re.ASCII  # JavaScript's \w, \d and \b are ASCII; so are ours, for parity with the mod.

# ---------------------------------------------------------------------------
# Spec Kit readers (mirror mod/hooks/speckit.ts)


def clip(text: str, limit: int) -> str:
    return text[: limit - 1] + "…" if len(text) > limit else text


def unbold(text: str) -> str:
    return text.replace("**", "").replace("`", "").strip()


def bullets_under(markdown: str, heading: re.Pattern, limit: int) -> list[str]:
    out: list[str] = []
    inside = False
    for line in markdown.split("\n"):
        h = re.match(r"^#{2,4}\s+(.*)$", line, A)
        if h:
            if inside:
                break
            inside = bool(heading.search(h.group(1) or ""))
            continue
        if not inside:
            continue
        bullet = re.match(r"^\s*[-*]\s+(.*)$", line, A)
        if bullet and bullet.group(1) and not re.match(r"^\[.*\]$", bullet.group(1).strip()):
            out.append(clip(unbold(bullet.group(1)), 200))
        if len(out) >= limit:
            break
    return out


STORY = re.compile(r"^###\s+User Story\s+(\d+)\s*[-–—:]\s*(.+?)\s*(?:\(Priority:\s*(P\d+)\))?\s*(?:🎯.*)?$", A)
SCENARIO = re.compile(r"^\s*(\d+)\.\s+(\*\*Given\*\*.*)$", A)


def req_status(text: str) -> dict:
    """A requirement's place in the spec's history (§11): active, superseded by another, or retired."""
    by = re.search(r"SUPERSEDED by ((?:FR|SC)-\d{3,})", text, A)
    if by:
        return {"status": "superseded", "supersededBy": by.group(1)}
    if "RETIRED" in text:
        return {"status": "retired", "supersededBy": None}
    return {"status": "active", "supersededBy": None}


def parse_spec(markdown: str) -> dict:
    title = re.search(r"^#\s+(?:Feature Specification:\s*)?(.+)$", markdown, re.M | A)
    input_line = re.search(r"^\*\*Input\*\*:\s*(?:User description:\s*)?(.+)$", markdown, re.M | A)
    raw_input = input_line.group(1).strip() if input_line else None
    if raw_input is not None:
        raw_input = re.sub(r'^"(.*)"$', r"\1", raw_input).strip()
    # A story runs from its heading to the next heading of level 1-3; its numbered Given lines are scenarios USn-ASk.
    stories: list[dict] = []
    story: dict | None = None
    for line in markdown.split("\n"):
        m = STORY.match(line)
        if m:
            story = {"id": f"US{m.group(1)}", "title": unbold(m.group(2) or ""), "priority": m.group(3), "scenarios": []}
            stories.append(story)
            continue
        if re.match(r"^#{1,3}\s", line, A):
            story = None
            continue
        scenario = SCENARIO.match(line) if story else None
        if story and scenario:
            story["scenarios"].append({"id": f"{story['id']}-AS{int(scenario.group(1))}", "text": clip(unbold(scenario.group(2) or ""), 300)})
    reqs: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(r"^\s*[-*]\s*\*\*((FR|SC)-\d{3,})\*\*\s*:?\s*(.*)$", markdown, re.M | A):
        rid = m.group(1)
        if rid in seen:
            continue
        seen.add(rid)
        text = m.group(3) or ""
        reqs.append(
            {
                "id": rid,
                "kind": m.group(2),
                "text": clip(unbold(text), 300),
                "needsClarification": bool(re.search(r"NEEDS CLARIFICATION", text, re.I)),
                # The status reads the whole line: a marker past the clip still counts.
                **req_status(unbold(text)),
            }
        )
    return {
        "title": title.group(1).strip() if title else "Untitled feature",
        "input": clip(raw_input, 600) if raw_input and raw_input != "$ARGUMENTS" else None,
        "stories": stories,
        "reqs": reqs,
        "outOfScope": bullets_under(markdown, re.compile(r"out of scope|non-goals?|not in scope", re.I), 8),
        "assumptions": bullets_under(markdown, re.compile(r"^assumptions", re.I), 6),
    }


PATH_EXT = re.compile(r"\.[a-z0-9]{1,6}$", re.I | A)
SPEC_DOCS = re.compile(r"^(spec|plan|tasks|research|data-model|quickstart|constitution|checklist)\.md$", re.I | A)


def extract_paths(text: str) -> list[str]:
    found: dict[str, None] = {}

    def keep(raw: str) -> None:
        path = re.sub(r"[.,;:)]+$", "", re.sub(r"^\./", "", raw.strip()))
        if not path or re.match(r"^https?:", path, re.I) or " " in path or len(path) > 200:
            return
        # "as plan.md says" names Spec Kit's own documents, not a file the task writes.
        if SPEC_DOCS.match(path):
            return
        if "/" in path or PATH_EXT.search(path):
            found.setdefault(path, None)

    for m in re.finditer(r"`([^`]+)`", text):
        keep(m.group(1) or "")
    bare = re.sub(r"`[^`]*`", " ", text)
    for m in re.finditer(
        r"(?:^|[\s(\"'])((?:\./)?(?:[\w@.-]+/)+[\w@.\[\]-]*|[\w-]+\.[a-z][a-z0-9]{0,5})(?=[\s,;:)\"']|\.(?:\s|$)|$)", bare, re.I | A
    ):
        token = m.group(1) or ""
        if re.match(r"^(e\.g|i\.e|etc|vs)\.?$", token, re.I) or re.match(r"^v?\d+(\.\d+)+$", token, A):
            continue
        keep(token)
    return list(found)


def parse_tasks(markdown: str) -> list[dict]:
    tasks: list[dict] = []
    phase = ""
    for line in markdown.split("\n"):
        heading = re.match(r"^##\s+(.+)$", line, A)
        if heading:
            phase = unbold(heading.group(1) or "")
            continue
        m = re.match(r"^\s*[-*]\s*\[( |x|X)\]\s*(?:\*\*)?(T\d{3,})(?:\*\*)?\s*(.*)$", line, A)
        if not m:
            continue
        rest = m.group(3) or ""
        parallel = "[P]" in rest
        story = re.search(r"\[(US\d+)\]", rest, A)
        rest = re.sub(r"\[(P|US\d+)\]\s*", "", rest, flags=A).strip()
        tasks.append(
            {
                "id": m.group(2),
                "done": m.group(1) != " ",
                "parallel": parallel,
                "story": story.group(1) if story else None,
                "text": clip(rest, 240),
                "paths": extract_paths(rest),
                "reqs": list(dict.fromkeys(re.findall(r"\b(?:FR|SC)-\d{3,}\b", rest, A))),
                "phase": phase,
            }
        )
    return tasks


def parse_constitution(markdown: str) -> dict:
    principles: list[str] = []
    musts: list[str] = []
    for line in markdown.split("\n"):
        h = re.match(r"^###\s+(.+)$", line, A)
        if h and h.group(1) and not re.search(r"\[[A-Z0-9_]+\]", h.group(1), A):
            principles.append(clip(unbold(h.group(1)), 80))
        if re.search(r"\bMUST\b", line, A) and not re.search(r"\[[A-Z0-9_]+\]", line, A) and not line.startswith("#"):
            text = unbold(re.sub(r"^\s*[-*]\s*", "", line, flags=A))
            if text:
                musts.append(clip(text, 200))
    return {"principles": principles[:12], "musts": musts[:12]}


# ---------------------------------------------------------------------------
# Shared rules (mirror mod/hooks/rules.ts): fingerprints, globs, test files, branches


def normalize_text(text: str) -> str:
    """NFKC, lower case, one space between words, no closing punctuation (§6)."""
    # No re.ASCII here: JavaScript's \s, which the mod collapses, is Unicode-aware.
    text = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text).lower()).strip()
    return re.sub(r"[.;:!]+\Z", "", text).strip()


def fingerprint(text: str) -> str:
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def spec_fingerprint(spec: dict) -> str:
    """What the spec gate keys on: the person's words, every requirement and every scenario."""
    parts = [spec.get("input") or "", *[r["text"] for r in spec.get("reqs", [])], *[x["text"] for s in spec.get("stories", []) for x in s.get("scenarios", [])]]
    return fingerprint("\n".join(parts))


DEFAULT_EXEMPT = [
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "Cargo.lock", "poetry.lock", "uv.lock", "Gemfile.lock", "go.sum", "composer.lock", "Podfile.lock", "pubspec.lock",
    "node_modules/", "/dist/", "/build/", "/coverage/", "/.next/", "/out/", "/target/", "__snapshots__/", "*.min.js", "*.map", "*.generated.*", "*.g.dart",
]  # fmt: skip
DEFAULT_UNCLEAR = [
    "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pubspec.yaml", "Gemfile", "requirements*.txt", "*.config.*", "tsconfig*.json", ".eslintrc*", ".prettierrc*", "Dockerfile", "docker-compose*.yml",
    "/.github/workflows/", ".env.example", "*.md",
]  # fmt: skip
TEST_GLOBS = ["*.test.*", "*.spec.*", "test_*.py", "*_test.py", "*_test.go", "*_test.dart", "/tests/", "/test/", "__tests__/"]


def glob_to_regex(pattern: str) -> re.Pattern:
    """The gitignore subset of §2: a folder with a trailing /, root-anchored with a leading /, any depth without a /."""
    p = re.sub(r"^\./", "", pattern.strip())
    folder = p.endswith("/")
    if folder:
        p = p[:-1]
    if p.startswith("/"):
        p = p[1:]
    elif "/" not in p:
        p = "**/" + p
    if folder:
        p += "/**"
    out, i = "", 0
    while i < len(p):
        if p.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif p.startswith("/**", i) and i + 3 == len(p):
            out, i = out + "(?:/.*)?", i + 3
        elif p.startswith("**", i):
            out, i = out + ".*", i + 2
        else:
            ch = p[i]
            out, i = out + ("[^/]*" if ch == "*" else "[^/]" if ch == "?" else re.escape(ch)), i + 1
    return re.compile(out)


def parse_ignore(text: str) -> dict:
    """`.xrefignore`: one pattern per line, `unclear: <pattern>` for the unclear bucket, `#` for comments."""
    rules: dict = {"exempt": [], "unclear": []}
    for raw in text.split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        unclear = re.match(r"^unclear:\s*(.+)$", line)
        if unclear:
            rules["unclear"].append(unclear.group(1).strip())
        else:
            rules["exempt"].append(line)
    return rules


def rules_from(ignore_text: str | None) -> dict:
    own = parse_ignore(ignore_text) if ignore_text else {"exempt": [], "unclear": []}
    return {"exempt": DEFAULT_EXEMPT + own["exempt"], "unclear": DEFAULT_UNCLEAR + own["unclear"]}


_COMPILED: dict[str, re.Pattern] = {}


def matches_any(rel: str, patterns: list[str]) -> bool:
    for p in patterns:
        if p not in _COMPILED:
            _COMPILED[p] = glob_to_regex(p)
        if _COMPILED[p].fullmatch(rel):
            return True
    return False


def is_test_file(rel: str) -> bool:
    return matches_any(rel, TEST_GLOBS)


def has_real_tests(text: str) -> bool:
    """At least one test that runs: `test.todo(`, `it.skip(` and `xit(` do not count."""
    return bool(re.search(r"\b(?:it|test|describe)\s*\(|\bdef test_|\bfunc Test[A-Z_]|\btestWidgets\s*\(", text, A))


def feature_from_branch(branch: str, dirs: list[str]) -> str | None:
    """`001-login` or `feature/001-login-v2` names the one feature folder starting with `001-`."""
    m = re.search(r"(?:^|/)(\d{3,})-", branch or "", A)
    if not m:
        return None
    hits = [d for d in dirs if d.rsplit("/", 1)[-1].startswith(m.group(1) + "-")]
    return hits[0] if len(hits) == 1 else None


def local_id(rid: str, feature_dir: str | None) -> str | None:
    """The bare id of an anchor or link (`001-auth/FR-003` -> `FR-003`) when it belongs to `feature_dir`, else None."""
    if "/" not in rid:
        return rid
    feature, bare = rid.rsplit("/", 1)
    return bare if feature_dir and feature_dir.rsplit("/", 1)[-1] == feature else None


# ---------------------------------------------------------------------------
# Proof (mirror mod/hooks/proof.ts): the coverage ladder and test results

LADDER = ["specified", "planned", "implemented", "tested", "passing"]


def is_active(req: dict) -> bool:
    return (req.get("status") or req_status(req["text"])["status"]) == "active"


def owners(rid: str, snap: dict, ledger: dict) -> list[dict]:
    """The tasks that own a requirement: those naming it, and those mapped to it."""
    mapped = set((ledger["requirements"].get(rid) or {}).get("tasks", []))
    return [t for t in snap["tasks"] if rid in t["reqs"] or t["id"] in mapped]


def is_stale(rid: str, snap: dict, ledger: dict) -> bool:
    """Whether the stored fingerprint says the requirement's text changed since it was last proven."""
    stored = ledger["fingerprints"].get(rid)
    req = next((r for r in snap["reqs"] if r["id"] == rid), None)
    return bool(stored) and req is not None and stored != fingerprint(req["text"])


def level_of(rid: str, snap: dict, ledger: dict) -> str:
    """The rung a requirement stands on; `snap` carries featureDir, tasks, reqs and realTests (§4)."""
    level = _raw_level(rid, snap, ledger)
    # A changed requirement needs new proof: whatever it had, it is planned at most.
    return "planned" if is_stale(rid, snap, ledger) and LADDER.index(level) > 1 else level


def _raw_level(rid: str, snap: dict, ledger: dict) -> str:
    own = owners(rid, snap, ledger)
    if not own:
        return "specified"
    anchored = [a["file"] for a in ledger["anchors"] if local_id(a["id"], snap["featureDir"]) == rid]
    linked = (ledger["requirements"].get(rid) or {}).get("files", [])
    touched = [f for t in own for f in (ledger["tasks"].get(t["id"]) or {}).get("touched", [])]
    if not any(t["done"] for t in own) or not any(not is_test_file(f) for f in anchored + linked + touched):
        return "planned"
    real = set(snap.get("realTests") or [])
    if not any(is_test_file(f) and f in real for f in anchored + linked):
        return "implemented"
    req = next((r for r in snap["reqs"] if r["id"] == rid), None)
    v = ledger["verification"].get(rid) or {}
    return "passing" if v.get("status") == "passing" and req and v.get("fingerprint") == fingerprint(req["text"]) else "tested"


def _unescape(text: str) -> str:
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")


def _attr(tag: str, name: str) -> str:
    m = re.search(r"\s" + name + r"\s*=\s*(\"([^\"]*)\"|'([^']*)')", tag)
    if not m:
        return ""
    return _unescape(m.group(2) if m.group(2) is not None else m.group(3) or "")


def parse_junit(xml: str) -> list[dict]:
    """Every <testcase> with name, classname, file and passed, failed or skipped (§9)."""
    cases = []
    for m in re.finditer(r"<testcase\b([^>]*?)(/>|>([\s\S]*?)</testcase>)", xml):
        tag, body = m.group(1) or "", m.group(3) or ""
        status = "failed" if re.search(r"<(failure|error)\b", body) else "skipped" if re.search(r"<skipped\b", body) else "passed"
        cases.append({"name": _attr(tag, "name"), "classname": _attr(tag, "classname"), "file": _attr(tag, "file"), "status": status})
    return cases


TEST_IDS = re.compile(r"\b(?:(?:FR|SC)-\d{3,}|US\d+-AS\d+)\b", A)


def verification_from(cases: list[dict], anchors: list[dict], fingerprints: dict, feature_dir: str | None, at: str, commit: str) -> dict:
    """Per requirement or scenario: failing if a test that names or anchors it failed, else passing if one passed."""
    by_id: dict[str, dict] = {}
    for c in cases:
        if c["status"] == "skipped":
            continue
        ids = dict.fromkeys(TEST_IDS.findall(f"{c['name']} {c['classname']}"))
        for a in anchors:
            rid = local_id(a["id"], feature_dir) if c["file"] and a["file"] == c["file"] else None
            if rid:
                ids.setdefault(rid, None)
        label = f"{c['classname']}.{c['name']}" if c["classname"] else c["name"]
        for rid in ids:
            entry = by_id.setdefault(rid, {"failed": False, "passed": False, "tests": set()})
            entry["failed" if c["status"] == "failed" else "passed"] = True
            entry["tests"].add(label)
    return {
        rid: {"status": "failing" if e["failed"] else "passing", "tests": sorted(e["tests"])[:10], "at": at, "commit": commit, "fingerprint": fingerprints.get(rid, "")}
        for rid, e in by_id.items()
    }


def verification_from_exit(exit_code: int, ids: list[str], fingerprints: dict, at: str, commit: str) -> dict:
    """Without JUnit: a suite that exits 0 proves the requirements that have a real test; a failing one proves nothing."""
    if exit_code != 0:
        return {}
    return {rid: {"status": "passing", "tests": ["<suite>"], "at": at, "commit": commit, "fingerprint": fingerprints.get(rid, "")} for rid in ids}


# ---------------------------------------------------------------------------
# X-Ref and drift (mirror mod/hooks/xref.ts)

ANCHOR = re.compile(r"@spec\s+((?:[\w.-]+/)?(?:(?:FR|SC)-\d{3,}|T-?\d{3,}|US\d+-AS\d+))", A)
RANK = {"none": 0, "green": 1, "yellow": 2, "red": 3}
MAX_UNPLANNED = 100


def is_spec_artifact(rel: str) -> bool:
    """Spec Kit's own files and the agent's configuration are never drift; CI workflows are code."""
    return (bool(re.match(r"^(specs|\.specify|\.claude|\.github)/", rel)) and not rel.startswith(".github/workflows/")) or rel in ("CLAUDE.md", "AGENTS.md")


def path_matches(rel: str, planned: str) -> bool:
    p = re.sub(r"^\./", "", planned)
    if rel == p:
        return True
    if p.endswith("/"):
        return rel.startswith(p)
    if rel.endswith("/" + p):
        return True
    if "/" not in p and "." not in p:
        return False
    if rel.startswith(p + "/"):
        return True
    return "/" not in p and rel.rsplit("/", 1)[-1] == p


def plans(task: dict, rel: str) -> bool:
    """A task plans a file it names always; a folder it names only while the task is open."""
    for p in task["paths"]:
        is_folder = p.endswith("/") or rel.startswith(re.sub(r"^\./", "", p) + "/")
        if path_matches(rel, p) and (not is_folder or not task["done"]):
            return True
    return False


def anchors_in(text: str, file: str) -> list[dict]:
    return [{"id": m.group(1), "file": file, "line": i + 1} for i, line in enumerate(text.split("\n")) for m in ANCHOR.finditer(line)]


def classify_core(rel: str, snap: dict, ledger: dict, rules: dict | None = None, new_text: str = "") -> tuple[str, str | None]:
    """The shared classification (§3), first match wins; the batch check reports it as it is."""
    rules = rules or {"exempt": [], "unclear": []}
    if is_spec_artifact(rel):
        return "spec", None
    if matches_any(rel, rules["exempt"]):
        return "exempt", None
    for tid, entry in ledger["tasks"].items():
        if rel in entry.get("linked", []):
            return "task-linked", tid
    # The task that plans a file comes before its anchors: it says which task the work is on.
    matches = [t for t in snap["tasks"] if plans(t, rel)]
    if matches:
        return "planned", next((t for t in matches if not t["done"]), matches[0])["id"]
    if new_text and anchors_in(new_text, rel):
        return "linked", None
    if any(rel in r.get("files", []) for r in ledger["requirements"].values()) or any(a["file"] == rel for a in ledger["anchors"]):
        return "linked", None
    if matches_any(rel, rules["unclear"]):
        return "unclear", None
    if not snap["tasks"]:
        return "untracked", None
    return "unplanned", None


def proof_snap(snap: dict) -> dict:
    """What the ladder reads from a snapshot."""
    return {"featureDir": snap["featureDir"], "tasks": snap["tasks"], "reqs": (snap.get("spec") or {}).get("reqs", []), "realTests": snap.get("realTests") or []}


def evaluate(snap: dict, ledger: dict, semantic: bool = False) -> dict:
    """The drift report (§8). The intent check counts only with `semantic`; the extension's exit code never passes it."""
    findings: list[dict] = []
    open_edits = [u for u in ledger["unplanned"] if not u.get("acknowledged")]
    for u in open_edits:
        findings.append({"kind": "unplanned", "level": "yellow", "file": u["file"], "text": f"{u['file']} is not planned for any task"})
    if len(open_edits) >= 3:
        findings.append({"kind": "unplanned", "level": "red", "text": f"{len(open_edits)} edits outside the planned files"})
    spec = snap.get("spec") or {}
    reqs = spec.get("reqs", [])
    by_id = {r["id"]: r for r in reqs}
    known = {r["id"] for r in reqs if is_active(r)} | {t["id"] for t in snap["tasks"]} | {x["id"] for s in spec.get("stories", []) for x in s.get("scenarios", [])}
    for a in ledger["anchors"]:
        bare = local_id(a["id"], snap["featureDir"])
        if not bare or bare in known:
            continue
        old = by_id.get(bare)
        why = ("which is " + (f"superseded by {old['supersededBy']}" if old.get("supersededBy") else "retired")) if old else "which the spec no longer has"
        test = is_test_file(a["file"])
        verb = "tests" if test else "anchors"
        findings.append({"kind": "orphan-test" if test else "dangling", "level": "yellow", "file": a["file"], "id": bare, "text": f"{a['file']}:{a['line']} {verb} {a['id']}, {why}"})
    proof = proof_snap(snap)
    for r in reqs:
        if is_active(r) and is_stale(r["id"], proof, ledger):
            findings.append({"kind": "re-verify", "level": "yellow", "id": r["id"], "text": f"{r['id']} changed since it was last proven; it needs new proof"})
    s = ledger.get("semantic")
    if s and semantic:
        if s["verdict"] == "drift" or s["score"] < 50:
            findings.append({"kind": "semantic", "level": "red", "text": f"Intent check {s['score']}/100: {(s.get('reasons') or ['the change drifts from the spec'])[0]}"})
        elif s["verdict"] == "minor" or s["score"] < 80:
            findings.append({"kind": "semantic", "level": "yellow", "text": f"Intent check {s['score']}/100: {(s.get('reasons') or ['minor drift'])[0]}"})
        for c in s.get("changes", []):
            what = "which contradicts the spec" if c["kind"] == "contradicts" else "which the spec does not cover"
            findings.append({"kind": "intent", "level": "red" if c["kind"] == "contradicts" else "yellow", "intent": c["text"], "text": f'User asked: "{c["text"]}", {what}'})
    frs = [r for r in reqs if r.get("kind", "FR") == "FR" and is_active(r)]
    levels = {rung: 0 for rung in LADDER}
    uncovered = []
    for r in frs:
        rung = level_of(r["id"], proof, ledger)
        levels[rung] += 1
        if rung == "specified":
            uncovered.append(r["id"])
    notes = [f"{st['id']} has no acceptance scenarios" for st in spec.get("stories", []) if not st.get("scenarios")]
    if not snap["featureDir"]:
        level = "none"
    elif any(f["level"] == "red" for f in findings):
        level = "red"
    else:
        level = "yellow" if findings else "green"
    return {
        "level": level,
        "findings": findings,
        "covered": len(frs) - len(uncovered),
        "total": len(frs),
        "uncovered": uncovered,
        "done": sum(1 for t in snap["tasks"] if t["done"]),
        "tasks": len(snap["tasks"]),
        "levels": levels,
        "notes": notes,
    }


def quotes(logged: str, quoted: str) -> bool:
    return quoted in logged or logged[:40] in quoted


def first_json(text: str):
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def parse_semantic(text: str, at: str) -> dict | None:
    raw = first_json(text)
    if not isinstance(raw, dict) or not isinstance(raw.get("score"), (int, float)) or isinstance(raw.get("score"), bool):
        return None
    score = raw["score"]
    verdict = raw.get("verdict")
    if verdict not in ("aligned", "minor", "drift"):
        verdict = "aligned" if score >= 80 else "minor" if score >= 50 else "drift"
    reasons = [r for r in raw.get("reasons", []) if isinstance(r, str)][:3] if isinstance(raw.get("reasons"), list) else []
    changes = []
    if isinstance(raw.get("intent_changes"), list):
        for c in raw["intent_changes"]:
            if isinstance(c, dict) and isinstance(c.get("text"), str):
                changes.append({"text": c["text"][:200], "kind": "contradicts" if c.get("kind") == "contradicts" else "extends"})
    return {"score": max(0, min(100, round(score))), "verdict": verdict, "reasons": reasons, "changes": changes[:5], "at": at}


def apply_semantic(ledger: dict, semantic: dict) -> dict:
    resolved = [i for i in ledger["intents"] if i["status"] == "resolved"]
    changes = [c for c in semantic["changes"] if not any(quotes(i["text"], c["text"]) for i in resolved)]
    intents = []
    for i in ledger["intents"]:
        hit = next((c for c in changes if i["status"] == "logged" and quotes(i["text"], c["text"])), None)
        intents.append({**i, "status": hit["kind"]} if hit else i)
    verdict = {**semantic, "changes": changes}
    return {**ledger, "intents": intents, "semantic": verdict, "semanticHistory": (ledger["semanticHistory"] + [verdict])[-MAX_HISTORY:]}


def link(ledger: dict, rel: str, rid: str, snap: dict, source: str = "link") -> tuple[dict, str | None]:
    """Ties a file to a task, requirement or scenario; a file once unplanned stops counting."""
    bare = local_id(rid, snap["featureDir"])
    if not bare:
        return ledger, f"{rid} names another feature than {snap['featureDir'] or 'the active one'}"
    ledger = json.loads(json.dumps(ledger))
    spec = snap["spec"] or {"reqs": [], "stories": []}
    if re.match(r"^T\d{3,}$", bare, A):
        if not any(t["id"] == bare for t in snap["tasks"]):
            return ledger, f"{bare} is no task in tasks.md"
        entry = ledger["tasks"].setdefault(bare, {"touched": [], "linked": []})
        if rel not in entry["linked"]:
            entry["linked"].append(rel)
    elif re.match(r"^(FR|SC)-\d{3,}$", bare, A) or re.match(r"^US\d+-AS\d+$", bare, A):
        known = any(r["id"] == bare for r in spec["reqs"]) or any(x["id"] == bare for s in spec["stories"] for x in s.get("scenarios", []))
        if not known:
            return ledger, f"{bare} is no requirement or acceptance scenario in spec.md"
        entry = ledger["requirements"].setdefault(bare, {"tasks": [], "files": [], "sources": []})
        if rel not in entry["files"]:
            entry["files"].append(rel)
        if source not in entry["sources"]:
            entry["sources"].append(source)
    else:
        return ledger, f"{rid} is neither a task (T###), a requirement (FR-### / SC-###) nor a scenario (US1-AS1)"
    ledger["unplanned"] = [{**u, "acknowledged": True} if u["file"] == rel else u for u in ledger["unplanned"]]
    # The text a link was made against: when it changes, the link needs new proof.
    req = next((r for r in spec["reqs"] if r["id"] == bare), None)
    if req:
        ledger["fingerprints"][bare] = fingerprint(req["text"])
    return ledger, None


def apply_mapping(ledger: dict, raw: object, snap: dict, source: str = "llm") -> tuple[dict, int]:
    if not isinstance(raw, dict):
        return ledger, 0
    reqs = {r["id"]: r for r in (snap["spec"] or {"reqs": []})["reqs"]}
    task_ids = {t["id"] for t in snap["tasks"]}
    ledger = json.loads(json.dumps(ledger))
    mapped = 0
    for rid, value in raw.items():
        if rid not in reqs or not isinstance(value, list):
            continue
        tasks = [t for t in value if isinstance(t, str) and t in task_ids]
        entry = ledger["requirements"].setdefault(rid, {"tasks": [], "files": [], "sources": []})
        entry["tasks"] = list(dict.fromkeys(entry["tasks"] + tasks))
        if source not in entry["sources"]:
            entry["sources"].append(source)
        if tasks:
            mapped += 1
            # The text it was mapped against (§1): a later change asks for new proof.
            ledger["fingerprints"][rid] = fingerprint(reqs[rid]["text"])
    return ledger, mapped


# ---------------------------------------------------------------------------
# The ledger, v2 (mirror mod/hooks/ledger.ts): committed half and local half

COMMITTED_KEYS = {"schema_version", "feature", "map", "links", "accepted", "fingerprints"}
LOCAL_KEYS = {"schema_version", "feature", "touched", "unplanned", "intents", "semantic", "semanticHistory", "verification", "approvals", "decisions", "anchors"}
MAX_HISTORY = 10


def empty_ledger() -> dict:
    return {
        "tasks": {},
        "requirements": {},
        "unplanned": [],
        "intents": [],
        "anchors": [],
        "semantic": None,
        "semanticHistory": [],
        "fingerprints": {},
        "verification": {},
        "approvals": {},
        "decisions": [],
        # Top-level keys of either file this script does not know (the mod's run state, say): written back as they were.
        "extra": {"committed": {}, "local": {}},
    }


def _obj(value) -> dict:
    return value if isinstance(value, dict) else {}


def _arr(value) -> list:
    return value if isinstance(value, list) else []


def _strs(value) -> list[str]:
    return [x for x in _arr(value) if isinstance(x, str)]


def migrate_v1(v1: dict) -> tuple[dict, dict]:
    """A v1 ledger (one file, `schema_version` 1 or none) as the two v2 halves."""
    map_: dict[str, list[str]] = {}
    links: dict[str, list[str]] = {}

    def add(file: str, rid: str) -> None:
        links[file] = sorted(set(links.get(file, []) + [rid]))

    for rid, r in _obj(v1.get("requirements")).items():
        entry = _obj(r)
        if _strs(entry.get("tasks")):
            map_[rid] = sorted(set(_strs(entry.get("tasks"))))
        for file in _strs(entry.get("files")):
            add(file, rid)
    touched: dict[str, list[str]] = {}
    for tid, t in _obj(v1.get("tasks")).items():
        entry = _obj(t)
        for file in _strs(entry.get("linked")):
            add(file, tid)
        if _strs(entry.get("touched")):
            touched[tid] = _strs(entry.get("touched"))
    unplanned = [u for u in _arr(v1.get("unplanned")) if isinstance(u, dict)]
    committed = {
        "schema_version": 2,
        "feature": v1.get("feature"),
        "map": map_,
        "links": links,
        "accepted": sorted({str(u.get("file")) for u in unplanned if u.get("acknowledged") is True}),
        "fingerprints": {},
    }
    local = {
        "schema_version": 2,
        "feature": v1.get("feature"),
        "touched": touched,
        "unplanned": [{"file": u.get("file"), "at": u.get("at"), "task": u.get("task")} for u in unplanned if u.get("acknowledged") is not True],
        "intents": _arr(v1.get("intents")),
        "semantic": v1.get("semantic"),
        "semanticHistory": [],
        "verification": {},
        "approvals": {},
        "decisions": [],
        "anchors": _arr(v1.get("anchors")),
    }
    return committed, local


def ledger_from_parts(committed: dict | None, local: dict | None) -> dict:
    """The in-memory ledger from both halves (§1); a v1 committed file is migrated on the way in."""
    committed = _obj(committed) if committed is not None else None
    local = _obj(local)
    if committed is not None and committed.get("schema_version") != 2:
        migrated, migrated_local = migrate_v1(committed)
        committed = migrated
        # A local file next to a v1 ledger is newer than the migration; it wins where it says something.
        local = {**migrated_local, **local}
    committed = committed or {}
    ledger = empty_ledger()
    for rid, tasks in _obj(committed.get("map")).items():
        if _strs(tasks):
            ledger["requirements"][rid] = {"tasks": _strs(tasks), "files": [], "sources": ["map"]}
    for file, ids in _obj(committed.get("links")).items():
        for rid in _strs(ids):
            if re.match(r"^T-?\d{3,}$", rid, A):
                entry = ledger["tasks"].setdefault(rid, {"touched": [], "linked": []})
                if file not in entry["linked"]:
                    entry["linked"].append(file)
            else:
                entry = ledger["requirements"].setdefault(rid, {"tasks": [], "files": [], "sources": []})
                if file not in entry["files"]:
                    entry["files"].append(file)
                if "link" not in entry["sources"]:
                    entry["sources"].append("link")
    for tid, files in _obj(local.get("touched")).items():
        ledger["tasks"].setdefault(tid, {"touched": [], "linked": []})["touched"] = _strs(files)
    ledger["unplanned"] = [
        {"file": str(u.get("file")), "at": str(u["at"]) if u.get("at") is not None else "", "task": u["task"] if isinstance(u.get("task"), str) else None, "acknowledged": False}
        for u in _arr(local.get("unplanned"))
        if isinstance(u, dict)
    ] + [{"file": f, "at": "", "task": None, "acknowledged": True} for f in _strs(committed.get("accepted"))]
    ledger["fingerprints"] = {k: v for k, v in _obj(committed.get("fingerprints")).items() if isinstance(v, str)}
    ledger["intents"] = _arr(local.get("intents"))
    ledger["anchors"] = _arr(local.get("anchors"))
    ledger["semantic"] = local.get("semantic")
    ledger["semanticHistory"] = _arr(local.get("semanticHistory"))
    ledger["verification"] = _obj(local.get("verification"))
    ledger["approvals"] = _obj(local.get("approvals"))
    ledger["decisions"] = _arr(local.get("decisions"))
    ledger["extra"] = {
        "committed": {k: v for k, v in committed.items() if k not in COMMITTED_KEYS},
        "local": {k: v for k, v in local.items() if k not in LOCAL_KEYS},
    }
    return ledger


def ledger_to_parts(ledger: dict, feature_dir: str) -> tuple[dict, dict]:
    """Both halves of a ledger; the committed one holds no timestamps."""
    map_: dict[str, list[str]] = {}
    links: dict[str, list[str]] = {}
    for rid, r in ledger["requirements"].items():
        if r.get("tasks"):
            map_[rid] = sorted(set(r["tasks"]))
        for file in r.get("files", []):
            links.setdefault(file, []).append(rid)
    touched: dict[str, list[str]] = {}
    for tid, t in ledger["tasks"].items():
        for file in t.get("linked", []):
            links.setdefault(file, []).append(tid)
        if t.get("touched"):
            touched[tid] = t["touched"]
    links = {file: sorted(set(ids)) for file, ids in links.items()}
    # An accepted file that was linked since is the link's, not an acceptance.
    accepted = sorted({u["file"] for u in ledger["unplanned"] if u.get("acknowledged") and u["file"] not in links})
    committed = {**ledger["extra"]["committed"], "schema_version": 2, "feature": feature_dir, "map": map_, "links": links, "accepted": accepted, "fingerprints": ledger["fingerprints"]}
    local = {
        **ledger["extra"]["local"],
        "schema_version": 2,
        "feature": feature_dir,
        "touched": touched,
        "unplanned": [{"file": u["file"], "at": u["at"], "task": u["task"]} for u in ledger["unplanned"] if not u.get("acknowledged")],
        "intents": ledger["intents"],
        "semantic": ledger["semantic"],
        "semanticHistory": ledger["semanticHistory"][-MAX_HISTORY:],
        "verification": ledger["verification"],
        "approvals": ledger["approvals"],
        "decisions": ledger["decisions"],
        "anchors": ledger["anchors"],
    }
    return committed, local


def committed_json(committed: dict) -> str:
    """Keys sorted at every level, 2-space indent, a final newline: the same state is the same bytes, in both tools."""
    return json.dumps(committed, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# The project on disk


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def find_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / ".specify").is_dir():
            return candidate
    return start


def read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def rel_path(file: str, root: Path) -> str:
    path = file.replace("\\", "/")
    base = str(root).replace("\\", "/").rstrip("/")
    if path.startswith(base + "/"):
        path = path[len(base) + 1 :]
    return re.sub(r"^\./", "", path)


def run(argv: list[str], cwd: Path) -> str | None:
    try:
        done = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode in (0, 1) else None


def parse_feature_json(text: str | None) -> str | None:
    try:
        value = json.loads(text or "")
    except json.JSONDecodeError:
        return None
    directory = value.get("feature_directory") if isinstance(value, dict) else None
    return directory if isinstance(directory, str) and directory else None


def feature_dirs(root: Path) -> list[str]:
    """Every feature folder with a spec.md."""
    dirs = []
    for folder in ("specs", ".specify/specs"):
        base = root / folder
        if base.is_dir():
            dirs += sorted(f"{folder}/{e.name}" for e in base.iterdir() if (e / "spec.md").is_file())
    return dirs


def resolve_feature(root: Path, explicit: str | None, base: str | None = None) -> str:
    """§7: --feature, Spec Kit's pointers, the branch, the diff, else the spec written last (under CI: a lone feature, else an error)."""
    if explicit:
        rel = rel_path(explicit, root).rstrip("/")
        if (root / rel / "spec.md").is_file():
            return rel
        fail(f"{explicit} holds no spec.md")
    named = os.environ.get("SPECIFY_FEATURE")
    for pointer in (os.environ.get("SPECIFY_FEATURE_DIRECTORY"), parse_feature_json(read(root / ".specify/feature.json")), f"specs/{named}" if named else None):
        if pointer:
            rel = rel_path(pointer, root).rstrip("/")
            if (root / rel / "spec.md").is_file():
                return rel
    dirs = feature_dirs(root)
    branch = os.environ.get("GITHUB_HEAD_REF") or (run(["git", "rev-parse", "--abbrev-ref", "HEAD"], root) or "").strip()
    hit = feature_from_branch(branch, dirs)
    if hit:
        return hit
    if base:
        diff = diff_files(root, base)
        touched = [d for d in dirs if any(f.startswith(d + "/") for f in diff) or any(plans(t, f) for t in parse_tasks(read(root / d / "tasks.md") or "") for f in diff)]
        if len(touched) == 1:
            return touched[0]
    if not dirs:
        fail("No Spec Kit feature found (specs/NNN-*/spec.md). Create one with the specify command first.")
    if os.environ.get("CI") and len(dirs) == 1:
        return dirs[0]
    if os.environ.get("CI"):
        # In CI the newest file is whatever the checkout wrote last: with several features, refuse to guess.
        fail(f"Cannot tell which feature to check (candidates: {', '.join(dirs)}). Pass --feature, set SPECIFY_FEATURE_DIRECTORY, or name the branch NNN-<feature>.")
    best, best_time = dirs[0], -1.0
    for d in dirs:
        times = [p.stat().st_mtime for p in (root / d / "tasks.md", root / d / "spec.md") if p.is_file()]
        if times and max(times) > best_time:
            best, best_time = d, max(times)
    return best


def snapshot(root: Path, feature_dir: str | None) -> dict:
    spec_md = read(root / feature_dir / "spec.md") if feature_dir else None
    tasks_md = read(root / feature_dir / "tasks.md") if feature_dir else None
    constitution_md = read(root / ".specify/memory/constitution.md")
    return {
        "featureDir": feature_dir,
        "spec": parse_spec(spec_md) if spec_md else None,
        "tasks": parse_tasks(tasks_md) if tasks_md else [],
        "constitution": parse_constitution(constitution_md) if constitution_md else None,
        "realTests": [],
    }


def committed_path(feature_dir: str) -> str:
    return f"{feature_dir}/xref.json"


def local_path(feature_dir: str) -> str:
    return f".specify/xref/local/{feature_dir.rstrip('/').rsplit('/', 1)[-1]}.json"


def load_ledger(root: Path, feature_dir: str) -> dict:
    def parsed(rel: str):
        text = read(root / rel)
        if not text:
            return None
        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            return {}
        return value if isinstance(value, dict) else {}

    return ledger_from_parts(parsed(committed_path(feature_dir)), parsed(local_path(feature_dir)))


def save_ledger(root: Path, feature_dir: str, ledger: dict) -> None:
    """Writes both halves (only what changed) and `.specify/xref/.gitignore`, which keeps the local half out of git."""
    committed, local = ledger_to_parts(ledger, feature_dir)
    for rel, text in (
        (committed_path(feature_dir), committed_json(committed)),
        (local_path(feature_dir), json.dumps(local, indent=2, ensure_ascii=False) + "\n"),
    ):
        path = root / rel
        if read(path) != text:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    ignore = root / ".specify/xref/.gitignore"
    if not ignore.exists():
        ignore.write_text("local/\n", encoding="utf-8")


SKIP_DIRS = {".git", "node_modules", "specs", ".specify", ".venv", "venv", "dist", "build", ".dart_tool", "Pods", "__pycache__"}


def scan_anchors(root: Path) -> list[dict]:
    """Every `@spec <id>` comment outside the spec folders: ripgrep, else git grep, else a walk."""
    out = run(["rg", "-n", "--no-heading", "-o", "-e", r"@spec\s+(?:[\w.-]+/)?(?:(?:FR|SC)-\d{3,}|T-?\d{3,}|US\d+-AS\d+)", "--glob", "!specs/**", "--glob", "!.specify/**", "."], root)
    if out is None:
        pattern = "@spec[[:space:]]+([[:alnum:]_.-]+/)?((FR|SC)-[0-9]{3,}|T-?[0-9]{3,}|US[0-9]+-AS[0-9]+)"
        out = run(["git", "grep", "--untracked", "-n", "-o", "-E", pattern, "--", ".", ":!specs", ":!.specify"], root)
    anchors: list[dict] = []
    if out is not None:
        for line in out.split("\n"):
            m = re.match(r"^(.+?):(\d+):(.*)$", line)
            if m:
                anchors += [{**a, "line": int(m.group(2))} for a in anchors_in(m.group(3), rel_path(m.group(1), root))]
        return anchors
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            path = Path(folder) / name
            if path.stat().st_size > 1 << 20:
                continue
            text = read(path)
            if text and "@spec" in text:
                anchors += anchors_in(text, rel_path(str(path), root))
    return anchors


def real_tests(root: Path, ledger: dict) -> list[str]:
    """The test files, among those anchored, linked or touched, with at least one test that runs."""
    files = {a["file"] for a in ledger["anchors"]}
    files |= {f for r in ledger["requirements"].values() for f in r.get("files", [])}
    files |= {f for t in ledger["tasks"].values() for f in t.get("linked", []) + t.get("touched", [])}
    return sorted(f for f in files if is_test_file(f) and has_real_tests(read(root / f) or ""))


def diff_files(root: Path, base: str | None) -> list[str]:
    """Changed files relative to the project and only inside it: the project may be one folder of a larger repository.

    Against a base, the committed diff since the merge base (a pull request); without one, the working tree.
    """
    if base:
        runs = [["git", "diff", "--name-only", "--relative", f"{base}...HEAD"]]
    else:
        runs = [["git", "diff", "--name-only", "--relative", "HEAD"], ["git", "ls-files", "--others", "--exclude-standard"]]
    files: dict[str, None] = {}
    for argv in runs:
        for line in (run(argv, root) or "").split("\n"):
            if line.strip():
                files.setdefault(line.strip(), None)
    return list(files)


def changed_files(root: Path, base: str | None) -> list[str]:
    return [f for f in diff_files(root, base) if not is_spec_artifact(f)]


def git_head(root: Path, short: bool = False) -> str:
    return (run(["git", "rev-parse", *(["--short"] if short else []), "HEAD"], root) or "").strip()


# ---------------------------------------------------------------------------
# Subcommands


def fail(message: str) -> None:
    """A usage or feature resolution error: exit 2, the message on stderr."""
    print(json.dumps({"error": message}), file=sys.stderr)
    raise SystemExit(2)


def emit(args, data: dict, text: str) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False) if args.json else text)


def context(args, scan: bool = False) -> tuple[Path, dict, dict]:
    root = find_root(Path(args.root).resolve() if args.root else Path.cwd())
    feature_dir = resolve_feature(root, args.feature, getattr(args, "base", None))
    snap = snapshot(root, feature_dir)
    ledger = load_ledger(root, feature_dir)
    if scan:
        ledger["anchors"] = scan_anchors(root)
    return root, snap, ledger


def report_of(root: Path, snap: dict, ledger: dict, semantic: bool = False) -> dict:
    snap["realTests"] = real_tests(root, ledger)
    return evaluate(snap, ledger, semantic)


def book_changes(root: Path, snap: dict, ledger: dict, base: str | None) -> list[dict]:
    """Classifies the changed files and books them in the in-memory ledger: touched for a task, or open drift."""
    rules = rules_from(read(root / ".xrefignore"))
    at = now()
    accepted = {u["file"] for u in ledger["unplanned"] if u.get("acknowledged")}
    changed = []
    for rel in changed_files(root, base):
        verdict, task = classify_core(rel, snap, ledger, rules)
        if verdict == "exempt":
            continue
        changed.append({"file": rel, "verdict": verdict, "task": task})
        if task and verdict in ("planned", "task-linked"):
            entry = ledger["tasks"].setdefault(task, {"touched": [], "linked": []})
            if rel not in entry["touched"]:
                entry["touched"].append(rel)
        # An accepted file stays accepted: the batch sees the whole diff on every run.
        if verdict == "unplanned" and rel not in accepted and not any(u["file"] == rel and not u.get("acknowledged") for u in ledger["unplanned"]):
            ledger["unplanned"] = (ledger["unplanned"] + [{"file": rel, "at": at, "task": None, "acknowledged": False}])[-MAX_UNPLANNED:]
    return changed


def read_junit(files: list[str]) -> list[dict]:
    cases: list[dict] = []
    for file in files:
        text = read(Path(file))
        if text is None:
            fail(f"Cannot read {file}")
        cases += parse_junit(text)
    return cases


def junit_in_memory(snap: dict, ledger: dict, files: list[str] | None) -> None:
    """Test results for this run's output only (summary, check): never written, and no fingerprint moves."""
    if not files:
        return
    current = {r["id"]: fingerprint(r["text"]) for r in (snap["spec"] or {"reqs": []})["reqs"]}
    ledger["verification"] = {**ledger["verification"], **verification_from(read_junit(files), ledger["anchors"], current, snap["featureDir"], now(), "")}


def requirement_rows(snap: dict, ledger: dict) -> list[dict]:
    proof = proof_snap(snap)
    rows = []
    for r in proof["reqs"]:
        entry = ledger["requirements"].get(r["id"], {})
        tasks = list(dict.fromkeys([t["id"] for t in snap["tasks"] if r["id"] in t["reqs"]] + entry.get("tasks", [])))
        anchors = [f"{a['file']}:{a['line']}" for a in ledger["anchors"] if local_id(a["id"], snap["featureDir"]) == r["id"]]
        files = list(dict.fromkeys(entry.get("files", []) + [f for t in tasks for f in ledger["tasks"].get(t, {}).get("touched", [])]))
        active = is_active(r)
        level = level_of(r["id"], proof, ledger) if active else None
        if level and r["kind"] == "SC":
            # Success criteria are measured outside the code: they stop at planned.
            level = "specified" if level == "specified" else "planned"
        rows.append(
            {
                "id": r["id"],
                "kind": r["kind"],
                "text": r["text"],
                "status": r.get("status", "active"),
                "supersededBy": r.get("supersededBy"),
                "level": level,
                "tasks": tasks,
                "files": files,
                "anchors": anchors,
                "covered": level != "specified" if r["kind"] == "FR" and active else None,
                "verification": (ledger["verification"].get(r["id"]) or {}).get("status"),
                "needsClarification": r["needsClarification"],
            }
        )
    return rows


def metrics_of(snap: dict, ledger: dict, with_intents: bool = True) -> dict:
    """§13, from the ledger alone. A linked file no task plans counts as an unplanned edit that was linked later."""
    linked = {f for r in ledger["requirements"].values() for f in r.get("files", [])} | {f for t in ledger["tasks"].values() for f in t.get("linked", [])}
    open_files = {u["file"] for u in ledger["unplanned"] if not u.get("acknowledged")}
    accepted = {u["file"] for u in ledger["unplanned"] if u.get("acknowledged") and u["file"] not in linked}
    later = {f for f in linked if f not in open_files and not any(plans(t, f) for t in snap["tasks"])}
    caught = len(open_files) + len(accepted) + len(later)
    out: dict = {
        "unplanned": {
            "caught": caught,
            "accepted": len(accepted),
            "linked": len(later),
            "open": len(open_files),
            "blindAcceptShare": round(len(accepted) / caught, 2) if caught else 0,
        }
    }
    if with_intents:
        count = {k: sum(1 for i in ledger["intents"] if i.get("status") == k) for k in ("extends", "contradicts", "resolved")}
        beyond = count["extends"] + count["contradicts"] + count["resolved"]
        out["intents"] = {"beyond": beyond, **count, "reachedShare": round(count["resolved"] / beyond, 2) if beyond else 0}
    return out


def cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def ladder_line(report: dict) -> str:
    return " · ".join(f"{rung} {report['levels'][rung]}" for rung in reversed(LADDER))


def advice_of(ledger: dict) -> dict | None:
    s = ledger.get("semantic")
    return {"score": s.get("score"), "verdict": s.get("verdict"), "reasons": s.get("reasons", []), "at": s.get("at")} if isinstance(s, dict) else None


def cmd_map(args) -> None:
    root, snap, ledger = context(args, scan=True)
    mapped = 0
    if args.apply:
        text = read(Path(args.apply))
        if text is None:
            fail(f"Cannot read {args.apply}")
        ledger, mapped = apply_mapping(ledger, first_json(text), snap, args.source)
    save_ledger(root, snap["featureDir"], ledger)
    report = report_of(root, snap, ledger)
    data = {
        "feature": snap["featureDir"],
        "ledger": committed_path(snap["featureDir"]),
        "local": local_path(snap["featureDir"]),
        "mapped": mapped,
        "coverage": {"covered": report["covered"], "total": report["total"], "uncovered": report["uncovered"]},
        "levels": report["levels"],
        "requirements": requirement_rows(snap, ledger),
        "tasks": [{k: t[k] for k in ("id", "done", "story", "text", "paths", "reqs", "phase")} for t in snap["tasks"]],
    }
    lines = [f"{snap['featureDir']}: FR covered {report['covered']}/{report['total']} · {ladder_line(report)}" + (f", mapped {mapped}" if args.apply else "")]
    lines += [f"  {r['id']} -> {', '.join(r['tasks']) or '-'} ({r['level'] or r['status']})" for r in data["requirements"] if r["kind"] == "FR"]
    emit(args, data, "\n".join(lines))


def cmd_link(args) -> None:
    root, snap, ledger = context(args)
    if args.req:
        if not args.task:
            fail("--req needs --task")
        ledger, mapped = apply_mapping(ledger, {args.req: [args.task]}, snap, args.source)
        error = None if mapped else f"{args.req} or {args.task} is unknown"
        what = f"{args.req} to {args.task}"
    else:
        if not (args.file and args.id):
            fail("link needs --file and --id, or --req and --task")
        ledger, error = link(ledger, rel_path(str(Path(args.file).resolve()) if Path(args.file).exists() else args.file, root), args.id, snap, args.source)
        what = f"{args.file} to {args.id}"
    if error:
        fail(error)
    save_ledger(root, snap["featureDir"], ledger)
    report = report_of(root, snap, ledger)
    emit(args, {"linked": what, "level": report["level"]}, f"Linked {what}. Drift: {report['level']}.")


def cmd_check(args) -> None:
    root, snap, ledger = context(args, scan=True)
    changed = book_changes(root, snap, ledger, args.base)
    if not args.no_write:
        save_ledger(root, snap["featureDir"], ledger)
    junit_in_memory(snap, ledger, args.junit)
    # The exit code rests on deterministic findings only; the intent check is advice, test results move the ladder.
    report = report_of(root, snap, ledger)
    spec = snap["spec"] or {}
    data = {
        "feature": snap["featureDir"],
        "level": report["level"],
        "findings": report["findings"],
        "notes": report["notes"],
        "changed": changed,
        "coverage": {"covered": report["covered"], "total": report["total"], "uncovered": report["uncovered"]},
        "levels": report["levels"],
        "tasks": {"done": report["done"], "total": report["tasks"]},
        "spec": {"title": spec.get("title"), "input": spec.get("input"), "outOfScope": spec.get("outOfScope", []), "requirements": [{"id": r["id"], "text": r["text"]} for r in spec.get("reqs", [])]},
        "openIntents": [i["text"] for i in ledger["intents"] if i.get("status") != "resolved"][-10:],
        "advice": advice_of(ledger),
        "ledger": committed_path(snap["featureDir"]),
        "local": local_path(snap["featureDir"]),
        "written": not args.no_write,
    }
    lines = [f"{snap['featureDir']}: drift {report['level']} · tasks {report['done']}/{report['tasks']} · FR covered {report['covered']}/{report['total']} · {ladder_line(report)}"]
    lines += [f"  {c['verdict']:<11} {c['file']}" + (f" ({c['task']})" if c["task"] else "") for c in changed]
    lines += [f"  ! {f['text']}" for f in report["findings"]]
    lines += [f"  · {n}" for n in report["notes"]]
    if data["advice"]:
        lines.append(f"  advice: intent check {data['advice']['score']}/100 ({data['advice']['verdict']}), not counted in the level")
    emit(args, data, "\n".join(lines))
    if args.fail_on != "none" and RANK[report["level"]] >= RANK[args.fail_on]:
        raise SystemExit(1)


def cmd_verify(args) -> None:
    root, snap, ledger = context(args, scan=True)
    current = {r["id"]: fingerprint(r["text"]) for r in (snap["spec"] or {"reqs": []})["reqs"]}
    at, commit = now(), git_head(root, short=True)
    cases: list[dict] = []
    if args.junit:
        cases = read_junit(args.junit)
        verification = verification_from(cases, ledger["anchors"], current, snap["featureDir"], at, commit)
    elif args.exit_code is not None:
        report_of(root, snap, ledger)
        proof = proof_snap(snap)
        tested = [r["id"] for r in proof["reqs"] if r["kind"] == "FR" and is_active(r) and LADDER.index(level_of(r["id"], proof, ledger)) >= LADDER.index("tested")]
        verification = verification_from_exit(args.exit_code, tested, current, at, commit)
    else:
        fail("verify needs --junit FILE (or --exit-code N without JUnit)")
    ledger["verification"] = {**ledger["verification"], **verification}
    for rid in verification:
        if rid in current:
            ledger["fingerprints"][rid] = current[rid]
    if not args.no_write:
        save_ledger(root, snap["featureDir"], ledger)
    report = report_of(root, snap, ledger)
    failing = sorted(rid for rid, v in verification.items() if v["status"] == "failing")
    passing = sorted(rid for rid, v in verification.items() if v["status"] == "passing")
    data = {"feature": snap["featureDir"], "cases": len(cases), "passing": passing, "failing": failing, "verification": verification, "levels": report["levels"], "written": not args.no_write}
    lines = [f"{snap['featureDir']}: {len(cases)} test cases · {len(passing)} passing · {len(failing)} failing · {ladder_line(report)}"]
    lines += [f"  {rid:<10} {verification[rid]['status']:<8} {', '.join(verification[rid]['tests'])}" for rid in sorted(verification)]
    emit(args, data, "\n".join(lines))
    if failing or (args.exit_code not in (None, 0) and not args.junit):
        raise SystemExit(1)


def cmd_record_check(args) -> None:
    root, snap, ledger = context(args)
    text = read(Path(args.file))
    semantic = parse_semantic(text or "", now())
    if not semantic:
        fail(f"{args.file} holds no verdict with a numeric score")
    semantic["head"] = git_head(root)
    semantic["diffHash"] = hashlib.sha256((run(["git", "diff", "HEAD"], root) or "").encode("utf-8")).hexdigest()
    ledger = apply_semantic(ledger, semantic)
    save_ledger(root, snap["featureDir"], ledger)
    # The verdict is advice (§8): the level stays the deterministic one; the verdict's own findings ride beside it.
    report = report_of(root, snap, ledger)
    advice = [f for f in evaluate(snap, ledger, semantic=True)["findings"] if f["kind"] in ("semantic", "intent")]
    data = {"score": semantic["score"], "verdict": semantic["verdict"], "level": report["level"], "findings": report["findings"], "advice": advice}
    emit(args, data, f"Intent check {semantic['score']}/100 ({semantic['verdict']}), recorded as advice. Drift: {report['level']}." + "".join(f"\n  advice: {f['text']}" for f in advice))


def report_markdown(snap: dict, ledger: dict, report: dict, rows: list[dict], metrics: dict) -> str:
    spec = snap["spec"] or {"title": snap["featureDir"], "input": None}
    out = [
        f"# Traceability: {spec['title']}",
        "",
        f"`{snap['featureDir']}` · drift **{report['level']}** · tasks {report['done']}/{report['tasks']} · FR covered {report['covered']}/{report['total']}",
        "",
        f"Coverage ladder: {ladder_line(report)}",
        "",
    ]
    if spec.get("input"):
        out += [f"> {spec['input']}", ""]
    out += ["## Requirements", "", "| Requirement | Level | Tasks | Files | Anchors |", "| --- | --- | --- | --- | --- |"]
    for r in rows:
        mark = " ⚠ uncovered" if r["covered"] is False else ""
        mark += " ❓" if r["needsClarification"] else ""
        level = r["level"] or (f"superseded by {r['supersededBy']}" if r["supersededBy"] else r["status"])
        out.append(f"| **{r['id']}**{mark} {cell(r['text'])} | {level} | {', '.join(r['tasks']) or '–'} | {cell(', '.join(r['files'])) or '–'} | {cell(', '.join(r['anchors'])) or '–'} |")
    out += ["", "## Drift", ""]
    out += [f"- **{f['level']}** {f['text']}" for f in report["findings"]] or ["- none"]
    if report["notes"]:
        out += ["", "## Notes", ""] + [f"- {n}" for n in report["notes"]]
    advice = advice_of(ledger)
    if advice:
        reasons = "; ".join(advice["reasons"])
        out += ["", "## Intent check (advice, not counted in the level)", "", f"{advice['score']}/100, {advice['verdict']}" + (f": {reasons}" if reasons else "")]
    beyond = [i for i in ledger["intents"] if i.get("status") in ("extends", "contradicts")]
    if beyond:
        out += ["", "## Requests beyond the spec", ""] + [f"- *{i['status']}*: {i['text']}" for i in beyond]
    u = metrics["unplanned"]
    out += [
        "",
        "## Metrics",
        "",
        f"- Unplanned edits caught: {u['caught']} (accepted {u['accepted']}, linked {u['linked']}, open {u['open']})",
        f"- Blind-accept share: {round(u['blindAcceptShare'] * 100)}%",
    ]
    if "intents" in metrics and metrics["intents"]["beyond"]:
        i = metrics["intents"]
        out.append(f"- Requests beyond the spec: {i['beyond']} (extends {i['extends']}, contradicts {i['contradicts']}), reached the spec: {i['resolved']} ({round(i['reachedShare'] * 100)}%)")
    out += ["", f"_Generated by speckit-xref from `{committed_path(snap['featureDir'])}`._", ""]
    return "\n".join(out)


def cmd_report(args) -> None:
    root, snap, ledger = context(args, scan=True)
    report = report_of(root, snap, ledger)
    rows = requirement_rows(snap, ledger)
    metrics = metrics_of(snap, ledger)
    fmt = "json" if args.json else args.format
    if fmt == "json":
        spec = snap["spec"] or {}
        data = {
            "feature": snap["featureDir"],
            "title": spec.get("title"),
            **{k: report[k] for k in ("level", "covered", "total", "uncovered", "done", "tasks", "levels", "findings", "notes")},
            "requirements": rows,
            "advice": advice_of(ledger),
            "beyondSpec": [{"text": i["text"], "status": i["status"]} for i in ledger["intents"] if i.get("status") in ("extends", "contradicts")],
            "metrics": metrics,
        }
        text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    else:
        text = report_markdown(snap, ledger, report, rows, metrics)
    if not args.out:
        sys.stdout.write(text)
        return
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    where = rel_path(str(target.resolve()), root)
    print(json.dumps({"report": where, "level": report["level"]}) if fmt == "json" else f"Wrote {where} (drift {report['level']}).")


def cmd_summary(args) -> None:
    root, snap, ledger = context(args, scan=True)
    # The job summary is public: it never reads the requests a person typed, nor the model's verdicts.
    ledger = {**ledger, "intents": [], "semantic": None, "semanticHistory": []}
    changed = book_changes(root, snap, ledger, args.base)
    junit_in_memory(snap, ledger, args.junit)
    report = report_of(root, snap, ledger)
    rows = requirement_rows(snap, ledger)
    unplanned = [c["file"] for c in changed if c["verdict"] == "unplanned" and any(u["file"] == c["file"] and not u.get("acknowledged") for u in ledger["unplanned"])]
    unclear = [c["file"] for c in changed if c["verdict"] == "unclear"]
    reverify = [f for f in report["findings"] if f["kind"] == "re-verify"]
    other = [f for f in report["findings"] if f["kind"] in ("dangling", "orphan-test")]
    if args.json:
        print(json.dumps({"feature": snap["featureDir"], "level": report["level"], "levels": report["levels"], "requirements": rows, "unplanned": unplanned, "unclear": unclear, "reverify": [f["id"] for f in reverify], "findings": report["findings"], "notes": report["notes"]}, indent=2, ensure_ascii=False))
        return
    title = (snap["spec"] or {}).get("title") or snap["featureDir"]
    out = [
        f"## Spec X-Ref: {title}",
        "",
        f"`{snap['featureDir']}` · drift **{report['level']}** · tasks {report['done']}/{report['tasks']} · FR covered {report['covered']}/{report['total']} · {ladder_line(report)}",
        "",
        "| Requirement | Level | Tasks | Files |",
        "| --- | --- | --- | --- |",
    ]
    for r in rows:
        level = r["level"] or (f"superseded by {r['supersededBy']}" if r["supersededBy"] else r["status"])
        files = list(dict.fromkeys(r["files"] + [a.rsplit(":", 1)[0] for a in r["anchors"]]))
        out.append(f"| **{r['id']}** {cell(clip(r['text'], 90))} | {level} | {', '.join(r['tasks']) or '–'} | {cell(', '.join(f'`{f}`' for f in files)) or '–'} |")
    for heading, items in (
        ("Unplanned files", [f"`{f}`" for f in unplanned]),
        ("Unclear files", [f"`{f}`" for f in unclear]),
        ("Re-verify", [f["text"] for f in reverify]),
        ("Anchors without a requirement", [f["text"] for f in other]),
        ("Notes", report["notes"]),
    ):
        if items:
            out += ["", f"### {heading}", ""] + [f"- {i}" for i in items]
    print("\n".join(out))


def cmd_migrate(args) -> None:
    root, snap, _ = context(args)
    feature_dir = snap["featureDir"]
    text = read(root / committed_path(feature_dir))
    try:
        version = json.loads(text).get("schema_version") if text else None
    except (json.JSONDecodeError, AttributeError):
        version = None
    if text is None:
        fail(f"{committed_path(feature_dir)} does not exist: nothing to migrate")
    save_ledger(root, feature_dir, load_ledger(root, feature_dir))
    migrated = version != 2
    data = {"feature": feature_dir, "migrated": migrated, "ledger": committed_path(feature_dir), "local": local_path(feature_dir)}
    emit(args, data, f"{'Migrated' if migrated else 'Already v2, rewrote'} {committed_path(feature_dir)}; local half in {local_path(feature_dir)}.")


def cmd_dump(args) -> None:
    if args.spec or args.tasks or args.constitution:
        print(json.dumps({
            "spec": parse_spec(read(Path(args.spec)) or "") if args.spec else None,
            "tasks": parse_tasks(read(Path(args.tasks)) or "") if args.tasks else [],
            "constitution": parse_constitution(read(Path(args.constitution)) or "") if args.constitution else None,
        }, indent=2, ensure_ascii=False))  # fmt: skip
        return
    root, snap, ledger = context(args)
    print(json.dumps({**snap, "report": report_of(root, snap, ledger)}, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# selftest: scripts/fixtures/cases.json, the outputs both tools must reproduce

COMMITTED_PARTS = ("map", "links", "accepted", "fingerprints")


def case_ledger(parts: dict) -> dict:
    """A case's ledger is given as v2 parts; it becomes the in-memory ledger through the load function."""
    committed = {"schema_version": 2, **{k: v for k, v in parts.items() if k in COMMITTED_PARTS}}
    local = {"schema_version": 2, **{k: v for k, v in parts.items() if k not in COMMITTED_PARTS}}
    return ledger_from_parts(committed, local)


def case_reqs(reqs: list[dict]) -> list[dict]:
    """Case snapshots may give reqs without kind or status: FR, and the status its text says."""
    out = []
    for r in reqs:
        status = req_status(r["text"])
        out.append({"kind": "FR", "needsClarification": False, **status, **r})
    return out


def case_snap(snap: dict) -> dict:
    reqs = case_reqs(snap.get("reqs", []))
    stories = [{"scenarios": [], **s} for s in snap.get("stories", [])]
    return {"featureDir": snap.get("featureDir"), "tasks": snap["tasks"], "spec": {"reqs": reqs, "stories": stories}, "realTests": snap.get("realTests", [])}


def selftest_cases(cases: dict) -> list[tuple[str, bool, str]]:
    """Every case as (label, passed, detail)."""
    results: list[tuple[str, bool, str]] = []

    def check(label: str, got, expected) -> None:
        results.append((label, got == expected, "" if got == expected else f"expected {json.dumps(expected, ensure_ascii=False)}, got {json.dumps(got, ensure_ascii=False)}"))

    for section, items in cases.items():
        if section.startswith("_"):
            continue
        if section == "fingerprint":
            for c in items:
                check(f"fingerprint: {c['text'][:40]!r}", [normalize_text(c["text"]), fingerprint(c["text"])], [c["normalized"], c["sha256"]])
        elif section == "glob":
            for c in items:
                check(f"glob: {c['pattern']} ~ {c['path']}", bool(glob_to_regex(c["pattern"]).fullmatch(c["path"])), c["match"])
        elif section == "ignoreFile":
            for i, c in enumerate(items):
                check(f"ignoreFile: #{i + 1}", parse_ignore(c["text"]), c["expected"])
        elif section == "isTestFile":
            for c in items:
                check(f"isTestFile: {c['path']}", is_test_file(c["path"]), c["isTest"])
        elif section == "hasRealTests":
            for c in items:
                check(f"hasRealTests: {c['text'].splitlines()[0][:40]!r}", has_real_tests(c["text"]), c["real"])
        elif section == "classifyCore":
            for c in items:
                rules = rules_from((c.get("rules") or {}).get("ignoreFile")) if c.get("rules") is not None else rules_from(None)
                verdict, task = classify_core(c["rel"], {"tasks": c["snap"]["tasks"]}, case_ledger(c["ledger"]), rules, c.get("newText") or "")
                check(f"classifyCore: {c['name']}", {"verdict": verdict, "task": task}, c["expected"])
        elif section == "levelOf":
            snap = {**items["snap"], "reqs": case_reqs(items["snap"]["reqs"])}
            for c in items["cases"]:
                check(f"levelOf: {c['name']}", level_of(c["id"], snap, case_ledger(c["ledger"])), c["expected"])
        elif section == "evaluate":
            snap = case_snap(items["snap"])
            for c in items["cases"]:
                r = evaluate(snap, case_ledger(c["ledger"]), c["semantic"])
                got = {"level": r["level"], "kinds": [f["kind"] for f in r["findings"]], "covered": r["covered"], "total": r["total"], "notes": r["notes"]}
                check(f"evaluate: {c['name']}", got, c["expected"])
        elif section == "scenarios":
            for i, c in enumerate(items):
                got = [{"id": s["id"], "scenarios": s["scenarios"]} for s in parse_spec(c["markdown"])["stories"]]
                check(f"scenarios: #{i + 1}", got, c["expected"])
        elif section == "reqStatus":
            for c in items:
                check(f"reqStatus: {c['text'][:40]!r}", req_status(c["text"]), {"status": c["status"], "supersededBy": c["supersededBy"]})
        elif section == "junit":
            for i, c in enumerate(items):
                parsed = parse_junit(c["xml"])
                check(f"junit: #{i + 1} cases", parsed, c["expectedCases"])
                got = verification_from(parsed, c["anchors"], c["fingerprints"], c["featureDir"], c["at"], c["commit"])
                check(f"junit: #{i + 1} verification", got, c["expectedVerification"])
        elif section == "featureFromBranch":
            for c in items:
                check(f"featureFromBranch: {c['branch']}", feature_from_branch(c["branch"], c["dirs"]), c["expected"])
        elif section == "migrateV1":
            for i, c in enumerate(items):
                committed, local = migrate_v1(c["v1"])
                # Compared as JSON values: the committed half as written, the local half as is.
                check(f"migrateV1: #{i + 1} committed", json.loads(committed_json(committed)), c["committed"])
                check(f"migrateV1: #{i + 1} local", json.loads(json.dumps(local)), c["local"])
        else:
            results.append((f"{section}: no adapter in xref.py", False, "unknown section"))
    return results


def cmd_selftest(args) -> None:
    path = Path(args.cases) if args.cases else Path(__file__).resolve().parent / "../../../scripts/fixtures/cases.json"
    text = read(path)
    if text is None:
        fail(f"Cannot read {path}; pass --cases FILE")
    try:
        cases = json.loads(text)
    except json.JSONDecodeError as error:
        fail(f"{path} is no JSON: {error}")
    results = selftest_cases(cases)
    failed = [r for r in results if not r[1]]
    if args.json:
        print(json.dumps({"ok": len(results) - len(failed), "failed": [{"case": label, "detail": detail} for label, _, detail in failed]}, indent=2, ensure_ascii=False))
    else:
        for label, ok, detail in results:
            print(f"{'ok  ' if ok else 'FAIL'} {label}" + (f"\n     {detail}" if detail else ""))
        print(f"{len(results) - len(failed)} ok, {len(failed)} failed")
    if failed:
        raise SystemExit(1)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="xref.py", description="Spec Kit cross-reference and drift check.")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--root", help="project root (default: nearest folder with .specify/)")
    common.add_argument("--feature", help="feature directory, e.g. specs/001-login (default: Spec Kit's active feature, the branch, the diff)")
    common.add_argument("--json", action="store_true", help="print JSON")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("map", parents=[common], help="requirements, tasks and the coverage ladder; record a FR -> tasks map")
    p.add_argument("--apply", metavar="FILE", help='JSON object {"FR-001": ["T004"], ...} to record')
    p.add_argument("--source", default="llm", help="where the map came from (default: llm)")
    p.set_defaults(run=cmd_map)

    p = sub.add_parser("link", parents=[common], help="tie a file to a task/requirement/scenario, or a requirement to a task")
    p.add_argument("--file")
    p.add_argument("--id", help="T###, FR-###, SC-###, USn-ASm or <feature>/FR-###")
    p.add_argument("--req")
    p.add_argument("--task")
    p.add_argument("--source", default="link")
    p.set_defaults(run=cmd_link)

    p = sub.add_parser("check", parents=[common], help="classify changed files; drift level")
    p.add_argument("--base", help="git ref to diff against (e.g. origin/main); uncommitted changes always count")
    p.add_argument("--fail-on", choices=["none", "yellow", "red"], default="none", help="exit 1 when the drift level reaches this (default: none)")
    p.add_argument("--no-write", action="store_true", help="leave both ledger files alone (CI)")
    p.add_argument("--junit", action="append", metavar="FILE", help="JUnit XML for the ladder in the output (repeatable; never stored, never in the exit code)")
    p.set_defaults(run=cmd_check)

    p = sub.add_parser("verify", parents=[common], help="record test results from JUnit XML")
    p.add_argument("--junit", action="append", metavar="FILE", help="a JUnit XML report (repeatable)")
    p.add_argument("--exit-code", type=int, help="without JUnit: the test command's exit code; 0 proves the requirements at tested")
    p.add_argument("--no-write", action="store_true", help="leave both ledger files alone")
    p.set_defaults(run=cmd_verify)

    p = sub.add_parser("record-check", parents=[common], help="record an intent verdict from a JSON file")
    p.add_argument("file")
    p.set_defaults(run=cmd_record_check)

    p = sub.add_parser("report", parents=[common], help="traceability report: ladder, findings, notes, metrics")
    p.add_argument("--format", choices=["md", "json"], default="md", help="md (default) or json; --json is json")
    p.add_argument("--out", help="write to this file instead of stdout")
    p.add_argument("--stdout", action="store_true", help=argparse.SUPPRESS)  # 0.1: the report now prints by default
    p.set_defaults(run=cmd_report)

    p = sub.add_parser("summary", parents=[common], help="the pull request job summary in Markdown")
    p.add_argument("--base", help="git ref to diff against (e.g. origin/main): the committed diff since the merge base")
    p.add_argument("--junit", action="append", metavar="FILE", help="JUnit XML for the ladder (repeatable; never stored)")
    p.set_defaults(run=cmd_summary)

    p = sub.add_parser("migrate", parents=[common], help="rewrite a v1 ledger as v2 (idempotent)")
    p.set_defaults(run=cmd_migrate)

    p = sub.add_parser("dump", parents=[common], help="parsed spec, tasks and constitution as JSON")
    p.add_argument("--spec")
    p.add_argument("--tasks")
    p.add_argument("--constitution")
    p.set_defaults(run=cmd_dump)

    p = sub.add_parser("selftest", parents=[common], help="run the shared cases (scripts/fixtures/cases.json)")
    p.add_argument("--cases", metavar="FILE", help="default: ../../../scripts/fixtures/cases.json from this script")
    p.set_defaults(run=cmd_selftest)

    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
