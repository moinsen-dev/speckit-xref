"""The xref.py CLI against a copy of examples/demo in a throwaway git repository.

Run: python3 -m unittest discover -s extension/tests
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "scripts" / "python" / "xref.py"
DEMO = HERE.parent.parent / "examples" / "demo"
FEATURE = "specs/001-magic-link-login"

# The script's own functions, for tests that need a value it computes (a fingerprint).
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("xref_script", SCRIPT)
X = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(X)
LOCAL = ".specify/xref/local/001-magic-link-login.json"
# What decides the feature or the CI behaviour; GitHub Actions sets CI and, on pull requests, GITHUB_HEAD_REF.
SCRUB = ("CI", "GITHUB_HEAD_REF", "SPECIFY_FEATURE", "SPECIFY_FEATURE_DIRECTORY")


def clean_env(extra: dict | None = None) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in SCRUB}
    return {**env, **(extra or {})}


def copy_committed_demo(target: Path) -> None:
    """The demo as committed, so a playground run in examples/demo does not change what the tests see."""
    repo = DEMO.parent.parent
    archive = subprocess.run(["git", "-C", str(repo), "archive", "HEAD", "examples/demo"], capture_output=True)
    if archive.returncode != 0:
        shutil.copytree(DEMO, target, dirs_exist_ok=True)
        return
    with tempfile.TemporaryDirectory() as unpacked:
        with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tar:
            # Our own git archive; the safety filter exists from Python 3.9.17/3.12 on.
            tar.extractall(unpacked, **({"filter": "data"} if hasattr(tarfile, "data_filter") else {}))
        shutil.copytree(Path(unpacked) / "examples" / "demo", target, dirs_exist_ok=True)


JUNIT = """<?xml version="1.0"?>
<testsuites><testsuite name="auth">
<testcase classname="auth.token" name="FR-002 issues a single-use token" file="tests/auth/token.test.ts"/>
<testcase classname="auth.callback" name="signs in" file="tests/auth/callback.test.ts">{failure}</testcase>
</testsuite></testsuites>
"""


class XrefCli(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="xref-test-"))
        self.scratch = Path(tempfile.mkdtemp(prefix="xref-scratch-"))
        copy_committed_demo(self.root)
        (self.root / FEATURE / "xref.json").unlink(missing_ok=True)
        self.git("init", "-q")
        self.commit_all("init")

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.scratch, ignore_errors=True)

    def git(self, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True, text=True).stdout

    def commit_all(self, message: str) -> None:
        self.git("add", "-A")
        self.git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message)

    def xref(self, *args: str, code: int = 0, env: dict | None = None, as_json: bool = True):
        done = subprocess.run(
            [sys.executable, "-I", str(SCRIPT), *args, *(["--json"] if as_json else [])],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=clean_env(env),
        )
        self.assertEqual(done.returncode, code, done.stderr or done.stdout)
        if not as_json:
            return done.stdout
        return json.loads(done.stdout or done.stderr)

    def write(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def outside(self, name: str, text: str) -> str:
        """An input file outside the repository (a verdict, a JUnit report), so it is no change of its own."""
        path = self.scratch / name
        path.write_text(text, encoding="utf-8")
        return str(path)

    def ledger(self) -> dict:
        return json.loads((self.root / FEATURE / "xref.json").read_text(encoding="utf-8"))

    def local(self) -> dict:
        return json.loads((self.root / LOCAL).read_text(encoding="utf-8"))

    def without_feature_pointer(self, *more_features: str) -> None:
        """Spec Kit gitignores feature.json: in CI the branch or the diff has to name the feature."""
        (self.root / ".specify" / "feature.json").unlink()
        for feature in more_features:
            self.write(f"specs/{feature}/spec.md", "# Feature Specification: Export\n\n- **FR-001**: Users MUST export.\n")
        self.commit_all("features")

    # --- map, link, check as in 0.1, on the split ledger -------------------------------------------

    def test_map_reads_the_same_numbers_as_the_mod(self) -> None:
        out = self.xref("map")
        self.assertEqual(out["feature"], FEATURE)
        self.assertEqual(out["coverage"], {"covered": 4, "total": 5, "uncovered": ["FR-005"]})
        self.assertEqual(out["levels"], {"specified": 1, "planned": 4, "implemented": 0, "tested": 0, "passing": 0})
        fr2 = next(r for r in out["requirements"] if r["id"] == "FR-002")
        self.assertEqual((fr2["tasks"], fr2["anchors"], fr2["level"]), (["T004"], ["src/auth/token.ts:1"], "planned"))
        self.assertEqual(next(t for t in out["tasks"] if t["id"] == "T007")["paths"], ["src/auth/token.ts"])
        committed = self.ledger()
        self.assertEqual(committed["schema_version"], 2)
        self.assertNotIn("summary", committed)
        self.assertNotIn("updated_at", committed)
        self.assertEqual(self.local()["anchors"], [{"id": "001-magic-link-login/FR-002", "file": "src/auth/token.ts", "line": 1}])
        self.assertEqual((self.root / ".specify/xref/.gitignore").read_text(encoding="utf-8"), "local/\n")

    def test_map_apply_records_the_agents_map_and_ignores_unknown_ids(self) -> None:
        mapping = self.outside("map.json", 'Here: {"FR-005": ["T005"], "FR-002": ["T004", "T007", "T999"], "FR-999": ["T001"]}')
        out = self.xref("map", "--apply", mapping)
        self.assertEqual(out["mapped"], 2)
        self.assertEqual(out["coverage"]["covered"], 5)
        committed = self.ledger()
        self.assertEqual(committed["map"], {"FR-002": ["T004", "T007"], "FR-005": ["T005"]})
        self.assertEqual(sorted(committed["fingerprints"]), ["FR-002", "FR-005"])

    def test_check_classifies_changes_and_fails_ci_at_the_level_asked(self) -> None:
        self.write("src/auth/request-link.ts", "export const handler = () => {}\n")
        self.write("src/ui/theme.ts", "export const dark = true\n")
        out = self.xref("check", "--fail-on", "yellow", code=1)
        verdicts = {c["file"]: (c["verdict"], c["task"]) for c in out["changed"]}
        self.assertEqual(verdicts["src/auth/request-link.ts"], ("planned", "T005"))
        self.assertEqual(verdicts["src/ui/theme.ts"], ("unplanned", None))
        self.assertEqual(out["level"], "yellow")
        self.xref("check", "--fail-on", "red")
        self.assertEqual(self.local()["touched"]["T005"], ["src/auth/request-link.ts"])
        self.assertEqual([u["file"] for u in self.local()["unplanned"]], ["src/ui/theme.ts"])
        self.assertNotIn("unplanned", self.ledger())

    def test_exempt_files_vanish_unclear_files_are_no_drift(self) -> None:
        self.write("package-lock.json", "{}\n")
        self.write("package.json", "{}\n")
        self.write("src/generated/api.ts", "x\n")
        self.write("db/schema.sql", "x\n")
        self.write(".xrefignore", "# generated\nsrc/generated/\nunclear: *.sql\n")
        out = self.xref("check")
        verdicts = {c["file"]: c["verdict"] for c in out["changed"]}
        self.assertEqual((verdicts["package.json"], verdicts["db/schema.sql"]), ("unclear", "unclear"))
        self.assertNotIn("package-lock.json", verdicts)
        self.assertNotIn("src/generated/api.ts", verdicts)
        self.assertNotIn("db/schema.sql", [f.get("file") for f in out["findings"]])

    def test_a_done_setup_task_naming_a_folder_does_not_plan_new_files_in_it(self) -> None:
        self.write("src/auth/password-fallback.ts", "export const loginWithPassword = () => true\n")
        self.write("src/config/mailer.ts", "export const mailer = { port: 2525 }\n")
        verdicts = {c["file"]: (c["verdict"], c["task"]) for c in self.xref("check")["changed"]}
        self.assertEqual(verdicts["src/auth/password-fallback.ts"], ("unplanned", None))
        self.assertEqual(verdicts["src/config/mailer.ts"], ("planned", "T002"))

    def test_success_criteria_are_not_claimed_as_covered(self) -> None:
        rows = {r["id"]: r["covered"] for r in self.xref("map")["requirements"]}
        self.assertEqual((rows["FR-002"], rows["FR-005"], rows["SC-001"]), (True, False, None))

    def test_a_project_in_a_folder_of_a_larger_repository_checks_only_its_own_files(self) -> None:
        mono = Path(tempfile.mkdtemp(prefix="xref-mono-"))
        self.addCleanup(shutil.rmtree, mono, True)
        copy_committed_demo(mono / "apps" / "login")
        (mono / "libs").mkdir()
        (mono / "libs" / "shared.ts").write_text("export const x = 1\n", encoding="utf-8")
        for args in (["init", "-q"], ["add", "-A"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]):
            subprocess.run(["git", *args], cwd=mono, check=True, capture_output=True)
        (mono / "libs" / "shared.ts").write_text("export const x = 2\n", encoding="utf-8")
        (mono / "apps" / "login" / "src" / "ui").mkdir(parents=True)
        (mono / "apps" / "login" / "src" / "ui" / "theme.ts").write_text("export const dark = true\n", encoding="utf-8")
        (mono / "apps" / "login" / "src" / "auth" / "token.ts").write_text("// @spec 001-magic-link-login/FR-002\nexport const ttl = 900\n", encoding="utf-8")
        done = subprocess.run([sys.executable, "-I", str(SCRIPT), "check", "--json"], cwd=mono / "apps" / "login", capture_output=True, text=True, env=clean_env())
        self.assertEqual(done.returncode, 0, done.stderr)
        changed = {c["file"]: c["verdict"] for c in json.loads(done.stdout)["changed"]}
        self.assertEqual(changed, {"src/auth/token.ts": "planned", "src/ui/theme.ts": "unplanned"})

    def test_check_against_a_base_counts_only_committed_changes(self) -> None:
        self.git("checkout", "-qb", "feature")
        self.write("src/ui/theme.ts", "export const dark = true\n")
        self.commit_all("theme")
        self.write("src/ui/scratch.ts", "uncommitted\n")
        base = self.git("rev-parse", "HEAD~1").strip()
        self.assertEqual([c["file"] for c in self.xref("check", "--base", base, "--no-write")["changed"]], ["src/ui/theme.ts"])
        self.assertEqual([c["file"] for c in self.xref("check", "--no-write")["changed"]], ["src/ui/scratch.ts"])

    def test_linking_an_unplanned_file_clears_the_drift(self) -> None:
        self.write("src/ui/theme.ts", "export const dark = true\n")
        self.assertEqual(self.xref("check")["level"], "yellow")
        self.assertEqual(self.xref("link", "--file", "src/ui/theme.ts", "--id", f"{FEATURE.split('/')[1]}/FR-004")["level"], "green")
        self.assertEqual(self.xref("check")["changed"][0]["verdict"], "linked")
        committed = self.ledger()
        self.assertEqual((committed["links"], committed["accepted"]), ({"src/ui/theme.ts": ["FR-004"]}, []))
        self.assertIn("FR-004", committed["fingerprints"])
        error = self.xref("link", "--file", "src/ui/theme.ts", "--id", "FR-099", code=2)
        self.assertIn("no requirement", error["error"])

    def test_three_unplanned_files_turn_the_light_red(self) -> None:
        for name in ("a", "b", "c"):
            self.write(f"src/misc/{name}.ts", "x\n")
        self.assertEqual(self.xref("check", "--fail-on", "red", code=1)["level"], "red")

    def test_an_anchor_to_a_requirement_the_spec_lacks_is_drift(self) -> None:
        self.write("src/auth/request-link.ts", "// @spec 001-magic-link-login/FR-009\n")
        self.write("tests/auth/old.test.ts", "// @spec FR-010\ntest('x', () => {})\n")
        findings = {f["kind"]: f["text"] for f in self.xref("check")["findings"]}
        self.assertEqual(findings["dangling"], "src/auth/request-link.ts:1 anchors 001-magic-link-login/FR-009, which the spec no longer has")
        self.assertEqual(findings["orphan-test"], "tests/auth/old.test.ts:1 tests FR-010, which the spec no longer has")

    def test_an_anchor_names_every_id_after_spec(self) -> None:
        ids = [a["id"] for a in X.anchors_in("// @spec 001-x/FR-003 FR-004\n# @spec FR-001, US1-AS2 and more", "f.ts")]
        self.assertEqual(ids, ["001-x/FR-003", "001-x/FR-004", "FR-001", "US1-AS2"])

    def test_anchors_in_new_uncommitted_files_are_found_without_ripgrep(self) -> None:
        # A PATH with git but no rg: the git grep fallback has to search untracked files too, scenario anchors included.
        tools = Path(tempfile.mkdtemp(prefix="xref-tools-"))
        self.addCleanup(shutil.rmtree, tools, True)
        (tools / "git").symlink_to(shutil.which("git"))
        self.write("src/auth/callback.ts", "// @spec 001-magic-link-login/FR-003\n")
        self.write("e2e/login.ts", "// @spec 001-magic-link-login/US1-AS1\n")
        out = self.xref("map", env={"PATH": str(tools)})
        fr3 = next(r for r in out["requirements"] if r["id"] == "FR-003")
        self.assertEqual(fr3["anchors"], ["src/auth/callback.ts:1"])
        self.assertIn({"id": "001-magic-link-login/US1-AS1", "file": "e2e/login.ts", "line": 1}, self.local()["anchors"])
        check = self.xref("check", env={"PATH": str(tools)})
        self.assertIn({"file": "e2e/login.ts", "verdict": "linked", "task": None}, check["changed"])
        self.assertEqual(check["findings"], [])

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
        self.assertEqual(self.xref("check", "--no-write")["openIntents"], ["Please also allow passwords as a fallback"])
        verdict = self.outside("verdict.txt", 'My verdict:\n{"score": 40, "verdict": "drift", "reasons": ["password fallback"], "intent_changes": [{"text": "allow passwords as a fallback", "kind": "contradicts"}]}')
        out = self.xref("record-check", verdict)
        self.assertEqual((out["score"], out["level"]), (40, "green"))
        self.assertEqual([f["kind"] for f in out["advice"]], ["semantic", "intent"])
        local = self.local()
        self.assertEqual(local["intents"][0]["status"], "contradicts")
        self.assertEqual(local["touched"]["T004"], ["src/auth/token.ts"])
        self.assertEqual([v["score"] for v in local["semanticHistory"]], [40])
        self.assertIn("diffHash", local["semantic"])
        self.assertEqual(self.ledger()["schema_version"], 2)
        # The LLM verdict is advice for the gate: the check stays green with no deterministic finding.
        check = self.xref("check", "--fail-on", "yellow")
        self.assertEqual((check["level"], check["advice"]["score"]), ("green", 40))
        self.assertEqual(self.xref("record-check", "map-missing.json", code=2)["error"], "map-missing.json holds no verdict with a numeric score")

    def test_report_prints_the_matrix_and_writes_it_with_out(self) -> None:
        report = self.xref("report", as_json=False)
        self.assertIn("# Traceability: Magic Link Login", report)
        self.assertIn("| **FR-002** System MUST send a single-use link that expires after 15 minutes. | planned | T004 | – | src/auth/token.ts:1 |", report)
        self.assertIn("**FR-005** ⚠ uncovered ❓", report)
        self.assertIn("- none", report)
        self.assertIn("- US2 has no acceptance scenarios", report)
        self.assertIn("## Metrics", report)
        out = self.xref("report", "--out", f"{FEATURE}/xref-report.md")
        self.assertEqual(out["report"], f"{FEATURE}/xref-report.md")
        data = json.loads((self.root / FEATURE / "xref-report.md").read_text(encoding="utf-8"))
        self.assertEqual(data["levels"]["planned"], 4)
        self.assertEqual(data["metrics"]["unplanned"]["caught"], 0)

    def test_the_feature_comes_from_spec_kits_pointers(self) -> None:
        self.write("specs/002-export/spec.md", "# Feature Specification: Export\n\n- **FR-001**: Users MUST export.\n")
        self.assertEqual(self.xref("map", env={"SPECIFY_FEATURE_DIRECTORY": "specs/002-export"})["feature"], "specs/002-export")
        self.assertEqual(self.xref("map", "--feature", "specs/002-export")["coverage"]["uncovered"], ["FR-001"])
        self.assertEqual(self.xref("map")["feature"], FEATURE)
        self.assertIn("holds no spec.md", self.xref("map", "--feature", "specs/404", code=2)["error"])
        shutil.rmtree(self.root / "specs")
        self.assertIn("No Spec Kit feature found", self.xref("check", code=2)["error"])

    # --- 0.2: feature resolution, CI, verification, migration, summary --------------------------

    def test_selftest_passes_on_the_shared_cases(self) -> None:
        done = subprocess.run([sys.executable, "-I", str(SCRIPT), "selftest"], capture_output=True, text=True, env=clean_env())
        self.assertEqual(done.returncode, 0, done.stdout[-2000:])
        self.assertNotIn("FAIL", done.stdout)
        self.assertRegex(done.stdout, r"\n\d+ ok, 0 failed\n$")

    def test_check_no_write_writes_nothing(self) -> None:
        self.write("src/ui/theme.ts", "export const dark = true\n")
        out = self.xref("check", "--no-write", "--fail-on", "yellow", code=1)
        self.assertEqual([f["kind"] for f in out["findings"]], ["unplanned"])
        self.assertFalse((self.root / FEATURE / "xref.json").exists())
        self.assertFalse((self.root / ".specify" / "xref").exists())

    def test_ci_refuses_to_guess_the_feature(self) -> None:
        self.without_feature_pointer("002-export")
        error = self.xref("check", code=2, env={"CI": "true"})["error"]
        self.assertIn("specs/001-magic-link-login", error)
        self.assertIn("specs/002-export", error)
        # Outside CI the spec written last stands in.
        self.assertEqual(self.xref("map")["feature"], "specs/002-export")

    def test_a_ledger_from_before_0_5_is_rebaselined_not_flagged(self) -> None:
        # The requirement wraps: the old parser saw its first line only and stored that fingerprint.
        spec = self.root / FEATURE / "spec.md"
        text = spec.read_text().replace("- **FR-002**: System MUST send a single-use link that expires after 15 minutes.", "- **FR-002**: System MUST send a single-use link that expires\n  after 15 minutes.")
        spec.write_text(text)
        old = X.fingerprint(X.parse_spec(text, wrap=False)["reqs"][1]["text"])
        self.write(f"{FEATURE}/xref.json", json.dumps({"schema_version": 2, "feature": FEATURE, "map": {}, "links": {}, "accepted": [], "fingerprints": {"FR-002": old}}))
        out = self.xref("check", "--no-write")
        self.assertNotIn("re-verify", [f["kind"] for f in out["findings"]])

    def test_ci_takes_a_lone_feature(self) -> None:
        # A PR branch not named NNN-*, feature.json gitignored, one feature: that one, not an error.
        (self.root / ".specify" / "feature.json").unlink(missing_ok=True)
        self.write("src/ui/theme.ts", "export const dark = true\n")
        out = self.xref("check", "--no-write", "--fail-on", "yellow", code=1, env={"CI": "true"})
        self.assertEqual(out["feature"], FEATURE)
        self.assertEqual([f["kind"] for f in out["findings"]], ["unplanned"])

    def test_the_branch_names_the_feature(self) -> None:
        self.without_feature_pointer("002-export")
        self.git("checkout", "-qb", "001-magic-link-login-fix")
        self.assertEqual(self.xref("check", "--no-write", env={"CI": "true"})["feature"], FEATURE)
        self.assertEqual(self.xref("check", "--no-write", env={"CI": "true", "GITHUB_HEAD_REF": "feature/002-export-csv"})["feature"], "specs/002-export")

    def test_the_diff_names_the_feature_against_a_base(self) -> None:
        self.without_feature_pointer("002-export")
        base = self.git("rev-parse", "HEAD").strip()
        self.git("checkout", "-qb", "work")
        self.write("src/auth/request-link.ts", "export const handler = () => {}\n")
        self.commit_all("handler")
        out = self.xref("check", "--base", base, "--no-write", env={"CI": "true"})
        self.assertEqual((out["feature"], out["changed"]), (FEATURE, [{"file": "src/auth/request-link.ts", "verdict": "planned", "task": "T005"}]))

    def test_verify_stores_test_results_in_the_local_half_only(self) -> None:
        self.write("tests/auth/callback.test.ts", "// @spec 001-magic-link-login/FR-003\ntest('signs in', () => {})\n")
        out = self.xref("verify", "--junit", self.outside("report.xml", JUNIT.format(failure="")))
        self.assertEqual((out["passing"], out["failing"]), (["FR-002", "FR-003"], []))
        self.assertEqual(self.local()["verification"]["FR-002"]["tests"], ["auth.token.FR-002 issues a single-use token"])
        committed = self.ledger()
        self.assertNotIn("verification", committed)
        self.assertEqual(sorted(committed["fingerprints"]), ["FR-002", "FR-003"])
        failing = self.outside("report.xml", JUNIT.format(failure='<failure message="no">x</failure>'))
        self.assertEqual(self.xref("verify", "--junit", failing, code=1)["failing"], ["FR-003"])
        self.assertEqual(self.local()["verification"]["FR-003"]["status"], "failing")

    def test_migrate_turns_a_v1_ledger_into_two_v2_halves(self) -> None:
        v1 = {
            "schema_version": 1,
            "feature": FEATURE,
            "updated_at": "2026-10-09T10:00:00.000Z",
            "summary": {"level": "yellow"},
            "tasks": {"T004": {"touched": ["src/auth/token.ts"], "linked": ["src/ui/theme.ts"]}},
            "requirements": {"FR-002": {"tasks": ["T004"], "files": [], "sources": ["llm"]}},
            "unplanned": [{"file": "src/x.ts", "at": "2026-10-09T10:02:00.000Z", "task": None, "acknowledged": True}, {"file": "src/y.ts", "at": "t", "task": None, "acknowledged": False}],
            "intents": [{"at": "t", "text": "setz T004 um", "task": "T004", "status": "logged"}],
            "anchors": [],
            "semantic": None,
        }
        self.write(f"{FEATURE}/xref.json", json.dumps(v1))
        self.assertTrue(self.xref("migrate")["migrated"])
        committed = self.ledger()
        self.assertEqual(committed, {"accepted": ["src/x.ts"], "feature": FEATURE, "fingerprintVersion": 2, "fingerprints": {}, "links": {"src/ui/theme.ts": ["T004"]}, "map": {"FR-002": ["T004"]}, "schema_version": 2})
        local = self.local()
        self.assertEqual((local["touched"], local["unplanned"], local["intents"][0]["text"]), ({"T004": ["src/auth/token.ts"]}, [{"file": "src/y.ts", "at": "t", "task": None}], "setz T004 um"))
        before = (self.root / FEATURE / "xref.json").read_bytes()
        self.assertFalse(self.xref("migrate")["migrated"])
        self.assertEqual((self.root / FEATURE / "xref.json").read_bytes(), before)

    def test_summary_is_markdown_for_the_pull_request(self) -> None:
        tasks = (self.root / FEATURE / "tasks.md").read_text(encoding="utf-8").replace("- [ ] T004", "- [x] T004")
        self.write(f"{FEATURE}/tasks.md", tasks)
        self.write("tests/auth/token.test.ts", "// @spec 001-magic-link-login/FR-002\ntest('issues a token', () => {})\n")
        self.write("src/ui/theme.ts", "export const dark = true\n")
        self.write("package.json", "{}\n")
        summary = self.xref("summary", "--junit", self.outside("report.xml", JUNIT.format(failure="")), as_json=False)
        self.assertTrue(summary.startswith("## Spec X-Ref: Magic Link Login\n"))
        self.assertIn("| Requirement | Level | Tasks | Files |", summary)
        self.assertIn("| **FR-002** System MUST send a single-use link that expires after 15 minutes. | passing | T004 | `src/auth/token.ts`, `tests/auth/token.test.ts` |", summary)
        self.assertIn("### Unplanned files\n\n- `src/ui/theme.ts`", summary)
        self.assertIn("### Unclear files\n\n- `package.json`", summary)
        self.assertIn("### Notes\n\n- US2 has no acceptance scenarios\n- US3 has no acceptance scenarios", summary)
        self.assertFalse((self.root / FEATURE / "xref.json").exists())
        self.assertFalse((self.root / ".specify" / "xref").exists())

    def test_summary_never_shows_what_a_person_typed(self) -> None:
        self.xref("map")
        local = self.local()
        local["intents"] = [{"at": "t", "text": "secret wish about passwords", "task": None, "status": "contradicts"}]
        self.write(LOCAL, json.dumps(local))
        self.assertNotIn("secret wish", self.xref("summary", as_json=False))
        self.assertNotIn("secret wish", json.dumps(self.xref("summary")))

    def test_the_committed_half_is_byte_stable(self) -> None:
        mapping = self.outside("map.json", '{"FR-002": ["T007", "T004"], "FR-001": ["T005"]}')
        self.xref("map", "--apply", mapping)
        first = (self.root / FEATURE / "xref.json").read_bytes()
        self.xref("map", "--apply", mapping)
        self.xref("link", "--file", "src/auth/token.ts", "--id", "T007")
        self.xref("link", "--file", "src/auth/token.ts", "--id", "T007")
        second = (self.root / FEATURE / "xref.json").read_bytes()
        self.write("src/ui/theme.ts", "x\n")
        self.xref("check")
        self.assertEqual((self.root / FEATURE / "xref.json").read_bytes(), second)
        self.assertNotIn(b"_at", second)
        self.assertEqual(json.loads(first)["map"], json.loads(second)["map"])
        self.assertEqual(json.loads(second)["links"], {"src/auth/token.ts": ["T007"]})
        self.assertEqual(second.decode("utf-8"), json.dumps(json.loads(second), indent=2, sort_keys=True, ensure_ascii=False) + "\n")

    def test_keys_another_tool_wrote_survive_a_rewrite(self) -> None:
        self.write(f"{FEATURE}/xref.json", json.dumps({"schema_version": 2, "zeta": {"b": 1, "a": [2, 1]}, "feature": FEATURE, "map": {}, "links": {}, "accepted": [], "fingerprints": {}, "alpha": True}))
        self.write(LOCAL, json.dumps({"schema_version": 2, "checkpoints": {"T004": "abc"}, "run": {"step": 3}, "briefing": None, "intents": []}))
        self.xref("link", "--file", "src/ui/theme.ts", "--id", "FR-004")
        self.xref("verify", "--junit", self.outside("report.xml", JUNIT.format(failure="")))
        committed = self.ledger()
        self.assertEqual((committed["zeta"], committed["alpha"]), ({"a": [2, 1], "b": 1}, True))
        self.assertEqual(list(committed), sorted(committed))
        local = self.local()
        self.assertEqual((local["checkpoints"], local["run"], local["briefing"]), ({"T004": "abc"}, {"step": 3}, None))
        self.assertIn("FR-002", local["verification"])


if __name__ == "__main__":
    unittest.main()
