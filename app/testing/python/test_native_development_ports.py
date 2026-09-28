"""Verifies the one rule for each checkout's native development port and origin.
Bridges native_development_ports.env with its Python, shell and JavaScript readers.
Exists so the public product keeps 8100 and the private Easelect checkout 8082
without any tool restating that choice, and so development credentials and the
self-signed certificate stay limited to the exact native origin on either port.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import subprocess

import pytest

try:
    from filterest.app.server_tools.lib import native_origin
except ModuleNotFoundError:
    from server_tools.lib import native_origin


SOURCE_ROOT = Path(__file__).resolve().parents[2]
PORTS_FILE = SOURCE_ROOT / "server_tools/lib/native_development_ports.env"
PORT_LIBRARY = SOURCE_ROOT / "server_tools/lib/filterest_port_preflight.sh"

# Pinned on purpose: reading the expected values from the file under test would
# let a wrong number there pass.
PUBLIC_PORT = 8100
EASELECT_PORT = 8082

# Every tool that used to choose between the two ports itself.
PORT_DECISION_FILES = (
    "server_tools/agent_tools/db_task.py",
    "server_tools/agent_tools/easelect_api_client.py",
    "server_tools/agent_tools/dev_agent_credentials.py",
    "server_tools/lib/native_origin.py",
    "server_tools/lib/filterest_port_preflight.sh",
    "server_tools/scripts/local_filterest_target.cjs",
    "frontend/vite.config.mjs",
    "filterest",
    "ctl",
    "worker_agent",
    "server_tools/install_filterest.sh",
    "server_tools/update_filterest.sh",
    "server_tools/run_filterest_admin.sh",
    "server_tools/setup_local_dev_environment.sh",
    "server_tools/agent_tools/worker_agent/worker_agent_core.sh",
    "server_tools/agent_tools/worker_agent/worker_agent_prompt_builder.sh",
    "server_tools/ctl/lib/common.sh",
    "server_tools/ctl/lib/coding_agent.sh",
    "server_tools/ctl/lib/instance_list.sh",
    "../filterest",
    "../ctl",
    "../worker_agent",
)

# Separate decisions that merely share a number: the stop command's fixed port
# set, and the published port of a Docker instance.
OTHER_DECISIONS_SHARING_A_NUMBER = {
    "server_tools/ctl/lib/common.sh": {"for port in 8082 8083 5173; do"},
    "server_tools/ctl/lib/instance_list.sh": {'port="${APP_PORT:-8082}"'},
}


def make_easelect_checkout(root: Path) -> Path:
    (root / ".git").mkdir(parents=True)
    (root / "VERSION_EASELECT").write_text("9.3.19\n", encoding="utf-8")
    return root


def test_the_ports_file_names_the_public_and_the_private_native_port() -> None:
    assert native_origin.read_native_development_ports() == (PUBLIC_PORT, EASELECT_PORT)
    assert native_origin.native_port_for_checkout(False) == PUBLIC_PORT
    assert native_origin.native_port_for_checkout(True) == EASELECT_PORT


def test_the_checkout_markers_choose_the_port(tmp_path: Path) -> None:
    easelect = make_easelect_checkout(tmp_path / "easelect")
    public = tmp_path / "filterest"
    public.mkdir()
    git_only = tmp_path / "git-only"
    (git_only / ".git").mkdir(parents=True)

    assert native_origin.native_development_port(easelect) == EASELECT_PORT
    assert native_origin.native_development_port(public) == PUBLIC_PORT
    assert native_origin.native_development_port(git_only) == PUBLIC_PORT
    assert native_origin.native_development_base_url(easelect) == "https://localhost:8082"
    assert native_origin.native_development_base_url(public) == "https://localhost:8100"


@pytest.mark.parametrize(
    "contents",
    (
        "FILTEREST_NATIVE_PORT=8100\n",
        "FILTEREST_NATIVE_PORT=eighty\nEASELECT_NATIVE_PORT=8082\n",
        "FILTEREST_NATIVE_PORT=0\nEASELECT_NATIVE_PORT=8082\n",
        "FILTEREST_NATIVE_PORT=70000\nEASELECT_NATIVE_PORT=8082\n",
        "FILTEREST_NATIVE_PORT 8100\nEASELECT_NATIVE_PORT=8082\n",
    ),
)
def test_a_malformed_ports_file_is_refused(tmp_path: Path, contents: str) -> None:
    ports_file = tmp_path / "native_development_ports.env"
    ports_file.write_text(contents, encoding="utf-8")

    with pytest.raises(ValueError):
        native_origin.read_native_development_ports(ports_file)


def test_a_missing_ports_file_is_refused(tmp_path: Path) -> None:
    with pytest.raises(OSError):
        native_origin.read_native_development_ports(tmp_path / "missing.env")


@pytest.mark.parametrize("port", (PUBLIC_PORT, EASELECT_PORT))
def test_only_the_exact_native_origin_is_local_on_either_port(port: int) -> None:
    for accepted in (
        f"https://localhost:{port}",
        f"https://localhost:{port}/",
        f"https://127.0.0.1:{port}",
    ):
        assert native_origin.is_local_native_base_url(accepted, port), accepted
    other_port = EASELECT_PORT if port == PUBLIC_PORT else PUBLIC_PORT
    for rejected in (
        f"http://localhost:{port}",
        f"https://localhost:{other_port}",
        "https://localhost",
        f"https://localhost:{port}/api",
        f"https://localhost:{port}/?next=1",
        f"https://localhost:{port}/#top",
        f"https://user:secret@localhost:{port}",
        f"https://[::1]:{port}",
        f"https://example.com:{port}",
        f"https://localhost:{port}.example.com",
        None,
    ):
        assert not native_origin.is_local_native_base_url(rejected, port), rejected


def run_shell_port(library: Path, project_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; filterest_native_default_port "$2"',
            "port-probe",
            str(library),
            str(project_root),
        ],
        check=False,
        capture_output=True,
        text=True,
    )


def test_the_shell_helper_reads_the_same_rule(tmp_path: Path) -> None:
    easelect = make_easelect_checkout(tmp_path / "easelect")
    public = tmp_path / "filterest"
    public.mkdir()

    assert run_shell_port(PORT_LIBRARY, easelect).stdout == str(EASELECT_PORT)
    assert run_shell_port(PORT_LIBRARY, public).stdout == str(PUBLIC_PORT)


@pytest.mark.parametrize(
    "contents",
    (
        None,
        "FILTEREST_NATIVE_PORT=8100\n",
        "FILTEREST_NATIVE_PORT=x\nEASELECT_NATIVE_PORT=8082\n",
        # The Python and JavaScript readers refuse these too.
        "FILTEREST_NATIVE_PORT=0\nEASELECT_NATIVE_PORT=8082\n",
        "FILTEREST_NATIVE_PORT=8100\nEASELECT_NATIVE_PORT=70000\n",
    ),
)
def test_the_shell_helper_stops_on_a_missing_or_malformed_file(
    tmp_path: Path, contents: str | None
) -> None:
    library_root = tmp_path / "lib"
    library_root.mkdir()
    shutil.copy2(PORT_LIBRARY, library_root / PORT_LIBRARY.name)
    shutil.copy2(
        SOURCE_ROOT / "server_tools/lib/easelect_private_paths.sh",
        library_root / "easelect_private_paths.sh",
    )
    if contents is not None:
        (library_root / PORTS_FILE.name).write_text(contents, encoding="utf-8")

    completed = run_shell_port(library_root / PORT_LIBRARY.name, tmp_path)

    assert completed.returncode != 0
    assert completed.stdout == ""
    assert "native_development_ports.env" in completed.stderr


def test_the_javascript_reader_reads_the_same_rule(tmp_path: Path) -> None:
    if shutil.which("node") is None:
        pytest.skip("Node.js is required for the JavaScript reader")
    easelect = make_easelect_checkout(tmp_path / "easelect")
    script = (
        "const target = require(process.argv[1]);"
        "console.log(JSON.stringify({"
        "ports: target.readNativeDevelopmentPorts(),"
        "public: target.defaultLocalFilterestBaseUrl(process.argv[2], {}),"
        "easelect: target.defaultLocalFilterestBaseUrl('.', {FILTEREST_PROJECT_ROOT_OVERRIDE: process.argv[3]}),"
        "}));"
    )
    completed = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(SOURCE_ROOT / "server_tools/scripts/local_filterest_target.cjs"),
            str(tmp_path / "filterest/app"),
            str(easelect),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert json.loads(completed.stdout) == {
        "ports": {"filterest": PUBLIC_PORT, "easelect": EASELECT_PORT},
        "public": "https://localhost:8100",
        "easelect": "https://localhost:8082",
    }


def test_the_settings_template_uses_the_public_native_port() -> None:
    # scaffold.sh copies this template into new native settings, and the Docker
    # runner into keys/docker.env, so its values stay; they must match the rule.
    template = dict(
        line.split("=", 1)
        for line in (SOURCE_ROOT / ".env.example").read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
    )

    for key in ("PORT", "EASELECT_PORT", "APP_PORT"):
        assert template[key] == str(PUBLIC_PORT), key
    for key in ("BASE_URL", "VITE_BACKEND_URL"):
        assert template[key] == f"https://localhost:{PUBLIC_PORT}", key


def test_the_image_build_carries_every_file_the_vite_configuration_reads() -> None:
    # The image's frontend stage copies only what the build needs, so an input of
    # the Vite configuration missing there fails the image build and nothing else.
    vite_config = (SOURCE_ROOT / "frontend/vite.config.mjs").read_text(encoding="utf-8")
    vite_inputs = sorted(set(re.findall(r"from '\.\./(server_tools/[^']+)'", vite_config)))
    # Read by local_filterest_target.cjs itself, not imported.
    vite_inputs.append("server_tools/lib/native_development_ports.env")
    dockerfile = (SOURCE_ROOT / "docker/Dockerfile").read_text(encoding="utf-8")
    frontend_stage = dockerfile.split("\nFROM ", 2)[1]

    assert "server_tools/scripts/local_filterest_target.cjs" in vite_inputs
    for vite_input in vite_inputs:
        assert f"COPY {vite_input} ./{vite_input}" in frontend_stage, vite_input


def test_no_tool_restates_the_native_port_rule() -> None:
    restatements = []
    for relative_path in PORT_DECISION_FILES:
        path = (SOURCE_ROOT / relative_path).resolve()
        allowed = OTHER_DECISIONS_SHARING_A_NUMBER.get(relative_path, set())
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith(("#", "//", "*")) or not re.search(r"\b(8082|8100)\b", line):
                continue
            if stripped not in allowed:
                restatements.append(f"{relative_path}:{number}: {stripped}")

    assert restatements == []
