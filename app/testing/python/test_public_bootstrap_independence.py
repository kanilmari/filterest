"""Prove public bootstrap rebuilding and validation need only public inputs."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

SOURCE = Path(__file__).resolve().parents[2]


def copy_public_inputs(tmp_path):
    root = tmp_path / "filterest"
    for name in ("server_tools/public_bootstrap", "server_tools/migrations", "server_tools/public_slice_export"):
        shutil.copytree(SOURCE / name, root / "app" / name, ignore=shutil.ignore_patterns("__pycache__"))
    for name in ("VERSION_APP", "VERSION_DB"):
        shutil.copy2(SOURCE / name, root / "app" / name)
    return root


def generate(root):
    return subprocess.run(
        [sys.executable, str(root / "app/server_tools/public_bootstrap/generate_bootstrap.py")],
        cwd=root, capture_output=True, text=True,
    )


def test_public_checkout_rebuilds_identical_sql_and_resolvable_manifest(tmp_path):
    root = copy_public_inputs(tmp_path)
    assert not (root.parent / "filterest_private").exists()
    result = generate(root)
    assert result.returncode == 0, result.stderr
    output = root / "app/server_tools/public_bootstrap"
    for name in ("schema.sql", "seed_data.sql", "manifest.json"):
        assert (output / name).read_bytes() == (SOURCE / "server_tools/public_bootstrap" / name).read_bytes()
    manifest = json.loads((output / "manifest.json").read_text())
    for name, evidence in manifest["source_files"].items():
        assert name.startswith("filterest/")
        source = root / name.removeprefix("filterest/")
        assert source.is_file()
        assert hashlib.sha256(source.read_bytes()).hexdigest() == evidence["sha256"]


def test_public_generation_rejects_private_fixture_before_output_write(tmp_path):
    root = copy_public_inputs(tmp_path)
    output = root / "app/server_tools/public_bootstrap"
    original = (output / "seed_data.sql").read_bytes()
    with (output / "source/base.seed.sql").open("a") as stream:
        stream.write("\nINSERT INTO public.dev_agent_tasks (id) VALUES (1);\n")
    result = generate(root)
    assert result.returncode != 0
    assert "Unreviewed seed tables" in result.stderr
    assert (output / "seed_data.sql").read_bytes() == original


def test_public_generation_rejects_output_symlink(tmp_path):
    root = copy_public_inputs(tmp_path)
    output = root / "app/server_tools/public_bootstrap/seed_data.sql"
    outside = tmp_path / "operator.txt"
    outside.write_text("preserve")
    output.unlink()
    output.symlink_to(outside)
    result = generate(root)
    assert result.returncode != 0
    assert "symlink" in result.stderr
    assert outside.read_text() == "preserve"


def test_public_audit_rejects_unshipped_manifest_input(tmp_path):
    root = copy_public_inputs(tmp_path)
    manifest_path = root / "app/server_tools/public_bootstrap/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["source_files"]["external/hidden-fixture.sql"] = {"sha256": "0" * 64}
    manifest_path.write_text(json.dumps(manifest))
    result = subprocess.run(
        [sys.executable, str(root / "app/server_tools/public_slice_export/audit_public_bootstrap.py"), "--target", str(root)],
        cwd=root, capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "not shipped publicly" in result.stdout + result.stderr


def test_invalid_migration_leaves_previous_public_package_untouched(tmp_path):
    root = copy_public_inputs(tmp_path)
    output = root / "app/server_tools/public_bootstrap"
    original = {name: (output / name).read_bytes() for name in ("schema.sql", "seed_data.sql", "manifest.json")}
    (root / "app/server_tools/migrations/20990101000001_unsafe'filename.sql").write_text("-- invalid migration filename")
    result = generate(root)
    assert result.returncode != 0
    assert "migration filename is not safe" in result.stderr
    for name, expected in original.items():
        assert (output / name).read_bytes() == expected
