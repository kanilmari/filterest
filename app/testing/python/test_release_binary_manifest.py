"""Verify release binaries against the product-owned dependency manifest.

Moved with the verifier so independent Filterest development owns its regression
coverage, including the distinct administrator-recovery binary dependency set.
"""
import os
from pathlib import Path
import subprocess
import pytest
from server_tools.release import verify_binary_manifest
from server_tools.public_slice_export import generate_third_party_notices

SOURCE_ROOT = Path(__file__).resolve().parents[2]

def test_release_binary_metadata_must_match_the_notice_manifest() -> None:
    manifest = {
        "dependencies": [
            {
                "ecosystem": "go",
                "name": "example.invalid/alpha",
                "version": "v1.2.3",
                "binary_targets": ["filterest", "filterest-admin-recovery"],
            },
            {
                "ecosystem": "go",
                "name": "example.invalid/beta",
                "version": "v4.5.6",
                "binary_targets": ["filterest"],
            },
            {
                "ecosystem": "go",
                "name": "golang.org/x/term",
                "version": "v0.33.0",
                "binary_targets": ["filterest-admin-recovery"],
            },
            {
                "ecosystem": "go-toolchain",
                "name": "Go runtime and standard library",
                "version": "go1.26.5",
                "binary_targets": ["filterest", "filterest-admin-recovery"],
            },
        ]
    }
    metadata = """/tmp/filterest-linux-amd64: go1.26.5
\tpath\tfilterest
\tdep\texample.invalid/alpha\tv1.2.3\th1:alpha=
\tdep\texample.invalid/beta\tv4.5.6\th1:beta=
\tbuild\t-tags=netgo,osusergo
\tbuild\tCGO_ENABLED=1
\tbuild\tGOARCH=amd64
\tbuild\tGOAMD64=v1
\tbuild\tGOOS=linux
"""

    verify_binary_manifest.verify_metadata(
        manifest,
        metadata,
        "amd64",
        "filterest",
    )

    recovery_metadata = """/tmp/filterest-admin-recovery: go1.26.5
\tpath\tfilterest/server_tools/admin_credential_recovery
\tdep\texample.invalid/alpha\tv1.2.3\th1:alpha=
\tdep\tgolang.org/x/term\tv0.33.0\th1:term=
\tbuild\tCGO_ENABLED=1
\tbuild\tGOARCH=amd64
\tbuild\tGOAMD64=v1
\tbuild\tGOOS=linux
"""
    verify_binary_manifest.verify_metadata(
        manifest,
        recovery_metadata,
        "amd64",
        "filterest-admin-recovery",
    )

    for target_architecture, baseline_key, baseline, higher in (
        ("amd64", "GOAMD64", "v1", "v3"), ("arm64", "GOARM64", "v8.0", "v9.0"),
    ):
        architecture_metadata = metadata.replace("GOARCH=amd64", "GOARCH=" + target_architecture).replace("GOAMD64=v1", baseline_key + "=" + baseline)
        verify_binary_manifest.verify_metadata(manifest, architecture_metadata, target_architecture, "filterest")
        with pytest.raises(verify_binary_manifest.BinaryManifestError, match=baseline_key):
            verify_binary_manifest.verify_metadata(manifest, architecture_metadata.replace(baseline_key + "=" + baseline, baseline_key + "=" + higher), target_architecture, "filterest")

    changed_metadata = metadata.replace("v4.5.6", "v4.5.7")
    with pytest.raises(
        verify_binary_manifest.BinaryManifestError,
        match="binary module set does not match manifest",
    ):
        verify_binary_manifest.verify_metadata(
            manifest,
            changed_metadata,
            "amd64",
            "filterest",
        )

    with pytest.raises(
        verify_binary_manifest.BinaryManifestError,
        match="does not define binary target",
    ):
        verify_binary_manifest.verify_metadata(
            manifest,
            metadata,
            "amd64",
            "unknown-binary",
        )


def test_built_admin_recovery_binary_matches_its_notice_target(
    tmp_path: Path,
    monkeypatch,
) -> None:
    go_cache = tmp_path / "go-build-cache"
    monkeypatch.setenv("GOCACHE", str(go_cache))
    dependencies, _ = generate_third_party_notices.collect_go_modules(
        SOURCE_ROOT
    )
    manifest = {
        "dependencies": [
            {
                "ecosystem": item.ecosystem,
                "name": item.name,
                "version": item.version,
                "binary_targets": list(item.binary_targets),
            }
            for item in dependencies
        ]
    }
    binary = tmp_path / "filterest-admin-recovery"
    environment = {
        **os.environ,
        "CGO_ENABLED": "1",
        "GOARCH": "amd64",
        "GOAMD64": "v1",
        "GOOS": "linux",
        "GOWORK": "off",
    }
    subprocess.run(
        [
            "go",
            "build",
            "-buildvcs=false",
            "-o",
            str(binary),
            "./server_tools/admin_credential_recovery",
        ],
        cwd=SOURCE_ROOT,
        env=environment,
        check=True,
    )
    metadata = subprocess.run(
        ["go", "version", "-m", str(binary)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    verify_binary_manifest.verify_metadata(
        manifest,
        metadata,
        "amd64",
        "filterest-admin-recovery",
    )
