#!/usr/bin/env bash
# filterest_production_update_contract.sh
# Verifies stable release identity evidence used by the VPS update adapter.
# Bridges remote GitHub evidence, checked-out releases, and durable Compose data.
# Kept separate so the single streamed adapter remains within source-size limits.

require_release_arguments() {
    [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--version must be semantic X.Y.Z"
    [[ "$TARGET_DB_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--db-version must be semantic X.Y.Z"
    [[ "$TARGET_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "--commit must be a lowercase 40-character SHA"
}

require_stage_id() {
    [[ "$STAGE_ID" =~ ^${SITE//./-}-filterest-[0-9]+\.[0-9]+\.[0-9]+-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$ ]] || \
        die "--stage-id has an invalid format"
}

assert_forward_version_plan() {
    python3 - "$OLD_APP_VERSION" "$TARGET_VERSION" "$OLD_DB_VERSION" "$TARGET_DB_VERSION" <<'PY'
import sys

old_app, target_app, old_db, target_db = sys.argv[1:]
parse = lambda value: tuple(int(part) for part in value.split("."))
if parse(target_app) <= parse(old_app):
    raise SystemExit("target application version is not newer than the active version")
if parse(target_db) < parse(old_db):
    raise SystemExit("target database version is older than the active database")
PY
}

sha256_value() {
    printf '%s' "$1" | sha256sum | awk '{print $1}'
}

file_sha256() {
    sha256sum "$1" | awk '{print $1}'
}

verify_remote_build_identity() {
    local identity_file version_file db_version_file raw_root
    identity_file="$(mktemp)"
    version_file="$(mktemp)"
    db_version_file="$(mktemp)"
    raw_root="https://raw.githubusercontent.com/kanilmari/filterest/$TARGET_COMMIT"
    if ! curl -fsSL --max-time 20 "$raw_root/BUILD_IDENTITY.json" >"$identity_file" || \
        ! curl -fsSL --max-time 20 "$raw_root/VERSION_APP" >"$version_file" || \
        ! curl -fsSL --max-time 20 "$raw_root/VERSION_DB" >"$db_version_file"; then
        rm -f "$identity_file" "$version_file" "$db_version_file"
        die "published release identity files are unavailable"
    fi
    python3 - "$identity_file" "$version_file" "$db_version_file" "$TARGET_VERSION" "$TARGET_DB_VERSION" <<'PY'
import json
import sys

identity_path, version_path, db_version_path, app_version, db_version = sys.argv[1:]
identity = json.loads(open(identity_path, encoding="utf-8").read())
expected = {
    "product": "filterest",
    "app_version": app_version,
    "channel": "stable",
    "artifact_type": "runtime",
    "maturity": "published",
}
for key, value in expected.items():
    assert identity.get(key) == value, identity
assert identity.get("database", {}).get("target_version") == db_version, identity
assert open(version_path, encoding="utf-8").read().strip() == app_version
assert open(db_version_path, encoding="utf-8").read().strip() == db_version
PY
    rm -f "$identity_file" "$version_file" "$db_version_file"
}

assert_durable_compose_image_patchable() {
    python3 - "$COMPOSE_FILE" "$DURABLE_APP_IMAGE" <<'PY'
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
image = sys.argv[2]
pattern = r"(?m)^(\s*image:\s*)" + re.escape(image) + r"(\s*(?:#.*)?)$"
if len(re.findall(pattern, source)) != 1:
    raise SystemExit("active app image line is not safely patchable exactly once")
PY
}

verify_release_checkout() {
    [[ "$(git -C "$RELEASE_DIR" rev-parse HEAD)" == "$TARGET_COMMIT" ]] || die "release checkout commit mismatch"
    [[ "$(tr -d '[:space:]' <"$RELEASE_DIR/VERSION_APP")" == "$TARGET_VERSION" ]] || die "VERSION_APP mismatch"
    [[ "$(tr -d '[:space:]' <"$RELEASE_DIR/VERSION_DB")" == "$TARGET_DB_VERSION" ]] || die "VERSION_DB mismatch"
    python3 - "$RELEASE_DIR/BUILD_IDENTITY.json" "$TARGET_VERSION" "$TARGET_DB_VERSION" <<'PY'
import json
import sys

path, app_version, db_version = sys.argv[1:]
identity = json.loads(open(path, encoding="utf-8").read())
expected = {
    "product": "filterest",
    "app_version": app_version,
    "channel": "stable",
    "artifact_type": "runtime",
    "maturity": "published",
}
for key, value in expected.items():
    assert identity.get(key) == value, identity
assert identity.get("database", {}).get("target_version") == db_version, identity
PY
}

restore_current_link_contract() {
    if [[ "$CURRENT_LINK_WAS_PRESENT" == "true" ]]; then
        ln -sfn "$CURRENT_RELEASE" "$SITE_ROOT/current"
    elif [[ -L "$SITE_ROOT/current" ]]; then
        rm "$SITE_ROOT/current"
    elif [[ -e "$SITE_ROOT/current" ]]; then
        die "current path became a non-symlink during rollback"
    fi
}
