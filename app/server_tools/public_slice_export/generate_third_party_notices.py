#!/usr/bin/env python3
"""Generate complete third-party notices for a Filterest release candidate.

The inventory follows what Filterest actually distributes: Go modules compiled
into every shipped binary, runtime npm packages, build helpers copied into the
browser bundle, and bundled public assets. Every third-party row points to
retained, hash-bound license/NOTICE bytes.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass

try:
    from .third_party_notice_renderer import render_notice_from_manifest
except ImportError:
    from third_party_notice_renderer import render_notice_from_manifest  # type: ignore[no-redef]


LICENSE_FILE_NAMES = (
    "LICENSE",
    "LICENCE",
    "License",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENCE.md",
    "LICENCE.txt",
    "License.md",
    "License.txt",
    "COPYING",
    "COPYING.md",
    "COPYING.txt",
    "NOTICE",
    "NOTICE.md",
    "NOTICE.txt",
    "PATENTS",
    "PATENTS.md",
    "PATENTS.txt",
    "AUTHORS",
    "AUTHORS.md",
    "AUTHORS.txt",
)
ASSET_SUFFIXES = {
    ".gif", ".ico", ".jpeg", ".jpg", ".otf", ".png", ".svg",
    ".ttf", ".webp", ".woff", ".woff2",
}
EMBEDDED_VECTOR_SOURCE_ROOTS = (
    pathlib.PurePosixPath("app/backend"),
    pathlib.PurePosixPath("app/frontend"),
)
EMBEDDED_VECTOR_SOURCE_SUFFIXES = {
    ".css", ".go", ".html", ".js", ".jsx", ".mjs", ".ts", ".tsx",
}
EMBEDDED_VECTOR_TEST_SUFFIXES = (
    ".spec.js", ".spec.jsx", ".spec.ts", ".spec.tsx",
    ".test.js", ".test.jsx", ".test.ts", ".test.tsx", "_test.go",
)
SOURCE_STRING_LITERAL_RE = re.compile(
    r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`''',
    re.DOTALL,
)
SVG_PATH_VALUE_RE = re.compile(
    r"""^\s*[Mm]\s*-?(?:\d+(?:\.\d+)?|\.\d+)
        (?=[\s,.-]+-?(?:\d+(?:\.\d+)?|\.\d+))""",
    re.VERBOSE,
)
SVG_PATH_MARKUP_RE = re.compile(
    r"""<path\b[^>]*\bd\s*=\s*
        (?P<literal>[\"'`]\s*[Mm]\s*-?(?:\d+(?:\.\d+)?|\.\d+)
        (?=[\s,.-]+-?(?:\d+(?:\.\d+)?|\.\d+))[^\"'`]*[\"'`])""",
    re.IGNORECASE | re.VERBOSE,
)
SVG_POINTS_CONTEXT_RE = re.compile(
    r"""(?:\bpoints\s*=\s*|\.setAttribute\(\s*[\"']points[\"']\s*,\s*)
        (?P<literal>[\"'`]\s*-?(?:\d+(?:\.\d+)?|\.\d+)
        (?:[\s,]+-?(?:\d+(?:\.\d+)?|\.\d+)){3,}\s*[\"'`])""",
    re.IGNORECASE | re.VERBOSE,
)
SVG_PRIMITIVE_MARKUP_RE = re.compile(
    r"""<(?:circle|ellipse|rect|line)\b[^>]*
        \b(?:cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|width|height)\s*=\s*
        [\"']\s*-?(?:\d+(?:\.\d+)?|\.\d+)""",
    re.IGNORECASE | re.VERBOSE,
)
SVG_DATA_URI_RE = re.compile(
    r"data:image/svg\+xml(?P<parameters>[^,]*),(?P<payload>[^\"'`\s)]+)",
    re.IGNORECASE,
)
SKIPPED_DIRS = {".git", "node_modules", "dist-public", "data", "backups"}
ASSET_PROVENANCE_PATH = pathlib.PurePosixPath(
    "app/server_tools/licenses/asset_provenance.json"
)
BROWSER_BUNDLE_PROVENANCE_PATH = pathlib.PurePosixPath(
    "app/server_tools/licenses/browser_bundle_provenance.json"
)
GO_BINARY_TARGETS = (
    ("filterest", ".", ("netgo", "osusergo"), "linux-release"),
    ("filterest", ".", (), "container"),
    (
        "filterest-admin-recovery",
        "./server_tools/admin_credential_recovery",
        (),
        "container",
    ),
)


@dataclass(frozen=True)
class Dependency:
    ecosystem: str
    name: str
    version: str
    license_id: str
    source_dir: pathlib.Path | None
    license_documents: tuple[pathlib.Path, ...]
    scope: str
    binary_targets: tuple[str, ...] = ()
    upstream: str = ""


@dataclass(frozen=True)
class Asset:
    path: str
    sha256: str
    component: str
    party: str
    license_id: str
    kind: str


@dataclass(frozen=True)
class EmbeddedVectorEvidence:
    path: str
    line: int
    kind: str


class InventoryCollectionError(RuntimeError):
    """Describe missing dependency metadata that must block notice generation."""


def read_text(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    return sha256_bytes(path.read_bytes())


def parse_json_stream(stream: str) -> list[dict]:
    decoder = json.JSONDecoder()
    index = 0
    values: list[dict] = []
    while index < len(stream):
        while index < len(stream) and stream[index].isspace():
            index += 1
        if index >= len(stream):
            break
        value, index = decoder.raw_decode(stream, index)
        if isinstance(value, dict):
            values.append(value)
    return values


def infer_license_from_text(text: str) -> str:
    sample = " ".join(text[:30000].lower().split())
    if "apache license" in sample and "version 2.0" in sample:
        return "Apache-2.0"
    if "mozilla public license version 2.0" in sample or "mozilla public license, version 2.0" in sample:
        return "MPL-2.0"
    if "mit license" in sample or "permission is hereby granted, free of charge" in sample:
        return "MIT"
    if "neither the name" in sample and "contributors may be used" in sample:
        return "BSD-3-Clause"
    if "redistribution and use in source and binary forms" in sample:
        return "BSD-2-Clause"
    if "permission to use, copy, modify, and/or distribute this software" in sample:
        return "ISC"
    if "gnu affero general public license" in sample:
        return "AGPL"
    if "gnu general public license" in sample:
        return "GPL"
    return "review-required"


def find_license_documents(source_dir: pathlib.Path | None) -> tuple[pathlib.Path, ...]:
    if source_dir is None or not source_dir.is_dir():
        return ()
    return tuple(
        source_dir / name
        for name in LICENSE_FILE_NAMES
        if (source_dir / name).is_file()
    )


def find_nested_license_documents(
    package_dir: pathlib.Path,
    module_dir: pathlib.Path,
) -> tuple[pathlib.Path, ...]:
    """Return the closest vendored component notices below a Go module root."""

    current = package_dir
    while current != module_dir and module_dir in current.parents:
        documents = find_license_documents(current)
        if documents:
            return documents
        current = current.parent
    return ()


def vendored_component_identity(
    module_name: str,
    module_version: str,
    module_dir: pathlib.Path,
    document_dir: pathlib.Path,
) -> tuple[str, str]:
    relative = document_dir.relative_to(module_dir).as_posix()
    leaf = document_dir.name
    match = re.fullmatch(r"(.+)-([0-9]+(?:\.[0-9]+)+)", leaf)
    if match:
        component, version = match.groups()
        return f"{module_name}:{component}", version
    return f"{module_name}:{relative}", module_version


def collect_go_toolchain(binary_targets: tuple[str, ...]) -> Dependency | None:
    result = subprocess.run(
        ["go", "env", "GOROOT", "GOVERSION"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    values = result.stdout.splitlines()
    if result.returncode != 0 or len(values) < 2:
        return None
    source_dir = pathlib.Path(values[0])
    documents = find_license_documents(source_dir)
    return Dependency(
        ecosystem="go-toolchain",
        name="Go runtime and standard library",
        version=values[1],
        license_id=infer_license_from_text(read_text(documents[0])) if documents else "review-required",
        source_dir=source_dir,
        license_documents=documents,
        scope="release-binary",
        binary_targets=binary_targets,
    )


def merge_dependency_target(
    dependencies: dict[tuple[str, str, str], Dependency],
    dependency: Dependency,
) -> None:
    """Merge one binary membership without hiding conflicting source metadata."""

    identity = (dependency.ecosystem, dependency.name, dependency.version)
    current = dependencies.get(identity)
    if current is None:
        dependencies[identity] = dependency
        return
    comparable_current = (
        current.license_id,
        current.source_dir,
        current.license_documents,
        current.scope,
        current.upstream,
    )
    comparable_incoming = (
        dependency.license_id,
        dependency.source_dir,
        dependency.license_documents,
        dependency.scope,
        dependency.upstream,
    )
    if comparable_current != comparable_incoming:
        raise InventoryCollectionError(
            f"dependency metadata conflicts across release targets: {identity!r}"
        )
    dependencies[identity] = Dependency(
        ecosystem=current.ecosystem,
        name=current.name,
        version=current.version,
        license_id=current.license_id,
        source_dir=current.source_dir,
        license_documents=current.license_documents,
        scope=current.scope,
        binary_targets=tuple(sorted({*current.binary_targets, *dependency.binary_targets})),
        upstream=current.upstream,
    )


def standalone_go_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment["GOWORK"] = "off"
    return environment


def snapshot_go_manifest_files(target: pathlib.Path) -> dict[pathlib.Path, bytes | None]:
    return {
        target / name: (target / name).read_bytes() if (target / name).is_file() else None
        for name in ("go.mod", "go.sum")
    }


def restore_go_manifest_files(snapshot: dict[pathlib.Path, bytes | None]) -> None:
    for path, content in snapshot.items():
        if content is None:
            if path.exists():
                path.unlink()
        elif not path.exists() or path.read_bytes() != content:
            path.write_bytes(content)


def warm_go_module_cache(target: pathlib.Path) -> dict[tuple[str, str], pathlib.Path]:
    snapshot = snapshot_go_manifest_files(target)
    try:
        result = subprocess.run(
            ["go", "mod", "download", "-json", "all"],
            cwd=target,
            env=standalone_go_environment(),
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        directories: dict[tuple[str, str], pathlib.Path] = {}
        for module in parse_json_stream(result.stdout):
            path = str(module.get("Path") or "")
            version = str(module.get("Version") or "")
            directory = str(module.get("Dir") or "")
            if path and version and directory:
                directories[(path, version)] = pathlib.Path(directory)
        return directories
    except OSError:
        return {}
    finally:
        restore_go_manifest_files(snapshot)


def collect_go_modules(
    target: pathlib.Path, *, readonly: bool = False,
) -> tuple[list[Dependency], str]:
    if not (target / "go.mod").is_file():
        raise InventoryCollectionError("go.mod is missing")

    # Preparation must not edit go.mod/go.sum, even temporarily: a parallel
    # editor owns those bytes. Missing dependencies fail closed in readonly mode.
    download_dirs = {} if readonly else warm_go_module_cache(target)
    environment = standalone_go_environment()
    if readonly:
        environment["GOFLAGS"] = "-mod=readonly"
    environment.update({"CGO_ENABLED": "1", "GOARCH": "amd64", "GOOS": "linux"})
    dependencies: dict[tuple[str, str, str], Dependency] = {}
    vendored_roots: dict[
        tuple[str, pathlib.Path],
        tuple[str, str, set[str]],
    ] = {}
    source_descriptions: list[str] = []
    for binary_target, package_target, build_tags, build_profile in GO_BINARY_TARGETS:
        command = ["go", "list", "-buildvcs=false"]
        if build_tags:
            command.extend(["-tags", " ".join(build_tags)])
        command.extend(["-deps", "-json", package_target])
        result = subprocess.run(
            command,
            cwd=target,
            env=environment,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if result.returncode != 0:
            detail = result.stderr.strip().splitlines()
            suffix = f": {detail[-1]}" if detail else ""
            raise InventoryCollectionError(
                f"go list -deps failed for {binary_target} ({build_profile}){suffix}"
            )
        tag_description = f" tags={' '.join(build_tags)}" if build_tags else ""
        source_descriptions.append(
            f"{binary_target}[{build_profile}]:{package_target}{tag_description}"
        )

        for package in parse_json_stream(result.stdout):
            module = package.get("Module")
            if not isinstance(module, dict) or module.get("Main"):
                continue
            name = str(module.get("Path") or "")
            version = str(module.get("Version") or "")
            replacement = module.get("Replace")
            metadata = replacement if isinstance(replacement, dict) else module
            source_dir_raw = str(metadata.get("Dir") or "")
            source_dir = pathlib.Path(source_dir_raw) if source_dir_raw else download_dirs.get((name, version))
            documents = find_license_documents(source_dir)
            license_id = infer_license_from_text(read_text(documents[0])) if documents else "review-required"
            if name:
                merge_dependency_target(
                    dependencies,
                    Dependency(
                        ecosystem="go",
                        name=name,
                        version=version,
                        license_id=license_id,
                        source_dir=source_dir,
                        license_documents=documents,
                        scope="release-binary",
                        binary_targets=(binary_target,),
                    ),
                )
                package_dir_raw = str(package.get("Dir") or "")
                if source_dir is not None and package_dir_raw:
                    nested_documents = find_nested_license_documents(pathlib.Path(package_dir_raw), source_dir)
                    if nested_documents:
                        document_dir = nested_documents[0].parent
                        key = (name, document_dir)
                        component_name, component_version = vendored_component_identity(
                            name,
                            version,
                            source_dir,
                            document_dir,
                        )
                        current = vendored_roots.get(key)
                        targets = set(current[2]) if current else set()
                        targets.add(binary_target)
                        vendored_roots[key] = (
                            component_name,
                            component_version,
                            targets,
                        )

    for dependency in list(dependencies.values()):
        if dependency.ecosystem != "go" or dependency.source_dir is None:
            continue
        nested_document_dirs = {
            path.parent
            for path in dependency.source_dir.rglob("*")
            if path.is_file()
            and path.name in LICENSE_FILE_NAMES
            and path.parent != dependency.source_dir
        }
        for document_dir in nested_document_dirs:
            key = (dependency.name, document_dir)
            component_name, component_version = vendored_component_identity(
                dependency.name,
                dependency.version,
                dependency.source_dir,
                document_dir,
            )
            current = vendored_roots.get(key)
            targets = set(current[2]) if current else set()
            targets.update(dependency.binary_targets)
            vendored_roots[key] = (component_name, component_version, targets)

    for (_module_name, document_dir), (
        component_name,
        component_version,
        binary_targets,
    ) in vendored_roots.items():
        documents = find_license_documents(document_dir)
        dependencies[("go-vendored", component_name, component_version)] = Dependency(
            ecosystem="go-vendored",
            name=component_name,
            version=component_version,
            license_id=infer_license_from_text(read_text(documents[0])) if documents else "review-required",
            source_dir=document_dir,
            license_documents=documents,
            scope="release-binary",
            binary_targets=tuple(sorted(binary_targets)),
        )

    toolchain = collect_go_toolchain(
        tuple(sorted({
            binary_target
            for binary_target, _package, _tags, _profile in GO_BINARY_TARGETS
        }))
    )
    if toolchain is None:
        raise InventoryCollectionError("Go toolchain metadata is unavailable")
    dependencies[(toolchain.ecosystem, toolchain.name, toolchain.version)] = toolchain
    return sorted(
        dependencies.values(),
        key=lambda item: (item.ecosystem, item.name, item.version),
    ), (
        "GOOS=linux GOARCH=amd64 CGO_ENABLED=1 go list -deps metadata for "
        + "; ".join(source_descriptions)
        + ", plus compiled vendored components and Go toolchain"
    )


def normalize_npm_license(value: object) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, list):
        normalized = [normalize_npm_license(item) for item in value]
        return ", ".join(item for item in normalized if item != "review-required") or "review-required"
    if isinstance(value, dict):
        return normalize_npm_license(value.get("type") or value.get("name"))
    return "review-required"


def npm_package_name(package_path: str, package_info: dict) -> str:
    if package_info.get("name"):
        return str(package_info["name"])
    marker = "node_modules/"
    return package_path.rsplit(marker, 1)[-1] if marker in package_path else package_path


def resolve_lock_dependency(packages: dict, package_path: str, dependency_name: str) -> str | None:
    base = package_path
    while True:
        candidate = f"{base}/node_modules/{dependency_name}" if base else f"node_modules/{dependency_name}"
        if candidate in packages:
            return candidate
        if not base:
            return None
        base = base.rsplit("/node_modules/", 1)[0] if "/node_modules/" in base else ""


def production_npm_package_paths(packages: dict) -> list[str]:
    root = packages.get("")
    if not isinstance(root, dict):
        return []
    pending = [resolve_lock_dependency(packages, "", name) for name in root.get("dependencies", {})]
    included: set[str] = set()
    while pending:
        package_path = pending.pop()
        if not package_path or package_path in included:
            continue
        included.add(package_path)
        package = packages.get(package_path)
        if not isinstance(package, dict):
            continue
        pending.extend(
            resolve_lock_dependency(packages, package_path, name)
            for name in package.get("dependencies", {})
        )
    return sorted(included)


def collect_npm_packages(target: pathlib.Path) -> tuple[list[Dependency], str]:
    lock_path = target / "package-lock.json"
    if not lock_path.is_file():
        raise InventoryCollectionError("package-lock.json is missing")
    packages = json.loads(read_text(lock_path)).get("packages", {})
    if not isinstance(packages, dict):
        raise InventoryCollectionError("package-lock.json packages are missing")

    dependencies: list[Dependency] = []
    used_installed_metadata = False
    for package_path in production_npm_package_paths(packages):
        package = packages[package_path]
        source_dir = target / package_path
        license_id = normalize_npm_license(package.get("license"))
        package_json_path = source_dir / "package.json"
        if package_json_path.is_file():
            metadata = json.loads(read_text(package_json_path))
            installed_license = normalize_npm_license(metadata.get("license") or metadata.get("licenses"))
            if license_id != "review-required" and installed_license != license_id:
                license_id = "review-required"
            else:
                license_id = installed_license
            used_installed_metadata = True
        dependencies.append(
            Dependency(
                ecosystem="npm",
                name=npm_package_name(package_path, package),
                version=str(package.get("version") or ""),
                license_id=license_id,
                source_dir=source_dir if source_dir.is_dir() else None,
                license_documents=find_license_documents(source_dir),
                scope="production-package",
            )
        )
    source = "package-lock.json production dependency graph"
    if used_installed_metadata:
        source += " with installed package metadata"
    return sorted(dependencies, key=lambda item: (item.name, item.version)), source


def read_browser_bundle_provenance(target: pathlib.Path) -> dict:
    path = target / BROWSER_BUNDLE_PROVENANCE_PATH
    if not path.is_file():
        raise InventoryCollectionError(
            f"browser bundle provenance is missing: {BROWSER_BUNDLE_PROVENANCE_PATH}"
        )
    value = json.loads(read_text(path))
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise InventoryCollectionError("browser bundle provenance schema_version must be 1")
    if not isinstance(value.get("components"), list) or not value["components"]:
        raise InventoryCollectionError("browser bundle provenance components are missing")
    return value


def collect_browser_bundle_dependencies(target: pathlib.Path) -> tuple[list[Dependency], str]:
    """Collect reviewed build-tool code that is present in production JS output."""

    provenance = read_browser_bundle_provenance(target)
    lock_path = target / "app" / "package-lock.json"
    if not lock_path.is_file():
        raise InventoryCollectionError("package-lock.json is missing")
    packages = json.loads(read_text(lock_path)).get("packages", {})
    if not isinstance(packages, dict):
        raise InventoryCollectionError("package-lock.json packages are missing")
    dist_dir = target / "app" / "frontend" / "dist"
    bundle_files = sorted(
        path
        for path in dist_dir.rglob("*.js")
        if path.is_file() and not path.is_symlink()
    ) if dist_dir.is_dir() else []
    if not bundle_files:
        raise InventoryCollectionError("production browser JavaScript bundle is missing")
    bundle_text = "\n".join(read_text(path) for path in bundle_files)
    license_root = target / "app" / "server_tools" / "licenses"
    dependencies: list[Dependency] = []
    seen_names: set[str] = set()

    for component in provenance["components"]:
        if not isinstance(component, dict):
            raise InventoryCollectionError("browser bundle component rows must be objects")
        name = str(component.get("name") or "")
        version = str(component.get("version") or "")
        package_path = str(component.get("package_path") or "")
        license_id = str(component.get("license") or "")
        upstream = str(component.get("source") or "")
        integrity = str(component.get("integrity") or "")
        required_by = str(component.get("required_by") or "")
        installed_license_path = pathlib.PurePosixPath(
            str(component.get("installed_license_path") or "")
        )
        if (
            not name
            or name in seen_names
            or not version
            or not package_path
            or not license_id
            or not upstream
            or not integrity
        ):
            raise InventoryCollectionError(
                f"browser bundle component identity is missing or duplicated: {name!r}"
            )
        seen_names.add(name)
        package = packages.get(package_path)
        if not isinstance(package, dict):
            raise InventoryCollectionError(
                f"browser bundle component is absent from package-lock.json: {name}"
            )
        if str(package.get("version") or "") != version:
            raise InventoryCollectionError(
                f"browser bundle component version requires review: {name}"
            )
        if normalize_npm_license(package.get("license")) != license_id:
            raise InventoryCollectionError(
                f"browser bundle component license requires review: {name}"
            )
        if str(package.get("integrity") or "") != integrity:
            raise InventoryCollectionError(
                f"browser bundle component integrity requires review: {name}"
            )
        if required_by:
            parent = packages.get(required_by)
            if (
                not isinstance(parent, dict)
                or name not in parent.get("dependencies", {})
                or resolve_lock_dependency(packages, required_by, name) != package_path
            ):
                raise InventoryCollectionError(
                    f"browser bundle component dependency path requires review: {name}"
                )
        else:
            root = packages.get("")
            if (
                not isinstance(root, dict)
                or name not in root.get("devDependencies", {})
                or resolve_lock_dependency(packages, "", name) != package_path
            ):
                raise InventoryCollectionError(
                    f"browser bundle root build dependency requires review: {name}"
                )

        documents: list[pathlib.Path] = []
        document_rows = component.get("documents")
        if not isinstance(document_rows, list) or not document_rows:
            raise InventoryCollectionError(
                f"browser bundle component lacks reviewed license documents: {name}"
            )
        for document in document_rows:
            if not isinstance(document, dict):
                raise InventoryCollectionError(
                    f"browser bundle document row must be an object: {name}"
                )
            relative = pathlib.PurePosixPath(str(document.get("path") or ""))
            if len(relative.parts) != 1 or relative.name in {"", ".", ".."}:
                raise InventoryCollectionError(
                    f"browser bundle document path must be a file name: {name}"
                )
            path = license_root / relative.name
            if not path.is_file() or path.is_symlink():
                raise InventoryCollectionError(
                    f"browser bundle license document is missing or not regular: {relative}"
                )
            if sha256_file(path) != str(document.get("sha256") or ""):
                raise InventoryCollectionError(
                    f"browser bundle license document bytes require review: {relative}"
                )
            documents.append(path)

        if (
            len(installed_license_path.parts) != 1
            or installed_license_path.name in {"", ".", ".."}
        ):
            raise InventoryCollectionError(
                f"browser bundle installed license path is invalid: {name}"
            )
        installed_dir = target / "app" / package_path
        if installed_dir.is_dir():
            installed_package_json = installed_dir / "package.json"
            installed_license = installed_dir / installed_license_path.name
            if not installed_package_json.is_file() or installed_package_json.is_symlink():
                raise InventoryCollectionError(
                    f"installed browser bundle package metadata is unavailable: {name}"
                )
            installed_metadata = json.loads(read_text(installed_package_json))
            if (
                str(installed_metadata.get("name") or "") != name
                or str(installed_metadata.get("version") or "") != version
                or normalize_npm_license(installed_metadata.get("license")) != license_id
            ):
                raise InventoryCollectionError(
                    f"installed browser bundle package metadata requires review: {name}"
                )
            if (
                not installed_license.is_file()
                or installed_license.is_symlink()
                or sha256_file(installed_license) != sha256_file(documents[0])
            ):
                raise InventoryCollectionError(
                    f"installed browser bundle license bytes require review: {name}"
                )

        markers = component.get("markers")
        if not isinstance(markers, list) or not markers:
            raise InventoryCollectionError(
                f"browser bundle component markers are missing: {name}"
            )
        for marker in markers:
            if not isinstance(marker, dict):
                raise InventoryCollectionError(
                    f"browser bundle marker row must be an object: {name}"
                )
            needle = str(marker.get("needle") or "")
            minimum_occurrences = marker.get("minimum_occurrences")
            if not needle or not isinstance(minimum_occurrences, int) or minimum_occurrences < 1:
                raise InventoryCollectionError(
                    f"browser bundle marker contract is invalid: {name}"
                )
            if bundle_text.count(needle) < minimum_occurrences:
                raise InventoryCollectionError(
                    f"browser bundle helper evidence requires review: {name}:{needle}"
                )

        dependencies.append(Dependency(
            ecosystem="npm-build",
            name=name,
            version=version,
            license_id=license_id,
            source_dir=license_root,
            license_documents=tuple(documents),
            scope="browser-production-bundle",
            upstream=upstream,
        ))

    return sorted(dependencies, key=lambda item: (item.name, item.version)), (
        f"{BROWSER_BUNDLE_PROVENANCE_PATH.as_posix()} matched against "
        "app/package-lock.json and app/frontend/dist/*.js"
    )


def should_skip_dir(relative_parts: tuple[str, ...]) -> bool:
    return any(part in SKIPPED_DIRS for part in relative_parts)


def read_asset_provenance(target: pathlib.Path) -> dict:
    path = target / ASSET_PROVENANCE_PATH
    if not path.is_file():
        raise ValueError(f"reviewed asset provenance is missing: {ASSET_PROVENANCE_PATH}")
    value = json.loads(read_text(path))
    if not isinstance(value, dict) or value.get("schema_version") != 2:
        raise ValueError("reviewed asset provenance schema_version must be 2")
    if not isinstance(value.get("components"), dict) or not isinstance(value.get("files"), list):
        raise ValueError("reviewed asset provenance must define components and files")
    if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", str(value.get("reviewed_on") or "")) is None:
        raise ValueError("reviewed asset provenance reviewed_on must be an ISO date")
    components = value["components"]
    if not components:
        raise ValueError("reviewed asset provenance must define at least one component")
    if "Filterest first-party assets" in components:
        raise ValueError(
            "generic Filterest first-party assets classification is forbidden; "
            "use a rights-reviewed asset group"
        )
    rejected_values = {"", "n/a", "none", "review-required", "tbd", "unknown"}
    for component, metadata in components.items():
        if not isinstance(component, str) or not component.strip() or not isinstance(metadata, dict):
            raise ValueError("reviewed asset provenance component rows must be named objects")
        party = str(metadata.get("party") or "")
        if party not in {"first-party", "third-party"}:
            raise ValueError(f"asset provenance party is invalid for {component}: {party}")
        for field in ("license", "source"):
            normalized = str(metadata.get(field) or "").strip().lower()
            if normalized in rejected_values:
                raise ValueError(
                    f"asset provenance {field} requires review for {component}"
                )
        documents = metadata.get("documents")
        if not isinstance(documents, list) or any(
            not isinstance(document, str) or not document.strip()
            for document in documents
        ):
            raise ValueError(
                f"asset provenance documents must be a list of file names for {component}"
            )
        if party == "third-party":
            if not documents:
                raise ValueError(
                    f"third-party asset component lacks retained documents: {component}"
                )
            continue
        if documents:
            raise ValueError(
                f"first-party asset component must not claim third-party documents: {component}"
            )
        for field in ("author", "rights_holder", "publication_rights_basis"):
            normalized = str(metadata.get(field) or "").strip().lower()
            if normalized in rejected_values:
                raise ValueError(
                    f"first-party asset {field} requires an explicit rights basis: {component}"
                )
        if metadata.get("rights_review") != "owner-attested":
            raise ValueError(
                f"first-party asset rights_review must be owner-attested: {component}"
            )
        if metadata.get("license") != "GPL-2.0-or-later":
            raise ValueError(
                f"first-party asset license must match the Filterest source license: {component}"
            )
    return value


def source_line_number(content: str, offset: int) -> int:
    return content.count("\n", 0, offset) + 1


def is_test_source(path: pathlib.Path) -> bool:
    return (
        path.name.endswith(EMBEDDED_VECTOR_TEST_SUFFIXES)
        or "testdata" in path.parts
    )


def is_substantive_test_path(path_value: str) -> bool:
    """Ignore tiny SVG fixtures while still catching copied icon geometry."""
    commands = re.findall(r"[AaCcHhLlMmQqSsTtVvZz]", path_value)
    numbers = re.findall(r"-?(?:\d+(?:\.\d+)?|\.\d+)", path_value)
    return len(path_value.strip()) >= 64 and len(commands) >= 3 and len(numbers) >= 8


def embedded_vector_matches(
    content: str,
    *,
    test_source: bool,
) -> list[tuple[int, str]]:
    """Locate static SVG/icon geometry and return offsets plus evidence kinds."""
    matches: list[tuple[int, str]] = []
    for literal_match in SOURCE_STRING_LITERAL_RE.finditer(content):
        value = literal_match.group(0)[1:-1]
        if not SVG_PATH_VALUE_RE.search(value):
            continue
        if test_source and not is_substantive_test_path(value):
            continue
        matches.append((literal_match.start(), "svg-path-literal"))

    if not test_source:
        matches.extend(
            (match.start(), "svg-path-markup")
            for match in SVG_PATH_MARKUP_RE.finditer(content)
        )
        matches.extend(
            (match.start(), "svg-points-literal")
            for match in SVG_POINTS_CONTEXT_RE.finditer(content)
        )
        matches.extend(
            (match.start(), "svg-primitive-markup")
            for match in SVG_PRIMITIVE_MARKUP_RE.finditer(content)
        )

    for data_uri_match in SVG_DATA_URI_RE.finditer(content):
        payload = urllib.parse.unquote_to_bytes(data_uri_match.group("payload"))
        if ";base64" in data_uri_match.group("parameters").lower():
            try:
                payload = base64.b64decode(payload, validate=True)
            except (binascii.Error, ValueError):
                continue
        decoded = payload.decode("utf-8", errors="replace")
        nested_matches = embedded_vector_matches(decoded, test_source=test_source)
        if nested_matches:
            matches.append((data_uri_match.start(), "encoded-svg-data-uri"))

    return sorted(set(matches))


def discover_embedded_vector_evidence(
    target: pathlib.Path,
) -> tuple[EmbeddedVectorEvidence, ...]:
    """Return non-generated source files that own static vector geometry.

    Generated browser bundles are excluded because their authoritative input is
    reviewed instead. Small test-only SVG fixtures are ignored, while a copied,
    substantive path literal in a test remains subject to provenance review.
    Renderers that only receive geometry from another module are not candidates.
    """
    discovered: list[EmbeddedVectorEvidence] = []
    for relative_root in EMBEDDED_VECTOR_SOURCE_ROOTS:
        root = target / relative_root
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            relative_path = path.relative_to(target)
            if path.is_symlink():
                raise ValueError(
                    "embedded vector source candidate must not be a symlink: "
                    f"{relative_path.as_posix()}"
                )
            if "dist" in relative_path.parts:
                continue
            if path.suffix.lower() not in EMBEDDED_VECTOR_SOURCE_SUFFIXES:
                continue
            content = read_text(path)
            for offset, kind in embedded_vector_matches(
                content,
                test_source=is_test_source(relative_path),
            ):
                discovered.append(EmbeddedVectorEvidence(
                    path=relative_path.as_posix(),
                    line=source_line_number(content, offset),
                    kind=kind,
                ))
    return tuple(sorted(discovered, key=lambda item: (item.path, item.line, item.kind)))


def discover_embedded_vector_sources(target: pathlib.Path) -> set[str]:
    return {item.path for item in discover_embedded_vector_evidence(target)}


def collect_assets(target: pathlib.Path) -> list[Asset]:
    actual_assets: dict[str, str] = {}
    for root, dirs, files in os.walk(target):
        root_path = pathlib.Path(root)
        relative_parts = root_path.relative_to(target).parts
        dirs[:] = [name for name in dirs if not should_skip_dir(relative_parts + (name,))]
        for file_name in files:
            path = root_path / file_name
            if path.suffix.lower() not in ASSET_SUFFIXES:
                continue
            relative_path = path.relative_to(target).as_posix()
            actual_assets[relative_path] = sha256_file(path)

    provenance = read_asset_provenance(target)
    components = provenance["components"]
    records: dict[str, dict] = {}
    for record in provenance["files"]:
        if not isinstance(record, dict):
            raise ValueError("reviewed asset provenance file rows must be objects")
        relative_path = str(record.get("path") or "")
        if not relative_path or relative_path in records:
            raise ValueError(f"duplicate or empty reviewed asset provenance path: {relative_path}")
        records[relative_path] = record

    reviewed_asset_paths = {
        path for path, record in records.items() if record.get("kind") == "asset"
    }
    if set(actual_assets) != reviewed_asset_paths:
        missing = sorted(set(actual_assets) - reviewed_asset_paths)
        stale = sorted(reviewed_asset_paths - set(actual_assets))
        raise ValueError(
            "asset provenance review is incomplete; "
            f"unreviewed={missing}; stale={stale}"
        )

    reviewed_embedded_paths = {
        path
        for path, record in records.items()
        if record.get("kind") == "embedded-icon-source"
    }
    discovered_embedded_paths = discover_embedded_vector_sources(target)
    if discovered_embedded_paths != reviewed_embedded_paths:
        unreviewed_paths = discovered_embedded_paths - reviewed_embedded_paths
        unreviewed = [
            f"{item.path}:{item.line} [{item.kind}]"
            for item in discover_embedded_vector_evidence(target)
            if item.path in unreviewed_paths
        ]
        stale = sorted(reviewed_embedded_paths - discovered_embedded_paths)
        raise ValueError(
            "embedded SVG/icon provenance review is incomplete; "
            f"unreviewed={unreviewed}; stale={stale}"
        )

    referenced_components = {
        str(record.get("component") or "") for record in records.values()
    }
    unused_components = sorted(set(components) - referenced_components)
    if unused_components:
        raise ValueError(
            f"asset provenance components are unused: {unused_components}"
        )

    assets: list[Asset] = []
    for relative_path, record in records.items():
        component = str(record.get("component") or "")
        kind = str(record.get("kind") or "")
        expected_hash = str(record.get("sha256") or "")
        metadata = components.get(component)
        if not isinstance(metadata, dict):
            raise ValueError(f"asset provenance component is undefined: {component}")
        path = target / relative_path
        if kind not in {"asset", "embedded-icon-source"}:
            raise ValueError(f"asset provenance kind is invalid for {relative_path}: {kind}")
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"reviewed asset provenance path is missing or not regular: {relative_path}")
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise ValueError(f"reviewed asset provenance hash changed: {relative_path}")
        assets.append(Asset(
            path=relative_path,
            sha256=actual_hash,
            component=component,
            party=str(metadata["party"]),
            license_id=str(metadata["license"]),
            kind=kind,
        ))
    return sorted(assets, key=lambda item: item.path)


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-._") or "dependency"
    return cleaned[:72]


def copy_document(
    bundle_dir: pathlib.Path,
    identity: str,
    source: pathlib.Path,
    ordinal: int,
) -> dict[str, str]:
    content = source.read_bytes()
    digest = sha256_bytes(content)
    identity_hash = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
    filename = f"{safe_filename(identity)}-{identity_hash}-{ordinal}-{safe_filename(source.name)}"
    destination = bundle_dir / filename
    destination.write_bytes(content)
    return {
        "path": f"THIRD_PARTY_LICENSES/{filename}",
        "sha256": digest,
        "source_file": source.name,
    }


def dependency_manifest_entry(bundle_dir: pathlib.Path, dependency: Dependency) -> dict:
    identity = f"{dependency.ecosystem}-{dependency.name}-{dependency.version}"
    documents = [
        copy_document(bundle_dir, identity, path, index)
        for index, path in enumerate(dependency.license_documents, start=1)
    ]
    entry = {
        "ecosystem": dependency.ecosystem,
        "name": dependency.name,
        "version": dependency.version,
        "scope": dependency.scope,
        "license": dependency.license_id,
        "documents": documents,
    }
    if dependency.binary_targets:
        entry["binary_targets"] = list(dependency.binary_targets)
    if dependency.upstream:
        entry["upstream"] = dependency.upstream
    return entry


def asset_component_entry(
    target: pathlib.Path,
    bundle_dir: pathlib.Path,
    assets: list[Asset],
    component: str,
    metadata: dict,
) -> dict:
    source_documents = tuple(str(name) for name in metadata.get("documents", []))
    documents = [
        copy_document(
            bundle_dir,
            f"asset-{component}",
            target / "app" / "server_tools" / "licenses" / name,
            index,
        )
        for index, name in enumerate(source_documents, start=1)
    ]
    entry = {
        "component": component,
        "party": str(metadata.get("party") or ""),
        "license": str(metadata.get("license") or "review-required"),
        "source": str(metadata.get("source") or ""),
        "assets": [
            {"path": asset.path, "sha256": asset.sha256}
            for asset in assets if asset.kind == "asset"
        ],
        "embedded_sources": [
            {"path": asset.path, "sha256": asset.sha256}
            for asset in assets if asset.kind == "embedded-icon-source"
        ],
        "documents": documents,
    }
    if entry["party"] == "first-party":
        entry.update({
            "author": str(metadata.get("author") or ""),
            "rights_holder": str(metadata.get("rights_holder") or ""),
            "publication_rights_basis": str(
                metadata.get("publication_rights_basis") or ""
            ),
            "rights_review": str(metadata.get("rights_review") or ""),
        })
    return entry


def read_version(target: pathlib.Path, file_name: str) -> str:
    path = target / "app" / file_name
    return read_text(path).strip() if path.is_file() else "unknown"


def build_manifest(
    target: pathlib.Path,
    go_modules: list[Dependency],
    go_source: str,
    npm_packages: list[Dependency],
    npm_source: str,
    browser_bundle_dependencies: list[Dependency],
    browser_bundle_source: str,
    assets: list[Asset],
    *,
    bundle_dir: pathlib.Path | None = None,
) -> dict:
    # Release preparation stages retained documents away from maintained source.
    bundle_dir = bundle_dir if bundle_dir is not None else target / "THIRD_PARTY_LICENSES"
    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
    bundle_dir.mkdir(parents=True)

    dependencies = [
        dependency_manifest_entry(bundle_dir, dependency)
        for dependency in [
            *go_modules,
            *npm_packages,
            *browser_bundle_dependencies,
        ]
    ]
    provenance = read_asset_provenance(target)
    component_metadata = provenance["components"]
    asset_components = []
    first_party_components = []
    for component in sorted({asset.component for asset in assets}):
        component_assets = [asset for asset in assets if asset.component == component]
        entry = asset_component_entry(
            target,
            bundle_dir,
            component_assets,
            component,
            component_metadata[component],
        )
        if component_assets[0].party == "first-party":
            first_party_components.append(entry)
        else:
            asset_components.append(entry)

    unresolved = [
        f"{entry['ecosystem']}:{entry['name']}@{entry['version']}"
        for entry in dependencies
        if entry["license"] == "review-required" or not entry["documents"]
    ]
    manifest = {
        "schema_version": 3,
        "filterest_app_version": read_version(target, "VERSION_APP"),
        "database_version": read_version(target, "VERSION_DB"),
        "go_metadata_source": go_source,
        "npm_metadata_source": npm_source,
        "browser_bundle_metadata_source": browser_bundle_source,
        "project_source_license": "GPL-2.0-or-later",
        "combined_binary_license": "GPL-3.0-or-later",
        "asset_provenance": {
            "path": ASSET_PROVENANCE_PATH.as_posix(),
            "sha256": sha256_file(target / ASSET_PROVENANCE_PATH),
        },
        "browser_bundle_provenance": {
            "path": BROWSER_BUNDLE_PROVENANCE_PATH.as_posix(),
            "sha256": sha256_file(target / BROWSER_BUNDLE_PROVENANCE_PATH),
        },
        "dependencies": dependencies,
        "asset_components": asset_components,
        "first_party_components": first_party_components,
        "unresolved": unresolved,
    }
    (bundle_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, help="Generated Filterest repository root.")
    parser.add_argument("--output", help="Defaults to <target>/THIRD_PARTY_NOTICES.md.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    target = pathlib.Path(args.target).resolve()
    if not target.is_dir():
        raise SystemExit(f"target directory not found: {target}")
    output = pathlib.Path(args.output).resolve() if args.output else target / "THIRD_PARTY_NOTICES.md"
    try:
        go_modules, go_source = collect_go_modules(target / "app")
        npm_packages, npm_source = collect_npm_packages(target / "app")
        browser_bundle_dependencies, browser_bundle_source = (
            collect_browser_bundle_dependencies(target)
        )
        assets = collect_assets(target)
    except (InventoryCollectionError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    manifest = build_manifest(
        target,
        go_modules,
        go_source,
        npm_packages,
        npm_source,
        browser_bundle_dependencies,
        browser_bundle_source,
        assets,
    )
    manifest_sha256 = sha256_file(target / "THIRD_PARTY_LICENSES" / "manifest.json")
    output.write_text(render_notice_from_manifest(manifest, manifest_sha256), encoding="utf-8")
    print(f"wrote {output}")
    compiled_go_modules = sum(1 for item in go_modules if item.ecosystem == "go")
    embedded_go_components = sum(
        1 for item in go_modules if item.ecosystem in {"go-toolchain", "go-vendored"}
    )
    print(
        f"compiled Go modules: {compiled_go_modules}; "
        f"Go runtime or vendored components: {embedded_go_components}; "
        f"runtime npm packages: {len(npm_packages)}; "
        f"browser bundle build components: {len(browser_bundle_dependencies)}; "
        f"assets: {len(assets)}; unresolved: {len(manifest['unresolved'])}"
    )
    return 1 if manifest["unresolved"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
