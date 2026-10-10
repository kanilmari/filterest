#!/usr/bin/env bash
# update_filterest.sh
# Updates one generated Filterest checkout to a verified published stable tag.
# Bridges GitHub release evidence, local backups, fast-forward Git, and the
# existing profile-aware installer or Docker runner so an operator does not
# repeat the process.

set -euo pipefail

# Updates always protect their backup, rollback and finite child diagnostics.
export FILTEREST_RECOVERY_OUTPUT=1
readonly FILTEREST_RECOVERY_OUTPUT

SCRIPT_SOURCE_DIRECTORY="$(dirname -- "${BASH_SOURCE[0]}" 2>/dev/null)" || { printf 'Recovery launcher location unavailable; sensitive details withheld.\n' >&2; exit 1; }
SCRIPT_DIR="$(cd -- "$SCRIPT_SOURCE_DIRECTORY" 2>/dev/null && pwd -P 2>/dev/null)" 2>/dev/null || { printf 'Recovery launcher location unavailable; sensitive details withheld.\n' >&2; exit 1; }
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/.." 2>/dev/null && pwd -P 2>/dev/null)" || { printf 'Recovery source location unavailable; sensitive details withheld.\n' >&2; exit 1; }
# Capture implicit shell/interpreter diagnostics as well as explicit output.
if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 && "${BASH_SOURCE[0]}" == "$0" ]]; then
    source "$SOURCE_ROOT/server_tools/lib/recovery_process_boundary.sh" >/dev/null 2>&1 || { printf 'Recovery process boundary unavailable; sensitive details withheld.\n' >&2; exit 1; }
    filterest_recovery_process_entry "${BASH_SOURCE[0]}" "$SOURCE_ROOT" "$@"
fi

# Bootstrap the shared layout resolver before any path-bearing helper failures.
source "$SOURCE_ROOT/server_tools/lib/installation_records.sh" 2>/dev/null || { printf 'Recovery diagnostic library unavailable; sensitive details withheld.\n' >&2; exit 1; }
INSTALLATION_ROOT="${FILTEREST_ROOT:-$(filterest_recovery_installation_root "$SOURCE_ROOT")}" || exit 1
INSTALLATION_ROOT="$(cd -- "$INSTALLATION_ROOT" 2>/dev/null && pwd -P 2>/dev/null)" 2>/dev/null || { printf 'Recovery installation root unavailable; sensitive details withheld.\n' >&2; exit 1; }
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
# Direct invocation must protect startup before any path-bearing helper error.
# shellcheck source=server_tools/lib/database_dump_options.sh
filterest_recovery_source "$INSTALLATION_ROOT" "$SOURCE_ROOT/server_tools/lib/database_dump_options.sh"
# shellcheck source=server_tools/lib/filterest_port_preflight.sh
filterest_recovery_source "$INSTALLATION_ROOT" "$SOURCE_ROOT/server_tools/lib/filterest_port_preflight.sh"
cd -- "$INSTALLATION_ROOT" 2>/dev/null || die "Could not enter recovery installation: $INSTALLATION_ROOT"

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
BACKUP_STAMP=""
BACKUP_DIRECTORY_PREPARED=0
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
    filterest_recovery_diagnostic "$INSTALLATION_ROOT" 'error: %s\n' "$*" >&2
    exit 1
}

cleanup() {
    local status=$?
    # Remove only an empty, newly prepared destination (for example a failed stop).
    if [[ "$status" -ne 0 && "$BACKUP_DIRECTORY_PREPARED" -eq 1 && -d "$BACKUP_DIR" ]]; then
        rmdir -- "$BACKUP_DIR" 2>/dev/null || true
    fi
    if [[ "$status" -ne 0 && -n "$RECOVERY_HINT" ]]; then
        filterest_recovery_diagnostic "$INSTALLATION_ROOT" '%s\n' "$RECOVERY_HINT" >&2
    fi
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        case "$TEMP_DIR" in
            /tmp/filterest-update.*|"${TMPDIR:-/tmp}"/filterest-update.*)
                filterest_recovery_output "$INSTALLATION_ROOT" rm -r -- "$TEMP_DIR" || true
                ;;
        esac
    fi
}
trap cleanup EXIT

parse_arguments() {
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --version)
                [[ "$#" -ge 2 && -n "${2:-}" && "${2:0:1}" != - ]] || die "--version requires a semantic version"
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
        remote_url="$(filterest_recovery_utility "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" remote get-url origin || true)"
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
    local branch="" changes="" change=""
    is_generated_filterest_checkout || \
        die "updates must run inside a generated Filterest checkout"
    [[ -d "$INSTALLATION_ROOT/.git" ]] || die "the Filterest checkout must retain Git metadata"
    branch="$(filterest_recovery_utility "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" branch --show-current)"
    [[ "$branch" == "main" ]] || die "updates require the main branch; current branch: ${branch:-detached}"
    # Status verifies unchanged content despite stale index timestamps without
    # writing its optional index refresh. Diff's cache refresh is not optional
    # on every Git version; disabling it can mistake timestamp changes for edits.
    changes="$(GIT_OPTIONAL_LOCKS=0 filterest_recovery_utility "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" status --porcelain=v1 --untracked-files=no)" || die "tracked files have local changes; commit or restore them first"
    while IFS= read -r change; do
        [[ -z "$change" || "${change:1:1}" == ' ' ]] || die "tracked files have local changes; commit or restore them first"
    done <<< "$changes"
    GIT_OPTIONAL_LOCKS=0 filterest_recovery_output "$INSTALLATION_ROOT" git -c diff.autoRefreshIndex=false -C "$INSTALLATION_ROOT" diff --cached --quiet || die "the Git index has staged changes; commit or restore them first"
    # Preserve local-change explanations before inspecting fetch/merge destinations.
    filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/recovery_checkout_preflight.py" \
        --root "$INSTALLATION_ROOT" --locks-only
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
    filterest_recovery_content_to_file "$INSTALLATION_ROOT" "$release_json" curl --fail --silent --show-error --location \
        --header 'Accept: application/vnd.github+json' \
        -- "$api_url"

    TARGET_TAG="$(filterest_recovery_utility "$INSTALLATION_ROOT" python3 - "$release_json" <<'PY'
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
    filterest_recovery_output "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" fetch --quiet origin "refs/tags/${TARGET_TAG}:refs/tags/${TARGET_TAG}"
    TARGET_COMMIT="$(filterest_recovery_utility "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" rev-parse "${TARGET_TAG}^{commit}")"
    tag_commit="$(filterest_recovery_utility "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" rev-list -n 1 "$TARGET_TAG")"
    [[ "$TARGET_COMMIT" == "$tag_commit" ]] || die "release tag does not resolve to one commit"
    filterest_recovery_content_to_file "$INSTALLATION_ROOT" "$identity_file" git -C "$INSTALLATION_ROOT" show "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}BUILD_IDENTITY.json" || \
        die "release commit has no BUILD_IDENTITY.json"
    filterest_recovery_output "$INSTALLATION_ROOT" python3 - "$identity_file" "$TARGET_VERSION" <<'PY'
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
    filterest_recovery_output "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}go.mod" || \
        die "release commit has no immutable app/go.mod"
    filterest_recovery_output "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}VERSION_APP" || \
        die "release commit has no immutable app/VERSION_APP"
    filterest_recovery_output "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}server_tools/install_filterest.sh" || \
        die "release commit has no immutable app installer"
    if [[ "$PROFILE" == "docker" ]]; then
        for docker_path in \
            "${GIT_SOURCE_PREFIX}server_tools/run_filterest_docker.sh" \
            "${GIT_SOURCE_PREFIX}docker/docker-compose.yml" \
            compose.yml
        do
            filterest_recovery_output "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${docker_path}" || \
                die "release commit has no Docker contract file: $docker_path"
        done
    fi
    mutable_tracked_paths="$(
        filterest_recovery_utility "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" ls-tree -r --name-only "$TARGET_COMMIT" -- \
            config keys projects data backups
    )"
    [[ -z "$mutable_tracked_paths" ]] || {
        filterest_recovery_diagnostic "$INSTALLATION_ROOT" 'Refusing release commit with tracked mutable installation paths:\n%s\n' \
            "$mutable_tracked_paths" >&2
        die "release commit would modify operator-owned installation state"
    }
    filterest_recovery_output "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" merge-base --is-ancestor HEAD "$TARGET_COMMIT" || \
        die "the published release is not a fast-forward from this checkout"
}

# Runs one Docker runner action against this installation root.
docker_runner() {
    FILTEREST_PROJECT_ROOT_OVERRIDE="$INSTALLATION_ROOT" filterest_recovery_output "$INSTALLATION_ROOT" "$DOCKER_RUNNER" "$@"
}

# Chooses the native or Docker update path from the installation's own records,
# with the launcher's rule for a folder that records both (installation_records.sh).
# Why: such a folder, or a native marker without exactly one known profile, would
# be stopped, backed up and restarted the wrong way, so it is refused before
# anything changes. A native update also needs its setup to have completed.
resolve_profile() {
    local marker="$RUNTIME_ROOT/filterest-setup-complete"
    local docker_profile=""
    local record="" records=""
    local native_records=()

    if [[ "$SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
        docker_profile="$(filterest_docker_install_profile "$DOCKER_RUNNER" "$INSTALLATION_ROOT")"
    fi
    records="$(filterest_native_setup_records "$marker" "$EASELECT_DEV_ENV_FILE" "$EASELECT_RUNTIME_ENV_FILE")" || return
    while IFS= read -r record; do
        [[ -n "$record" ]] || continue
        native_records+=("$record")
    done <<< "$records"
    filterest_refuse_mixed_installation "$docker_profile" ${native_records[@]+"${native_records[@]}"}
    if [[ -e "$marker" || -L "$marker" ]]; then
        [[ -f "$marker" && ! -L "$marker" ]] || die "the native setup marker is not a regular file: $marker"
        PROFILE=""
        if [[ "$(grep -c '^profile=' -- "$marker" 2>/dev/null || true)" == "1" ]]; then
            PROFILE="$(filterest_recovery_utility "$INSTALLATION_ROOT" sed -n 's/^profile=//p' -- "$marker")" || return
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
    filterest_recovery_scan "$INSTALLATION_ROOT" stderr _resolve_private_environment "$@"
}

_resolve_private_environment() {
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
        value="$(grep -E "^${key}=" -- "$file" 2>/dev/null | tail -1 | cut -d'=' -f2- || true)"
        if [[ -n "$value" ]]; then
            printf '%s' "$value"
            return
        fi
    done
}

show_plan() {
    local current_version="" plan_destination=1
    # Interactive context is scanned here before it bypasses the finite outer
    # buffer. Keep its original stdout so the operator can review before input.
    if [[ "$ASSUME_YES" -eq 0 && "$DRY_RUN" -eq 0 && -t 0 && "${FILTEREST_RECOVERY_CONTEXT_FD:-}" == 7 ]] && { true >&7; } 2>/dev/null; then
        plan_destination=7
    fi
    current_version="$(filterest_recovery_version "$INSTALLATION_ROOT" "$APP_VERSION_FILE")"
    filterest_recovery_diagnostic "$INSTALLATION_ROOT" '\nFilterest stable update plan\n' >&"${plan_destination:-1}"
    filterest_recovery_diagnostic "$INSTALLATION_ROOT" '  Repository: %s\n  Installed version: %s\n  Published version: %s\n  Release commit: %s\n  Profile: %s\n' \
        "$RELEASE_REPOSITORY" "$current_version" "$TARGET_VERSION" "$TARGET_COMMIT" "$PROFILE" >&"${plan_destination:-1}"
    if [[ "$PROFILE" == "docker" ]]; then
        filterest_recovery_diagnostic "$INSTALLATION_ROOT" '  Safety: database dump from the database container + mutable-data and settings backup, then fast-forward-only update and image rebuild\n' >&"${plan_destination:-1}"
    else
        filterest_recovery_diagnostic "$INSTALLATION_ROOT" '  Safety: database + mutable-data backup, then fast-forward-only update\n' >&"${plan_destination:-1}"
    fi
    if [[ "$current_version" == "$TARGET_VERSION" && "$(filterest_recovery_utility "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" rev-parse HEAD)" == "$TARGET_COMMIT" ]]; then
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
    if [[ "${FILTEREST_RECOVERY_CONTEXT_FD:-}" == 7 ]] && { true >&7; } 2>/dev/null; then
        filterest_recovery_diagnostic "$INSTALLATION_ROOT" '\nStop Filterest, create the backup, and apply this update? [y/N] ' >&7
    else
        filterest_recovery_diagnostic "$INSTALLATION_ROOT" '\nStop Filterest, create the backup, and apply this update? [y/N] '
    fi
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
    filterest_recovery_scan "$INSTALLATION_ROOT" stderr _acquire_update_lock "$@"
}

_acquire_update_lock() {
    filterest_recovery_content_names "$INSTALLATION_ROOT" "$RUNTIME_ROOT/filterest-update.lock" || return 1
    (umask 077; filterest_recovery_output "$INSTALLATION_ROOT" mkdir -p -- "$RUNTIME_ROOT") || die "Could not prepare update runtime directory: $RUNTIME_ROOT"
    local previous_umask="$(umask)"
    umask 077
    { exec 9>>"$RUNTIME_ROOT/filterest-update.lock"; } || die "Could not open update lock in: $RUNTIME_ROOT"
    umask "$previous_umask"
    filterest_recovery_output "$INSTALLATION_ROOT" python3 - <<'PY' || die "another Filterest update is already running for this installation"
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
        filterest_recovery_output "$INSTALLATION_ROOT" "$SOURCE_ROOT/server_tools/run_filterest_admin.sh" stop
    else
        filterest_recovery_output "$INSTALLATION_ROOT" "$INSTALLATION_ROOT/ctl" --stop
    fi
}

# Validate static recovery destinations and bootstrap paths before shutting down.
prepare_backup_directory() {
    filterest_recovery_scan "$INSTALLATION_ROOT" stderr _prepare_backup_directory "$@"
}

_prepare_backup_directory() {
    BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    BACKUP_DIR="$BACKUP_ROOT/update_${BACKUP_STAMP}_$(filterest_recovery_version "$INSTALLATION_ROOT" "$APP_VERSION_FILE")_to_${TARGET_VERSION}"
    filterest_recovery_content_names "$INSTALLATION_ROOT" "$BACKUP_ROOT" "$BACKUP_DIR" || return 1
    [[ ! -L "$BACKUP_ROOT" ]] || die "backup root must not be a symbolic link"
    (umask 077; filterest_recovery_output "$INSTALLATION_ROOT" mkdir -p -- "$BACKUP_ROOT") || die "Could not prepare backup root: $BACKUP_ROOT"
    [[ ! -e "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || die "backup folder already exists: $BACKUP_DIR"
    (umask 077; filterest_recovery_output "$INSTALLATION_ROOT" mkdir -m 700 -- "$BACKUP_DIR") || die "Could not create backup folder: $BACKUP_DIR"
    BACKUP_DIRECTORY_PREPARED=1
}

create_backup() {
    filterest_recovery_scan "$INSTALLATION_ROOT" stderr _create_backup "$@"
}

_create_backup() {
    local previous_umask="$(umask)"
    umask 077
    local stamp="$BACKUP_STAMP"
    local backup_dir="$BACKUP_DIR"

    if [[ "$PROFILE" == "docker" ]]; then
        docker_runner dump-database --output "$backup_dir/database.dump"
    else
        filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery.py" backup \
            --root "$INSTALLATION_ROOT" --profile native \
            --settings "$EASELECT_DEV_ENV_FILE" --settings "$EASELECT_RUNTIME_ENV_FILE" \
            --output "$backup_dir/database.dump" --dump-options "${FILTEREST_DATABASE_DUMP_OPTIONS[@]}"
    fi

    local recovery_profile=native
    local recovery_settings=()
    if [[ "$PROFILE" == docker ]]; then
        recovery_profile=docker
    else
        recovery_settings=(--settings "$EASELECT_DEV_ENV_FILE" --settings "$EASELECT_RUNTIME_ENV_FILE")
    fi
    # The same link-free boundary runs before shutdown and while reading files.
    filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery_update.py" archive \
        --root "$INSTALLATION_ROOT" --profile "$recovery_profile" \
        ${recovery_settings[@]+"${recovery_settings[@]}"} --backup "$backup_dir"
    # Recheck both archives and settings immediately before marking the whole
    # update backup complete. This catches failed/truncated exports and settings
    # edited while the archiver was reading them.
    filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery.py" verify \
        --root "$INSTALLATION_ROOT" --profile "$recovery_profile" \
        ${recovery_settings[@]+"${recovery_settings[@]}"} --backup "$backup_dir" \
        --archive "$backup_dir/installation_settings.tar.gz"
    # The manifest is an authenticated artifact; the whole-update seal is written last.
    {
        printf 'from_version=%s\nto_version=%s\nrelease_tag=%s\nrelease_commit=%s\ncreated_at=%s\n' \
            "$(filterest_recovery_version "$INSTALLATION_ROOT" "$APP_VERSION_FILE")" "$TARGET_VERSION" \
            "$TARGET_TAG" "$TARGET_COMMIT" "$stamp"
        printf 'profile=%s\nsource_commit=%s\n' \
            "$PROFILE" "$(filterest_recovery_utility "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" rev-parse HEAD)"
        if [[ "$PROFILE" == "docker" ]]; then
            printf 'app_image_id=%s\n' "${APP_IMAGE_ID:-unknown}"
        fi
    } | filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery_update.py" manifest \
        --root "$INSTALLATION_ROOT" --profile "$recovery_profile" \
        ${recovery_settings[@]+"${recovery_settings[@]}"} --backup "$backup_dir"
    filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery_update.py" seal \
        --root "$INSTALLATION_ROOT" --profile "$recovery_profile" \
        ${recovery_settings[@]+"${recovery_settings[@]}"} --backup "$backup_dir"
    umask "$previous_umask"
    BACKUP_DIR="$backup_dir"
    filterest_recovery_diagnostic "$INSTALLATION_ROOT" 'Backup created: %s\n' "$backup_dir"
    if [[ "$PROFILE" == "docker" ]]; then
        RECOVERY_HINT="The update stopped before changing the installation; the backup in $backup_dir is complete. Start the installed version again with: ./filterest docker start"
    fi
}

apply_update() {
    filterest_recovery_output "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" merge --ff-only "$TARGET_COMMIT"
    if [[ "$PROFILE" != "docker" ]]; then
        FILTEREST_RECOVERY_CONTENT_ROOT="$INSTALLATION_ROOT" \
            filterest_recovery_output "$INSTALLATION_ROOT" "$SOURCE_ROOT/server_tools/install_filterest.sh" --profile "$PROFILE" --yes --no-start
    fi
}

# Read only inert target requirements through the existing checked git-show sink.
# Old releases have no list; their installed release's list is the compatibility
# fallback. Never source or execute the target installer to discover packages.
preflight_native_installation() {
    [[ "$PROFILE" == admin && "$DRY_RUN" -eq 0 ]] || return 0
    local contract="server_tools/lib/native_host_packages.list"
    local target_list="$TEMP_DIR/native_host_packages.list" packages="" package=""
    filterest_recovery_source "$INSTALLATION_ROOT" "$SOURCE_ROOT/server_tools/lib/native_host_package_reader.sh"
    if filterest_recovery_output "$INSTALLATION_ROOT" git -C "$INSTALLATION_ROOT" cat-file -e "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}${contract}" >/dev/null 2>&1; then
        filterest_recovery_content_to_file "$INSTALLATION_ROOT" "$target_list" git -C "$INSTALLATION_ROOT" show "${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}${contract}"
    else
        filterest_recovery_content_to_file "$INSTALLATION_ROOT" "$target_list" cat -- "$SOURCE_ROOT/$contract"
    fi
    packages="$(filterest_native_host_packages "$target_list" admin "${FILTEREST_POSTGRESQL_MAJOR:-}")" || die "invalid native host package requirements"
    while IFS= read -r package; do
        if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q '^install ok installed$'; then
            die "Recovery update requires host packages already installed; run ordinary setup first"
        fi
    done <<< "$packages"
    # A direct updater invocation may retain this preview switch even when the
    # normal root launcher clears it. Its opaque credential writer is forbidden.
    [[ "${FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN:-}" != 1 ]] || die "Recovery refuses automated-preview credential file creation."
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
    filterest_recovery_scan "$INSTALLATION_ROOT" stderr _start_updated_runtime "$@"
}

_start_updated_runtime() {
    local -x FILTEREST_RECOVERY_CONTENT_ROOT="$INSTALLATION_ROOT"
    local port="" app_version="" db_version=""
    if [[ "$PROFILE" == "docker" ]]; then
        start_updated_docker_runtime
        return
    fi
    if [[ "$PROFILE" == "admin" ]]; then
        ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST="" \
            filterest_recovery_output "$INSTALLATION_ROOT" "$SOURCE_ROOT/server_tools/run_filterest_admin.sh" start 9>&- || return "$?"
    else
        port="$(environment_value APP_PORT)"
        if [[ -z "$port" ]]; then
            port="$(filterest_native_default_port "$INSTALLATION_ROOT")"
        fi
        ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST="" \
            filterest_recovery_output "$INSTALLATION_ROOT" "$INSTALLATION_ROOT/ctl" -p "$port" 9>&-
    fi
    app_version="$(filterest_recovery_version "$INSTALLATION_ROOT" "$APP_VERSION_FILE")" || return
    db_version="$(filterest_recovery_version "$INSTALLATION_ROOT" "$DB_VERSION_FILE")" || return
    (umask 077; filterest_recovery_output "$INSTALLATION_ROOT" mkdir -p -- "$RUNTIME_ROOT") || return
    filterest_recovery_content_to_file "$INSTALLATION_ROOT" "$RUNTIME_ROOT/filterest-setup-complete" \
        printf 'profile=%s\napp_version=%s\ndb_version=%s\n' \
        "$PROFILE" "$app_version" "$db_version" || return
    filterest_recovery_output "$INSTALLATION_ROOT" "$INSTALLATION_ROOT/filterest" status
}

main() {
    parse_arguments "$@"
    require_command curl
    require_command git
    require_command python3
    verify_checkout
    # Path resolution only; the native settings it names are also native records.
    resolve_private_environment
    resolve_profile
    if [[ "$PROFILE" != "docker" ]]; then
        require_command pg_dump
        require_command pg_dumpall
        require_command pg_restore
    fi
    TEMP_DIR="$(filterest_recovery_mktemp "$INSTALLATION_ROOT" -d -- "${TMPDIR:-/tmp}/filterest-update.XXXXXX")" || return
    download_release_evidence
    # Fetch can encounter ref/shallow locks too. Refuse existing Git operations
    # with the same fixed explanation before it writes any release evidence.
    filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/recovery_checkout_preflight.py" \
        --root "$INSTALLATION_ROOT" --locks-only --profile "$PROFILE"
    fetch_and_verify_target
    filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/recovery_checkout_preflight.py" \
        --root "$INSTALLATION_ROOT" --target "$TARGET_COMMIT" --profile "$PROFILE"
    if [[ "$PROFILE" == "docker" ]]; then
        # Settings only: a dry run neither needs nor calls Docker.
        docker_runner update-preflight --dry-run
    fi
    show_plan
    if [[ "$PROFILE" == "docker" ]]; then
        docker_runner update-preflight
    fi
    preflight_native_installation
    if [[ "$PROFILE" == admin ]]; then
        # Existing logs are outside the archive roots. Refuse their bytes and
        # destination before lock/backup/shutdown; the live scanner checks again.
        filterest_recovery_content_stream "$INSTALLATION_ROOT" live-preflight \
            "$RUNTIME_ROOT/logs/filterest-admin.log" < /dev/null || return 1
        filterest_recovery_content_stream "$INSTALLATION_ROOT" destination-preflight \
            "$RUNTIME_ROOT/filterest-admin.pid" "$RUNTIME_ROOT/bin/filterest-server" \
            "$RUNTIME_ROOT/filterest-binary-version" "$RUNTIME_ROOT/filterest-installation-id" < /dev/null || return 1
        FILTEREST_RECOVERY_CONTENT_ROOT="$INSTALLATION_ROOT" filterest_recovery_output "$INSTALLATION_ROOT" \
            "$SOURCE_ROOT/server_tools/install_filterest.sh" --profile admin --update-preflight
    fi
    confirm_plan
    acquire_update_lock
    # Refuse nonportable protected settings and missing recovery inputs before downtime.
    if [[ "$PROFILE" == docker ]]; then
        filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery.py" preflight \
            --root "$INSTALLATION_ROOT" --profile docker
    else
        filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery.py" preflight \
            --root "$INSTALLATION_ROOT" --profile native \
            --settings "$EASELECT_DEV_ENV_FILE" --settings "$EASELECT_RUNTIME_ENV_FILE"
    fi
    if [[ "$PROFILE" == docker ]]; then
        filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery_update.py" preflight \
            --root "$INSTALLATION_ROOT" --profile docker
    else
        filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SOURCE_ROOT/server_tools/lib/database_recovery_update.py" preflight \
            --root "$INSTALLATION_ROOT" --profile native \
            --settings "$EASELECT_DEV_ENV_FILE" --settings "$EASELECT_RUNTIME_ENV_FILE" \
            --home "$FILTEREST_KEYS_HOME" --home "$FILTEREST_PROJECTS_HOME"
    fi
    if [[ "$PROFILE" == development && "$DRY_RUN" -eq 0 ]]; then
        # Keep role/archive preflight and its useful refusals before declining
        # opaque compiler/cache/runner writes, still before shutdown or merge.
        die "Recovery native source build refused; use an already installed admin runtime"
    fi
    prepare_backup_directory
    stop_runtime
    create_backup
    apply_update
    start_updated_runtime
    filterest_recovery_diagnostic "$INSTALLATION_ROOT" '\nFilterest update completed: %s\n' "$TARGET_VERSION"
}

main "$@"
