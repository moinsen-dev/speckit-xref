"""The xref.py CLI against a copy of examples/demo in a throwaway git repository.

Run: python3 -m unittest discover -s extension/tests
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "scripts" / "python" / "xref.py"
DEMO = HERE.parent.parent / "examples" / "demo"
FEATURE = "specs/001-magic-link-login"


class XrefCli(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="xref-test-"))
        shutil.copytree(DEMO, self.root, dirs_exist_ok=True)
        (self.root / FEATURE / "xref.json").unlink(missing_ok=True)
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def git(self, *args: str) -> None:
        subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def xref(self, *args: str, code: int = 0, env: dict | None = None) -> dict:
        done = subprocess.run(
            [sys.executable, "-I", str(SCRIPT), *args, "--json"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env={**os.environ, **(env or {})},
        )
        self.assertEqual(done.returncode, code, done.stderr or done.stdout)
        return json.loads(done.stdout or done.stderr)

    def write(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def ledger(self) -> dict:
        return json.loads((self.root / FEATURE / "xref.json").read_text(encoding="utf-8"))

    def test_map_reads_the_same_numbers_as_the_mod(self) -> None:
        out = self.xref("map")
        self.assertEqual(out["feature"], FEATURE)
        self.assertEqual(out["coverage"], {"covered": 4, "total": 5, "uncovered": ["FR-005"]})
        fr2 = next(r for r in out["requirements"] if r["id"] == "FR-002")
        self.assertEqual(fr2["tasks"], ["T004"])
        self.assertEqual(fr2["anchors"], ["src/auth/token.ts:1"])
        self.assertEqual(next(t for t in out["tasks"] if t["id"] == "T007")["paths"], ["src/auth/token.ts"])
        self.assertEqual(self.ledger()["summary"], {"level": "green", "coverage": "4/5", "tasks": "3/8"})

    def test_map_apply_records_the_agents_map_and_ignores_unknown_ids(self) -> None:
        self.write("map.json", 'Here: {"FR-005": ["T005"], "FR-002": ["T004", "T007", "T999"], "FR-999": ["T001"]}')
        out = self.xref("map", "--apply", "map.json")
        self.assertEqual(out["mapped"], 2)
        self.assertEqual(out["coverage"]["covered"], 5)
        requirements = self.ledger()["requirements"]
        self.assertEqual(requirements["FR-002"]["tasks"], ["T004", "T007"])
        self.assertEqual(requirements["FR-005"]["sources"], ["llm"])
        self.assertNotIn("FR-999", requirements)

    def test_check_classifies_changes_and_fails_ci_at_the_level_asked(self) -> None:
        self.write("src/auth/request-link.ts", "export const handler = () => {}\n")
        self.write("src/ui/theme.ts", "export const dark = true\n")
        out = self.xref("check", "--fail-on", "yellow", code=2)
        verdicts = {c["file"]: (c["verdict"], c["task"]) for c in out["changed"]}
        self.assertEqual(verdicts["src/auth/request-link.ts"], ("planned", "T005"))
        self.assertEqual(verdicts["src/ui/theme.ts"], ("unplanned", None))
        self.assertNotIn("map.json", verdicts)
        self.assertEqual(out["level"], "yellow")
        self.xref("check", "--fail-on", "red")
        ledger = self.ledger()
        self.assertEqual(ledger["tasks"]["T005"]["touched"], ["src/auth/request-link.ts"])
        self.assertEqual([u["file"] for u in ledger["unplanned"]], ["src/ui/theme.ts"])

    def test_a_done_setup_task_naming_a_folder_does_not_plan_new_files_in_it(self) -> None:
        self.write("src/auth/password-fallback.ts", "export const loginWithPassword = () => true\n")
        self.write("src/config/mailer.ts", "export const mailer = { port: 2525 }\n")
        verdicts = {c["file"]: (c["verdict"], c["task"]) for c in self.xref("check")["changed"]}
        self.assertEqual(verdicts["src/auth/password-fallback.ts"], ("unplanned", None))
        self.assertEqual(verdicts["src/config/mailer.ts"], ("planned", "T002"))

    def test_success_criteria_are_not_claimed_as_covered(self) -> None:
        rows = {r["id"]: r["covered"] for r in self.xref("map")["requirements"]}
        self.assertEqual((rows["FR-002"], rows["FR-005"], rows["SC-001"]), (True, False, None))

    def test_check_against_a_base_counts_committed_changes(self) -> None:
        self.git("checkout", "-qb", "feature")
        self.write("src/ui/theme.ts", "export const dark = true\n")
        self.git("add", "-A")
        self.git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "theme")
        self.assertEqual(self.xref("check")["changed"], [])
        base = subprocess.run(["git", "rev-parse", "HEAD~1"], cwd=self.root, capture_output=True, text=True).stdout.strip()
        self.assertEqual([c["file"] for c in self.xref("check", "--base", base)["changed"]], ["src/ui/theme.ts"])

    def test_linking_an_unplanned_file_clears_the_drift(self) -> None:
        self.write("src/ui/theme.ts", "export const dark = true\n")
        self.assertEqual(self.xref("check")["level"], "yellow")
        self.assertEqual(self.xref("link", "--file", "src/ui/theme.ts", "--id", f"{FEATURE.split('/')[1]}/FR-004")["level"], "green")
        self.assertEqual(self.xref("check")["changed"][0]["verdict"], "linked")
        error = self.xref("link", "--file", "src/ui/theme.ts", "--id", "FR-099", code=1)
        self.assertIn("no requirement", error["error"])

    def test_three_unplanned_files_turn_the_light_red(self) -> None:
        for name in ("a", "b", "c"):
            self.write(f"src/misc/{name}.ts", "x\n")
        out = self.xref("check", "--fail-on", "red", code=2)
        self.assertEqual(out["level"], "red")

    def test_an_anchor_to_a_requirement_the_spec_lacks_is_drift(self) -> None:
        self.write("src/auth/request-link.ts", "// @spec 001-magic-link-login/FR-009\n")
        out = self.xref("check")
        self.assertIn("src/auth/request-link.ts:1 anchors 001-magic-link-login/FR-009, which the spec no longer has", [f["text"] for f in out["findings"]])

    def test_anchors_in_new_uncommitted_files_are_found_without_ripgrep(self) -> None:
        # A PATH with git but no rg: the git grep fallback has to search untracked files too.
        tools = Path(tempfile.mkdtemp(prefix="xref-tools-"))
        self.addCleanup(shutil.rmtree, tools, True)
        (tools / "git").symlink_to(shutil.which("git"))
        self.write("src/auth/callback.ts", "// @spec 001-magic-link-login/FR-003\n")
        out = self.xref("map", env={"PATH": str(tools)})
        fr3 = next(r for r in out["requirements"] if r["id"] == "FR-003")
        self.assertEqual(fr3["anchors"], ["src/auth/callback.ts:1"])

    def test_record_check_reads_a_chatty_verdict_and_marks_the_logged_request(self) -> None:
        mod_ledger = {
            "schema_version": 1,
            "producer": "speckit-xref",
            "feature": FEATURE,
            "tasks": {"T004": {"touched": ["src/auth/token.ts"], "linked": []}},
            "requirements": {},
            "unplanned": [],
            "intents": [{"at": "2026-10-09T10:00:00.000Z", "text": "Please also allow passwords as a fallback", "task": "T004", "status": "logged"}],
            "anchors": [],
            "semantic": None,
        }
        self.write(f"{FEATURE}/xref.json", json.dumps(mod_ledger))
        self.assertEqual(self.xref("check")["openIntents"], ["Please also allow passwords as a fallback"])
        self.write("verdict.txt", 'My verdict:\n{"score": 40, "verdict": "drift", "reasons": ["password fallback"], "intent_changes": [{"text": "allow passwords as a fallback", "kind": "contradicts"}]}')
        out = self.xref("record-check", "verdict.txt")
        self.assertEqual((out["score"], out["level"]), (40, "red"))
        ledger = self.ledger()
        self.assertEqual(ledger["intents"][0]["status"], "contradicts")
        self.assertEqual(ledger["tasks"]["T004"]["touched"], ["src/auth/token.ts"])
        self.assertEqual(self.xref("record-check", "map-missing.json", code=1)["error"], "map-missing.json holds no verdict with a numeric score")

    def test_report_writes_the_matrix(self) -> None:
        self.xref("report")
        report = (self.root / FEATURE / "xref-report.md").read_text(encoding="utf-8")
        self.assertIn("# Traceability: Magic Link Login", report)
        self.assertIn("| **FR-002** System MUST send a single-use link that expires after 15 minutes. | T004 | – | src/auth/token.ts:1 |", report)
        self.assertIn("**FR-005** ⚠ uncovered ❓", report)
        self.assertIn("- none", report)

    def test_the_feature_comes_from_spec_kits_pointers(self) -> None:
        self.write("specs/002-export/spec.md", "# Feature Specification: Export\n\n- **FR-001**: Users MUST export.\n")
        self.assertEqual(self.xref("map", env={"SPECIFY_FEATURE_DIRECTORY": "specs/002-export"})["feature"], "specs/002-export")
        self.assertEqual(self.xref("map", "--feature", "specs/002-export")["coverage"]["uncovered"], ["FR-001"])
        self.assertEqual(self.xref("map")["feature"], FEATURE)
        shutil.rmtree(self.root / "specs")
        self.assertIn("No Spec Kit feature found", self.xref("check", code=1)["error"])


if __name__ == "__main__":
    unittest.main()
