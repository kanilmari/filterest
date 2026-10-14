"""test_custom_root_proof_tooling.py
Prove manual suite isolation and operator-file ownership without a dev instance.
Connect matrix/relevant selection and the coordinator helper to temporary files.
Keep security failures observable without browsers, database, Git writes or network.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

from relevant_checks import ROOT, MAP_PATH, make_plan, validate_map


OPERATOR = ROOT / "app/testing/e2e/T_admin/custom_root_fixture_operator.py"
spec = importlib.util.spec_from_file_location("custom_root_fixture_operator", OPERATOR)
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
MANUAL = "app/testing/e2e/T_admin/T18_custom_root_page.spec.ts"


@pytest.fixture
def placed(tmp_path):
    destination = tmp_path / "site_root"
    operator.operate("place", str(destination))
    return destination


def test_manual_spec_excluded_from_both_matrix_modes_and_relevant_selection():
    selection = ROOT / "app/testing/e2e/matrix-test-selection.cjs"
    script = "const {matrixTestIgnore}=require(process.argv[1]);process.stdout.write(JSON.stringify([matrixTestIgnore(false),matrixTestIgnore(true)]));"
    result = subprocess.run(["node", "-e", script, str(selection)], capture_output=True, text=True, check=True)
    ordinary, setup = json.loads(result.stdout)
    relative = MANUAL.removeprefix("app/testing/e2e/")
    assert relative in ordinary and relative in setup
    assert "**/setup/**" in ordinary and "**/setup/**" not in setup
    config = (ROOT / "app/playwright.config.ts").read_text()
    assert "testIgnore: matrixTestIgnore(includeSetupTests)" in config
    assert "from './testing/e2e/matrix-test-selection.cjs'" in config
    plan = make_plan(ROOT, [MANUAL])
    assert all(MANUAL not in check["targets"] for check in plan["heavy"])


def test_manual_spec_cannot_be_curated_into_regular_browser_coverage():
    policy = json.loads((ROOT / MAP_PATH).read_text())
    next(entry for entry in policy["browser_areas"] if entry["specs"])["specs"].append(MANUAL)
    with pytest.raises(ValueError, match="manual spec cannot enter"):
        validate_map(ROOT, policy)


def test_fixture_round_trip_removes_only_created_files(placed):
    operator.operate("verify", str(placed))
    unrelated = placed / "operator.css"
    unrelated.write_text("keep me")
    operator.operate("hide", str(placed))
    assert not (placed / "index.html").exists()
    with pytest.raises(ValueError, match="absent"):
        operator.operate("verify", str(placed))
    operator.operate("show", str(placed))
    operator.operate("verify", str(placed))
    operator.operate("remove", str(placed))
    assert list(placed.iterdir()) == [unrelated]
    assert unrelated.read_text() == "keep me"


def test_hidden_fixture_is_removed_after_failed_browser_proof(placed):
    operator.operate("hide", str(placed))
    operator.operate("remove", str(placed))
    assert not placed.exists()
    operator.operate("remove", str(placed))  # Global cleanup is safely idempotent.


@pytest.mark.parametrize("name", [*operator.FILES, operator.HIDDEN, operator.MANIFEST])
def test_helper_refuses_existing_operator_file(tmp_path, name):
    destination = tmp_path / "site_root"
    destination.mkdir()
    protected = destination / name
    protected.write_text("operator original")
    with pytest.raises(ValueError, match="Refusing to overwrite"):
        operator.operate("place", str(destination))
    assert list(destination.iterdir()) == [protected]
    assert protected.read_text() == "operator original"


def test_cleanup_preserves_changed_file_and_manifest(placed):
    changed = placed / "custom_root.css"
    changed.write_text("operator changed this")
    before = set(placed.iterdir())
    with pytest.raises(ValueError, match="Operator file changed"):
        operator.operate("remove", str(placed))
    assert set(placed.iterdir()) == before
    assert changed.read_text() == "operator changed this"


def test_cleanup_preserves_replacement_with_identical_bytes(placed):
    file = placed / "index.html"
    replacement = placed / "replacement"
    replacement.write_bytes(file.read_bytes())
    replacement.replace(file)
    with pytest.raises(ValueError, match="Operator file changed"):
        operator.operate("remove", str(placed))
    assert file.exists()


def test_hide_and_show_refuse_operator_destination(placed):
    hidden = placed / operator.HIDDEN
    hidden.write_text("operator")
    with pytest.raises(ValueError, match="Operator file changed"):
        operator.operate("hide", str(placed))
    assert hidden.read_text() == "operator"
    hidden.unlink()
    operator.operate("hide", str(placed))
    (placed / "index.html").write_text("replacement")
    with pytest.raises(ValueError, match="Operator file changed"):
        operator.operate("show", str(placed))
    assert (placed / "index.html").read_text() == "replacement"


def test_existing_empty_directory_remains_after_cleanup(tmp_path):
    destination = tmp_path / "site_root"
    destination.mkdir()
    operator.operate("place", str(destination))
    operator.operate("remove", str(destination))
    assert destination.is_dir() and not list(destination.iterdir())


def test_symlink_destination_is_refused(tmp_path):
    actual = tmp_path / "actual"
    actual.mkdir()
    destination = tmp_path / "site_root"
    destination.symlink_to(actual, target_is_directory=True)
    with pytest.raises(ValueError, match="non-symlink"):
        operator.operate("place", str(destination))
    assert not list(actual.iterdir())


def test_missing_placed_file_fails_loudly(placed):
    (placed / "index.html").unlink()
    result = subprocess.run(["bash", str(OPERATOR.with_name("T18_custom_root_fixture.sh")), "verify", str(placed)],
                            capture_output=True, text=True)
    assert result.returncode == 1
    assert "NOT completed" in result.stderr and "absent: index.html" in result.stderr
    operator.operate("remove", str(placed))
    assert not placed.exists()
