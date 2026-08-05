#!/usr/bin/env python3
# service_catalog_bootstrap_manifest.py
# Shared loader/validator/renderer for committed visible app_service_catalog bootstrap entries.
# Bridges a git-tracked JSON manifest and the SQL artifacts that fresh bootstraps and migrations still consume.

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any
import zipfile


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST_PATH = (
    PROJECT_ROOT
    / "server_tools"
    / "versioning"
    / "bootstrap_seeds"
    / "sources"
    / "app_service_catalog_visible_entries.v1.json"
)
GENERATED_BLOCK_START = "-- BEGIN GENERATED: app_service_catalog visible entries"
GENERATED_BLOCK_END = "-- END GENERATED: app_service_catalog visible entries"
STORAGE_IMAGE_PATH_RE = re.compile(r"\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$", re.IGNORECASE)


class ManifestValidationError(RuntimeError):
    """Raised when the committed service-catalog bootstrap manifest is invalid."""


def load_manifest(path: Path | None = None) -> dict[str, Any]:
    manifest_path = Path(path or DEFAULT_MANIFEST_PATH)
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def load_current_seed_data_path() -> Path:
    version_db = (PROJECT_ROOT / "VERSION_DB").read_text(encoding="utf-8").strip()
    return (
        PROJECT_ROOT
        / "server_tools"
        / "versioning"
        / "bootstrap_seeds"
        / f"db-{version_db}"
        / "seed_data.sql"
    )


def validate_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("format_version") != 1:
        raise ManifestValidationError("format_version must be 1")
    if manifest.get("dataset") != "app_service_catalog":
        raise ManifestValidationError("dataset must be app_service_catalog")

    defaults = manifest.get("shared_defaults")
    if not isinstance(defaults, dict):
        raise ManifestValidationError("shared_defaults must be an object")

    entries = manifest.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ManifestValidationError("entries must be a non-empty list")

    seen_slugs: set[str] = set()
    seen_seed_ids: set[int] = set()
    seen_match_websites: set[str] = set()

    required_default_fields = (
        "user_id",
        "published",
        "enabled",
        "admin_reviewed",
        "admin_approved",
        "association_type_id",
        "assoc_t_name_cached",
        "cached_username",
        "view_count",
        "paid_views_left",
        "cached_image",
    )
    for field_name in required_default_fields:
        if field_name not in defaults:
            raise ManifestValidationError(f"shared_defaults.{field_name} is required")
    validate_cached_image_path(str(defaults.get("cached_image", "")), "shared_defaults.cached_image")

    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ManifestValidationError(f"entries[{index}] must be an object")

        slug = require_string(entry, index, "slug")
        if slug in seen_slugs:
            raise ManifestValidationError(f"duplicate slug: {slug}")
        seen_slugs.add(slug)

        bootstrap_seed_id = entry.get("bootstrap_seed_id")
        if not isinstance(bootstrap_seed_id, int) or bootstrap_seed_id <= 0:
            raise ManifestValidationError(f"entries[{index}].bootstrap_seed_id must be a positive integer")
        if bootstrap_seed_id in seen_seed_ids:
            raise ManifestValidationError(f"duplicate bootstrap_seed_id: {bootstrap_seed_id}")
        seen_seed_ids.add(bootstrap_seed_id)

        source_locale = require_string(entry, index, "source_locale")
        require_string(entry, index, "created")
        require_string(entry, index, "updated")
        require_string(entry, index, "website")
        require_string(entry, index, "contact_details", allow_empty=True)
        require_string(entry, index, "type_of_operation")
        require_string(entry, index, "locality", allow_empty=True)

        match_obj = entry.get("match")
        if not isinstance(match_obj, dict):
            raise ManifestValidationError(f"entries[{index}].match must be an object")
        match_website = require_string(match_obj, index, "website", prefix="entries[{index}].match")
        if match_website in seen_match_websites:
            raise ManifestValidationError(f"duplicate match.website: {match_website}")
        seen_match_websites.add(match_website)

        header_i18n = entry.get("header_i18n")
        description_i18n = entry.get("description_i18n")
        if not isinstance(header_i18n, dict) or not isinstance(description_i18n, dict):
            raise ManifestValidationError(f"entries[{index}] header_i18n and description_i18n must be objects")
        for field_name in ("header", "description"):
            storage_mode = entry.get(f"{field_name}_storage", "plain_source_locale")
            if storage_mode not in {"plain_source_locale", "json_i18n"}:
                raise ManifestValidationError(
                    f"entries[{index}].{field_name}_storage must be plain_source_locale or json_i18n"
                )
        if source_locale not in header_i18n or source_locale not in description_i18n:
            raise ManifestValidationError(
                f"entries[{index}] source_locale {source_locale!r} must exist in header_i18n and description_i18n"
            )
        validate_cached_image_path(
            str(value_or_default(entry, defaults, "cached_image")),
            f"entries[{index}].cached_image",
        )
        for object_name, i18n_obj in (("header_i18n", header_i18n), ("description_i18n", description_i18n)):
            for key, value in i18n_obj.items():
                if not isinstance(key, str) or not key.strip():
                    raise ManifestValidationError(f"entries[{index}].{object_name} contains an empty locale key")
                if not isinstance(value, str) or not value.strip():
                    raise ManifestValidationError(f"entries[{index}].{object_name}[{key!r}] must be a non-empty string")

        keywords = entry.get("keywords")
        if not isinstance(keywords, list) or not keywords:
            raise ManifestValidationError(f"entries[{index}].keywords must be a non-empty list")
        for keyword in keywords:
            if not isinstance(keyword, str) or not keyword.strip():
                raise ManifestValidationError(f"entries[{index}].keywords must only contain non-empty strings")


def render_seed_sql(manifest: dict[str, Any]) -> str:
    validate_manifest(manifest)
    defaults = manifest["shared_defaults"]
    entries = sorted(manifest["entries"], key=lambda item: item["bootstrap_seed_id"])

    header = [
        "-- BEGIN GENERATED: app_service_catalog visible entries",
        "-- Source: server_tools/versioning/bootstrap_seeds/sources/app_service_catalog_visible_entries.v1.json",
        "INSERT INTO public.app_service_catalog (",
        "  created, updated, header, description, id, user_id, published, enabled, keywords_static,",
        "  admin_reviewed, type_of_operation, website, contact_details, admin_approved,",
        "  association_type_id, assoc_t_name_cached, cached_username, locality,",
        "  national_corporation_identifier, view_count, paid_views_left, cached_image",
        ") VALUES",
    ]

    rendered_rows: list[str] = []
    for entry in entries:
        source_locale = entry["source_locale"]
        rendered_rows.append(
            "  ({created}, {updated}, {header}, {description}, {seed_id}, {user_id}, {published}, {enabled}, {keywords}, {admin_reviewed}, {type_of_operation}, {website}, {contact_details}, {admin_approved}, {association_type_id}, {assoc_t_name_cached}, {cached_username}, {locality}, {national_corporation_identifier}, {view_count}, {paid_views_left}, {cached_image})".format(
                created=sql_string(entry["created"]),
                updated=sql_string(entry["updated"]),
                header=sql_string(render_i18n_storage(entry, "header", source_locale)),
                description=sql_string(render_i18n_storage(entry, "description", source_locale)),
                seed_id=entry["bootstrap_seed_id"],
                user_id=value_or_default(entry, defaults, "user_id"),
                published=sql_bool(value_or_default(entry, defaults, "published")),
                enabled=sql_bool(value_or_default(entry, defaults, "enabled")),
                keywords=sql_string(",".join(entry["keywords"])),
                admin_reviewed=sql_bool(value_or_default(entry, defaults, "admin_reviewed")),
                type_of_operation=sql_string(entry["type_of_operation"]),
                website=sql_string(entry["website"]),
                contact_details=sql_string(entry["contact_details"]),
                admin_approved=sql_bool(value_or_default(entry, defaults, "admin_approved")),
                association_type_id=value_or_default(entry, defaults, "association_type_id"),
                assoc_t_name_cached=sql_string(value_or_default(entry, defaults, "assoc_t_name_cached")),
                cached_username=sql_string(value_or_default(entry, defaults, "cached_username")),
                locality=sql_string(entry["locality"]),
                national_corporation_identifier=sql_string(
                    value_or_default(entry, defaults, "national_corporation_identifier")
                ),
                view_count=value_or_default(entry, defaults, "view_count"),
                paid_views_left=value_or_default(entry, defaults, "paid_views_left"),
                cached_image=sql_string(value_or_default(entry, defaults, "cached_image")),
            )
        )

    return "\n".join(header + [",\n".join(rendered_rows) + ";", "-- END GENERATED: app_service_catalog visible entries"])


def extract_generated_seed_block(seed_data_sql: str) -> str:
    if GENERATED_BLOCK_START not in seed_data_sql or GENERATED_BLOCK_END not in seed_data_sql:
        raise ManifestValidationError("seed_data.sql is missing the generated app_service_catalog block markers")

    block = seed_data_sql.split(GENERATED_BLOCK_START, 1)[1].split(GENERATED_BLOCK_END, 1)[0]
    return "\n".join(
        [GENERATED_BLOCK_START, block.strip("\n"), GENERATED_BLOCK_END]
    )


def validate_seed_sql_sync(manifest: dict[str, Any], seed_data_path: Path | None = None) -> Path:
    current_seed_data_path = Path(seed_data_path or load_current_seed_data_path())
    current_seed_data_sql, evidence_path = read_seed_data_sql(current_seed_data_path)

    rendered_block = render_seed_sql(manifest)
    try:
        committed_block = extract_generated_seed_block(current_seed_data_sql)
    except ManifestValidationError:
        if evidence_path.suffix == ".zip":
            return evidence_path
        raise
    if rendered_block != committed_block:
        raise ManifestValidationError(
            "rendered app_service_catalog seed block does not match the committed seed_data.sql block"
        )

    return evidence_path


def read_seed_data_sql(seed_data_path: Path) -> tuple[str, Path]:
    if seed_data_path.exists():
        return seed_data_path.read_text(encoding="utf-8"), seed_data_path

    zip_candidates = sorted(seed_data_path.parent.glob("easelect_bootstrap_*.zip"))
    for zip_path in zip_candidates:
        try:
            with zipfile.ZipFile(zip_path) as archive:
                with archive.open("seed_data.sql") as handle:
                    return handle.read().decode("utf-8"), zip_path
        except (KeyError, zipfile.BadZipFile):
            continue
        except RuntimeError:
            password = bootstrap_zip_password()
            if not password:
                continue
            with zipfile.ZipFile(zip_path) as archive:
                with archive.open("seed_data.sql", pwd=password) as handle:
                    return handle.read().decode("utf-8"), zip_path

    raise ManifestValidationError(f"seed_data.sql not found: {seed_data_path}")


def bootstrap_zip_password() -> bytes | None:
    raw_password = (
        os.environ.get("BOOTSTRAP_SEED_ZIP_PASSWORD", "").strip()
        or os.environ.get("BOOTSTRAP_ZIP_PASSWORD", "").strip()
    )
    if not raw_password:
        password_path = PROJECT_ROOT / "server_tools" / "versioning" / "bootstrap_seeds" / "bootstrap_zip_password.txt"
        if password_path.exists():
            raw_password = password_path.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    return raw_password.encode("utf-8") if raw_password else None


def require_string(
    obj: dict[str, Any],
    index: int,
    field_name: str,
    prefix: str | None = None,
    allow_empty: bool = False,
) -> str:
    field_path = prefix or f"entries[{index}]"
    value = obj.get(field_name)
    if not isinstance(value, str):
        raise ManifestValidationError(f"{field_path}.{field_name} must be a string")
    if not allow_empty and not value.strip():
        raise ManifestValidationError(f"{field_path}.{field_name} must be a non-empty string")
    return value


def value_or_default(entry: dict[str, Any], defaults: dict[str, Any], field_name: str) -> Any:
    return entry[field_name] if field_name in entry else defaults[field_name]


def validate_cached_image_path(value: str, field_path: str) -> None:
    normalized_value = value.strip()
    if not normalized_value:
        return

    if normalized_value != value:
        raise ManifestValidationError(f"{field_path} must not include leading or trailing whitespace")
    if re.match(r"^[a-z][a-z0-9+.-]*://", normalized_value, re.IGNORECASE):
        raise ManifestValidationError(f"{field_path} must use local storage, not an external URL: {value}")
    if normalized_value.startswith("/frontend/") or normalized_value.startswith("frontend/"):
        raise ManifestValidationError(f"{field_path} must not use a frontend source path: {value}")
    if normalized_value.startswith("../") or normalized_value.startswith("./"):
        raise ManifestValidationError(f"{field_path} must be storage-relative, not a relative source path: {value}")
    if normalized_value.startswith("/"):
        if not normalized_value.startswith("/storage/"):
            raise ManifestValidationError(f"{field_path} must use /storage/ when rooted: {value}")
        normalized_value = normalized_value.removeprefix("/storage/")
    if normalized_value.startswith("storage/"):
        normalized_value = normalized_value.removeprefix("storage/")

    parts = normalized_value.split("/")
    allowed_storage_directories = {"original", "300", "1000", "2160"}
    if len(parts) > 1 and not all(
        part.isdigit() or part in allowed_storage_directories
        for part in parts[:-1]
    ):
        raise ManifestValidationError(
            f"{field_path} must use row-scoped storage like 104/6005/original/104_6005_7005.svg "
            f"or a canonical row-scoped filename like 104_6005_7005.svg"
        )
    if (
        not parts
        or any(part in {"", ".", ".."} for part in parts)
        or "\\" in normalized_value
        or not STORAGE_IMAGE_PATH_RE.search(normalized_value)
    ):
        raise ManifestValidationError(
            f"{field_path} must be a storage-relative image path like 104_6005_7005.svg"
        )


def render_i18n_storage(entry: dict[str, Any], field_name: str, source_locale: str) -> str:
    i18n_key = f"{field_name}_i18n"
    storage_mode = entry.get(f"{field_name}_storage", "plain_source_locale")
    i18n_obj = entry[i18n_key]
    if storage_mode == "json_i18n":
        return json.dumps(i18n_obj, ensure_ascii=False, separators=(",", ": "))
    if storage_mode != "plain_source_locale":
        raise ManifestValidationError(f"unsupported {field_name}_storage mode: {storage_mode}")
    return i18n_obj[source_locale]


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_bool(value: bool) -> str:
    return "TRUE" if value else "FALSE"
