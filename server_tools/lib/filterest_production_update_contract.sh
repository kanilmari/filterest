#!/usr/bin/env bash
# filterest_production_update_contract.sh
# Verifies release, recovery, and persisted state used by the VPS update adapter.
# Bridges remote GitHub evidence, prepared releases, backups, and Compose data.
# Keeps reusable safety helpers outside the bounded single-site adapter body.

require_release_arguments() {
    [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--version must be semantic X.Y.Z"
    [[ "$TARGET_DB_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--db-version must be semantic X.Y.Z"
    [[ "$TARGET_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "--commit must be a lowercase 40-character SHA"
}

require_stage_id() {
    [[ "$STAGE_ID" =~ ^${SITE//./-}-filterest-[0-9]+\.[0-9]+\.[0-9]+-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$ ]] || \
        die "--stage-id has an invalid format"
}

assert_private_real_directory() {
    local path="$1" description="$2" metadata owner mode
    [[ -d "$path" && ! -L "$path" ]] || die "$description is missing, linked, or not a real directory"
    metadata="$(stat -c '%u %a' -- "$path")" || die "$description ownership cannot be inspected"
    owner="${metadata%% *}"
    mode="${metadata##* }"
    [[ "$owner" == "$EUID" ]] || die "$description is not owned by the adapter EUID"
    (( (8#$mode & 8#022) == 0 )) || die "$description is group/world writable"
}

assert_private_real_file() {
    local path="$1" description="$2" metadata owner mode
    [[ -f "$path" && ! -L "$path" ]] || die "$description is missing, linked, or not a real regular file"
    metadata="$(stat -c '%u %a' -- "$path")" || die "$description ownership cannot be inspected"
    owner="${metadata%% *}"
    mode="${metadata##* }"
    [[ "$owner" == "$EUID" ]] || die "$description is not owned by the adapter EUID"
    (( (8#$mode & 8#022) == 0 )) || die "$description is group/world writable"
}

assert_production_host_trust_boundary() {
    assert_private_real_directory /srv "production service root"
    assert_private_real_directory /srv/filterest-cloud "Filterest production root"
    assert_private_real_directory "$SITE_ROOT" "site root"
    assert_private_real_directory "$SITE_ROOT/config" "site configuration directory"
    assert_private_real_directory "$RELEASES_ROOT" "site releases root"
    assert_private_real_directory "$BACKUPS_ROOT" "site backups root"
    assert_private_real_directory "$UPDATE_STATE_ROOT" "site update-state root"
    assert_private_real_file "$ENV_FILE" "protected site environment file"
    assert_private_real_file "$COMPOSE_FILE" "site Compose file"
}

assert_owned_private_tree() {
    local root="$1" description="$2" inventory path metadata owner mode
    assert_private_real_directory "$root" "$description root"
    inventory="$(mktemp)"
    if ! find -P "$root" -print0 >"$inventory"; then
        rm -f "$inventory"
        die "$description cannot be inventoried"
    fi
    while IFS= read -r -d '' path; do
        [[ ! -L "$path" ]] || {
            rm -f "$inventory"
            die "$description contains a symbolic link"
        }
        [[ -d "$path" || -f "$path" ]] || {
            rm -f "$inventory"
            die "$description contains a non-file build-context entry"
        }
        metadata="$(stat -c '%u %a' -- "$path")" || {
            rm -f "$inventory"
            die "$description entry ownership cannot be inspected"
        }
        owner="${metadata%% *}"
        mode="${metadata##* }"
        [[ "$owner" == "$EUID" ]] || {
            rm -f "$inventory"
            die "$description contains an entry not owned by the adapter EUID"
        }
        (( (8#$mode & 8#022) == 0 )) || {
            rm -f "$inventory"
            die "$description contains a group/world-writable entry"
        }
    done <"$inventory"
    rm -f "$inventory"
}

acquire_site_operation_lock() {
    if [[ -z "${SITE_LOCK_FD:-}" ]]; then
        # Lock the allowlisted site root itself so update, maintenance-page, and
        # future per-site operator adapters all share one kernel lock object.
        exec {SITE_LOCK_FD}<"$SITE_ROOT" || die "site operation lock cannot be opened"
        flock -n "$SITE_LOCK_FD" || die "another update operation already owns this site"
    fi
}

acquire_host_image_lock() {
    local lock_root="$1"
    [[ -d "$lock_root" && ! -L "$lock_root" ]] || die "host-wide image lock root is invalid"
    if [[ -z "${HOST_IMAGE_LOCK_FD:-}" ]]; then
        exec {HOST_IMAGE_LOCK_FD}<"$lock_root" || die "host-wide image-build lock cannot be opened"
        flock "$HOST_IMAGE_LOCK_FD" || die "host-wide image-build lock cannot be acquired"
    fi
}

release_host_image_lock() {
    [[ -n "${HOST_IMAGE_LOCK_FD:-}" ]] || die "host-wide image-build lock is not held"
    flock -u "$HOST_IMAGE_LOCK_FD" || die "host-wide image-build lock cannot be released"
    exec {HOST_IMAGE_LOCK_FD}>&-
    HOST_IMAGE_LOCK_FD=""
}

assert_forward_version_plan() {
    python3 - "$OLD_APP_VERSION" "$TARGET_VERSION" "$OLD_DB_VERSION" "$OLD_IMAGE_DB_VERSION" "$TARGET_DB_VERSION" <<'PY'
import sys

old_app, target_app, old_db, old_image_db, target_db = sys.argv[1:]
parse = lambda value: tuple(int(part) for part in value.split("."))
if parse(target_app) <= parse(old_app):
    raise SystemExit("target application version is not newer than the active version")
if parse(target_db) < parse(old_db):
    raise SystemExit("target database version is older than the active database")
if parse(target_db) < parse(old_image_db):
    raise SystemExit("target database version is older than the previous image requirement")
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
    if identity.get(key) != value:
        raise SystemExit(f"published build identity field mismatch: {key}")
database = identity.get("database")
if not isinstance(database, dict) or database.get("target_version") != db_version:
    raise SystemExit("published build identity database version mismatch")
if open(version_path, encoding="utf-8").read().strip() != app_version:
    raise SystemExit("published VERSION_APP mismatch")
if open(db_version_path, encoding="utf-8").read().strip() != db_version:
    raise SystemExit("published VERSION_DB mismatch")
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
    local tracked_symlinks checkout_changes ignored_changes required_input
    [[ -d "$RELEASE_DIR" && ! -L "$RELEASE_DIR" ]] || die "release checkout root is missing, linked, or invalid"
    [[ -d "$RELEASE_DIR/.git" && ! -L "$RELEASE_DIR/.git" ]] || die "release Git metadata is missing, linked, or invalid"
    assert_owned_private_tree "$RELEASE_DIR" "release checkout"
    for required_input in VERSION_APP VERSION_DB BUILD_IDENTITY.json docker/Dockerfile; do
        [[ -f "$RELEASE_DIR/$required_input" && ! -L "$RELEASE_DIR/$required_input" ]] || \
            die "release build input is missing, linked, or not regular: $required_input"
    done
    [[ "$(git -C "$RELEASE_DIR" rev-parse HEAD)" == "$TARGET_COMMIT" ]] || die "release checkout commit mismatch"
    [[ "$(tr -d '[:space:]' <"$RELEASE_DIR/VERSION_APP")" == "$TARGET_VERSION" ]] || die "VERSION_APP mismatch"
    [[ "$(tr -d '[:space:]' <"$RELEASE_DIR/VERSION_DB")" == "$TARGET_DB_VERSION" ]] || die "VERSION_DB mismatch"
    checkout_changes="$(git -C "$RELEASE_DIR" status --porcelain=v1 --untracked-files=all)" || \
        die "release checkout cleanliness cannot be verified"
    [[ -z "$checkout_changes" ]] || die "release checkout contains tracked or untracked build-context changes"
    ignored_changes="$(git -C "$RELEASE_DIR" ls-files --others --ignored --exclude-standard)" || \
        die "release checkout ignored files cannot be audited"
    [[ -z "$ignored_changes" ]] || die "release checkout contains ignored build-context entries"
    tracked_symlinks="$(git -C "$RELEASE_DIR" ls-files -s | awk '$1 == "120000" {print $4}')" || \
        die "release checkout symlinks cannot be audited"
    [[ -z "$tracked_symlinks" ]] || die "release checkout contains tracked symlinks"
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
    if identity.get(key) != value:
        raise SystemExit(f"release build identity field mismatch: {key}")
database = identity.get("database")
if not isinstance(database, dict) or database.get("target_version") != db_version:
    raise SystemExit("release build identity database version mismatch")
PY
}

ensure_release_checkout() {
    local short_commit="${TARGET_COMMIT:0:7}" temporary_checkout
    if [[ -L "$RELEASE_DIR" ]]; then
        die "release target is a symlink"
    fi
    if [[ -d "$RELEASE_DIR/.git" ]]; then
        log "reusing existing reviewed release checkout $RELEASE_DIR"
        verify_release_checkout
        return
    fi
    [[ ! -e "$RELEASE_DIR" ]] || die "release target exists but is not a Git checkout"
    temporary_checkout="$(mktemp -d "$RELEASES_ROOT/.prepare-filterest-${TARGET_VERSION}-${short_commit}.XXXXXX")"
    chmod 700 "$temporary_checkout"
    log "cloning reviewed public release v$TARGET_VERSION into an owner-only temporary checkout"
    if ! git clone --quiet --branch "v$TARGET_VERSION" --depth 1 "$REPOSITORY" "$temporary_checkout"; then
        rm -rf -- "$temporary_checkout"
        die "reviewed public release clone failed"
    fi
    if ! (RELEASE_DIR="$temporary_checkout"; verify_release_checkout); then
        rm -rf -- "$temporary_checkout"
        die "temporary release checkout verification failed"
    fi
    if ! mv -T --no-clobber "$temporary_checkout" "$RELEASE_DIR"; then
        rm -rf -- "$temporary_checkout"
        die "temporary release checkout cannot be published atomically"
    fi
    if [[ -e "$temporary_checkout" || -L "$temporary_checkout" ]]; then
        rm -rf -- "$temporary_checkout"
        die "release target appeared during atomic checkout publication"
    fi
    verify_release_checkout
}

attest_target_image() {
    local image="$1"
    [[ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.version"}}')" == "$TARGET_VERSION" ]] && \
        [[ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$TARGET_COMMIT" ]] && \
        [[ "$(docker image inspect "$image" --format '{{index .Config.Labels "easelect.db_version"}}')" == "$TARGET_DB_VERSION" ]]
}

verify_prepared_image_result() {
    local image="$1" expected_id="$2" before_id after_id
    before_id="$(docker image inspect "$image" --format '{{.Id}}')"
    [[ "$before_id" == "$expected_id" ]] || die "prepared image changed after build or reuse"
    attest_target_image "$image" || die "prepared image identity labels no longer match the target"
    after_id="$(docker image inspect "$image" --format '{{.Id}}')"
    [[ "$after_id" == "$expected_id" ]] || die "prepared image changed during final attestation"
}

ensure_target_image() {
    local target_image="$1" before_id after_id temporary_image temporary_id
    acquire_host_image_lock /srv/filterest-cloud
    if docker image inspect "$target_image" >/dev/null 2>&1; then
        log "reusing existing exact-version image $target_image"
        before_id="$(docker image inspect "$target_image" --format '{{.Id}}')"
        [[ "$before_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "reused image has an invalid content identifier"
        attest_target_image "$target_image" || die "reused image identity labels do not match the target"
        after_id="$(docker image inspect "$target_image" --format '{{.Id}}')"
        [[ "$after_id" == "$before_id" ]] || die "reused image changed during attestation"
        TARGET_IMAGE_ID="$after_id"
        TARGET_IMAGE_DISPOSITION="reused"
    else
        temporary_image="filterest-prepare:${TARGET_VERSION}-${TARGET_COMMIT:0:7}-${SITE//./-}-$$-${RANDOM}"
        docker image inspect "$temporary_image" >/dev/null 2>&1 && die "temporary image tag unexpectedly exists"
        log "building a temporary image while the old app remains online"
        if ! docker build \
            --build-arg "EASELECT_APP_VERSION=$TARGET_VERSION" \
            --build-arg "EASELECT_DB_VERSION=$TARGET_DB_VERSION" \
            --build-arg "EASELECT_GIT_COMMIT=$TARGET_COMMIT" \
            --tag "$temporary_image" \
            --file "$RELEASE_DIR/docker/Dockerfile" \
            "$RELEASE_DIR"; then
            docker image rm "$temporary_image" >/dev/null 2>&1 || true
            die "temporary image build failed"
        fi
        temporary_id="$(docker image inspect "$temporary_image" --format '{{.Id}}')"
        if [[ ! "$temporary_id" =~ ^sha256:[0-9a-f]{64}$ ]] || ! attest_target_image "$temporary_image"; then
            docker image rm "$temporary_image" >/dev/null 2>&1 || true
            die "temporary image identity does not match the target"
        fi
        if docker image inspect "$target_image" >/dev/null 2>&1; then
            docker image rm "$temporary_image" >/dev/null 2>&1 || true
            die "final image tag appeared while the temporary image was building"
        fi
        if ! docker tag "$temporary_image" "$target_image"; then
            docker image rm "$temporary_image" >/dev/null 2>&1 || true
            die "verified temporary image cannot be published"
        fi
        before_id="$(docker image inspect "$target_image" --format '{{.Id}}')"
        [[ "$before_id" == "$temporary_id" ]] || die "final image tag does not reference the verified build"
        attest_target_image "$target_image" || die "final image identity labels do not match the target"
        after_id="$(docker image inspect "$target_image" --format '{{.Id}}')"
        [[ "$after_id" == "$before_id" ]] || die "final image changed during attestation"
        docker image rm "$temporary_image" >/dev/null || die "temporary image tag cleanup failed"
        TARGET_IMAGE_ID="$after_id"
        TARGET_IMAGE_DISPOSITION="built"
    fi
    release_host_image_lock
}

write_app_overlay() {
    local overlay_file="$1" image="$2" app_version="$3" db_version="$4" commit="$5" migrations="$6"
    {
        printf 'services:\n  app:\n    image: %s\n' "$image"
        printf '    labels:\n'
        printf '      easelect.version_contract: "1"\n'
        printf '      easelect.app_version: "%s"\n' "$app_version"
        printf '      easelect.db_version: "%s"\n' "$db_version"
        printf '      easelect.git_commit: "%s"\n' "$commit"
        printf '      org.opencontainers.image.version: "%s"\n' "$app_version"
        printf '      org.opencontainers.image.revision: "%s"\n' "$commit"
        if [[ "$migrations" == "true" ]]; then
            printf '    environment:\n'
            printf '      ENABLE_SQL_MIGRATIONS: "true"\n'
            printf '      EASELECT_MIGRATION_FILE_ALLOWLIST: ""\n'
        fi
    } >"$overlay_file"
    chmod 600 "$overlay_file"
}

verify_compose_overlay() {
    local overlay_file="$1" expected_image="$2" expected_migrations="$3" config_file
    config_file="$(mktemp)"
    if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$overlay_file" \
        --project-name "$COMPOSE_PROJECT" config --format json >"$config_file"; then
        rm -f "$config_file"
        die "Compose overlay cannot be rendered"
    fi
    python3 - "$config_file" "$expected_image" "$expected_migrations" <<'PY'
import json
import sys

config_path, expected_image, expected_migrations = sys.argv[1:]
config = json.loads(open(config_path, encoding="utf-8").read())
services = config.get("services")
if not isinstance(services, dict) or not {"app", "db"}.issubset(services):
    raise SystemExit("Compose overlay does not contain both app and database services")
app = services["app"]
if not isinstance(app, dict) or app.get("image") != expected_image:
    raise SystemExit("Compose overlay application image mismatch")
if expected_migrations == "true":
    if str(app.get("environment", {}).get("ENABLE_SQL_MIGRATIONS", "")).lower() != "true":
        raise SystemExit("Compose stage overlay does not enable migrations")
else:
    if str(app.get("environment", {}).get("ENABLE_SQL_MIGRATIONS", "false")).lower() == "true":
        raise SystemExit("Compose prepare overlay unexpectedly enables migrations")
PY
    rm -f "$config_file"
}

create_complete_backup() {
    local backup_dir="$1"
    [[ "$backup_dir" == "$BACKUPS_ROOT/"* ]] || die "backup target is outside backups root"
    [[ ! -e "$backup_dir" ]] || die "backup target already exists"
    install -d -m 700 "$backup_dir"

    log "creating PostgreSQL custom-format backup"
    docker exec "$DB_CONTAINER" sh -lc \
        'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
        >"$backup_dir/database.dump"
    docker exec -i "$DB_CONTAINER" pg_restore --list <"$backup_dir/database.dump" >/dev/null

    log "creating dereferenced active and deleted-media archives"
    tar --dereference -C "$STORAGE_SOURCE" -czf "$backup_dir/storage.tar.gz" .
    tar --dereference -C "$STORAGE_DELETED_SOURCE" -czf "$backup_dir/storage_deleted.tar.gz" .
    gzip -t "$backup_dir/storage.tar.gz"
    gzip -t "$backup_dir/storage_deleted.tar.gz"
    tar -tzf "$backup_dir/storage.tar.gz" >/dev/null
    tar -tzf "$backup_dir/storage_deleted.tar.gz" >/dev/null
    (
        cd "$backup_dir"
        sha256sum database.dump storage.tar.gz storage_deleted.tar.gz >SHA256SUMS
        sha256sum -c SHA256SUMS
        printf 'complete\n' >STATUS
    )
    chmod 600 "$backup_dir"/*
}

state_variable_names() {
    printf '%s\n' \
        STATE_STATUS STAGE_ID CURRENT_RELEASE CURRENT_LINK_WAS_PRESENT RELEASE_DIR BACKUP_DIR \
        TARGET_VERSION TARGET_DB_VERSION TARGET_COMMIT OLD_APP_VERSION OLD_DB_VERSION \
        OLD_IMAGE_DB_VERSION OLD_IMAGE DURABLE_APP_IMAGE OLD_COMMIT OLD_CONTAINER_ID \
        DB_CONTAINER_ID APP_MOUNTS_SHA256 DB_MOUNTS_SHA256 STORAGE_SOURCE STORAGE_DELETED_SOURCE \
        POSTGRES_SOURCE ENV_FILE_SHA256 COMPOSE_FILE_SHA256 FINAL_COMPOSE_FILE_SHA256 SESSION_MODE \
        SESSION_COOKIE_NAME SESSION_KEY_SHA256 SESSION_SECRET_SHA256 EXPECTED_INSTANCE_NAME \
        EXPECTED_ENVIRONMENT_TYPE STAGED_APP_CONTAINER_ID LOGIN_PROOF_ID
}

write_state() {
    local state_file="$UPDATE_STATE_ROOT/$STAGE_ID/state.env" variable_name encoded_value
    {
        while IFS= read -r variable_name; do
            printf -v encoded_value '%q' "${!variable_name}"
            [[ "$encoded_value" == "''" || "$encoded_value" =~ ^[A-Za-z0-9_./:@+,-]+$ ]] || \
                die "state value cannot be represented by the strict non-eval format"
            printf '%s=%s\n' "$variable_name" "$encoded_value"
        done < <(state_variable_names)
    } >"$state_file"
    chmod 600 "$state_file"
}

load_state() {
    local requested_stage_id="$STAGE_ID" stage_dir state_file parsed_file state_size parsed_key parsed_value
    local expected_current_release expected_release_dir expected_backup_dir stage_prefix stage_suffix stage_stamp variable_name
    local -a expected_keys=()
    require_stage_id
    stage_dir="$UPDATE_STATE_ROOT/$requested_stage_id"
    state_file="$stage_dir/state.env"
    assert_private_real_directory "$stage_dir" "stage state directory"
    [[ "$(stat -c '%a' -- "$stage_dir")" == "700" ]] || die "stage state directory mode is not exactly 0700"
    assert_private_real_file "$state_file" "stage state file"
    [[ "$(stat -c '%a' -- "$state_file")" == "600" ]] || die "stage state file mode is not exactly 0600"
    state_size="$(stat -c '%s' -- "$state_file")" || die "stage state file size cannot be inspected"
    (( state_size > 0 && state_size <= 65536 )) || die "stage state file size is invalid"
    while IFS= read -r parsed_key; do
        expected_keys+=("$parsed_key")
    done < <(state_variable_names)
    parsed_file="$(mktemp)"
    if ! python3 - "$state_file" "${expected_keys[@]}" >"$parsed_file" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
expected = sys.argv[2:]
raw = path.read_bytes()
if not raw or len(raw) > 65536 or b"\0" in raw:
    raise SystemExit("stage state has an invalid byte length or NUL data")
try:
    text = raw.decode("ascii")
except UnicodeDecodeError as exc:
    raise SystemExit("stage state is not strict ASCII") from exc
if not text.endswith("\n"):
    raise SystemExit("stage state does not end with a newline")
lines = text[:-1].split("\n")
if len(lines) != len(expected):
    raise SystemExit("stage state key count mismatch")
values = {}
safe_value = re.compile(r"[A-Za-z0-9_./:@+,-]+")
for line in lines:
    key, separator, encoded = line.partition("=")
    if not separator or key not in expected or key in values:
        raise SystemExit("stage state contains an unknown, missing, or duplicate key")
    if encoded == "''":
        value = ""
    elif safe_value.fullmatch(encoded):
        value = encoded
    else:
        raise SystemExit("stage state contains unsupported shell-quoted data")
    values[key] = value
if set(values) != set(expected):
    raise SystemExit("stage state exact key set mismatch")
output = bytearray()
for key in expected:
    output.extend(key.encode("ascii") + b"\0" + values[key].encode("ascii") + b"\0")
sys.stdout.buffer.write(output)
PY
    then
        rm -f "$parsed_file"
        die "stage state parser rejected the persisted record"
    fi
    while IFS= read -r -d '' parsed_key && IFS= read -r -d '' parsed_value; do
        printf -v "$parsed_key" '%s' "$parsed_value"
    done <"$parsed_file"
    rm -f "$parsed_file"
    [[ "$STAGE_ID" == "$requested_stage_id" ]] || die "stored stage identifier disagrees with the request"
    [[ "$STATE_STATUS" =~ ^(preparing|staged|finalized|stage_failed|rolled_back)$ ]] || \
        die "recorded stage status is invalid"
    for variable_name in TARGET_VERSION TARGET_DB_VERSION OLD_APP_VERSION OLD_DB_VERSION OLD_IMAGE_DB_VERSION; do
        [[ "${!variable_name}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "recorded semantic version is invalid: $variable_name"
    done
    assert_forward_version_plan
    [[ "$TARGET_COMMIT" =~ ^[0-9a-f]{40}$ && "$OLD_COMMIT" =~ ^[0-9a-f]{40}$ ]] || \
        die "recorded release commit is invalid"
    for variable_name in OLD_CONTAINER_ID DB_CONTAINER_ID STAGED_APP_CONTAINER_ID; do
        if [[ "$variable_name" == "STAGED_APP_CONTAINER_ID" && "$STATE_STATUS" =~ ^(preparing|stage_failed|rolled_back)$ && -z "${!variable_name}" ]]; then
            continue
        fi
        [[ "${!variable_name}" =~ ^[0-9a-f]{64}$ ]] || die "recorded container identifier is invalid: $variable_name"
    done
    for variable_name in APP_MOUNTS_SHA256 DB_MOUNTS_SHA256 ENV_FILE_SHA256 COMPOSE_FILE_SHA256 \
        SESSION_KEY_SHA256 SESSION_SECRET_SHA256; do
        [[ "${!variable_name}" =~ ^[0-9a-f]{64}$ ]] || die "recorded SHA-256 value is invalid: $variable_name"
    done
    if [[ "$STATE_STATUS" == "finalized" ]]; then
        [[ "$FINAL_COMPOSE_FILE_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "finalized stage lacks its Compose hash"
        [[ "$LOGIN_PROOF_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:@+-]{5,119}$ ]] || die "finalized stage proof identifier is invalid"
    elif [[ "$STATE_STATUS" =~ ^(preparing|staged|stage_failed)$ ]]; then
        [[ -z "$FINAL_COMPOSE_FILE_SHA256" && -z "$LOGIN_PROOF_ID" ]] || die "unfinished stage contains finalized-only evidence"
    else
        [[ -z "$FINAL_COMPOSE_FILE_SHA256" || "$FINAL_COMPOSE_FILE_SHA256" =~ ^[0-9a-f]{64}$ ]] || \
            die "rolled-back stage Compose hash is invalid"
        [[ -z "$LOGIN_PROOF_ID" || "$LOGIN_PROOF_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:@+-]{5,119}$ ]] || \
            die "rolled-back stage proof identifier is invalid"
    fi
    [[ "$CURRENT_LINK_WAS_PRESENT" == "true" || "$CURRENT_LINK_WAS_PRESENT" == "false" ]] || \
        die "recorded current-link marker is invalid"
    [[ "$SESSION_MODE" == "isolated" || "$SESSION_MODE" == "replica-pool" ]] || die "recorded session mode is invalid"
    if [[ "$SESSION_MODE" == "isolated" ]]; then
        [[ -z "$SESSION_COOKIE_NAME" ]] || die "isolated session state contains an explicit cookie name"
    else
        [[ "$SESSION_COOKIE_NAME" =~ ^[A-Za-z0-9_+-]{1,120}$ ]] || die "replica session cookie name is invalid"
    fi
    [[ "$EXPECTED_INSTANCE_NAME" == "$SITE_INSTANCE_NAME" ]] || die "recorded instance identity is invalid"
    [[ "$EXPECTED_ENVIRONMENT_TYPE" == "prod" ]] || die "recorded environment type is invalid"
    [[ "$OLD_IMAGE" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@+-]{0,255}$ ]] || die "recorded old image reference is invalid"
    [[ "$DURABLE_APP_IMAGE" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@+-]{0,255}$ ]] || die "recorded durable image reference is invalid"
    [[ "$OLD_IMAGE" != *"//"* && "$DURABLE_APP_IMAGE" != *"//"* ]] || die "recorded image reference is ambiguous"
    expected_current_release="$RELEASES_ROOT/filterest-${OLD_APP_VERSION}-${OLD_COMMIT:0:7}"
    expected_release_dir="$RELEASES_ROOT/filterest-${TARGET_VERSION}-${TARGET_COMMIT:0:7}"
    stage_prefix="${SITE//./-}-filterest-${TARGET_VERSION}-"
    stage_suffix="-${TARGET_COMMIT:0:7}"
    [[ "$STAGE_ID" == "$stage_prefix"*"$stage_suffix" ]] || die "stage identifier disagrees with its target identity"
    stage_stamp="${STAGE_ID#"$stage_prefix"}"
    stage_stamp="${stage_stamp%"$stage_suffix"}"
    [[ "$stage_stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "stage identifier timestamp is invalid"
    expected_backup_dir="$BACKUPS_ROOT/pre-filterest-${TARGET_VERSION}-${stage_stamp}"
    [[ "$CURRENT_RELEASE" == "$expected_current_release" ]] || die "recorded current release path is invalid"
    [[ "$RELEASE_DIR" == "$expected_release_dir" ]] || die "recorded target release path is invalid"
    [[ "$BACKUP_DIR" == "$expected_backup_dir" ]] || die "recorded backup path is invalid"
    for variable_name in STORAGE_SOURCE STORAGE_DELETED_SOURCE POSTGRES_SOURCE; do
        [[ "${!variable_name}" == "$SITE_ROOT/runtime-data/"* && "${!variable_name}" != *"//"* && \
            "${!variable_name}" != *"/./"* && "${!variable_name}" != *"/../"* && \
            "${!variable_name}" != */. && "${!variable_name}" != */.. ]] || \
            die "recorded runtime-data source is invalid: $variable_name"
    done
}

patch_durable_compose_image() {
    local source_image="$1" target_image="$2" temporary_file
    temporary_file="$(mktemp "$SITE_ROOT/config/.compose-update.XXXXXX")"
    cp -p "$COMPOSE_FILE" "$temporary_file"
    python3 - "$temporary_file" "$source_image" "$target_image" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
source_image, target_image = sys.argv[2:]
source = path.read_text(encoding="utf-8")
pattern = r"(?m)^(\s*image:\s*)" + re.escape(source_image) + r"(\s*(?:#.*)?)$"
updated, count = re.subn(pattern, lambda match: match.group(1) + target_image + match.group(2), source)
if count != 1:
    raise SystemExit("active app image line was not found exactly once")
path.write_text(updated, encoding="utf-8")
PY
    mv "$temporary_file" "$COMPOSE_FILE"
}

verify_durable_compose_image() {
    local expected_image="$1" config_file
    config_file="$(mktemp)"
    if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
        --project-name "$COMPOSE_PROJECT" config --format json >"$config_file"; then
        rm -f "$config_file"
        return 1
    fi
    python3 - "$config_file" "$expected_image" <<'PY'
import json
import sys

config = json.loads(open(sys.argv[1], encoding="utf-8").read())
services = config.get("services")
if not isinstance(services, dict) or not {"app", "db"}.issubset(services):
    raise SystemExit("durable Compose config does not contain both app and database services")
app = services["app"]
if not isinstance(app, dict) or app.get("image") != sys.argv[2]:
    raise SystemExit("durable Compose application image mismatch")
PY
    rm -f "$config_file"
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
