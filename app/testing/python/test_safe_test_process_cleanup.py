"""Verify the browser-test harness cleans up only the browsers its own run started.

Bridges the real safe_test.sh with a stand-in Playwright that leaves a detached
"browser" behind, the way a crashed Playwright worker does.
Exists because several sessions run browser tests on one machine at once, and
an earlier cleanup ended every browser that appeared during its run, other
sessions' included.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest


SOURCE_ROOT = Path(__file__).resolve().parents[2]
HARNESS = SOURCE_ROOT / "server_tools/scripts/safe_test.sh"

FAKE_PLAYWRIGHT = """#!/usr/bin/env bash
# Stand-in Playwright: starts one browser detached into its own session, as
# Playwright does, then waits for a release file and exits without closing it.
setsid bash -c 'echo $$ > "$0"; exec -a "fake-chromium --headless=new" sleep 300' \\
    "$FAKE_BROWSER_PID_FILE" </dev/null >/dev/null 2>&1 &
while [[ -n "${FAKE_PLAYWRIGHT_RELEASE_FILE:-}" && ! -e "$FAKE_PLAYWRIGHT_RELEASE_FILE" ]]; do
    sleep 0.1
done
exit 0
"""


def is_alive(pid: int) -> bool:
    try:
        state = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8").rsplit(")", 1)[1].split()[0]
    except (FileNotFoundError, IndexError, ProcessLookupError):
        return False
    return state != "Z"


def wait_for(predicate, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError("condition was not reached in time")


@pytest.fixture
def fake_playwright_root(tmp_path: Path) -> Path:
    if not Path("/proc/self/environ").exists() or shutil.which("setsid") is None:
        pytest.skip("process-environment cleanup needs Linux /proc and setsid")
    node_modules = tmp_path / "node_modules"
    (node_modules / ".bin").mkdir(parents=True)
    playwright = node_modules / ".bin/playwright"
    playwright.write_text(FAKE_PLAYWRIGHT, encoding="utf-8")
    playwright.chmod(0o755)
    return node_modules


def start_run(node_modules: Path, work: Path, name: str) -> subprocess.Popen[str]:
    environment = dict(os.environ)
    environment.update(
        {
            "FILTEREST_NODE_MODULES_ROOT": str(node_modules),
            "FAKE_BROWSER_PID_FILE": str(work / f"{name}.pid"),
            "FAKE_PLAYWRIGHT_RELEASE_FILE": str(work / f"{name}.release"),
        }
    )
    return subprocess.Popen(
        ["bash", str(HARNESS), "--workers=1"],
        env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )


def read_pid(path: Path) -> int:
    wait_for(lambda: path.exists() and path.read_text(encoding="utf-8").strip().isdigit())
    return int(path.read_text(encoding="utf-8").strip())


def test_concurrent_run_cleanup_spares_the_other_runs_browser(
    fake_playwright_root: Path, tmp_path: Path
) -> None:
    browsers: list[int] = []
    runs: list[subprocess.Popen[str]] = []
    try:
        # Run B starts first; run A's browser then appears while B is running,
        # which is exactly what the earlier before/after comparison killed.
        runs.append(start_run(fake_playwright_root, tmp_path, "b"))
        browsers.append(read_pid(tmp_path / "b.pid"))
        runs.append(start_run(fake_playwright_root, tmp_path, "a"))
        browsers.append(read_pid(tmp_path / "a.pid"))
        browser_b, browser_a = browsers
        assert is_alive(browser_a) and is_alive(browser_b)

        (tmp_path / "b.release").touch()
        output_b, _ = runs[0].communicate(timeout=60)
        assert runs[0].returncode == 0, output_b
        assert "1 leftover browser process(es) started by this run" in output_b
        wait_for(lambda: not is_alive(browser_b))
        assert is_alive(browser_a), "run B's cleanup ended run A's browser"

        (tmp_path / "a.release").touch()
        output_a, _ = runs[1].communicate(timeout=60)
        assert runs[1].returncode == 0, output_a
        wait_for(lambda: not is_alive(browser_a))
    finally:
        for run in runs:
            if run.poll() is None:
                run.kill()
        for pid in browsers:
            if is_alive(pid):
                os.kill(pid, 9)


def test_missing_playwright_names_the_setup_command(tmp_path: Path) -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is required to resolve the project boundary")
    empty_modules = tmp_path / "node_modules"
    empty_modules.mkdir()
    environment = dict(os.environ)
    environment.update(
        {
            "FILTEREST_NODE_MODULES_ROOT": str(empty_modules),
            "PATH": f"{Path(node).parent}:/usr/bin:/bin",
            "HOME": str(tmp_path),
        }
    )
    if shutil.which("playwright", path=environment["PATH"]):
        pytest.skip("a system-wide playwright is installed")
    completed = subprocess.run(
        ["bash", str(HARNESS)], env=environment, capture_output=True, text=True, timeout=60
    )
    assert completed.returncode == 127
    assert "Playwright is not installed for this installation" in completed.stderr
    assert "./filterest setup --profile development --dependencies-only" in completed.stderr
