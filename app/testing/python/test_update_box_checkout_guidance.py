"""Verify the ordinary launcher supplies Docker with truthful host checkout evidence.
Connects temporary Git installations to a harmless Docker-dispatch probe.
Keeps detached, Gitless and other-branch installations on neutral operator guidance.
"""
from pathlib import Path
import os
import shutil
import subprocess

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("checkout", ["main", "workline", "detached", "gitless"])
def test_launcher_derives_checkout_branch(tmp_path: Path, checkout: str) -> None:
    installation = tmp_path / "installation"
    application = installation / "app"
    application.mkdir(parents=True)
    shutil.copy2(APP_ROOT / "filterest", application / "filterest")
    library = application / "server_tools/lib"
    library.mkdir(parents=True)
    # Source just the launcher's existing setup dependencies; no real operation runs.
    for name in ("python_bytecode_cache.sh", "project_python_venv.sh", "installation_records.sh"):
        shutil.copy2(APP_ROOT / "server_tools/lib" / name, library / name)
    probe = application / "server_tools/run_filterest_docker.sh"
    probe.write_text('#!/bin/bash\nprintf "%s" "$FILTEREST_UPDATE_CHECKOUT_BRANCH"\n')
    probe.chmod(0o755)
    if checkout != "gitless":
        subprocess.run(["git", "init", "--initial-branch=main", str(installation)],
                       check=True, capture_output=True)
        if checkout == "workline":
            subprocess.run(["git", "-C", str(installation), "symbolic-ref", "HEAD", "refs/heads/workline"],
                           check=True, capture_output=True)
        elif checkout == "detached":
            (installation / ".git/HEAD").write_text("0123456789abcdef0123456789abcdef01234567\n")
    environment = os.environ.copy()
    environment.update(FILTEREST_PROJECT_ROOT_OVERRIDE=str(installation),
                       FILTEREST_UPDATE_CHECKOUT_BRANCH="inherited-main-claim",
                       PYTHONPYCACHEPREFIX=str(tmp_path / "python-cache"))
    result = subprocess.run([str(application / "filterest"), "docker", "status"],
                            env=environment, check=True, capture_output=True, text=True)
    assert result.stdout == ("main" if checkout == "main" else "workline" if checkout == "workline" else "")
