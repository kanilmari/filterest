"""Exercise release assembly using miniature source and deterministic compiler fixtures.

The real builder runs checksum, notice and module checks without cloning a source
checkout, publishing binaries, or interacting with services and databases.
"""
import json
import os
from pathlib import Path
import subprocess
import pytest

SOURCE_ROOT = Path(__file__).resolve().parents[2]
BUILDER = SOURCE_ROOT / "server_tools/release/build_assets.sh"


@pytest.fixture
def release_fixture(tmp_path):
    source = tmp_path / "source-fixture"
    required = {
        "app/VERSION_APP": "1.2.3\n",
        "app/go.mod": "module example.invalid/fixture\ngo 1.26.5\n",
        "app/main.go": "package main\nfunc main() {}\n",
        "LICENSE": "Fixture product license\n",
        "NOTICE": "Fixture notice\n",
        "THIRD_PARTY_NOTICES.md": "Fixture dependency notice\n",
        "app/server_tools/licenses/GPL-3.0.txt": "Fixture GPL text\n",
        "THIRD_PARTY_LICENSES/manifest.json": json.dumps({"dependencies": [
            {"ecosystem": "go", "name": "example.invalid/alpha", "version": "v1.2.3", "binary_targets": ["filterest"]},
            {"ecosystem": "go-toolchain", "version": "go1.26.5", "binary_targets": ["filterest"]},
        ]}),
    }
    for relative, content in required.items():
        file = source / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
    binary_dir = tmp_path / "fixture-bin"
    binary_dir.mkdir()
    programs = {
        "git": '#!/bin/sh\nprintf "%s" "${FIXTURE_GIT_STATUS:-}"\nexit "${FIXTURE_GIT_EXIT:-0}"\n',
        "find": '#!/bin/sh\nif [ "${FIXTURE_FIND_FAIL:-0}" = 1 ]; then exit 2; fi\nexec /usr/bin/find "$@"\n',
        "gcc": '#!/bin/sh\nexit 90\n',
        "aarch64-linux-gnu-gcc": '#!/bin/sh\nexit 90\n',
        "go": r"""#!/usr/bin/env python3
import json, os, pathlib, sys
if sys.argv[1] == "build":
    destination = pathlib.Path(sys.argv[sys.argv.index("-o") + 1])
    destination.write_text("fixture binary " + os.environ["GOARCH"])
    with open(os.environ["FIXTURE_EVENTS"], "a") as output:
        output.write(json.dumps({key: os.environ.get(key) for key in ["GOARCH", "GOWORK", "GOFLAGS", "GOMODCACHE", "GOCACHE"]}) + "\n")
elif sys.argv[1:3] == ["version", "-m"]:
    arch = "arm64" if sys.argv[3].endswith("arm64") else "amd64"
    version = os.environ.get("FIXTURE_MODULE_VERSION", "v1.2.3")
    print(sys.argv[3] + ": go1.26.5")
    print("\tdep\texample.invalid/alpha\t" + version + "\th1:fixture=")
    for key, value in {"-tags": "netgo,osusergo", "CGO_ENABLED": "1", "GOARCH": arch, "GOOS": "linux"}.items():
        print("\tbuild\t" + key + "=" + value)
else:
    raise SystemExit(91)
""",
        "file": r"""#!/usr/bin/env python3
import sys
architecture = "ARM aarch64" if sys.argv[1].endswith("arm64") else "x86-64"
print("ELF 64-bit " + architecture + ", dynamically linked")
""",
        "readelf": r"""#!/usr/bin/env python3
import os, sys
if sys.argv[1] == "-d":
    print("Shared library: [libc.so.6]")
else:
    print("GLIBC_" + os.environ.get("FIXTURE_GLIBC", "2.34"))
""",
    }
    for name, content in programs.items():
        program = binary_dir / name
        program.write_text(content)
        program.chmod(0o755)
    environment = {**os.environ, "PATH": str(binary_dir) + ":" + os.environ["PATH"], "FIXTURE_EVENTS": str(tmp_path / "events"), "GOWORK": str(tmp_path / "unrelated.go.work")}
    environment.pop("GOMODCACHE", None)
    environment.pop("GOCACHE", None)
    return source, tmp_path / "output", environment


def run_builder(fixture, *arguments, updates=None):
    source, output, environment = fixture
    return subprocess.run([str(BUILDER), "--target", str(source), "--output-dir", str(output), *arguments], cwd="/tmp", env={**environment, **(updates or {})}, capture_output=True, text=True)


def test_check_only_never_creates_output_or_runs_compiler(release_fixture):
    source, output, environment = release_fixture
    result = run_builder(release_fixture, "--check-only", updates={"FIXTURE_GIT_STATUS": " M source"})
    assert result.returncode == 0, result.stderr
    assert not output.exists()
    assert not Path(environment["FIXTURE_EVENTS"]).exists()
    assert "A real build still requires clean Git source" in result.stdout


def test_full_assembly_keeps_fourteen_assets_and_standalone_go_boundary(release_fixture):
    source, output, environment = release_fixture
    result = run_builder(release_fixture)
    assert result.returncode == 0, result.stdout + result.stderr
    assert len(list(output.iterdir())) == 14
    checksums = list(output.glob("*.sha256"))
    assert len(checksums) == 7
    subprocess.run(["sha256sum", "-c", *[str(p) for p in checksums]], cwd=output, check=True, capture_output=True)
    events = [json.loads(line) for line in Path(environment["FIXTURE_EVENTS"]).read_text().splitlines()]
    assert [event["GOARCH"] for event in events] == ["amd64", "arm64"]
    assert all(event["GOWORK"] == "off" and event["GOFLAGS"] == "-mod=readonly" for event in events)
    assert all(event["GOMODCACHE"] == str(source / "data/runtime/go/module-cache") for event in events)


def test_dirty_source_refuses_release_binaries(release_fixture):
    source, output, environment = release_fixture
    result = run_builder(release_fixture, updates={"FIXTURE_GIT_STATUS": " M app/main.go"})
    assert result.returncode != 0
    assert "must be clean" in result.stderr
    assert not Path(environment["FIXTURE_EVENTS"]).exists()


def test_output_inside_source_is_rejected(release_fixture):
    source, _, environment = release_fixture
    result = run_builder((source, source / "generated-output", environment))
    assert result.returncode != 0
    assert "outside the standalone Filterest checkout" in result.stderr
    assert not Path(environment["FIXTURE_EVENTS"]).exists()


@pytest.mark.parametrize("updates, message", [
    ({"FIXTURE_GLIBC": "2.35"}, "GLIBC_2.34-compatible"),
    ({"FIXTURE_MODULE_VERSION": "v9.9.9"}, "module set does not match manifest"),
])
def test_binary_contract_failure_cannot_produce_complete_asset_set(release_fixture, updates, message):
    result = run_builder(release_fixture, updates=updates)
    assert result.returncode != 0
    assert message in result.stderr
    assert not list(release_fixture[1].glob("*THIRD_PARTY_LICENSES.tar.gz"))


def test_git_failure_is_not_treated_as_clean_source(release_fixture):
    _, output, environment = release_fixture
    result = run_builder(release_fixture, updates={"FIXTURE_GIT_EXIT": "128"})
    assert result.returncode != 0
    assert "could not inspect" in result.stderr
    assert not Path(environment["FIXTURE_EVENTS"]).exists()
    assert not output.exists() or not list(output.iterdir())


def test_output_inspection_failure_is_not_treated_as_empty(release_fixture):
    _, output, environment = release_fixture
    output.mkdir()
    result = run_builder(release_fixture, updates={"FIXTURE_FIND_FAIL": "1"})
    assert result.returncode != 0
    assert "could not inspect output" in result.stderr
    assert not Path(environment["FIXTURE_EVENTS"]).exists()
    assert not list(output.iterdir())
