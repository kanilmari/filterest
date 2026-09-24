"""Keep `./filterest release verify` running every release source check in order.

Bridges the entry point with stand-in checks that record how they were called.
Exists so a check cannot silently drop out of the release gate, and so private
names an embedding workspace supplies reach the checks that need them.
"""

from __future__ import annotations

import json
from pathlib import Path

from server_tools.release import verify_source


CHECK_SCRIPTS = (
    "release/audit_source_boundary.py",
    "release/audit_public_root_files.py",
    "scripts/validate_release_ledger.py",
    "scripts/validate_app_db_compatibility.py",
    "public_slice_export/audit_public_bootstrap.py",
    "release/audit_public_demo_assets.py",
    "release/audit_browser_bundle.py",
)


def stand_in_checkout(tmp_path: Path, failing: str | None = None) -> tuple[Path, Path]:
    target = tmp_path / "checkout"
    calls = tmp_path / "calls.jsonl"
    for script in CHECK_SCRIPTS:
        path = target / "app/server_tools" / script
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "import json, sys\n"
            f"open({str(calls)!r}, 'a').write(json.dumps([{script!r}, sys.argv[1:]]) + '\\n')\n"
            f"raise SystemExit({1 if script == failing else 0})\n"
        )
    return target, calls


def recorded(calls: Path) -> list[list]:
    return [json.loads(line) for line in calls.read_text().splitlines()]


def test_every_check_runs_in_order_with_supplied_private_names(tmp_path, capsys):
    target, calls = stand_in_checkout(tmp_path)

    status = verify_source.main([
        "--target", str(target),
        "--forbidden-name", "example_private_shell",
        "--forbidden-marker", "ExampleShell",
    ])

    assert status == 0
    runs = recorded(calls)
    assert [script for script, _ in runs] == list(CHECK_SCRIPTS)
    arguments = dict((script, args) for script, args in runs)
    assert "--forbidden-name=example_private_shell" in arguments["release/audit_source_boundary.py"]
    assert arguments["release/audit_public_demo_assets.py"][-2:] == [
        "--allow-local-mutable-homes",
        "--forbidden-marker=ExampleShell",
    ]
    assert arguments["scripts/validate_app_db_compatibility.py"] == [
        "--repository-root", str(target.resolve() / "app"),
    ]
    assert arguments["release/audit_browser_bundle.py"] == ["--target", str(target.resolve())]
    assert "Release source checks passed (7 checks)" in capsys.readouterr().out


def test_the_first_failing_check_stops_the_run(tmp_path, capsys):
    target, calls = stand_in_checkout(tmp_path, failing="scripts/validate_release_ledger.py")

    assert verify_source.main(["--target", str(target)]) == 1
    assert [script for script, _ in recorded(calls)] == list(CHECK_SCRIPTS[:3])
    assert "Release source check failed: release ledger." in capsys.readouterr().err


def test_default_target_is_this_checkout() -> None:
    assert verify_source.DEFAULT_TARGET == Path(__file__).resolve().parents[3]
