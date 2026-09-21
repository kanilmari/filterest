#!/usr/bin/env python3
# audit_public_demo_assets.py
# Reviews Filterest demo media and its runtime-materialization contract.
# Bridges immutable fixture sources, seed references, and mutable storage targets.
# Exists so public screenshots/demo-data review is repeatable release evidence;
# `./filterest release verify` runs it on this checkout.

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from dataclasses import dataclass
from typing import Any

try:
    from .audit_source_boundary import OPERATOR_HOMES
except ImportError:  # run as a script from this directory
    from audit_source_boundary import OPERATOR_HOMES


MAX_STORAGE_IMAGE_BYTES = 2_500_000
RUNTIME_MEDIA_SCHEMA_VERSION = 1
EXPECTED_RUNTIME_MEDIA_DESTINATIONS = 21
RUNTIME_MEDIA_MANIFEST_NAME = "runtime_media.v1.json"
LEGACY_ROOT_MEDIA_HOMES = ("storage",)
ALLOWED_RUNTIME_MEDIA_VARIANTS = {"original", "300", "1000", "2160"}
MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Secret-like and machine-specific text that no fixture image may carry. A
# workspace that embeds Filterest adds its own names with --forbidden-marker.
FORBIDDEN_TEXT_MARKERS = [
    "/home/",
    "sk-",
    "OPENAI_API_KEY",
    "SECRET=",
    "TOKEN=",
    "PASSWORD=",
]


@dataclass(frozen=True)
class DemoAssetAudit:
    auth_assets: list[pathlib.Path]
    storage_assets: list[pathlib.Path]
    runtime_destinations: list[str]
    findings: list[str]


@dataclass(frozen=True)
class RuntimeMediaContract:
    source_assets: list[pathlib.Path]
    destinations: list[str]
    seeded_cached_image_names: set[str]


def sha256_file(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path: pathlib.Path, root: pathlib.Path) -> str:
    return str(path.relative_to(root))


def parse_canonical_relative_posix_path(
    value: Any,
    *,
    label: str,
    findings: list[str],
) -> pathlib.PurePosixPath | None:
    """Validate one portable manifest path before it reaches filesystem logic.

    Bridges untrusted JSON strings and fixture/storage path resolution so the
    release audit cannot accept absolute, parent-relative, or normalized aliases.
    """
    if not isinstance(value, str) or not value:
        findings.append(f"{label} must be a non-empty string")
        return None
    if "\\" in value:
        findings.append(f"{label} must use forward slashes: {value!r}")
        return None

    parsed = pathlib.PurePosixPath(value)
    if (
        parsed.is_absolute()
        or parsed.as_posix() != value
        or any(part in {"", ".", ".."} for part in parsed.parts)
    ):
        findings.append(f"{label} must be a canonical relative path: {value!r}")
        return None
    return parsed


def validate_runtime_destination(
    value: Any,
    *,
    label: str,
    findings: list[str],
) -> pathlib.PurePosixPath | None:
    """Validate one row-scoped destination declared by the runtime manifest.

    Bridges the immutable bootstrap contract and mutable storage layout so all
    generated paths retain canonical table, row, variant, and filename identity.
    """
    destination = parse_canonical_relative_posix_path(
        value,
        label=label,
        findings=findings,
    )
    if destination is None:
        return None
    if len(destination.parts) != 4:
        findings.append(
            f"{label} must match <table_uid>/<row_id>/<variant>/<filename>: {value!r}"
        )
        return None

    table_uid, row_id, variant, filename = destination.parts
    for coordinate_name, coordinate in (("table UID", table_uid), ("row ID", row_id)):
        if (
            re.fullmatch(r"[1-9][0-9]*", coordinate) is None
            or len(coordinate) > 19
            or int(coordinate) > MAX_POSTGRES_BIGINT
        ):
            findings.append(f"{label} has non-canonical {coordinate_name}: {value!r}")
            return None
    if variant not in ALLOWED_RUNTIME_MEDIA_VARIANTS:
        findings.append(f"{label} has unsupported media variant: {value!r}")
        return None
    if not re.fullmatch(
        rf"{re.escape(table_uid)}_{re.escape(row_id)}_[1-9][0-9]*\.(?:png|jpg)",
        filename,
        flags=re.IGNORECASE,
    ):
        findings.append(f"{label} has a non-canonical row-scoped filename: {value!r}")
        return None
    return destination


def extract_seeded_cached_image_names(seed_sql: str) -> set[str]:
    """Read the public starter rows' cached image names without executing SQL.

    Bridges bootstrap seed text and runtime destination validation so a seed
    reference cannot silently outlive or bypass its materialized media contract.
    """
    names = set(
        re.findall(
            r"UPDATE\s+public\.[A-Za-z0-9_]+\s+SET\s+cached_image\s*=\s*'([^']+)'",
            seed_sql,
            flags=re.IGNORECASE,
        )
    )
    for case_body in re.findall(
        r"SET\s+cached_image\s*=\s*CASE\b(.*?)\bEND",
        seed_sql,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        names.update(re.findall(r"\bTHEN\s+'([^']+)'", case_body, flags=re.IGNORECASE))
    return names


def audit_runtime_media_contract(
    root: pathlib.Path,
    findings: list[str],
) -> RuntimeMediaContract:
    """Audit the schema-versioned fixture-to-runtime media mapping.

    Bridges public fixture bytes, the runtime manifest, and seed SQL references;
    it exists to make fresh-install media completeness a deterministic gate.
    """
    fixture_root = root / "app" / "server_tools" / "public_bootstrap" / "source" / "fixtures"
    manifest_path = fixture_root / RUNTIME_MEDIA_MANIFEST_NAME
    source_assets: list[pathlib.Path] = []
    source_references: list[str] = []
    destinations: list[str] = []

    if manifest_path.is_symlink():
        findings.append(
            f"runtime media manifest must not be a symlink: {relative(manifest_path, root)}"
        )
        return RuntimeMediaContract(source_assets, destinations, set())
    if not manifest_path.is_file():
        findings.append(
            f"missing runtime media manifest: {relative(manifest_path, root)}"
        )
        return RuntimeMediaContract(source_assets, destinations, set())

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        findings.append(
            f"invalid runtime media manifest {relative(manifest_path, root)}: {exc}"
        )
        return RuntimeMediaContract(source_assets, destinations, set())

    if not isinstance(manifest, dict):
        findings.append("runtime media manifest root must be an object")
        return RuntimeMediaContract(source_assets, destinations, set())
    schema_version = manifest.get("schema_version")
    if (
        not isinstance(schema_version, int)
        or isinstance(schema_version, bool)
        or schema_version != RUNTIME_MEDIA_SCHEMA_VERSION
    ):
        findings.append(
            "runtime media manifest schema_version must be "
            f"{RUNTIME_MEDIA_SCHEMA_VERSION}, got {schema_version!r}"
        )
    materialization_revision = manifest.get("materialization_revision")
    if (
        not isinstance(materialization_revision, int)
        or isinstance(materialization_revision, bool)
        or materialization_revision < 1
    ):
        findings.append(
            "runtime media manifest materialization_revision must be a positive integer, "
            f"got {materialization_revision!r}"
        )
    assets = manifest.get("assets")
    if not isinstance(assets, list):
        findings.append("runtime media manifest assets must be a list")
        return RuntimeMediaContract(source_assets, destinations, set())

    fixture_root_resolved = fixture_root.resolve()
    for asset_index, asset in enumerate(assets):
        asset_label = f"runtime media asset[{asset_index}]"
        if not isinstance(asset, dict):
            findings.append(f"{asset_label} must be an object")
            continue

        source = parse_canonical_relative_posix_path(
            asset.get("source"),
            label=f"{asset_label}.source",
            findings=findings,
        )
        source_sha256_value = asset.get("source_sha256")
        source_sha256 = (
            source_sha256_value
            if isinstance(source_sha256_value, str)
            and re.fullmatch(r"[0-9a-f]{64}", source_sha256_value)
            else None
        )
        if source_sha256 is None:
            findings.append(
                f"{asset_label}.source_sha256 must be a lowercase SHA-256 digest"
            )
        source_path: pathlib.Path | None = None
        if source is not None:
            source_references.append(source.as_posix())
            if len(source.parts) != 2 or source.parts[0] not in {"docs", "starter-images"}:
                findings.append(
                    f"{asset_label}.source must belong directly to docs/ or starter-images/: "
                    f"{source.as_posix()!r}"
                )
            source_path = fixture_root.joinpath(*source.parts)
            try:
                source_path.resolve().relative_to(fixture_root_resolved)
            except (OSError, RuntimeError, ValueError):
                findings.append(
                    f"{asset_label}.source escapes the fixture root: {source.as_posix()!r}"
                )
                source_path = None
            if source_path is not None:
                if source_path.is_symlink():
                    findings.append(
                        f"runtime media source must not be a symlink: {relative(source_path, root)}"
                    )
                elif not source_path.is_file():
                    findings.append(
                        f"missing public fixture storage asset: {relative(source_path, root)}"
                    )
                else:
                    source_assets.append(source_path)
                    if (
                        source_sha256 is not None
                        and sha256_file(source_path) != source_sha256
                    ):
                        findings.append(
                            f"{asset_label}.source_sha256 does not match source bytes: "
                            f"{source.as_posix()!r}"
                        )

        asset_destinations = asset.get("destinations")
        if not isinstance(asset_destinations, list) or not asset_destinations:
            findings.append(f"{asset_label}.destinations must be a non-empty list")
            continue
        for destination_index, destination_value in enumerate(asset_destinations):
            destination = validate_runtime_destination(
                destination_value,
                label=f"{asset_label}.destinations[{destination_index}]",
                findings=findings,
            )
            if destination is None:
                continue
            destination_text = destination.as_posix()
            destinations.append(destination_text)
            if source is not None:
                if source.suffix.lower() != destination.suffix.lower():
                    findings.append(
                        f"{asset_label} source and destination extensions differ: "
                        f"{source.as_posix()!r} -> {destination_text!r}"
                    )
                if source.parts[0] == "starter-images" and not source.stem.endswith(
                    f"-{destination.parts[2]}"
                ):
                    findings.append(
                        f"{asset_label} starter source does not match destination variant: "
                        f"{source.as_posix()!r} -> {destination_text!r}"
                    )

    if len(source_references) != len(set(source_references)):
        findings.append("runtime media manifest source paths must be unique")
    discovered_sources = {
        path.relative_to(fixture_root).as_posix()
        for path in fixture_root.rglob("*")
        if path.is_file() and path.suffix.lower() in {".png", ".jpg"}
    }
    declared_sources = set(source_references)
    for missing_source in sorted(discovered_sources - declared_sources):
        findings.append(f"fixture image is absent from runtime media manifest: {missing_source}")
    for unknown_source in sorted(declared_sources - discovered_sources):
        findings.append(f"runtime media manifest references an unavailable source: {unknown_source}")

    if len(destinations) != EXPECTED_RUNTIME_MEDIA_DESTINATIONS:
        findings.append(
            "runtime media manifest must declare exactly "
            f"{EXPECTED_RUNTIME_MEDIA_DESTINATIONS} destinations, got {len(destinations)}"
        )
    unique_destinations = set(destinations)
    if len(unique_destinations) != EXPECTED_RUNTIME_MEDIA_DESTINATIONS:
        findings.append(
            "runtime media manifest must declare exactly "
            f"{EXPECTED_RUNTIME_MEDIA_DESTINATIONS} unique destinations, "
            f"got {len(unique_destinations)}"
        )

    seed_path = fixture_root.parent / "app_tables.seed.sql"
    seeded_cached_image_names: set[str] = set()
    if seed_path.is_symlink():
        findings.append(
            "public bootstrap seed source must not be a symlink: "
            f"{relative(seed_path, root)}"
        )
    elif not seed_path.is_file():
        findings.append(f"missing public bootstrap seed source: {relative(seed_path, root)}")
    else:
        seeded_cached_image_names = extract_seeded_cached_image_names(
            seed_path.read_text(encoding="utf-8")
        )
        destination_names = {
            pathlib.PurePosixPath(destination).name for destination in unique_destinations
        }
        for missing_name in sorted(seeded_cached_image_names - destination_names):
            findings.append(
                f"seeded cached_image has no runtime media destination: {missing_name}"
            )
        for unseeded_name in sorted(destination_names - seeded_cached_image_names):
            findings.append(
                f"runtime media destination has no seeded cached_image reference: {unseeded_name}"
            )

    return RuntimeMediaContract(source_assets, destinations, seeded_cached_image_names)


def validate_storage_image(
    path: pathlib.Path,
    root: pathlib.Path,
    findings: list[str],
    markers: tuple[str, ...] = tuple(FORBIDDEN_TEXT_MARKERS),
) -> None:
    rel = relative(path, root)
    data = path.read_bytes()
    if len(data) > MAX_STORAGE_IMAGE_BYTES:
        findings.append(f"{rel} exceeds {MAX_STORAGE_IMAGE_BYTES} bytes")
    if path.suffix == ".png" and not data.startswith(PNG_SIGNATURE):
        findings.append(f"{rel} is not a PNG asset")
    if path.suffix == ".jpg" and not data.startswith(b"\xff\xd8\xff"):
        findings.append(f"{rel} is not a JPEG asset")
    for marker in markers:
        if marker.encode("utf-8") in data:
            findings.append(f"{rel} contains forbidden marker: {marker}")


def audit_demo_assets(
    public_root: pathlib.Path,
    *,
    allow_local_mutable_homes: bool = False,
    extra_markers: tuple[str, ...] = (),
) -> DemoAssetAudit:
    findings: list[str] = []
    markers = tuple(dict.fromkeys((*FORBIDDEN_TEXT_MARKERS, *extra_markers)))
    auth_roots = (
        public_root / "app" / "frontend" / "public" / "auth-tour",
        public_root / "app" / "frontend" / "dist" / "auth-tour",
    )
    auth_assets = sorted(
        path
        for auth_root in auth_roots
        if auth_root.is_dir()
        for path in auth_root.rglob("*")
        if path.is_file() or path.is_symlink()
    )
    runtime_media = audit_runtime_media_contract(public_root, findings)
    storage_assets = runtime_media.source_assets

    for auth_root in auth_roots:
        if auth_root.exists() or auth_root.is_symlink():
            findings.append(
                "withdrawn auth-tour media directory is distributed: "
                f"{relative(auth_root, public_root)}"
            )

    for asset in storage_assets:
        if not asset.is_file():
            findings.append(f"missing public fixture storage asset: {relative(asset, public_root)}")
            continue
        if asset.suffix in {".png", ".jpg"}:
            validate_storage_image(asset, public_root, findings, markers)
        else:
            findings.append(f"{relative(asset, public_root)} has unsupported fixture asset type")

    # Operator homes may exist locally once the boundary check has proved them
    # untracked and ignored. A root storage/ folder is not an operator home:
    # media belongs under data/, so a root copy is refused in every mode.
    mutable_homes = LEGACY_ROOT_MEDIA_HOMES if allow_local_mutable_homes else (
        *OPERATOR_HOMES,
        *LEGACY_ROOT_MEDIA_HOMES,
    )
    for mutable_home in mutable_homes:
        if (public_root / mutable_home).exists():
            findings.append(f"mutable root home exported into public source: {mutable_home}/")

    return DemoAssetAudit(
        auth_assets=auth_assets,
        storage_assets=storage_assets,
        runtime_destinations=runtime_media.destinations,
        findings=findings,
    )


def render_report(public_root: pathlib.Path, audit: DemoAssetAudit) -> str:
    lines = [
        "# Filterest Public Demo Asset Audit",
        "",
        "- Target: `Filterest public demo assets`",
        f"- Published auth-tour media files: `{len(audit.auth_assets)}`",
        f"- Immutable bootstrap fixture sources: `{len(audit.storage_assets)}`",
        f"- Runtime storage destinations: `{len(set(audit.runtime_destinations))}`",
        f"- Findings: `{len(audit.findings)}`",
        "",
        "## Verdict",
        "",
        "FAIL" if audit.findings else "PASS",
        "",
        "## Auth-Tour Assets",
        "",
    ]
    if audit.auth_assets:
        for asset in audit.auth_assets:
            lines.append(f"- `{relative(asset, public_root)}`: withdrawn media is present")
    else:
        lines.append(
            "- No auth-tour screenshots are distributed; the dormant gallery may be "
            "repopulated only after a new content and provenance review."
        )
    lines.extend(["", "## Immutable Bootstrap Fixture Sources", ""])
    table_counts: dict[str, int] = {}
    table_extensions: dict[str, set[str]] = {}
    for asset in audit.storage_assets:
        table_uid = asset.parent.name
        table_counts[table_uid] = table_counts.get(table_uid, 0) + 1
        table_extensions.setdefault(table_uid, set()).add(asset.suffix.lstrip(".").upper())
    for table_uid in sorted(table_counts):
        extensions = "/".join(sorted(table_extensions.get(table_uid, set())))
        lines.append(f"- table `{table_uid}`: `{table_counts[table_uid]}` {extensions} files")
    lines.extend(["", "## Findings", ""])
    if audit.findings:
        for finding in audit.findings:
            lines.append(f"- {finding}")
    else:
        lines.append("- No withdrawn auth-tour media, exported mutable homes, invalid fixture images, or secret-like markers detected.")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Audit Filterest public demo media and fixture assets.")
    parser.add_argument(
        "--target",
        default=str(pathlib.Path(__file__).resolve().parents[3]),
        help="Filterest repository root (default: the checkout this tool belongs to)",
    )
    parser.add_argument("--report", help="Optional Markdown report path to write")
    parser.add_argument(
        "--allow-local-mutable-homes",
        action="store_true",
        help=(
            "Allow canonical config/keys/projects/data/backups homes after the "
            "candidate gate has proved they are local, ignored, and untracked."
        ),
    )
    parser.add_argument(
        "--forbidden-marker",
        action="append",
        default=[],
        help="Additional text no fixture image may contain, such as a private product name; repeatable",
    )
    args = parser.parse_args(argv)

    public_root = pathlib.Path(args.target).resolve()
    audit = audit_demo_assets(
        public_root,
        allow_local_mutable_homes=args.allow_local_mutable_homes,
        extra_markers=tuple(args.forbidden_marker),
    )
    report = render_report(public_root, audit)

    if args.report:
        report_path = pathlib.Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report, encoding="utf-8")
        print(f"wrote {report_path}")

    if audit.findings:
        print(report, file=sys.stderr)
        return 1

    print(
        "Public demo asset audit OK: "
        f"{len(audit.auth_assets)} published auth-tour media files, "
        f"{len(audit.storage_assets)} immutable bootstrap fixture sources, "
        f"{len(set(audit.runtime_destinations))} runtime storage destinations."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
