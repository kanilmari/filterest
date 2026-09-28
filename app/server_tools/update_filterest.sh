#!/usr/bin/env bash
# update_filterest.sh
# Updates one generated Filterest checkout to a verified published stable tag.
# Bridges GitHub release evidence, local backups, fast-forward Git, and the
# existing profile-aware installer or Docker runner so an operator does not
# repeat the process.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
INSTALLATION_ROOT="${FILTEREST_ROOT:-${FILTEREST_PROJECT_ROOT_OVERRIDE:-$SOURCE_ROOT}}"
INSTALLATION_ROOT="$(cd "$INSTALLATION_ROOT" && pwd -P)"
PROJECT_ROOT="$INSTALLATION_ROOT"
RUNTIME_ROOT="$INSTALLATION_ROOT/runtime"
BACKUP_ROOT="$INSTALLATION_ROOT/data/update_backups"
GIT_SOURCE_PREFIX=""
if [[ "$SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
    RUNTIME_ROOT="$INSTALLATION_ROOT/data/runtime"
    BACKUP_ROOT="$INSTALLATION_ROOT/backups"
    GIT_SOURCE_PREFIX="app/"
fi
APP_VERSION_FILE="$SOURCE_ROOT/VERSION_APP"
DB_VERSION_FILE="$SOURCE_ROOT/VERSION_DB"
DOCKER_RUNNER="$SOURCE_ROOT/server_tools/run_filterest_docker.sh"
cd "$INSTALLATION_ROOT"

ASSUME_YES=0
DRY_RUN=0
REQUESTED_VERSION=""
READY_TIMEOUT=""
RELEASE_REPOSITORY="${FILTEREST_RELEASE_REPOSITORY:-}"
TEMP_DIR=""
TARGET_TAG=""
TARGET_COMMIT=""
TARGET_VERSION=""
PROFILE=""
BACKUP_DIR=""
APP_IMAGE_ID=""
RECOVERY_HINT=""

usage() {
    cat <<'USAGE'
Usage: ./filterest update [options]

Updates a generated Filterest checkout to a published stable GitHub release.

Options:
  --version VERSION        Install this exact published stable version.
  --dry-run                Verify and show the update plan without changing local data.
  --yes                    Apply the verified plan without another confirmation.
  --ready-timeout SECONDS  Docker only: how long to wait for the updated
                           installation to report ready (default 600).
  -h, --help               Show this help.

The updater refuses dirty checkouts, development snapshots, draft/prerelease
GitHub releases, non-fast-forward histories, and unapproved release origins.
Before changing the checkout it backs up PostgreSQL, storage directories, and
the installation-owned bootstrap state that records completed starter-media runs.
A Docker installation (keys/docker.env) is dumped through its database
container, also backs up keys/, config/ and projects/, and is rebuilt with the
release's pending migrations enabled.
USAGE
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

cleanup() {
    local status=$?
    if [[ "$status" -ne 0 && -n "$RECOVERY_HINT" ]]; then
        printf '%s\n' "$RECOVERY_HINT" >&2
    fi
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        case "$TEMP_DIR" in
            /tmp/filterest-update.*|"${TMPDIR:-/tmp}"/filterest-update.*)
                rm -r -- "$TEMP_DIR"
                ;;
        esac
    fi
}
trap cleanup EXIT

parse_arguments() {
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --version)
                [[ "$#" -ge 2 ]] || die "--version requires a semantic version"
                REQUESTED_VERSION="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            --yes)
                ASSUME_YES=1
                shift
                ;;
            --ready-timeout)
                [[ "$#" -ge 2 && "$2" =~ ^[1-9][0-9]*$ ]] || \
                    die "--ready-timeout requires a positive number of seconds"
                READY_TIMEOUT="$2"
                shift 2
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                die "unknown update option: $1"
                ;;
        esac
    done
    if [[ -n "$REQUESTED_VERSION" && ! "$REQUESTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        die "--version must be in MAJOR.MINOR.PATCH form"
    fi
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "required command is missing: $1"
}

is_generated_filterest_checkout() {
    [[ -f "$APP_VERSION_FILE" && ! -f "$INSTALLATION_ROOT/VERSION_EASELECT" ]]
}

resolve_release_repository() {
    local remote_url=""
    local parsed=""
    if [[ -z "$RELEASE_REPOSITORY" ]]; then
        remote_url="$(git -C "$INSTALLATION_ROOT" remote get-url origin 2>/dev/null || true)"
        parsed="$(printf '%s' "$remote_url" | sed -E \
            -e 's#^git@github\.com:##' \
            -e 's#^https://github\.com/##' \
            -e 's#^ssh://git@github\.com/##' \
            -e 's#\.git$##')"
        RELEASE_REPOSITORY="$parsed"
    fi
    case "$RELEASE_REPOSITORY" in
        kanilmari/filterest|filterest/filterest) ;;
        *) die "release repository is not approved: ${RELEASE_REPOSITORY:-missing}" ;;
    esac
}

verify_checkout() {
    local branch=""
    is_generated_filterest_checkout || \
        die "updates must run inside a generated Filterest checkout"
    [[ -d "$INSTALLATION_ROOT/.git" ]] || die "the Filterest checkout must retain Git metadata"
    branch="$(git -C "$INSTALLATION_ROOT" branch --show-current)"
    [[ "$branch" == "main" ]] || die "updates require the main branch; current branch: ${branch:-detached}"
    git -C "$INSTALLATION_ROOT" diff --quiet || die "tracked files have local changes; commit or restore them first"
    git -C "$INSTALLATION_ROOT" diff --cached --quiet || die "the Git index has staged changes; commit or restore them first"
    resolve_release_repository
}

release_api_url() {
    if [[ -n "$REQUESTED_VERSION" ]]; then
        printf 'https://api.github.com/repos/%s/releases/tags/v%s' \
            "$RELEASE_REPOSITORY" "$REQUESTED_VERSION"
    else
        printf 'https://api.github.com/repos/%s/releases/latest' "$RELEASE_REPOSITORY"
    fi
}

download_release_evidence() {
    local api_url=""
    local release_json="$TEMP_DIR/release.json"
    api_url="$(release_api_url)"
    # Stable Filterest releases are public. Keep the installed updater
    # deliberately credential-free so an update never needs, reads, or risks
    # forwarding a maintainer's GitHub credentials.
    curl --fail --silent --show-error --location \
        --header 'Accept: application/vnd.github+json' \
        --output "$release_json" "$api_url"

    TARGET_TAG="$(python3 - "$release_json" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    release = json.load(handle)
tag = release.get("tag_name", "")
if release.get("draft") or release.get("prerelease"):
    raise SystemExit("GitHub release is draft or prerelease")
if not release.get("published_at"):
    raise SystemExit("GitHub release has no publication timestamp")
if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
    raise SystemExit("GitHub release tag is not vMAJOR.MINOR.PATCH")
print(tag)
PY
    )" || die "GitHub did not return a published stable Filterest release"
    TARGET_VERSION="${TARGET_TAG#v}"
    if [[ -n "$REQUESTED_VERSION" && "$TARGET_VERSION" != "$REQUESTED_VERSION" ]]; then
        die "GitHub release version does not match --version"
    fi
}

fetch_and_verify_target() {
    local identity_file="$TEMP_DIR/BUILD_IDENTITY.json"
    local mutable_tracked_paths=""
    local tag_commit=""
    local docker_path=""
    git -C "$INSTALLATION_ROOT" fetch --quiet origin "refs/tags/${TARGET_TAG}:refs/tags/${TARGET_TAG}"
    TARGET_COMMIT="$(git -C "$INSTALLATION_ROOT" rev-parse "${TARGET_TAG}^{commit}")"
    tag_commit="$(git -C "$INSTALLATION_ROOT" rev-list -n 1 "$TARGET_TAG")"
    [[ "$TARGET_COMMIT" == "$tag_commit" ]] || die "release tag does not resolve to one commit"
    git -C "$INSTALLATION_ROOT" show "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}BUILD_IDENTITY.json" > "$identity_file" || \
        die "release commit has no BUILD_IDENTITY.json"
    python3 - "$identity_file" "$TARGET_VERSION" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    identity = json.load(handle)
expected = sys.argv[2]
checks = {
    "product": "filterest",
    "app_version": expected,
    "channel": "stable",
    "artifact_type": "runtime",
}
for key, value in checks.items():
    if identity.get(key) != value:
        raise SystemExit(f"build identity {key} is {identity.get(key)!r}, expected {value!r}")
if identity.get("maturity") not in {"candidate", "published"}:
    raise SystemExit("build identity is not a stable runtime candidate")
PY
    git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}go.mod" || \
        die "release commit has no immutable app/go.mod"
    git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}VERSION_APP" || \
        die "release commit has no immutable app/VERSION_APP"
    git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}server_tools/install_filterest.sh" || \
        die "release commit has no immutable app installer"
    if [[ "$PROFILE" == "docker" ]]; then
        for docker_path in \
            "${GIT_SOURCE_PREFIX}server_tools/run_filterest_docker.sh" \
            "${GIT_SOURCE_PREFIX}docker/docker-compose.yml" \
            compose.yml
        do
            git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${docker_path}" || \
                die "release commit has no Docker contract file: $docker_path"
        done
    fi
    mutable_tracked_paths="$(
        git -C "$INSTALLATION_ROOT" ls-tree -r --name-only "$TARGET_COMMIT" -- \
            config keys projects data backups
    )"
    [[ -z "$mutable_tracked_paths" ]] || {
        printf 'Refusing release commit with tracked mutable installation paths:\n%s\n' \
            "$mutable_tracked_paths" >&2
        die "release commit would modify operator-owned installation state"
    }
    git -C "$INSTALLATION_ROOT" merge-base --is-ancestor HEAD "$TARGET_COMMIT" || \
        die "the published release is not a fast-forward from this checkout"
}

# Runs one Docker runner action against this installation root.
docker_runner() {
    FILTEREST_PROJECT_ROOT_OVERRIDE="$INSTALLATION_ROOT" "$DOCKER_RUNNER" "$@"
}

# Chooses the native or Docker update path from the installation's own records.
# Between the native setup marker and keys/docker.env, which only the Docker runner reads.
# Why: a folder that claims both, or a marker without exactly one known profile,
# would be stopped, backed up and restarted the wrong way, so it is refused
# before anything changes.
resolve_profile() {
    local marker="$RUNTIME_ROOT/filterest-setup-complete"
    local docker_profile=""

    if [[ "$SOURCE_ROOT" == "$INSTALLATION_ROOT/app" && -f "$DOCKER_RUNNER" ]]; then
        docker_profile="$(docker_runner profile)"
    fi
    if [[ -e "$marker" || -L "$marker" ]]; then
        [[ "$docker_profile" != "docker" ]] || \
            die "this installation has both a native setup marker ($marker) and Docker settings (keys/docker.env); keep only the one that matches how Filterest runs here"
        [[ -f "$marker" && ! -L "$marker" ]] || die "the native setup marker is not a regular file: $marker"
        PROFILE=""
        if [[ "$(grep -c '^profile=' "$marker" || true)" == "1" ]]; then
            PROFILE="$(sed -n 's/^profile=//p' "$marker")"
        fi
        case "$PROFILE" in
            admin|development) ;;
            *) die "the native setup marker must record exactly one profile, admin or development: $marker" ;;
        esac
    elif [[ "$docker_profile" == "docker" ]]; then
        PROFILE="docker"
    else
        die "completed Filterest setup profile is missing; run ./filterest setup or ./filterest docker setup first"
    fi
}

resolve_private_environment() {
    # shellcheck source=server_tools/lib/easelect_private_paths.sh
    source "$SOURCE_ROOT/server_tools/lib/easelect_private_paths.sh"
    easelect_resolve_private_paths "$INSTALLATION_ROOT"
    if [[ "$SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
        local protected_runtime_root="$FILTEREST_KEYS_HOME/filterest_runtime"
        EASELECT_RUNTIME_ENV_FILE="$protected_runtime_root/runtime_environment.env"
        EASELECT_DEV_ENV_FILE="$protected_runtime_root/development_environment.env"
        EASELECT_TLS_CERT_FILE="$protected_runtime_root/local_tls_certificate/localhost_certificate.crt"
        EASELECT_TLS_KEY_FILE="$protected_runtime_root/local_tls_certificate/localhost_private_key.key"
        export EASELECT_RUNTIME_ENV_FILE EASELECT_DEV_ENV_FILE
        export EASELECT_TLS_CERT_FILE EASELECT_TLS_KEY_FILE
    fi
}

environment_value() {
    local key="$1"
    local file=""
    local value=""
    for file in "$EASELECT_DEV_ENV_FILE" "$EASELECT_RUNTIME_ENV_FILE"; do
        [[ -f "$file" ]] || continue
        value="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d'=' -f2- || true)"
        if [[ -n "$value" ]]; then
            printf '%s' "$value"
            return
        fi
    done
}

show_plan() {
    local current_version=""
    current_version="$(tr -d '[:space:]' < "$APP_VERSION_FILE")"
    printf '\nFilterest stable update plan\n'
    printf '  Repository: %s\n' "$RELEASE_REPOSITORY"
    printf '  Installed version: %s\n' "$current_version"
    printf '  Published version: %s\n' "$TARGET_VERSION"
    printf '  Release commit: %s\n' "$TARGET_COMMIT"
    printf '  Profile: %s\n' "$PROFILE"
    if [[ "$PROFILE" == "docker" ]]; then
        printf '  Safety: database dump from the database container + mutable-data and settings backup, then fast-forward-only update and image rebuild\n'
    else
        printf '  Safety: database + mutable-data backup, then fast-forward-only update\n'
    fi
    if [[ "$current_version" == "$TARGET_VERSION" && "$(git -C "$INSTALLATION_ROOT" rev-parse HEAD)" == "$TARGET_COMMIT" ]]; then
        printf '\nFilterest is already on the latest published stable release.\n'
        exit 0
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '\nDry run complete; no application files, database, storage, or processes were changed.\n'
        exit 0
    fi
}

confirm_plan() {
    local answer=""
    [[ "$ASSUME_YES" -eq 1 ]] && return
    [[ -t 0 ]] || die "non-interactive update requires --yes"
    printf '\nStop Filterest, create the backup, and apply this update? [y/N] '
    read -r answer
    case "$answer" in
        y|Y|yes|YES) ;;
        *) die "update cancelled" ;;
    esac
}

# Allows one update per installation from the stop until this process exits.
# Between concurrent ./filterest update runs and the services, backups and checkout they change.
# Why: the kernel drops the lock with the process, so a killed update leaves nothing to
# remove; started services get descriptor 9 closed so they cannot keep holding it.
acquire_update_lock() {
    mkdir -p "$RUNTIME_ROOT"
    exec 9>>"$RUNTIME_ROOT/filterest-update.lock"
    python3 - <<'PY' || die "another Filterest update is already running for this installation"
import fcntl
import sys

try:
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit(1)
PY
}

stop_runtime() {
    if [[ "$PROFILE" == "docker" ]]; then
        RECOVERY_HINT="The update stopped before changing the installation. Start the installed version again with: ./filterest docker start"
        # Read while the container still runs, for the backup manifest only.
        APP_IMAGE_ID="$(docker_runner app-image-id)" || APP_IMAGE_ID=""
        APP_IMAGE_ID="${APP_IMAGE_ID%%$'\n'*}"
        docker_runner stop-app
    elif [[ "$PROFILE" == "admin" ]]; then
        "$SOURCE_ROOT/server_tools/run_filterest_admin.sh" stop
    else
        "$INSTALLATION_ROOT/ctl" --stop
    fi
}

create_backup() {
    local stamp=""
    local backup_dir=""
    local host=""
    local port=""
    local user=""
    local password=""
    local database=""
    local settings_paths=()
    local name=""
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="$BACKUP_ROOT/update_${stamp}_$(tr -d '[:space:]' < "$APP_VERSION_FILE")_to_${TARGET_VERSION}"
    mkdir -p "$BACKUP_ROOT"
    [[ ! -e "$backup_dir" && ! -L "$backup_dir" ]] || die "backup folder already exists: $backup_dir"
    mkdir -m 700 "$backup_dir"

    if [[ "$PROFILE" == "docker" ]]; then
        docker_runner dump-database --output "$backup_dir/database.dump"
    else
        host="$(environment_value DB_HOST)"
        port="$(environment_value DB_PORT)"
        user="$(environment_value DB_ADMIN_USER)"
        password="$(environment_value DB_ADMIN_PASSWORD)"
        database="$(environment_value DB_NAME)"
        host="${host:-localhost}"
        port="${port:-5432}"
        database="${database:-filterest}"
        [[ -n "$user" && -n "$password" ]] || die "database backup credentials are missing"
        PGPASSWORD="$password" pg_dump --format=custom --no-owner --no-privileges \
            --host "$host" --port "$port" --username "$user" --dbname "$database" \
            --file "$backup_dir/database.dump"
        chmod 600 "$backup_dir/database.dump"
    fi

    if [[ -e "$INSTALLATION_ROOT/data/storage" || -e "$INSTALLATION_ROOT/data/storage_deleted" ]]; then
        local storage_paths=()
        [[ -e "$INSTALLATION_ROOT/data/storage" ]] && storage_paths+=(storage)
        [[ -e "$INSTALLATION_ROOT/data/storage_deleted" ]] && storage_paths+=(storage_deleted)
        tar --dereference -C "$INSTALLATION_ROOT/data" -czf "$backup_dir/storage.tar.gz" "${storage_paths[@]}"
        chmod 600 "$backup_dir/storage.tar.gz"
    fi
    if [[ -e "$INSTALLATION_ROOT/data/bootstrap" ]]; then
        [[ ! -L "$INSTALLATION_ROOT/data/bootstrap" ]] || \
            die "bootstrap state directory must not be a symbolic link"
        [[ -d "$INSTALLATION_ROOT/data/bootstrap" ]] || \
            die "bootstrap state path is not a directory"
        # Archive links as links instead of dereferencing them. Completion-marker
        # validation remains the application's responsibility after a restore,
        # while the update backup cannot be tricked into reading outside data/.
        tar -C "$INSTALLATION_ROOT/data" -czf "$backup_dir/bootstrap.tar.gz" bootstrap
        chmod 600 "$backup_dir/bootstrap.tar.gz"
    fi
    if [[ "$PROFILE" == "docker" ]]; then
        # Docker keeps its secrets, TLS identity and path contracts in these folders,
        # so the backup alone can restart the previous version. Links stay links.
        for name in keys config projects; do
            if [[ -e "$INSTALLATION_ROOT/$name" ]]; then
                settings_paths+=("$name")
            fi
        done
        if [[ "${#settings_paths[@]}" -gt 0 ]]; then
            tar -C "$INSTALLATION_ROOT" -czf "$backup_dir/installation_settings.tar.gz" "${settings_paths[@]}"
            chmod 600 "$backup_dir/installation_settings.tar.gz"
        fi
    fi
    # Renamed into place last: a backup folder without manifest.txt is incomplete.
    {
        printf 'from_version=%s\nto_version=%s\nrelease_tag=%s\nrelease_commit=%s\ncreated_at=%s\n' \
            "$(tr -d '[:space:]' < "$APP_VERSION_FILE")" "$TARGET_VERSION" \
            "$TARGET_TAG" "$TARGET_COMMIT" "$stamp"
        if [[ "$PROFILE" == "docker" ]]; then
            printf 'profile=%s\nsource_commit=%s\napp_image_id=%s\n' \
                "$PROFILE" "$(git -C "$INSTALLATION_ROOT" rev-parse HEAD)" "${APP_IMAGE_ID:-unknown}"
        fi
    } > "$backup_dir/manifest.txt.partial"
    chmod 600 "$backup_dir/manifest.txt.partial"
    mv "$backup_dir/manifest.txt.partial" "$backup_dir/manifest.txt"
    BACKUP_DIR="$backup_dir"
    printf 'Backup created: %s\n' "$backup_dir"
    if [[ "$PROFILE" == "docker" ]]; then
        RECOVERY_HINT="The update stopped before changing the installation; the backup in $backup_dir is complete. Start the installed version again with: ./filterest docker start"
    fi
}

apply_update() {
    git -C "$INSTALLATION_ROOT" merge --ff-only "$TARGET_COMMIT"
    if [[ "$PROFILE" != "docker" ]]; then
        "$SOURCE_ROOT/server_tools/install_filterest.sh" --profile "$PROFILE" --yes --no-start
    fi
}

# Rebuilds and starts the updated Docker stack with the release's pending migrations.
# Between the fast-forwarded checkout, the runner's Compose call, and /system/ready.
# Why: a stack that does not report the new version ready is stopped rather than left
# serving on a schema it may not match; the database and the backup stay for recovery.
start_updated_docker_runtime() {
    local status=0
    local stop_status=0
    local outcome=""
    local ready_options=()

    RECOVERY_HINT=""
    if [[ -n "$READY_TIMEOUT" ]]; then
        ready_options=(--timeout "$READY_TIMEOUT")
    fi
    ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST="" \
        docker_runner start --for-update 9>&- || status=$?
    if [[ "$status" -eq 0 ]]; then
        docker_runner ready-check --expect-version "$TARGET_VERSION" ${ready_options[@]+"${ready_options[@]}"} || \
            status=$?
    fi
    if [[ "$status" -ne 0 ]]; then
        docker_runner stop-app || stop_status=$?
        if [[ "$stop_status" -eq 0 ]]; then
            outcome="so its application container was stopped"
        else
            outcome="and stopping its application container failed, so it may still be running; stop it with ./filterest docker stop-app"
        fi
        die "Filterest $TARGET_VERSION did not start and report ready, $outcome. The checkout is at release commit $TARGET_COMMIT, the database keeps any migrations that completed, and the pre-update backup is in $BACKUP_DIR. README.md, section \"Updating A Git Checkout\", describes returning to the previous version."
    fi
    docker_runner status
}

start_updated_runtime() {
    local port=""
    if [[ "$PROFILE" == "docker" ]]; then
        start_updated_docker_runtime
        return
    fi
    if [[ "$PROFILE" == "admin" ]]; then
        ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST="" \
            "$SOURCE_ROOT/server_tools/run_filterest_admin.sh" start 9>&-
    else
        port="$(environment_value APP_PORT)"
        port="${port:-8100}"
        ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST="" \
            "$INSTALLATION_ROOT/ctl" -p "$port" 9>&-
    fi
    mkdir -p "$RUNTIME_ROOT"
    printf 'profile=%s\napp_version=%s\ndb_version=%s\n' \
        "$PROFILE" \
        "$(tr -d '[:space:]' < "$APP_VERSION_FILE")" \
        "$(tr -d '[:space:]' < "$DB_VERSION_FILE")" \
        > "$RUNTIME_ROOT/filterest-setup-complete"
    "$INSTALLATION_ROOT/filterest" status
}

main() {
    parse_arguments "$@"
    require_command curl
    require_command git
    require_command python3
    require_command tar
    verify_checkout
    resolve_profile
    if [[ "$PROFILE" != "docker" ]]; then
        require_command pg_dump
    fi
    TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/filterest-update.XXXXXX")"
    download_release_evidence
    fetch_and_verify_target
    if [[ "$PROFILE" == "docker" ]]; then
        # Settings only: a dry run neither needs nor calls Docker.
        docker_runner update-preflight --dry-run
    else
        resolve_private_environment
    fi
    show_plan
    if [[ "$PROFILE" == "docker" ]]; then
        docker_runner update-preflight
    fi
    confirm_plan
    acquire_update_lock
    stop_runtime
    create_backup
    apply_update
    start_updated_runtime
    printf '\nFilterest update completed: %s\n' "$TARGET_VERSION"
}

main "$@"
