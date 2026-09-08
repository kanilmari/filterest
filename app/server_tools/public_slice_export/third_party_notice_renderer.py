#!/usr/bin/env python3
"""Render the human-readable Filterest third-party notice from its manifest.

Bridges hash-bound dependency and asset metadata with the public Markdown file.
Exists separately so collection, bundling, and presentation stay maintainable.
"""

from __future__ import annotations

import pathlib
from collections import Counter


ASSET_PROVENANCE_PATH = pathlib.PurePosixPath(
    "app/server_tools/licenses/asset_provenance.json"
)


def markdown_cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def document_links(documents: list[dict]) -> str:
    return ", ".join(
        f"[`{pathlib.PurePosixPath(item['path']).name}`]({item['path']})"
        for item in documents
    )


def render_notice_from_manifest(manifest: dict, manifest_sha256: str = "") -> str:
    """Render deterministic notice prose and tables from one manifest."""

    dependencies = manifest["dependencies"]
    go_modules = [item for item in dependencies if item["ecosystem"] == "go"]
    go_embedded_components = [
        item
        for item in dependencies
        if item["ecosystem"] in {"go-toolchain", "go-vendored"}
    ]
    npm_packages = [item for item in dependencies if item["ecosystem"] == "npm"]
    browser_bundle_components = [
        item for item in dependencies if item["ecosystem"] == "npm-build"
    ]
    asset_components = manifest["asset_components"]
    first_party_components = manifest["first_party_components"]
    retained_documents = [
        document
        for entry in [*dependencies, *asset_components]
        for document in entry["documents"]
    ]
    third_party_asset_count = sum(len(entry["assets"]) for entry in asset_components)
    embedded_source_count = sum(
        len(entry["embedded_sources"]) for entry in asset_components
    )
    first_party_asset_count = sum(
        len(entry["assets"]) for entry in first_party_components
    )
    license_counts = Counter(item["license"] for item in dependencies)

    lines = [
        "# Third-Party Notices",
        "",
        "This generated inventory covers what the Filterest release distributes:",
        "compiled Go modules across shipped binaries, runtime npm packages, build-tool",
        "code present in the production browser bundle, third-party public assets,",
        "and the reviewed rights basis for project-original public assets.",
        "Reviewed upstream legal and attribution document bytes are retained under",
        "`THIRD_PARTY_LICENSES/` and bound here through its manifest.",
        "",
        "## Candidate",
        "",
        f"- Filterest app version: `{manifest['filterest_app_version']}`",
        f"- Database version: `{manifest['database_version']}`",
        f"- Project source license: `{manifest['project_source_license']}`",
        f"- Combined release-binary license: `{manifest['combined_binary_license']}`",
        f"- License bundle manifest SHA-256: `{manifest_sha256}`",
        f"- Go metadata source: `{manifest['go_metadata_source']}`",
        f"- npm metadata source: `{manifest['npm_metadata_source']}`",
        f"- browser bundle metadata source: `{manifest['browser_bundle_metadata_source']}`",
        f"- compiled Go modules listed: `{len(go_modules)}`",
        f"- compiled Go runtime or vendored components listed: `{len(go_embedded_components)}`",
        f"- runtime npm packages listed: `{len(npm_packages)}`",
        f"- browser bundle build components listed: `{len(browser_bundle_components)}`",
        f"- third-party asset files listed: `{third_party_asset_count}`",
        f"- source files containing third-party icon geometry: `{embedded_source_count}`",
        f"- first-party asset files recorded: `{first_party_asset_count}`",
        f"- retained legal and attribution documents: `{len(retained_documents)}`",
        f"- unresolved third-party rows: `{len(manifest['unresolved'])}`",
        "",
        "Most development-only npm packages referenced by `app/package-lock.json` are not",
        "copied into release assets. Build tools whose generated helper code is present in",
        "the production browser bundle are listed explicitly below with retained licenses.",
        "",
        "Filterest's own source is GPL-2.0-or-later. Because the compiled release includes",
        "Apache-2.0 components, the combined binaries are conveyed under GPL-3.0-or-later.",
        "",
        "## Dependency License Summary",
        "",
    ]
    for license_id, count in sorted(license_counts.items()):
        lines.append(f"- `{license_id}`: {count}")

    lines.extend(
        [
            "",
            "## Compiled Go Modules Across Release Binaries",
            "",
            "| Module | Version | License | Scope | Binaries | Retained documents |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for item in go_modules:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item["name"]),
                    markdown_cell(item["version"]),
                    markdown_cell(item["license"]),
                    markdown_cell(item["scope"]),
                    markdown_cell(", ".join(item["binary_targets"])),
                    document_links(item["documents"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Go Runtime And Vendored Components",
            "",
            "| Component | Version | License | Scope | Binaries | Retained documents |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for item in go_embedded_components:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item["name"]),
                    markdown_cell(item["version"]),
                    markdown_cell(item["license"]),
                    markdown_cell(item["scope"]),
                    markdown_cell(", ".join(item["binary_targets"])),
                    document_links(item["documents"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Runtime npm Packages",
            "",
            "| Package | Version | License | Scope | Retained documents |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    for item in npm_packages:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item["name"]),
                    markdown_cell(item["version"]),
                    markdown_cell(item["license"]),
                    markdown_cell(item["scope"]),
                    document_links(item["documents"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Production Browser Bundle Build Components",
            "",
            "| Component | Version | License | Scope | Upstream | Retained documents |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for item in browser_bundle_components:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item["name"]),
                    markdown_cell(item["version"]),
                    markdown_cell(item["license"]),
                    markdown_cell(item["scope"]),
                    f"[source]({item['upstream']})",
                    document_links(item["documents"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Third-Party Asset Components",
            "",
            "| Component | Asset files | Embedded source files | License | Upstream | Retained documents |",
            "| --- | ---: | ---: | --- | --- | --- |",
        ]
    )
    for item in asset_components:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item["component"]),
                    str(len(item["assets"])),
                    str(len(item["embedded_sources"])),
                    markdown_cell(item["license"]),
                    f"[source]({item['source']})",
                    document_links(item["documents"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## First-Party Asset Provenance",
            "",
            "| Component | Asset files | Author | Rights holder | Publication-rights basis | License |",
            "| --- | ---: | --- | --- | --- | --- |",
        ]
    )
    for item in first_party_components:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item["component"]),
                    str(len(item["assets"])),
                    markdown_cell(item["author"]),
                    markdown_cell(item["rights_holder"]),
                    markdown_cell(item["publication_rights_basis"]),
                    markdown_cell(item["license"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Asset Provenance",
            "",
            "Every third-party and first-party asset path and SHA-256 value is explicitly reviewed in",
            f"`{ASSET_PROVENANCE_PATH.as_posix()}` and copied into the hash-bound release manifest.",
            "Every first-party group also records its author, rights holder, publication-rights",
            "basis, and owner attestation; a generic first-party label is not accepted.",
            "Material Icons and Symbols are attributed to Google under Apache-2.0;",
            "the selected Lucide icons are attributed to Lucide Icons and Contributors under ISC.",
            "Additional embedded interface geometry without a documented first-party rights basis",
            "is conservatively covered by the retained Lucide/Feather terms without asserting exact upstream bytes.",
            "The embedded Heroicons wrench-screwdriver geometry is attributed to Tailwind Labs under MIT.",
            "New or changed asset bytes fail generation until their provenance row is reviewed;",
            "static SVG path, points, primitive markup, and encoded SVG data in maintained source",
            "also fail generation unless their complete source file has a reviewed hash-bound row;",
            "no file defaults automatically to first-party ownership.",
            "",
            "## Unresolved Rows",
            "",
        ]
    )
    if manifest["unresolved"]:
        lines.extend(f"- `{item}`" for item in manifest["unresolved"])
    else:
        lines.append("None.")
    lines.append("")
    return "\n".join(lines)
