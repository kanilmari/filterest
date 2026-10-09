# test_release_asset_builder.py
# Exercises native and managed bundle assembly with isolated reviewed Git fixtures.
# Connects deterministic compiler evidence to source/OCI payload validation.
# Proves tampering/path/platform refusals without real keys, Docker or remote access.
"""Exercise release assembly using miniature source and deterministic compiler fixtures.

The real builder runs checksum, notice and module checks without cloning a source
checkout, publishing binaries, or interacting with services and databases.
"""
import json
import os
from pathlib import Path
import subprocess
import pytest

from server_tools.release.audit_public_root_files import read_manifest
from release_bundle_fixture import (bundle_go_tools, local_contract_bridge, candidate, release_candidate,
    unsigned_bundle, signed_bundle, write_oci, write_tar)
from server_tools.release import build_bundle, bundle_verifier, bundle_contract, source_archive, oci_archive

SOURCE_ROOT = Path(__file__).resolve().parents[2]
BUILDER = SOURCE_ROOT / "server_tools/release/build_assets.sh"
ROOT_CHECK_FILES = ("audit_public_root_files.py", "public_root_files.txt")
PASSING_CHECK_STANDINS = (
    "release/audit_source_boundary.py",
    "scripts/validate_release_ledger.py",
    "scripts/validate_app_db_compatibility.py",
    "public_slice_export/audit_public_bootstrap.py",
    "release/audit_public_demo_assets.py",
    "release/audit_browser_bundle.py",
)


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
    # A complete fixture has exactly the reviewed root files; the builder audits
    # them with the real root check. The other release source checks have their
    # own tests, so here they are stand-ins that pass.
    for root_file in read_manifest():
        required.setdefault(root_file, "Fixture root file\n")
    for check in ROOT_CHECK_FILES:
        required[f"app/server_tools/release/{check}"] = (SOURCE_ROOT / "server_tools/release" / check).read_text()
    for check in PASSING_CHECK_STANDINS:
        required[f"app/server_tools/{check}"] = "print('stand-in check OK')\n"
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
    destination.write_text(json.dumps({key: os.environ.get(key) for key in ["GOAMD64", "GOARM64"]}))
    with open(os.environ["FIXTURE_EVENTS"], "a") as output:
        output.write(json.dumps({key: os.environ.get(key) for key in ["GOARCH", "GOWORK", "GOFLAGS", "GOMODCACHE", "GOCACHE", "GOAMD64", "GOARM64", "GOENV", "GOEXPERIMENT", "CGO_CFLAGS", "CGO_CPPFLAGS", "CGO_CXXFLAGS", "CGO_FFLAGS", "CGO_LDFLAGS"]}) + "\n")
elif sys.argv[1:3] == ["version", "-m"]:
    arch = "arm64" if sys.argv[3].endswith("arm64") else "amd64"
    version = os.environ.get("FIXTURE_MODULE_VERSION", "v1.2.3")
    print(sys.argv[3] + ": go1.26.5")
    print("\tdep\texample.invalid/alpha\t" + version + "\th1:fixture=")
    baseline_key = "GOAMD64" if arch == "amd64" else "GOARM64"
    baseline_value = json.loads(pathlib.Path(sys.argv[3]).read_text())[baseline_key]
    for key, value in {"-tags": "netgo,osusergo", "CGO_ENABLED": "1", "GOARCH": arch, "GOOS": "linux", baseline_key: os.environ.get("FIXTURE_CPU_BASELINE", baseline_value)}.items():
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


@pytest.mark.parametrize("change", ["unreviewed", "missing"])
def test_root_files_must_match_the_reviewed_list(release_fixture, change):
    source, output, environment = release_fixture
    if change == "unreviewed":
        (source / "temporary-report.txt").write_text("stray\n")
        expected = "- temporary-report.txt"
    else:
        (source / "codesize").unlink()
        expected = "- codesize"
    result = run_builder(release_fixture, "--check-only")
    assert result.returncode != 0
    assert expected in result.stdout
    assert "Release source check failed: repository-root files." in result.stderr
    assert not output.exists()
    assert not Path(environment["FIXTURE_EVENTS"]).exists()


@pytest.mark.parametrize(("check", "label"), [
    ("release/audit_source_boundary.py", "source boundary"),
    ("scripts/validate_release_ledger.py", "release ledger"),
    ("release/audit_public_demo_assets.py", "demo media"),
])
def test_a_failing_source_check_stops_both_build_modes(release_fixture, check, label):
    source, output, environment = release_fixture
    (source / "app/server_tools" / check).write_text("raise SystemExit(1)\n")
    for arguments in (("--check-only",), ()):
        result = run_builder(release_fixture, *arguments)
        assert result.returncode != 0
        assert f"Release source check failed: {label}." in result.stderr
    assert not output.exists()
    assert not Path(environment["FIXTURE_EVENTS"]).exists()


def test_full_assembly_keeps_fourteen_assets_and_standalone_go_boundary(release_fixture):
    source, output, environment = release_fixture
    result = run_builder(release_fixture, updates={"GOAMD64": "v4", "GOARM64": "v9.5", "GOENV": "/missing/persisted-go-env", "CGO_CFLAGS": "-O3 -march=native", "CGO_CPPFLAGS": "-march=native", "GOEXPERIMENT": "unreviewed"})
    assert result.returncode == 0, result.stdout + result.stderr
    assert len(list(output.iterdir())) == 14
    checksums = list(output.glob("*.sha256"))
    assert len(checksums) == 7
    subprocess.run(["sha256sum", "-c", *[str(p) for p in checksums]], cwd=output, check=True, capture_output=True)
    events = [json.loads(line) for line in Path(environment["FIXTURE_EVENTS"]).read_text().splitlines()]
    assert [event["GOARCH"] for event in events] == ["amd64", "arm64"]
    assert all(event["GOWORK"] == "off" and event["GOFLAGS"] == "-mod=readonly" for event in events)
    assert all(event["GOMODCACHE"] == str(source / "data/runtime/go/module-cache") for event in events)
    assert all(event["GOAMD64"] == "v1" and event["GOARM64"] == "v8.0" and event["GOENV"] == "off" for event in events)
    assert all(event["CGO_CFLAGS"] == "-O2 -g" and event["CGO_CPPFLAGS"] == "" and event["GOEXPERIMENT"] == "" for event in events)


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
    ({"FIXTURE_CPU_BASELINE": "v4"}, "GOAMD64"),
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


def test_managed_bundle_is_canonical_unsigned_and_bound_to_final_git_tree(unsigned_bundle):
    root, directory, commit, _, _, report = unsigned_bundle
    data = (directory / bundle_contract.MANIFEST_NAME).read_bytes()
    manifest = json.loads(data)
    from server_tools.versioning.release_contract_v1 import canonical_json_line
    assert data == canonical_json_line(manifest)
    assert not report["signed"] and not report["publication_ready"]
    assert manifest["published_commit"] == commit
    assert manifest["build_identity"]["source"]["commit"] != commit
    assert len(report["assets"]) == 19
    assert not (directory / bundle_contract.SIGNATURES_NAME).exists()
    assert all(row["expanded_size_bytes"] >= row["size_bytes"] for row in manifest["artifacts"])
    assert bundle_verifier.verify_unsigned_bundle(root, directory, commit)["assets"] == report["assets"]


def test_locally_built_bundle_verifies_with_random_encrypted_fixture_key(signed_bundle):
    root, directory, commit, policy, _ = signed_bundle
    report = bundle_verifier.verify_signed_bundle(root, directory, commit, policy, 1)
    assert len(report["assets"]) == 20
    assert report["signature_verification"]["trust_policy_revision"] == 1
    assert report["signature_verification"]["manifest_sha256"] == report["manifest_sha256"]
    assert "passphrase" not in json.dumps(report)
    assert "PRIVATE KEY" not in json.dumps(report)


@pytest.mark.parametrize("change", ["extra", "missing", "symlink", "tamper"])
def test_bundle_requires_exact_regular_unchanged_inventory(signed_bundle, tmp_path, change):
    root, directory, commit, policy, _ = signed_bundle
    path = directory / "filterest-1.2.4-source.tar.gz"
    if change == "extra":
        (directory / "unexpected-operator-secret").write_bytes(b"fixture")
    elif change == "missing":
        path.unlink()
    elif change == "symlink":
        path.rename(tmp_path / "source.tar.gz")
        path.symlink_to(tmp_path / "source.tar.gz")
    else:
        path.write_bytes(path.read_bytes() + b"tamper")
    with pytest.raises(bundle_contract.BundleError, match="inventory|hash or size"):
        bundle_verifier.verify_signed_bundle(root, directory, commit, policy, 1)


@pytest.mark.parametrize("change", ["missing", "extra", "traversal", "symlink", "hardlink", "device", "mode", "duplicate"])
def test_source_archive_rejects_unsafe_missing_or_changed_members(unsigned_bundle, tmp_path, change):
    import io
    import tarfile
    root, directory, commit, _, _, _ = unsigned_bundle
    path = directory / "filterest-1.2.4-source.tar.gz"
    with tarfile.open(path, "r:gz") as source:
        members = [(member, source.extractfile(member).read() if member.isfile() else None) for member in source]
    rewritten = tmp_path / "rewritten.tar.gz"
    with tarfile.open(rewritten, "w:gz") as output:
        removed = False
        for member, data in members:
            if member.isfile() and change == "missing" and not removed:
                removed = True
                continue
            if member.isfile() and change == "mode" and not removed:
                member.mode = 0o777
                removed = True
            output.addfile(member, io.BytesIO(data) if data is not None else None)
        if change in {"extra", "traversal", "symlink", "hardlink", "device", "duplicate"}:
            member = tarfile.TarInfo("../escape" if change == "traversal" else "extra-file")
            if change in {"symlink", "hardlink", "device"}:
                member.type = {"symlink": tarfile.SYMTYPE, "hardlink": tarfile.LNKTYPE, "device": tarfile.CHRTYPE}[change]
                member.linkname = "/operator/state"
            if change == "duplicate":
                member = next(member for member, data in members if member.isfile())
                data = next(data for item, data in members if item is member)
                output.addfile(member, io.BytesIO(data))
            else:
                output.addfile(member)
    with pytest.raises(bundle_contract.BundleError, match="archive"):
        source_archive.verify_source_archive(root, commit, rewritten)
    assert not (tmp_path / "escape").exists()


def test_source_output_ignores_worktree_bytes_and_operator_state(unsigned_bundle, tmp_path):
    root, _, commit, _, _, _ = unsigned_bundle
    (root / "app/main.go").write_bytes(b"unreviewed working bytes")
    (root / "keys").mkdir(exist_ok=True)
    (root / "keys/fixture-secret").write_bytes(b"not source")
    destination = tmp_path / "reviewed-source.tar.gz"
    source_archive.package_source(root, commit, destination)
    import tarfile
    with tarfile.open(destination) as archive:
        assert not any(member.name.startswith("keys/") for member in archive)
        assert archive.extractfile("app/main.go").read() != b"unreviewed working bytes"


@pytest.mark.parametrize("change", ["wrong_platform", "wrong_identity", "missing_blob", "extra_blob", "blob_substitution", "index_substitution"])
def test_prebuilt_oci_refuses_platform_identity_and_blob_substitution(unsigned_bundle, tmp_path, change):
    _, directory, _, _, _, _ = unsigned_bundle
    manifest = json.loads((directory / bundle_contract.MANIFEST_NAME).read_bytes())
    path = tmp_path / "substitute.tar"
    files = write_oci(path, manifest, architecture="arm64" if change == "wrong_platform" else "amd64",
                      label_updates={"com.filterest.composition": "easelect"} if change == "wrong_identity" else None)
    blob = next(name for name in files if name.startswith("blobs/"))
    if change == "missing_blob":
        del files[blob]
    elif change == "extra_blob":
        files["blobs/sha256/" + "f" * 64] = b"unreferenced substitution"
    elif change == "blob_substitution":
        files[blob] = b"substituted image bytes"
    elif change == "index_substitution":
        index = json.loads(files["index.json"])
        index["manifests"].append(index["manifests"][0])
        files["index.json"] = json.dumps(index).encode()
    write_tar(path, files)
    with pytest.raises(bundle_contract.BundleError, match="OCI"):
        oci_archive.verify_oci_archive(path, {"os": "linux", "architecture": "amd64", "cpu_features": []}, oci_archive.identity_labels(manifest))


def test_migration_inventory_binds_reviewed_bytes_and_missing_paths(unsigned_bundle):
    root, _, commit, _, _, _ = unsigned_bundle
    with pytest.raises(bundle_contract.BundleError, match="missing Git member"):
        source_archive.bind_migrations(root, commit, [{"component": "filterest", "id": "20261009000099_missing.sql"}])


def test_bundle_build_options_refuse_incomplete_or_inside_source_output(release_fixture):
    source, _, _ = release_fixture
    result = run_builder(release_fixture, "--oci-archive", "amd64=/tmp/fixture.tar")
    assert result.returncode and "require --bundle-spec" in result.stderr
    inside = source / "must-not-be-created"
    result = run_builder((source, inside, release_fixture[2]))
    assert result.returncode and not inside.exists()


@pytest.mark.parametrize("change", ["hash", "database_version", "error_policy", "owner"])
def test_migration_specification_cannot_misstate_reviewed_bytes_or_directives(tmp_path, change):
    from test_release_preparation import commit_fixture
    root = tmp_path / "migration-source"
    directory = root / "app/server_tools/migrations"
    directory.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
    name = "20261009000099_record_database_release_9_10_2.sql"
    data = b"-- VERSION_DB: 9.10.2\nSELECT 'fixture only';\n"
    if change == "owner":
        data = b"-- VERSION_DB_OWNER: 20261009000100_other.sql\n" + data
    (directory / name).write_bytes(data)
    commit = commit_fixture(root)
    row = {"id": name, "component": "filterest", "database_version": "9.10.2",
           "transaction_policy": "runner", "error_policy": "required", "publishes_database_version": True}
    if change == "hash":
        row["content_sha256"] = "f" * 64
    elif change == "database_version":
        row["database_version"] = "9.10.1"
    elif change == "error_policy":
        row["error_policy"] = "optional"
    with pytest.raises(bundle_contract.BundleError, match="migration|publisher"):
        source_archive.bind_migrations(root, commit, [row])


def test_migration_hash_comes_from_git_and_archive_preserves_it(tmp_path):
    from test_release_preparation import commit_fixture
    import hashlib
    root = tmp_path / "migration-source"
    directory = root / "app/server_tools/migrations"
    directory.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
    name = "20261009000099_record_database_release_9_10_2.sql"
    data = b"-- VERSION_DB: 9.10.2\nSELECT 'fixture only';\n"
    (directory / name).write_bytes(data)
    commit = commit_fixture(root)
    rows = source_archive.bind_migrations(root, commit, [{"id": name, "component": "filterest",
        "database_version": "9.10.2", "transaction_policy": "runner", "error_policy": "required", "publishes_database_version": True}])
    assert rows[0]["content_sha256"] == hashlib.sha256(data).hexdigest()
    (directory / name).write_bytes(b"changed worktree cannot rewrite recorded hash")
    path = tmp_path / "source.tar.gz"
    source_archive.package_source(root, commit, path)
    source_archive.verify_source_archive(root, commit, path, rows)


@pytest.mark.parametrize("change", ["operator_home", "tracked_symlink", "export_ignore"])
def test_reviewed_git_tree_cannot_include_operator_paths_or_silently_omit_source(tmp_path, change):
    from test_release_preparation import commit_fixture
    root = tmp_path / "unsafe-source"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
    (root / "README.md").write_bytes(b"reviewed fixture source")
    if change == "operator_home":
        (root / "keys").mkdir()
        (root / "keys/fixture-secret").write_bytes(b"fixture")
    elif change == "tracked_symlink":
        (root / "link").symlink_to("README.md")
    else:
        (root / ".gitattributes").write_text("README.md export-ignore\n")
    commit = commit_fixture(root)
    with pytest.raises(bundle_contract.BundleError):
        source_archive.package_source(root, commit, tmp_path / "source.tar.gz")


def test_builder_forwards_unsigned_bundle_contract_after_native_build(release_fixture, tmp_path):
    source, _, environment = release_fixture
    binary_dir = Path(environment["PATH"].split(":")[0])
    git = binary_dir / "git"
    git.write_text('#!/bin/sh\ncase "$*" in\n*rev-parse*) printf "%s" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ;;\n*status*) printf "%s" "${FIXTURE_GIT_STATUS:-}" ;;\nesac\n')
    python = binary_dir / "python3"
    python.write_text('''#!/bin/sh
case "$1" in
*/build_bundle.py)
    /usr/bin/python3 - "$@" <<'PY'
import json, os, pathlib, sys
pathlib.Path(os.environ["FIXTURE_EVENTS"] + ".bundle").write_text(json.dumps(sys.argv[1:]))
PY
    exit 0 ;;
esac
exec /usr/bin/python3 "$@"
''')
    python.chmod(0o755)
    spec = tmp_path / "reviewed requirements.json"
    spec.write_text("{}")
    result = run_builder(release_fixture, "--bundle-spec", str(spec), "--published-commit", "a" * 40,
                         "--oci-archive", "amd64=/outside/prebuilt fixture.tar")
    assert result.returncode == 0, result.stderr
    forwarded = json.loads(Path(environment["FIXTURE_EVENTS"] + ".bundle").read_text())
    assert forwarded[1:] == ["--target", str(source), "--assets-dir", str(release_fixture[1]),
        "--published-commit", "a" * 40, "--bundle-spec", str(spec), "--oci-archive", "amd64=/outside/prebuilt fixture.tar"]
    assert len(list(release_fixture[1].iterdir())) == 14
    assert len(Path(environment["FIXTURE_EVENTS"]).read_text().splitlines()) == 2
