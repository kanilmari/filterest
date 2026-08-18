#!/usr/bin/env bash
# update_filterest.sh
# Updates one generated Filterest checkout to a verified published stable tag.
# Bridges GitHub release evidence, local backups, fast-forward Git, and the
# existing profile-aware installer so an operator does not repeat the process.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

ASSUME_YES=0
DRY_RUN=0
REQUESTED_VERSION=""
RELEASE_REPOSITORY="${FILTEREST_RELEASE_REPOSITORY:-}"
TEMP_DIR=""
TARGET_TAG=""
TARGET_COMMIT=""
TARGET_VERSION=""
PROFILE=""

usage() {
    cat <<'USAGE'
Usage: ./filterest update [options]

Updates a generated Filterest checkout to a published stable GitHub release.

Options:
  --version VERSION  Install this exact published stable version.
  --dry-run          Verify and show the update plan without changing local data.
  --yes              Apply the verified plan without another confirmation.
  -h, --help         Show this help.

The updater refuses dirty checkouts, development snapshots, draft/prerelease
GitHub releases, non-fast-forward histories, and unapproved release origins.
Before changing the checkout it backs up PostgreSQL plus storage directories.
USAGE
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

cleanup() {
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
    [[ -f "$PROJECT_ROOT/VERSION_APP" && ! -f "$PROJECT_ROOT/VERSION_EASELECT" ]]
}

resolve_release_repository() {
    local remote_url=""
    local parsed=""
    if [[ -z "$RELEASE_REPOSITORY" ]]; then
        remote_url="$(git remote get-url origin 2>/dev/null || true)"
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
    [[ -d "$PROJECT_ROOT/.git" ]] || die "the Filterest checkout must retain Git metadata"
    branch="$(git branch --show-current)"
    [[ "$branch" == "main" ]] || die "updates require the main branch; current branch: ${branch:-detached}"
    git diff --quiet || die "tracked files have local changes; commit or restore them first"
    git diff --cached --quiet || die "the Git index has staged changes; commit or restore them first"
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
    local tag_commit=""
    git fetch --quiet origin "refs/tags/${TARGET_TAG}:refs/tags/${TARGET_TAG}"
    TARGET_COMMIT="$(git rev-parse "${TARGET_TAG}^{commit}")"
    tag_commit="$(git rev-list -n 1 "$TARGET_TAG")"
    [[ "$TARGET_COMMIT" == "$tag_commit" ]] || die "release tag does not resolve to one commit"
    git show "${TARGET_COMMIT}:BUILD_IDENTITY.json" > "$identity_file" || \
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
    git merge-base --is-ancestor HEAD "$TARGET_COMMIT" || \
        die "the published release is not a fast-forward from this checkout"
}

installed_profile() {
    local marker="$PROJECT_ROOT/runtime/filterest-setup-complete"
    sed -n 's/^profile=//p' "$marker" 2>/dev/null | head -1 || true
}

resolve_private_environment() {
    # shellcheck source=server_tools/lib/easelect_private_paths.sh
    source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
    easelect_resolve_private_paths "$PROJECT_ROOT"
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
    current_version="$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_APP")"
    printf '\nFilterest stable update plan\n'
    printf '  Repository: %s\n' "$RELEASE_REPOSITORY"
    printf '  Installed version: %s\n' "$current_version"
    printf '  Published version: %s\n' "$TARGET_VERSION"
    printf '  Release commit: %s\n' "$TARGET_COMMIT"
    printf '  Profile: %s\n' "$PROFILE"
    printf '  Safety: database + storage backup, then fast-forward-only update\n'
    if [[ "$current_version" == "$TARGET_VERSION" && "$(git rev-parse HEAD)" == "$TARGET_COMMIT" ]]; then
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

stop_runtime() {
    if [[ "$PROFILE" == "admin" ]]; then
        "$PROJECT_ROOT/server_tools/run_filterest_admin.sh" stop
    else
        "$PROJECT_ROOT/ctl" --stop
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
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="$FILTEREST_RUNTIME_DATA_HOME/update_backups/${stamp}_$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_APP")_to_${TARGET_VERSION}"
    mkdir -p "$backup_dir"
    chmod 700 "$backup_dir"

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

    if [[ -e "$PROJECT_ROOT/storage" || -e "$PROJECT_ROOT/storage_deleted" ]]; then
        local storage_paths=()
        [[ -e "$PROJECT_ROOT/storage" ]] && storage_paths+=(storage)
        [[ -e "$PROJECT_ROOT/storage_deleted" ]] && storage_paths+=(storage_deleted)
        tar --dereference -C "$PROJECT_ROOT" -czf "$backup_dir/storage.tar.gz" "${storage_paths[@]}"
        chmod 600 "$backup_dir/storage.tar.gz"
    fi
    printf 'from_version=%s\nto_version=%s\nrelease_tag=%s\nrelease_commit=%s\ncreated_at=%s\n' \
        "$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_APP")" "$TARGET_VERSION" \
        "$TARGET_TAG" "$TARGET_COMMIT" "$stamp" > "$backup_dir/manifest.txt"
    chmod 600 "$backup_dir/manifest.txt"
    printf 'Backup created: %s\n' "$backup_dir"
}

apply_update() {
    git merge --ff-only "$TARGET_COMMIT"
    "$PROJECT_ROOT/server_tools/install_filterest.sh" --profile "$PROFILE" --yes --no-start
}

start_updated_runtime() {
    local port=""
    if [[ "$PROFILE" == "admin" ]]; then
        ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST="" \
            "$PROJECT_ROOT/server_tools/run_filterest_admin.sh" start
    else
        port="$(environment_value APP_PORT)"
        port="${port:-8100}"
        ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST="" \
            "$PROJECT_ROOT/ctl" -p "$port"
    fi
    mkdir -p "$PROJECT_ROOT/runtime"
    printf 'profile=%s\napp_version=%s\ndb_version=%s\n' \
        "$PROFILE" \
        "$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_APP")" \
        "$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_DB")" \
        > "$PROJECT_ROOT/runtime/filterest-setup-complete"
    "$PROJECT_ROOT/filterest" status
}

main() {
    parse_arguments "$@"
    require_command curl
    require_command git
    require_command python3
    require_command pg_dump
    require_command tar
    verify_checkout
    TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/filterest-update.XXXXXX")"
    download_release_evidence
    fetch_and_verify_target
    PROFILE="$(installed_profile)"
    case "$PROFILE" in
        admin|development) ;;
        *) die "completed Filterest setup profile is missing; run ./filterest setup first" ;;
    esac
    resolve_private_environment
    show_plan
    confirm_plan
    stop_runtime
    create_backup
    apply_update
    start_updated_runtime
    printf '\nFilterest update completed: %s\n' "$TARGET_VERSION"
}

main "$@"
