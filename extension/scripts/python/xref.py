#!/usr/bin/env python3
"""speckit-xref: tie a Spec Kit feature and its code together, and measure drift.

The batch twin of the speckit-xref Claude Code mod. Both read the same Spec Kit
files and keep the same ledger, ``specs/<feature>/xref.json``, so a mapping made
here shows in the mod's pane and a drift the mod logged shows in a CI check.
The readers below mirror ``mod/hooks/speckit.ts`` and ``mod/hooks/xref.ts`` rule
for rule; ``scripts/parity.mjs`` holds them to that.

Standard library only. Subcommands:

  map            requirements, tasks and coverage; --apply FILE records a FR -> tasks map
  link           tie a file to a task or requirement, or a requirement to a task
  check          classify changed files against the plan; drift level, exit code for CI
  record-check   record an intent verdict (score, reasons, intent changes) from a JSON file
  report         Markdown traceability report: requirement -> tasks -> files and anchors
  dump           the parsed spec, tasks and constitution (for parity tests)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

A = re.ASCII  # JavaScript's \w and \d are ASCII; so are ours, for parity with the mod.

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


def parse_spec(markdown: str) -> dict:
    title = re.search(r"^#\s+(?:Feature Specification:\s*)?(.+)$", markdown, re.M | A)
    input_line = re.search(r"^\*\*Input\*\*:\s*(?:User description:\s*)?(.+)$", markdown, re.M | A)
    raw_input = input_line.group(1).strip() if input_line else None
    if raw_input is not None:
        raw_input = re.sub(r'^"(.*)"$', r"\1", raw_input).strip()
    stories = [
        {"id": f"US{m.group(1)}", "title": unbold(m.group(2) or ""), "priority": m.group(3)}
        for m in re.finditer(
            r"^###\s+User Story\s+(\d+)\s*[-–—:]\s*(.+?)\s*(?:\(Priority:\s*(P\d+)\))?\s*(?:🎯.*)?$", markdown, re.M | A
        )
    ]
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


def extract_paths(text: str) -> list[str]:
    found: dict[str, None] = {}

    def keep(raw: str) -> None:
        path = re.sub(r"[.,;:)]+$", "", re.sub(r"^\./", "", raw.strip()))
        if not path or re.match(r"^https?:", path, re.I) or " " in path or len(path) > 200:
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
# X-Ref and drift (mirror mod/hooks/xref.ts)

ANCHOR = re.compile(r"@spec\s+((?:[\w.-]+/)?(?:FR|SC|T)-?\d{3,})", A)
RANK = {"none": 0, "green": 1, "yellow": 2, "red": 3}


def empty_ledger() -> dict:
    return {"tasks": {}, "requirements": {}, "unplanned": [], "intents": [], "anchors": [], "semantic": None}


def is_spec_artifact(rel: str) -> bool:
    return bool(re.match(r"^(specs|\.specify|\.claude|\.github)/", rel)) or rel in ("CLAUDE.md", "AGENTS.md")


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


def local_id(rid: str, feature_dir: str | None) -> str | None:
    if "/" not in rid:
        return rid
    feature, bare = rid.rsplit("/", 1)
    return bare if feature_dir and feature_dir.rstrip("/").rsplit("/", 1)[-1] == feature else None


def is_covered(rid: str, snap: dict, ledger: dict) -> bool:
    if any(rid in t["reqs"] for t in snap["tasks"]):
        return True
    entry = ledger["requirements"].get(rid)
    if entry and (entry.get("tasks") or entry.get("files")):
        return True
    return any(local_id(a["id"], snap["featureDir"]) == rid for a in ledger["anchors"])


def evaluate(snap: dict, ledger: dict) -> dict:
    findings: list[dict] = []
    open_edits = [u for u in ledger["unplanned"] if not u.get("acknowledged")]
    for u in open_edits:
        findings.append({"kind": "unplanned", "level": "yellow", "file": u["file"], "text": f"{u['file']} is not planned for any task"})
    if len(open_edits) >= 3:
        findings.append({"kind": "unplanned", "level": "red", "text": f"{len(open_edits)} edits outside the planned files"})
    spec = snap["spec"] or {"reqs": []}
    req_ids = {r["id"] for r in spec["reqs"]}
    task_ids = {t["id"] for t in snap["tasks"]}
    for a in ledger["anchors"]:
        bare = local_id(a["id"], snap["featureDir"])
        if bare and bare not in req_ids and bare not in task_ids:
            findings.append({"kind": "dangling", "level": "yellow", "file": a["file"], "text": f"{a['file']}:{a['line']} anchors {a['id']}, which the spec no longer has"})
    s = ledger.get("semantic")
    if s:
        if s["verdict"] == "drift" or s["score"] < 50:
            findings.append({"kind": "semantic", "level": "red", "text": f"Intent check {s['score']}/100: {(s['reasons'] or ['the change drifts from the spec'])[0]}"})
        elif s["verdict"] == "minor" or s["score"] < 80:
            findings.append({"kind": "semantic", "level": "yellow", "text": f"Intent check {s['score']}/100: {(s['reasons'] or ['minor drift'])[0]}"})
        for c in s.get("changes", []):
            what = "which contradicts the spec" if c["kind"] == "contradicts" else "which the spec does not cover"
            findings.append({"kind": "intent", "level": "red" if c["kind"] == "contradicts" else "yellow", "intent": c["text"], "text": f'User asked: "{c["text"]}", {what}'})
    frs = [r for r in spec["reqs"] if r["kind"] == "FR"]
    uncovered = [r["id"] for r in frs if not is_covered(r["id"], snap, ledger)]
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
    return {**ledger, "intents": intents, "semantic": {**semantic, "changes": changes}}


def link(ledger: dict, rel: str, rid: str, snap: dict, source: str = "link") -> tuple[dict, str | None]:
    bare = local_id(rid, snap["featureDir"])
    if not bare:
        return ledger, f"{rid} names another feature than {snap['featureDir'] or 'the active one'}"
    ledger = json.loads(json.dumps(ledger))
    if re.match(r"^T\d{3,}$", bare):
        if not any(t["id"] == bare for t in snap["tasks"]):
            return ledger, f"{bare} is no task in tasks.md"
        entry = ledger["tasks"].setdefault(bare, {"touched": [], "linked": []})
        if rel not in entry["linked"]:
            entry["linked"].append(rel)
    elif re.match(r"^(FR|SC)-\d{3,}$", bare):
        if not any(r["id"] == bare for r in (snap["spec"] or {"reqs": []})["reqs"]):
            return ledger, f"{bare} is no requirement in spec.md"
        entry = ledger["requirements"].setdefault(bare, {"tasks": [], "files": [], "sources": []})
        if rel not in entry["files"]:
            entry["files"].append(rel)
        if source not in entry["sources"]:
            entry["sources"].append(source)
    else:
        return ledger, f"{rid} is neither a task (T###) nor a requirement (FR-### / SC-###)"
    ledger["unplanned"] = [{**u, "acknowledged": True} if u["file"] == rel else u for u in ledger["unplanned"]]
    return ledger, None


def apply_mapping(ledger: dict, raw: object, snap: dict, source: str = "llm") -> tuple[dict, int]:
    if not isinstance(raw, dict):
        return ledger, 0
    req_ids = {r["id"] for r in (snap["spec"] or {"reqs": []})["reqs"]}
    task_ids = {t["id"] for t in snap["tasks"]}
    ledger = json.loads(json.dumps(ledger))
    mapped = 0
    for rid, value in raw.items():
        if rid not in req_ids or not isinstance(value, list):
            continue
        tasks = [t for t in value if isinstance(t, str) and t in task_ids]
        entry = ledger["requirements"].setdefault(rid, {"tasks": [], "files": [], "sources": []})
        entry["tasks"] = list(dict.fromkeys(entry["tasks"] + tasks))
        if source not in entry["sources"]:
            entry["sources"].append(source)
        if tasks:
            mapped += 1
    return ledger, mapped


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


def parse_feature_json(text: str | None) -> str | None:
    try:
        value = json.loads(text or "")
    except json.JSONDecodeError:
        return None
    directory = value.get("feature_directory") if isinstance(value, dict) else None
    return directory if isinstance(directory, str) and directory else None


def resolve_feature(root: Path, explicit: str | None) -> str | None:
    named = os.environ.get("SPECIFY_FEATURE")
    pointers = [explicit, os.environ.get("SPECIFY_FEATURE_DIRECTORY"), parse_feature_json(read(root / ".specify/feature.json")), f"specs/{named}" if named else None]
    for pointer in pointers:
        if not pointer:
            continue
        rel = rel_path(pointer, root).rstrip("/")
        if (root / rel / "spec.md").is_file():
            return rel
    best, best_time = None, 0.0
    for folder in ("specs", ".specify/specs"):
        base = root / folder
        if not base.is_dir():
            continue
        for entry in base.iterdir():
            if not entry.is_dir():
                continue
            times = [p.stat().st_mtime for p in (entry / "tasks.md", entry / "spec.md") if p.is_file()]
            if times and max(times) > best_time:
                best, best_time = f"{folder}/{entry.name}", max(times)
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
    }


def load_ledger(root: Path, feature_dir: str) -> dict:
    text = read(root / feature_dir / "xref.json")
    base = empty_ledger()
    if not text:
        return base
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        return base
    for key, kind in (("tasks", dict), ("requirements", dict), ("unplanned", list), ("intents", list), ("anchors", list)):
        if isinstance(raw.get(key), kind):
            base[key] = raw[key]
    base["semantic"] = raw.get("semantic") or None
    return base


def save_ledger(root: Path, snap: dict, ledger: dict) -> dict:
    report = evaluate(snap, ledger)
    doc = {
        "schema_version": 1,
        "producer": "speckit-xref",
        "feature": snap["featureDir"],
        "updated_at": now(),
        "summary": {"level": report["level"], "coverage": f"{report['covered']}/{report['total']}", "tasks": f"{report['done']}/{report['tasks']}"},
        **ledger,
    }
    (root / snap["featureDir"] / "xref.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def run(argv: list[str], cwd: Path) -> str | None:
    try:
        done = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode in (0, 1) else None


SKIP_DIRS = {".git", "node_modules", "specs", ".specify", ".venv", "venv", "dist", "build", ".dart_tool", "Pods", "__pycache__"}


def scan_anchors(root: Path) -> list[dict]:
    """Every `@spec <id>` comment outside the spec folders: ripgrep, else git grep, else a walk."""
    out = run(["rg", "-n", "--no-heading", "-o", "-e", r"@spec\s+(?:[\w.-]+/)?(?:FR|SC|T)-?\d{3,}", "--glob", "!specs/**", "--glob", "!.specify/**", "."], root)
    if out is None:
        out = run(["git", "grep", "--untracked", "-n", "-o", "-E", "@spec[[:space:]]+([[:alnum:]_.-]+/)?(FR|SC|T)-?[0-9]{3,}", "--", ".", ":!specs", ":!.specify"], root)
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


def changed_files(root: Path, base: str | None) -> list[str]:
    """Changed files relative to the project and only inside it: the project may be one folder of a larger repository."""
    runs = [["git", "diff", "--name-only", "--relative", "HEAD"], ["git", "ls-files", "--others", "--exclude-standard"]]
    if base:
        runs.insert(0, ["git", "diff", "--name-only", "--relative", f"{base}...HEAD"])
    files: dict[str, None] = {}
    for argv in runs:
        for line in (run(argv, root) or "").split("\n"):
            if line.strip():
                files.setdefault(line.strip(), None)
    return [f for f in files if not is_spec_artifact(f)]


def classify(rel: str, snap: dict, ledger: dict) -> tuple[str, str | None]:
    """The batch verdict: there is no current task, so any task that plans the file serves it."""
    if is_spec_artifact(rel):
        return "spec", None
    for tid, entry in ledger["tasks"].items():
        if rel in entry.get("linked", []):
            return "linked", tid
    if any(rel in r.get("files", []) for r in ledger["requirements"].values()) or any(a["file"] == rel for a in ledger["anchors"]):
        return "linked", None
    if not snap["tasks"]:
        return "untracked", None
    matches = [t for t in snap["tasks"] if plans(t, rel)]
    if matches:
        return "planned", next((t for t in matches if not t["done"]), matches[0])["id"]
    return "unplanned", None


# ---------------------------------------------------------------------------
# Subcommands


def context(args) -> tuple[Path, dict, dict]:
    root = find_root(Path(args.root).resolve() if args.root else Path.cwd())
    feature_dir = resolve_feature(root, args.feature)
    if not feature_dir:
        fail("No Spec Kit feature found (specs/NNN-*/spec.md). Create one with the specify command first.")
    snap = snapshot(root, feature_dir)
    return root, snap, load_ledger(root, feature_dir)


def fail(message: str) -> None:
    print(json.dumps({"error": message}), file=sys.stderr)
    raise SystemExit(1)


def emit(args, data: dict, text: str) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False) if args.json else text)


def requirement_rows(snap: dict, ledger: dict) -> list[dict]:
    rows = []
    for r in (snap["spec"] or {"reqs": []})["reqs"]:
        entry = ledger["requirements"].get(r["id"], {})
        tasks = list(dict.fromkeys([t["id"] for t in snap["tasks"] if r["id"] in t["reqs"]] + entry.get("tasks", [])))
        anchors = [f"{a['file']}:{a['line']}" for a in ledger["anchors"] if local_id(a["id"], snap["featureDir"]) == r["id"]]
        files = list(dict.fromkeys(entry.get("files", []) + [f for t in tasks for f in ledger["tasks"].get(t, {}).get("touched", [])]))
        rows.append({"id": r["id"], "kind": r["kind"], "text": r["text"], "tasks": tasks, "files": files, "anchors": anchors, "covered": is_covered(r["id"], snap, ledger) if r["kind"] == "FR" else None, "needsClarification": r["needsClarification"]})
    return rows


def cmd_map(args) -> None:
    root, snap, ledger = context(args)
    ledger = {**ledger, "anchors": scan_anchors(root)}
    mapped = 0
    if args.apply:
        text = read(Path(args.apply))
        if text is None:
            fail(f"Cannot read {args.apply}")
        ledger, mapped = apply_mapping(ledger, first_json(text), snap, args.source)
    report = save_ledger(root, snap, ledger)
    data = {
        "feature": snap["featureDir"],
        "ledger": f"{snap['featureDir']}/xref.json",
        "mapped": mapped,
        "coverage": {"covered": report["covered"], "total": report["total"], "uncovered": report["uncovered"]},
        "requirements": requirement_rows(snap, ledger),
        "tasks": [{k: t[k] for k in ("id", "done", "story", "text", "paths", "reqs", "phase")} for t in snap["tasks"]],
    }
    lines = [f"{snap['featureDir']}: FR covered {report['covered']}/{report['total']}" + (f", mapped {mapped}" if args.apply else "")]
    lines += [f"  {r['id']} -> {', '.join(r['tasks']) or '-'}" for r in data["requirements"] if r["kind"] == "FR"]
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
    report = save_ledger(root, snap, ledger)
    emit(args, {"linked": what, "level": report["level"]}, f"Linked {what}. Drift: {report['level']}.")


def cmd_check(args) -> None:
    root, snap, ledger = context(args)
    ledger = {**ledger, "anchors": scan_anchors(root)}
    at = now()
    changed = []
    for rel in changed_files(root, args.base):
        verdict, task = classify(rel, snap, ledger)
        changed.append({"file": rel, "verdict": verdict, "task": task})
        if verdict == "planned" and task:
            entry = ledger["tasks"].setdefault(task, {"touched": [], "linked": []})
            if rel not in entry["touched"]:
                entry["touched"].append(rel)
        if verdict == "unplanned" and not any(u["file"] == rel and not u.get("acknowledged") for u in ledger["unplanned"]):
            ledger["unplanned"] = (ledger["unplanned"] + [{"file": rel, "at": at, "task": None, "acknowledged": False}])[-100:]
    report = save_ledger(root, snap, ledger)
    spec = snap["spec"] or {}
    data = {
        "feature": snap["featureDir"],
        "level": report["level"],
        "findings": report["findings"],
        "changed": changed,
        "coverage": {"covered": report["covered"], "total": report["total"], "uncovered": report["uncovered"]},
        "tasks": {"done": report["done"], "total": report["tasks"]},
        "spec": {"title": spec.get("title"), "input": spec.get("input"), "outOfScope": spec.get("outOfScope", []), "requirements": [{"id": r["id"], "text": r["text"]} for r in spec.get("reqs", [])]},
        "openIntents": [i["text"] for i in ledger["intents"] if i["status"] != "resolved"][-10:],
        "ledger": f"{snap['featureDir']}/xref.json",
    }
    lines = [f"{snap['featureDir']}: drift {report['level']} · tasks {report['done']}/{report['tasks']} · FR covered {report['covered']}/{report['total']}"]
    lines += [f"  {c['verdict']:<10} {c['file']}" + (f" ({c['task']})" if c["task"] else "") for c in changed]
    lines += [f"  ! {f['text']}" for f in report["findings"]]
    emit(args, data, "\n".join(lines))
    if args.fail_on and RANK[report["level"]] >= RANK[args.fail_on]:
        raise SystemExit(2)


def cmd_record_check(args) -> None:
    root, snap, ledger = context(args)
    text = read(Path(args.file))
    semantic = parse_semantic(text or "", now())
    if not semantic:
        fail(f"{args.file} holds no verdict with a numeric score")
    ledger = apply_semantic(ledger, semantic)
    report = save_ledger(root, snap, ledger)
    emit(args, {"score": semantic["score"], "verdict": semantic["verdict"], "level": report["level"], "findings": report["findings"]}, f"Intent check {semantic['score']}/100 ({semantic['verdict']}). Drift: {report['level']}.")


def cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def cmd_report(args) -> None:
    root, snap, ledger = context(args)
    ledger = {**ledger, "anchors": scan_anchors(root)}
    report = evaluate(snap, ledger)
    spec = snap["spec"] or {"title": snap["featureDir"], "input": None}
    out = [
        f"# Traceability: {spec['title']}",
        "",
        f"`{snap['featureDir']}` · drift **{report['level']}** · tasks {report['done']}/{report['tasks']} · FR covered {report['covered']}/{report['total']}",
        "",
    ]
    if spec.get("input"):
        out += [f"> {spec['input']}", ""]
    out += ["## Requirements", "", "| Requirement | Tasks | Files | Anchors |", "| --- | --- | --- | --- |"]
    for r in requirement_rows(snap, ledger):
        mark = " ⚠ uncovered" if r["covered"] is False else ""
        mark += " ❓" if r["needsClarification"] else ""
        out.append(f"| **{r['id']}**{mark} {cell(r['text'])} | {', '.join(r['tasks']) or '–'} | {cell(', '.join(r['files'])) or '–'} | {cell(', '.join(r['anchors'])) or '–'} |")
    out += ["", "## Drift", ""]
    out += [f"- **{f['level']}** {f['text']}" for f in report["findings"]] or ["- none"]
    open_intents = [i for i in ledger["intents"] if i["status"] in ("extends", "contradicts")]
    if open_intents:
        out += ["", "## Requests beyond the spec", ""] + [f"- *{i['status']}*: {i['text']}" for i in open_intents]
    out += ["", f"_Generated by speckit-xref from `{snap['featureDir']}/xref.json` at {now()}._", ""]
    markdown = "\n".join(out)
    if args.stdout:
        print(markdown)
        return
    target = Path(args.out) if args.out else root / snap["featureDir"] / "xref-report.md"
    target.write_text(markdown, encoding="utf-8")
    print(json.dumps({"report": rel_path(str(target.resolve()), root), "level": report["level"]}) if args.json else f"Wrote {rel_path(str(target.resolve()), root)} (drift {report['level']}).")


def cmd_dump(args) -> None:
    if args.spec or args.tasks or args.constitution:
        print(json.dumps({
            "spec": parse_spec(read(Path(args.spec)) or "") if args.spec else None,
            "tasks": parse_tasks(read(Path(args.tasks)) or "") if args.tasks else [],
            "constitution": parse_constitution(read(Path(args.constitution)) or "") if args.constitution else None,
        }, indent=2, ensure_ascii=False))
        return
    root, snap, ledger = context(args)
    print(json.dumps({**snap, "report": evaluate(snap, ledger)}, indent=2, ensure_ascii=False))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="xref.py", description="Spec Kit cross-reference and drift check.")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--root", help="project root (default: nearest folder with .specify/)")
    common.add_argument("--feature", help="feature directory, e.g. specs/001-login (default: Spec Kit's active feature)")
    common.add_argument("--json", action="store_true", help="print JSON")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("map", parents=[common], help="requirements, tasks and coverage; record a FR -> tasks map")
    p.add_argument("--apply", metavar="FILE", help='JSON object {"FR-001": ["T004"], ...} to record')
    p.add_argument("--source", default="llm", help="where the map came from (default: llm)")
    p.set_defaults(run=cmd_map)

    p = sub.add_parser("link", parents=[common], help="tie a file to a task/requirement, or a requirement to a task")
    p.add_argument("--file")
    p.add_argument("--id", help="T###, FR-###, SC-### or <feature>/FR-###")
    p.add_argument("--req")
    p.add_argument("--task")
    p.add_argument("--source", default="link")
    p.set_defaults(run=cmd_link)

    p = sub.add_parser("check", parents=[common], help="classify changed files; drift level")
    p.add_argument("--base", help="git ref to diff against (e.g. origin/main); uncommitted changes always count")
    p.add_argument("--fail-on", choices=["yellow", "red"], help="exit 2 when the drift level reaches this")
    p.set_defaults(run=cmd_check)

    p = sub.add_parser("record-check", parents=[common], help="record an intent verdict from a JSON file")
    p.add_argument("file")
    p.set_defaults(run=cmd_record_check)

    p = sub.add_parser("report", parents=[common], help="write the Markdown traceability report")
    p.add_argument("--out", help="target file (default: <feature>/xref-report.md)")
    p.add_argument("--stdout", action="store_true", help="print instead of writing")
    p.set_defaults(run=cmd_report)

    p = sub.add_parser("dump", parents=[common], help="parsed spec, tasks and constitution as JSON")
    p.add_argument("--spec")
    p.add_argument("--tasks")
    p.add_argument("--constitution")
    p.set_defaults(run=cmd_dump)

    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
