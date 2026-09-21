"""Keep Filterest's reviewed demo media and its runtime contract intact.

Bridges the public bootstrap fixtures with the demo-media release check.
Exists so withdrawn screenshots, unsafe or duplicated destinations, digest
drift and secret-like text cannot reach a release. The example marker below
stands in for a private product name that only an embedding workspace knows.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil

from server_tools.release import audit_public_demo_assets as auditor


SOURCE_ROOT = Path(__file__).resolve().parents[2]
INSTALLATION_ROOT = SOURCE_ROOT.parent
PUBLIC_BOOTSTRAP = SOURCE_ROOT / "server_tools/public_bootstrap/source"


def copy_runtime_media_source(tmp_path: Path) -> Path:
    target_source = tmp_path / "app/server_tools/public_bootstrap/source"
    shutil.copytree(PUBLIC_BOOTSTRAP, target_source)
    return tmp_path


def test_demo_asset_auditor_accepts_the_canonical_runtime_media_contract() -> None:
    findings: list[str] = []

    contract = auditor.audit_runtime_media_contract(INSTALLATION_ROOT, findings)

    assert findings == []
    assert len(contract.source_assets) == 15
    assert len(contract.destinations) == 21
    assert len(set(contract.destinations)) == 21
    assert contract.seeded_cached_image_names == {
        "7_1_1.jpg",
        "8_1_1.jpg",
        "9_1_1.png",
        "9_2_1.png",
        "9_3_1.png",
        "10_1_1.jpg",
    }


def test_demo_asset_auditor_requires_auth_tour_media_to_stay_withdrawn(
    tmp_path: Path,
) -> None:
    public_root = copy_runtime_media_source(tmp_path)
    public_asset = public_root / "app/frontend/public/auth-tour/reintroduced.jpg"
    built_asset = public_root / "app/frontend/dist/auth-tour/reintroduced.jpg"
    public_asset.parent.mkdir(parents=True)
    built_asset.parent.mkdir(parents=True)
    public_asset.write_bytes(b"candidate")
    built_asset.write_bytes(b"candidate")

    audit = auditor.audit_demo_assets(public_root)

    assert len(audit.auth_assets) == 2
    assert any(
        "withdrawn auth-tour media directory is distributed: "
        "app/frontend/public/auth-tour" == finding
        for finding in audit.findings
    )
    assert any(
        "withdrawn auth-tour media directory is distributed: "
        "app/frontend/dist/auth-tour" == finding
        for finding in audit.findings
    )


def test_demo_asset_auditor_rejects_unsafe_runtime_media_paths() -> None:
    findings: list[str] = []

    assert auditor.parse_canonical_relative_posix_path(
        "../docs/start-here.png",
        label="source",
        findings=findings,
    ) is None
    assert auditor.validate_runtime_destination(
        "9/1/../9_1_1.png",
        label="destination",
        findings=findings,
    ) is None

    assert findings == [
        "source must be a canonical relative path: '../docs/start-here.png'",
        "destination must be a canonical relative path: '9/1/../9_1_1.png'",
    ]


def test_demo_asset_auditor_rejects_duplicate_destinations(tmp_path: Path) -> None:
    public_root = copy_runtime_media_source(tmp_path)
    manifest_path = (
        public_root
        / "app/server_tools/public_bootstrap/source/fixtures/runtime_media.v1.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["assets"][0]["destinations"][0] = manifest["assets"][0]["destinations"][1]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    findings: list[str] = []

    auditor.audit_runtime_media_contract(public_root, findings)

    assert "runtime media manifest must declare exactly 21 unique destinations, got 20" in findings


def test_demo_asset_auditor_rejects_seed_filename_drift(tmp_path: Path) -> None:
    public_root = copy_runtime_media_source(tmp_path)
    seed_path = public_root / "app/server_tools/public_bootstrap/source/app_tables.seed.sql"
    seed = seed_path.read_text(encoding="utf-8").replace(
        "UPDATE public.tiketit SET cached_image = '10_1_1.jpg' WHERE id = 1;",
        "UPDATE public.tiketit SET cached_image = '10_1_2.jpg' WHERE id = 1;",
    )
    seed_path.write_text(seed, encoding="utf-8")
    findings: list[str] = []

    auditor.audit_runtime_media_contract(public_root, findings)

    assert "seeded cached_image has no runtime media destination: 10_1_2.jpg" in findings
    assert "runtime media destination has no seeded cached_image reference: 10_1_1.jpg" in findings


def test_demo_asset_auditor_rejects_source_swap_without_matching_digest(
    tmp_path: Path,
) -> None:
    public_root = copy_runtime_media_source(tmp_path)
    manifest_path = (
        public_root
        / "app/server_tools/public_bootstrap/source/fixtures/runtime_media.v1.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    service_asset = manifest["assets"][3]
    risk_asset = manifest["assets"][7]
    service_asset["source"], risk_asset["source"] = (
        risk_asset["source"],
        service_asset["source"],
    )
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    findings: list[str] = []

    auditor.audit_runtime_media_contract(public_root, findings)

    assert any(
        "source_sha256 does not match source bytes: "
        "'starter-images/risk-original.jpg'" in finding
        for finding in findings
    )
    assert any(
        "source_sha256 does not match source bytes: "
        "'starter-images/service-original.jpg'" in finding
        for finding in findings
    )


def test_demo_asset_auditor_rejects_corrupted_source_bytes(tmp_path: Path) -> None:
    public_root = copy_runtime_media_source(tmp_path)
    source_path = (
        public_root
        / "app/server_tools/public_bootstrap/source/fixtures/docs/start-here.png"
    )
    source_path.write_bytes(source_path.read_bytes() + b"corruption")
    findings: list[str] = []

    auditor.audit_runtime_media_contract(public_root, findings)

    assert any(
        "source_sha256 does not match source bytes: 'docs/start-here.png'" in finding
        for finding in findings
    )


def test_demo_asset_auditor_rejects_invalid_revision_and_digest(tmp_path: Path) -> None:
    public_root = copy_runtime_media_source(tmp_path)
    manifest_path = (
        public_root
        / "app/server_tools/public_bootstrap/source/fixtures/runtime_media.v1.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["materialization_revision"] = False
    manifest["assets"][0]["source_sha256"] = "A" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    findings: list[str] = []

    auditor.audit_runtime_media_contract(public_root, findings)

    assert (
        "runtime media manifest materialization_revision must be a positive integer, "
        "got False" in findings
    )
    assert (
        "runtime media asset[0].source_sha256 must be a lowercase SHA-256 digest"
        in findings
    )


def test_fixture_images_are_checked_for_generic_and_supplied_markers(tmp_path: Path) -> None:
    public_root = copy_runtime_media_source(tmp_path)
    image = next(
        path for path in (public_root / "app/server_tools/public_bootstrap/source/fixtures").rglob("*.png")
    )
    image.write_bytes(image.read_bytes() + b"/home/someone/ ExampleShell")

    plain = auditor.audit_demo_assets(public_root)
    with_marker = auditor.audit_demo_assets(public_root, extra_markers=("ExampleShell",))

    assert any("contains forbidden marker: /home/" in finding for finding in plain.findings)
    assert not any("ExampleShell" in finding for finding in plain.findings)
    assert any("contains forbidden marker: ExampleShell" in finding for finding in with_marker.findings)


def test_mutable_homes_are_refused_unless_the_boundary_check_allowed_them(tmp_path: Path) -> None:
    public_root = copy_runtime_media_source(tmp_path)
    for home in ("config", "keys", "projects", "data", "backups", "storage"):
        (public_root / home).mkdir()

    exported = auditor.audit_demo_assets(public_root).findings
    local = auditor.audit_demo_assets(public_root, allow_local_mutable_homes=True).findings

    for home in ("config", "keys", "projects", "data", "backups", "storage"):
        assert f"mutable root home exported into public source: {home}/" in exported
    assert [finding for finding in local if "mutable root home" in finding] == [
        "mutable root home exported into public source: storage/"
    ]


def test_command_defaults_to_this_checkout(capsys) -> None:
    assert auditor.main(["--allow-local-mutable-homes"]) == 0
    assert "Public demo asset audit OK" in capsys.readouterr().out
