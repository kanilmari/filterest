#!/usr/bin/env bash
# check_first_cloud_recovery_readiness.sh
# Checks first-cloud backup, restore, rollback, and status evidence without mutations.
# Operates between repo runbooks, optional local/SSH release-root paths,
# optional backup/storage paths, optional live system endpoints, and terminal evidence.
# Exists so #839 B6 recovery readiness can be proven repeatably before acceptance.

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

RELEASE_ROOT="${FIRST_CLOUD_RECOVERY_RELEASE_ROOT:-}"
BACKUP_DIR="${FIRST_CLOUD_RECOVERY_BACKUP_DIR:-}"
STORAGE_ROOT="${FIRST_CLOUD_RECOVERY_STORAGE_ROOT:-}"
STORAGE_DELETED_ROOT="${FIRST_CLOUD_RECOVERY_STORAGE_DELETED_ROOT:-}"
TIMEOUT_SECONDS="${FIRST_CLOUD_RECOVERY_TIMEOUT_SECONDS:-10}"
SSH_TARGET="${FIRST_CLOUD_RECOVERY_SSH_TARGET:-}"
SSH_KEY="${FIRST_CLOUD_RECOVERY_SSH_KEY:-}"
SYSTEMD_SERVICE="${FIRST_CLOUD_RECOVERY_SYSTEMD_SERVICE:-}"
EXPECTED_APP_VERSION="$(tr -d '[:space:]' <"$PROJECT_ROOT/VERSION_APP" 2>/dev/null || true)"
EXPECTED_DB_VERSION="$(tr -d '[:space:]' <"$PROJECT_ROOT/VERSION_DB" 2>/dev/null || true)"

BASE_URLS=()
REMOTE_BASE_URLS=()
REQUIRE_RELEASE_ROOT=false
REQUIRE_BACKUP=false
REQUIRE_STORAGE_ROOT=false
REQUIRE_STORAGE_DELETED_ROOT=false
REQUIRE_ROLLBACK_TARGET=false
REQUIRE_REPO_RUNBOOKS=false
REQUIRE_SERVICE_ACTIVE=false
REQUIRE_CURRENT_VERSION_MATCH="${FIRST_CLOUD_RECOVERY_REQUIRE_CURRENT_VERSION_MATCH:-false}"
SKIP_NETWORK=false
STRICT=false
PRINT_OPERATOR_COMMANDS=false
PRINT_RESTORE_REHEARSAL_PLAN=false
SSH_ARGS=()

CHECKS_RUN=0
FAILURES=0
WARNINGS=0

usage() {
    cat <<USAGE
Usage:
  ${SCRIPT_NAME} [options]
  ${SCRIPT_NAME} --release-root /opt/filterest --backup-dir /srv/filterest-cloud/filterest.com/backups --base-url https://filterest.com
  ${SCRIPT_NAME} --ssh-target user@example.com --ssh-key ~/.ssh/easelect_key --release-root /opt/filterest --backup-dir /srv/filterest-cloud/filterest.com/backups --base-url https://filterest.com

Runs non-mutating first-cloud recovery-readiness checks. It never edits
release roots, symlinks, databases, backups, storage, services, or env files.

Options:
  --release-root <path>       Native production release root to inspect,
                              for example /opt/filterest.
  --backup-dir <path>         Directory containing recovery DB backups.
                              Defaults to <release-root>/backups when
                              --release-root is provided.
  --storage-root <path>       Runtime storage root to inspect.
  --storage-deleted-root <path>
                              Runtime deleted-media/archive storage root to
                              inspect.
  --base-url <url>            Live Easelect base URL to inspect through
                              /system/ready and /system/instance-status.
                              May be repeated.
  --remote-base-url <url>     Live Easelect base URL to inspect over
                              --ssh-target, for example
                              https://localhost:8082. May be repeated.
                              When --storage-root is also provided, the
                              reported /system/instance-status storage_root
                              must resolve to that root on the remote host.
  --ssh-target <user@host>    Inspect release-root, backup, storage, and
                              optional systemd status over SSH read-only.
  --ssh-key <path>            SSH private key for --ssh-target.
  --service-name <unit>       Optional systemd unit to check over SSH,
                              for example easelect.service.
  --timeout <seconds>         curl timeout for live endpoint checks.
                              Default: ${TIMEOUT_SECONDS}.
  --require-release-root      Fail if release-root/current evidence is missing.
  --require-backup            Fail if no non-empty DB backup artifact is found.
  --require-storage-root      Fail if storage-root evidence is missing.
  --require-storage-deleted-root
                              Fail if storage-deleted-root evidence is missing.
  --require-rollback-target   Fail if release-root has no previous release dir.
  --require-repo-runbooks     Fail if repo runbook files/docs are missing.
  --require-service-active    Fail if --service-name is not active over SSH.
  --require-current-version-match
                              Fail if current release VERSION_APP or
                              VERSION_DB differs from this checkout.
  --skip-network              Skip live --base-url checks.
  --strict                    Treat warnings as failures at the final verdict.
  --print-operator-commands   Print the manual recovery/rollback checklist.
  --print-restore-rehearsal-plan
                              Print a non-live DB restore rehearsal plan using
                              the provided release-root and backup evidence.
                              This prints operator-owned steps only; it never
                              runs restore commands, copies files, or edits DBs.
  -h, --help                  Show this help.

Environment defaults:
  FIRST_CLOUD_RECOVERY_RELEASE_ROOT
  FIRST_CLOUD_RECOVERY_BACKUP_DIR
  FIRST_CLOUD_RECOVERY_STORAGE_ROOT
  FIRST_CLOUD_RECOVERY_STORAGE_DELETED_ROOT
  FIRST_CLOUD_RECOVERY_TIMEOUT_SECONDS
  FIRST_CLOUD_RECOVERY_SSH_TARGET
  FIRST_CLOUD_RECOVERY_SSH_KEY
  FIRST_CLOUD_RECOVERY_SYSTEMD_SERVICE
  FIRST_CLOUD_RECOVERY_REQUIRE_CURRENT_VERSION_MATCH

Exit codes:
  0  no blocking failures were found
  1  at least one blocking failure was found, or --strict saw warnings
  2  usage error
USAGE
}

fail_usage() {
    printf 'error: %s\n\n' "$1" >&2
    usage >&2
    exit 2
}

pass_check() {
    CHECKS_RUN=$((CHECKS_RUN + 1))
    printf '[PASS] %s\n' "$1"
}

fail_check() {
    CHECKS_RUN=$((CHECKS_RUN + 1))
    FAILURES=$((FAILURES + 1))
    printf '[FAIL] %s\n' "$1" >&2
}

warn_check() {
    WARNINGS=$((WARNINGS + 1))
    printf '[WARN] %s\n' "$1" >&2
}

info() {
    printf '[INFO] %s\n' "$1"
}

is_positive_integer() {
    local value="$1"
    [[ "$value" =~ ^[1-9][0-9]*$ ]]
}

path_missing_result() {
    local required="$1"
    local message="$2"
    if [[ "$required" == true ]]; then
        fail_check "$message"
    else
        warn_check "$message"
    fi
}

require_command() {
    local command_name="$1"
    if command -v "$command_name" >/dev/null 2>&1; then
        return 0
    fi
    fail_check "required command not found: ${command_name}"
    return 1
}

## Integrity-test a compressed backup without mutating it, falling back to sudo for protected artifacts.
check_gzip_integrity() {
    local gzip_file="$1"
    local label="$2"
    local output_file

    output_file="$(mktemp)"
    if gzip -t "$gzip_file" >"$output_file" 2>&1; then
        pass_check "${label} passes integrity test"
        rm -f "$output_file"
        return
    fi
    if [[ ! -r "$gzip_file" ]] && command -v sudo >/dev/null 2>&1; then
        if sudo -n gzip -t "$gzip_file" >"$output_file" 2>&1; then
            pass_check "${label} passes integrity test via sudo read-only access"
            rm -f "$output_file"
            return
        fi
    fi
    if [[ ! -r "$gzip_file" ]]; then
        fail_check "${label} could not be integrity-tested because it is not readable and sudo read-only gzip test was unavailable: ${gzip_file}"
    else
        fail_check "${label} failed integrity test: ${gzip_file}"
    fi
    rm -f "$output_file"
}

build_ssh_args() {
    SSH_ARGS=(
        -o BatchMode=yes
        -o IdentitiesOnly=yes
        -o StrictHostKeyChecking=accept-new
        -o ConnectTimeout="${TIMEOUT_SECONDS}"
    )
    if [[ -n "$SSH_KEY" ]]; then
        SSH_ARGS=(-i "$SSH_KEY" "${SSH_ARGS[@]}")
    fi
}

check_repo_file() {
    local path="$1"
    local label="$2"
    local required="$3"
    if [[ -r "$PROJECT_ROOT/$path" ]]; then
        pass_check "${label} exists: ${path}"
    else
        path_missing_result "$required" "${label} missing or unreadable: ${path}"
    fi
}

normalize_bool() {
    local value="$1"
    case "$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]' | xargs)" in
        true|1|yes|y|on) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

record_version_match_result() {
    local label="$1"
    local actual="$2"
    local expected="$3"

    if [[ -z "$expected" ]]; then
        warn_check "source ${label} could not be read for release version comparison"
        return
    fi
    if [[ "$actual" == "$expected" ]]; then
        pass_check "current release ${label} matches source ${label}: ${actual}"
        return
    fi
    path_missing_result \
        "$REQUIRE_CURRENT_VERSION_MATCH" \
        "current release ${label}=${actual:-<empty>} differs from source ${label}=${expected}"
}

record_protected_file_result() {
    local path="$1"
    local label="$2"

    if [[ -r "$path" ]]; then
        pass_check "${label} exists and is readable without printing contents"
        return
    fi
    if [[ -e "$path" ]]; then
        pass_check "${label} exists and is protected from the current SSH/user context"
        return
    fi
    warn_check "${label} was not found"
}

file_contains_pattern() {
    local path="$1"
    local pattern="$2"

    if command -v rg >/dev/null 2>&1; then
        rg -q "$pattern" "$path"
        return $?
    fi

    grep -Eq "$pattern" "$path"
}

check_doc_pattern() {
    local path="$1"
    local pattern="$2"
    local label="$3"
    local required="$4"
    local full_path="$PROJECT_ROOT/$path"

    if [[ ! -r "$full_path" ]]; then
        path_missing_result "$required" "${label} doc missing or unreadable: ${path}"
        return
    fi
    if file_contains_pattern "$full_path" "$pattern"; then
        pass_check "${label} is documented in ${path}"
    else
        path_missing_result "$required" "${label} is not documented in ${path}"
    fi
}

run_manifest_validation() {
    local output_file

    require_command python3 || return
    output_file="$(mktemp)"
    if python3 "$PROJECT_ROOT/server_tools/scripts/validate_app_db_compatibility.py" >"$output_file" 2>&1; then
        pass_check "app/DB compatibility manifest validates"
    else
        fail_check "app/DB compatibility manifest validation failed"
        sed 's/^/  /' "$output_file" >&2
    fi
    rm -f "$output_file"
}

print_operator_commands() {
    cat <<COMMANDS

Manual first-cloud recovery checklist:
  ./server_tools/check_first_cloud_runtime_safety.sh --base-url https://filterest.com
  ./server_tools/check_first_cloud_recovery_readiness.sh \\
    --ssh-target <operator>@<host> \\
    --ssh-key ~/.ssh/easelect_key \\
    --release-root /opt/filterest \\
    --backup-dir /srv/filterest-cloud/filterest.com/backups \\
    --storage-root /srv/filterest-cloud/filterest.com/storage/current \\
    --storage-deleted-root /srv/filterest-cloud/filterest.com/storage_deleted/current \\
    --service-name filterest.service \\
    --base-url https://filterest.com \\
    --require-repo-runbooks --require-release-root --require-backup \\
    --require-storage-root --require-storage-deleted-root \\
    --require-rollback-target --require-service-active
  ./server_tools/check_first_cloud_recovery_readiness.sh \\
    --ssh-target <operator>@<host> \\
    --ssh-key ~/.ssh/easelect_key \\
    --release-root /opt/filterest \\
    --backup-dir /srv/filterest-cloud/filterest.com/backups \\
    --print-restore-rehearsal-plan \\
    --skip-network
  sudo systemctl status filterest --no-pager
  sudo journalctl -u filterest -n 100 --no-pager

Rollback rehearsal:
  1. Confirm the target app change is app-only, or identify the matching DB
     backup/schema pair before touching a live DB.
  2. For app-only rollback, repoint /opt/filterest/current to the previous
     release directory and restart filterest.service.
  3. For app+DB rollback, restore the DB only on an approved non-live rehearsal
     target first, then perform the live restore only under human/operator
     control.
COMMANDS
}

print_local_restore_rehearsal_inputs() {
    local release_root="$1"
    local backup_dir="$2"
    local current_link
    local current_target
    local current_app_version
    local current_db_version
    local latest_line
    local latest_file
    local latest_size
    local latest_sha256

    printf 'Discovered local evidence for the non-live restore rehearsal plan:\n'
    printf '  - Source checkout app/DB: %s / %s\n' "${EXPECTED_APP_VERSION:-<unknown>}" "${EXPECTED_DB_VERSION:-<unknown>}"

    if [[ -n "$release_root" ]]; then
        current_link="${release_root%/}/current"
        if [[ -L "$current_link" ]]; then
            current_target="$(readlink -f "$current_link" 2>/dev/null || true)"
            printf '  - Current release target: %s\n' "${current_target:-<unresolved>}"
            if [[ -n "$current_target" && -r "$current_target/VERSION_APP" && -r "$current_target/VERSION_DB" ]]; then
                current_app_version="$(tr -d '[:space:]' <"$current_target/VERSION_APP" 2>/dev/null || true)"
                current_db_version="$(tr -d '[:space:]' <"$current_target/VERSION_DB" 2>/dev/null || true)"
                printf '  - Current release app/DB: %s / %s\n' "${current_app_version:-<empty>}" "${current_db_version:-<empty>}"
            else
                printf '  - Current release app/DB: <not readable from provided release root>\n'
            fi
        else
            printf '  - Current release target: <no current symlink at %s>\n' "$current_link"
        fi
    else
        printf '  - Current release target: <no --release-root provided>\n'
    fi

    if [[ -n "$backup_dir" && -d "$backup_dir" && -r "$backup_dir" ]]; then
        latest_line="$(
            find "$backup_dir" -maxdepth 1 -type f \
                \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.dump' -o -name 'backup_*.sql' -o -name 'easelect_*.sql.gz' \) \
                -size +0c -printf '%T@\t%p\n' 2>/dev/null | sort -nr | head -n 1
        )"
        latest_file="${latest_line#*$'\t'}"
        if [[ -n "$latest_line" && "$latest_file" != "$latest_line" && -f "$latest_file" ]]; then
            latest_size="$(du -h "$latest_file" 2>/dev/null | awk '{print $1}')"
            printf '  - Latest backup artifact: %s (%s)\n' "$latest_file" "${latest_size:-unknown size}"
            if command -v sha256sum >/dev/null 2>&1; then
                latest_sha256="$(sha256sum "$latest_file" 2>/dev/null | awk '{print $1}')"
                if [[ -n "$latest_sha256" ]]; then
                    printf '  - Latest backup SHA256: %s\n' "$latest_sha256"
                fi
            fi
            return
        fi
        printf '  - Latest backup artifact: <none found in %s>\n' "$backup_dir"
    elif [[ -n "$backup_dir" ]]; then
        printf '  - Latest backup artifact: <backup dir missing or unreadable: %s>\n' "$backup_dir"
    else
        printf '  - Latest backup artifact: <no --backup-dir provided>\n'
    fi
}

print_remote_restore_rehearsal_inputs() {
    local release_root="$1"
    local backup_dir="$2"
    local output_file
    local error_file

    output_file="$(mktemp)"
    error_file="$(mktemp)"
    if ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" -- \
        "$release_root" "$backup_dir" "$EXPECTED_APP_VERSION" "$EXPECTED_DB_VERSION" >"$output_file" 2>"$error_file" <<'REMOTE'
release_root="$1"
backup_dir="$2"
expected_app_version="$3"
expected_db_version="$4"

path_is_link() {
    local path="$1"
    [[ -L "$path" ]] && return 0
    sudo -n test -L "$path" >/dev/null 2>&1
}

resolve_link() {
    local path="$1"
    readlink -f "$path" 2>/dev/null || sudo -n readlink -f "$path" 2>/dev/null || true
}

read_trimmed_file() {
    local path="$1"
    if [[ -r "$path" ]]; then
        tr -d '[:space:]' <"$path"
        return 0
    fi
    if sudo -n test -r "$path" >/dev/null 2>&1; then
        sudo -n cat "$path" | tr -d '[:space:]'
        return 0
    fi
    return 1
}

dir_is_readable() {
    local path="$1"
    [[ -d "$path" && -r "$path" && -x "$path" ]] && return 0
    sudo -n test -d "$path" >/dev/null 2>&1
}

latest_backup_line() {
    local path="$1"
    if [[ -d "$path" && -r "$path" && -x "$path" ]]; then
        find "$path" -maxdepth 1 -type f \
            \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.dump' -o -name 'backup_*.sql' -o -name 'easelect_*.sql.gz' \) \
            -size +0c -printf '%T@\t%p\n' 2>/dev/null
        return 0
    fi
    if sudo -n test -d "$path" >/dev/null 2>&1; then
        sudo -n find "$path" -maxdepth 1 -type f \
            \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.dump' -o -name 'backup_*.sql' -o -name 'easelect_*.sql.gz' \) \
            -size +0c -printf '%T@\t%p\n' 2>/dev/null
        return 0
    fi
    return 1
}

file_size_human() {
    local path="$1"
    local size

    size="$(du -h "$path" 2>/dev/null | awk 'NR == 1 { print $1 }')"
    if [[ -n "$size" ]]; then
        printf '%s' "$size"
        return 0
    fi
    sudo -n du -h "$path" 2>/dev/null | awk 'NR == 1 { print $1 }'
}

file_sha256() {
    local path="$1"
    local value

    if command -v sha256sum >/dev/null 2>&1; then
        value="$(sha256sum "$path" 2>/dev/null | awk 'NR == 1 { print $1 }')"
        if [[ -n "$value" ]]; then
            printf '%s' "$value"
            return 0
        fi
        sudo -n sha256sum "$path" 2>/dev/null | awk 'NR == 1 { print $1 }'
    fi
}

printf 'Discovered SSH evidence for the non-live restore rehearsal plan:\n'
printf '  - Source checkout app/DB: %s / %s\n' "${expected_app_version:-<unknown>}" "${expected_db_version:-<unknown>}"

if [[ -n "$release_root" ]]; then
    current_link="${release_root%/}/current"
    if path_is_link "$current_link"; then
        current_target="$(resolve_link "$current_link")"
        printf '  - Current release target: %s\n' "${current_target:-<unresolved>}"
        if [[ -n "$current_target" ]]; then
            current_app_version="$(read_trimmed_file "$current_target/VERSION_APP" || true)"
            current_db_version="$(read_trimmed_file "$current_target/VERSION_DB" || true)"
        fi
        if [[ -n "${current_app_version:-}" && -n "${current_db_version:-}" ]]; then
            printf '  - Current release app/DB: %s / %s\n' "${current_app_version:-<empty>}" "${current_db_version:-<empty>}"
        else
            printf '  - Current release app/DB: <not readable from provided release root>\n'
        fi
    else
        printf '  - Current release target: <no current symlink at %s>\n' "$current_link"
    fi
else
    printf '  - Current release target: <no --release-root provided>\n'
fi

if [[ -n "$backup_dir" ]] && dir_is_readable "$backup_dir"; then
    latest_line="$(latest_backup_line "$backup_dir" | sort -nr | head -n 1)"
    latest_file="${latest_line#*$'\t'}"
    if [[ -n "$latest_line" && "$latest_file" != "$latest_line" ]]; then
        latest_size="$(file_size_human "$latest_file")"
        latest_sha256="$(file_sha256 "$latest_file")"
        printf '  - Latest backup artifact: %s (%s)\n' "$latest_file" "${latest_size:-unknown size}"
        if [[ -n "$latest_sha256" ]]; then
            printf '  - Latest backup SHA256: %s\n' "$latest_sha256"
        fi
    else
        printf '  - Latest backup artifact: <none found in %s>\n' "$backup_dir"
    fi
elif [[ -n "$backup_dir" ]]; then
    printf '  - Latest backup artifact: <backup dir missing or unreadable: %s>\n' "$backup_dir"
else
    printf '  - Latest backup artifact: <no --backup-dir provided>\n'
fi
REMOTE
    then
        cat "$output_file"
    else
        printf 'Discovered SSH evidence for the non-live restore rehearsal plan:\n'
        printf '  - SSH evidence could not be read from %s\n' "$SSH_TARGET"
        sed 's/^/    /' "$error_file" >&2
    fi
    rm -f "$output_file" "$error_file"
}

print_restore_rehearsal_plan() {
    cat <<PLAN

Non-live first-cloud DB restore rehearsal plan:
  Safety boundary:
  - This output is a plan only. The helper does not run DB restore commands,
    copy backup files, create/drop databases, edit env files, repoint symlinks,
    restart services, or touch the live database.
  - AI agents must not run live DB restores or direct SQL mutations. A human or
    approved operator owns the actual non-live restore rehearsal.
  - The rehearsal target must be disposable and separate from the live
    /opt/filterest/current service and live production database.

PLAN

    if [[ -n "$SSH_TARGET" ]]; then
        print_remote_restore_rehearsal_inputs "$RELEASE_ROOT" "$BACKUP_DIR"
    else
        print_local_restore_rehearsal_inputs "$RELEASE_ROOT" "$BACKUP_DIR"
    fi

    cat <<PLAN

Required non-live inputs before the operator starts:
  1. A disposable DB target whose name clearly marks it as non-live.
  2. A non-live app release root or temporary checkout matching the app/DB pair
     being rehearsed.
  3. A copied backup artifact from the path above, handled outside this helper.
  4. A copied env file with DB_HOST/DB_PORT/DB_NAME/DB_* credentials rewritten
     for the disposable DB only; do not reuse the live DB identity.
  5. A private or loopback base URL for the non-live app so /system/ready and
     /system/instance-status can be recorded after startup.

Operator-owned rehearsal sequence:
  1. Preserve the live system unchanged and record the exact backup artifact,
     source app version, source DB version, and intended rollback release pair.
  2. Restore the selected backup into the disposable non-live DB using the
     project's approved human/operator restore procedure.
  3. Start the matching app release against that disposable DB and isolated
     storage/env inputs.
  4. Verify the non-live app with runtime-safety, edge-status if applicable, and
     recovery-readiness checks pointed only at the non-live target.
  5. Attach the restore log, non-live /system/ready JSON, non-live
     /system/instance-status JSON, and this plan output to #839.

Completion evidence expected for #839 B6:
  - The backup artifact identity and integrity are recorded.
  - The non-live DB target identity is recorded and is not the live DB.
  - The restore result is recorded by the human/operator.
  - The restored non-live app reports ready=true and db_compatible=true.
  - Any live app+DB rollback remains a separate human/operator emergency action.
PLAN
}

check_repo_recovery_inputs() {
    info "checking repository recovery runbook inputs"
    check_repo_file "server_tools/deploy_to_production.sh" "native deploy script" "$REQUIRE_REPO_RUNBOOKS"
    check_repo_file "server_tools/daily_backup.sh" "native daily backup script" "$REQUIRE_REPO_RUNBOOKS"
    check_repo_file "server_tools/check_first_cloud_runtime_safety.sh" "first-cloud runtime safety helper" "$REQUIRE_REPO_RUNBOOKS"
    check_repo_file "server_tools/versioning/app_db_compatibility.jsonl" "app/DB compatibility manifest" "$REQUIRE_REPO_RUNBOOKS"
    check_repo_file "docs/instructions_and_documentation/Production_Deployment.md" "production deployment guide" "$REQUIRE_REPO_RUNBOOKS"
    check_repo_file "docs/instructions_and_documentation/Logging_and_Observability.md" "logging and observability guide" "$REQUIRE_REPO_RUNBOOKS"
    check_repo_file "docs/instructions_and_documentation/Human_QA_Handoff.md" "acceptance evidence guide" "$REQUIRE_REPO_RUNBOOKS"

    check_doc_pattern \
        "docs/instructions_and_documentation/Production_Deployment.md" \
        "First Cloud Recovery Readiness|check_first_cloud_recovery_readiness\\.sh" \
        "first-cloud recovery readiness" \
        "$REQUIRE_REPO_RUNBOOKS"
    check_doc_pattern \
        "docs/instructions_and_documentation/Production_Deployment.md" \
        "restore rehearsal|print-restore-rehearsal-plan" \
        "non-live restore rehearsal plan" \
        "$REQUIRE_REPO_RUNBOOKS"
    check_doc_pattern \
        "docs/instructions_and_documentation/Cloud_And_Open_Source_Readiness_Checklist.md" \
        "check_first_cloud_recovery_readiness\\.sh|B6 - Backup, Restore, Rollback" \
        "#839 B6 recovery gate" \
        "$REQUIRE_REPO_RUNBOOKS"
    check_doc_pattern \
        "docs/instructions_and_documentation/Logging_and_Observability.md" \
        "first cloud recovery|recovery readiness|operator status" \
        "operator recovery observability" \
        "$REQUIRE_REPO_RUNBOOKS"

    run_manifest_validation
}

check_release_root() {
    local root="$1"
    local current_link
    local current_target
    local rollback_count
    local release_dir
    local release_name

    if [[ -z "$root" ]]; then
        path_missing_result "$REQUIRE_RELEASE_ROOT" "no --release-root provided; skipping release-root/current rollback evidence"
        return
    fi

    info "checking release root ${root}"
    if [[ ! -d "$root" ]]; then
        path_missing_result "$REQUIRE_RELEASE_ROOT" "release root is missing or not a directory: ${root}"
        return
    fi
    pass_check "release root exists: ${root}"

    current_link="${root%/}/current"
    if [[ ! -L "$current_link" ]]; then
        path_missing_result "$REQUIRE_RELEASE_ROOT" "current release symlink is missing: ${current_link}"
        return
    fi
    current_target="$(readlink -f "$current_link" 2>/dev/null || true)"
    if [[ -z "$current_target" || ! -d "$current_target" ]]; then
        path_missing_result "$REQUIRE_RELEASE_ROOT" "current release symlink target is not a directory: ${current_link}"
        return
    fi
    pass_check "current release symlink resolves to ${current_target}"

    if [[ -r "$current_target/VERSION_APP" && -r "$current_target/VERSION_DB" ]]; then
        local current_app_version
        local current_db_version

        current_app_version="$(tr -d '[:space:]' <"$current_target/VERSION_APP" 2>/dev/null || true)"
        current_db_version="$(tr -d '[:space:]' <"$current_target/VERSION_DB" 2>/dev/null || true)"
        pass_check "current release carries VERSION_APP=${current_app_version:-<empty>} and VERSION_DB=${current_db_version:-<empty>}"
        record_version_match_result "VERSION_APP" "$current_app_version" "$EXPECTED_APP_VERSION"
        record_version_match_result "VERSION_DB" "$current_db_version" "$EXPECTED_DB_VERSION"
    else
        fail_check "current release is missing VERSION_APP or VERSION_DB"
    fi

    record_protected_file_result "$current_target/environment_type.env" "current release environment_type.env"
    record_protected_file_result "$current_target/.env" "current release preserved .env"

    if [[ -x "$current_target/easelect" ]]; then
        pass_check "current release has executable easelect binary"
    else
        fail_check "current release is missing executable easelect binary"
    fi

    if [[ -d "$current_target/server_tools/migrations" ]]; then
        pass_check "current release carries migration files"
    else
        warn_check "current release does not carry server_tools/migrations"
    fi

    rollback_count=0
    while IFS= read -r release_dir; do
        [[ "$release_dir" == "$current_target" ]] && continue
        release_name="$(basename "$release_dir")"
        if [[ "$release_name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]]; then
            rollback_count=$((rollback_count + 1))
        fi
    done < <(find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)

    if [[ "$rollback_count" -gt 0 ]]; then
        pass_check "release root has ${rollback_count} previous timestamped rollback target(s)"
    else
        path_missing_result "$REQUIRE_ROLLBACK_TARGET" "release root has no previous timestamped rollback target"
    fi
}

check_backup_dir() {
    local dir="$1"
    local latest_line
    local latest_file
    local latest_size
    local latest_sha256

    if [[ -z "$dir" ]]; then
        path_missing_result "$REQUIRE_BACKUP" "no --backup-dir provided; skipping DB backup artifact evidence"
        return
    fi

    info "checking backup directory ${dir}"
    if [[ ! -d "$dir" ]]; then
        path_missing_result "$REQUIRE_BACKUP" "backup directory is missing: ${dir}"
        return
    fi
    if [[ ! -r "$dir" ]]; then
        path_missing_result "$REQUIRE_BACKUP" "backup directory is not readable: ${dir}"
        return
    fi
    pass_check "backup directory is readable: ${dir}"

    latest_line="$(
        find "$dir" -maxdepth 1 -type f \
            \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.dump' -o -name 'backup_*.sql' -o -name 'easelect_*.sql.gz' \) \
            -size +0c -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1
    )"
    latest_file="${latest_line#* }"
    if [[ -z "$latest_line" || "$latest_file" == "$latest_line" || ! -f "$latest_file" ]]; then
        path_missing_result "$REQUIRE_BACKUP" "no non-empty SQL/custom backup artifact found in ${dir}"
        return
    fi

    latest_size="$(du -h "$latest_file" 2>/dev/null | awk '{print $1}')"
    pass_check "latest backup artifact exists: ${latest_file} (${latest_size:-unknown size})"
    if command -v sha256sum >/dev/null 2>&1; then
        latest_sha256="$(sha256sum "$latest_file" 2>/dev/null | awk '{print $1}')"
        if [[ -n "$latest_sha256" ]]; then
            pass_check "latest backup artifact sha256=${latest_sha256}"
        else
            warn_check "latest backup artifact SHA256 was not available"
        fi
    else
        warn_check "sha256sum is not available; backup SHA256 was not recorded"
    fi

    if [[ "$latest_file" == *.gz ]]; then
        if command -v gzip >/dev/null 2>&1; then
            check_gzip_integrity "$latest_file" "latest gzip backup"
        else
            warn_check "gzip is not available; compressed backup integrity was not tested"
        fi
    fi
}

check_storage_root() {
    local root="$1"
    local label="${2:-storage root}"
    local required="${3:-$REQUIRE_STORAGE_ROOT}"
    local option_name="${4:---storage-root}"
    local top_count
    local df_line

    if [[ -z "$root" ]]; then
        path_missing_result "$required" "no ${option_name} provided; skipping ${label} evidence"
        return
    fi

    info "checking ${label} ${root}"
    if [[ ! -d "$root" ]]; then
        path_missing_result "$required" "${label} is missing: ${root}"
        return
    fi
    if [[ ! -r "$root" ]]; then
        path_missing_result "$required" "${label} is not readable: ${root}"
        return
    fi
    top_count="$(find "$root" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
    pass_check "${label} is readable with ${top_count} top-level item(s)"

    df_line="$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print "available_kb="$4" used_percent="$5" mount="$6}')"
    if [[ -n "$df_line" ]]; then
        pass_check "${label} filesystem reports ${df_line}"
    else
        warn_check "${label} filesystem free-space check was unavailable"
    fi
}

parse_remote_report() {
    local output_file="$1"
    local prefix="$2"
    local line
    local level
    local message

    while IFS=$'\t' read -r level message; do
        [[ -z "${level:-}" ]] && continue
        if [[ -n "$prefix" && -n "${message:-}" ]]; then
            record_report_line "$level" "${prefix}: ${message}"
        else
            record_report_line "$level" "${message:-$level}"
        fi
    done <"$output_file"
}

check_remote_release_root() {
    local root="$1"
    local output_file
    local error_file

    if [[ -z "$root" ]]; then
        path_missing_result "$REQUIRE_RELEASE_ROOT" "no --release-root provided; skipping SSH release-root/current rollback evidence"
        return
    fi

    output_file="$(mktemp)"
    error_file="$(mktemp)"
    info "checking release root ${root:-<none>} over SSH ${SSH_TARGET}"
    if ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" -- \
        "$root" "$REQUIRE_RELEASE_ROOT" "$REQUIRE_ROLLBACK_TARGET" \
        "$EXPECTED_APP_VERSION" "$EXPECTED_DB_VERSION" "$REQUIRE_CURRENT_VERSION_MATCH" >"$output_file" 2>"$error_file" <<'REMOTE'
root="$1"
require_release_root="$2"
require_rollback_target="$3"
expected_app_version="$4"
expected_db_version="$5"
require_current_version_match="$6"

pass() { printf 'PASS\t%s\n' "$1"; }
warn() { printf 'WARN\t%s\n' "$1"; }
fail() { printf 'FAIL\t%s\n' "$1"; }
path_missing_result() {
    if [[ "$1" == true ]]; then
        fail "$2"
    else
        warn "$2"
    fi
}
path_is_dir() {
    [[ -d "$1" ]] || sudo -n test -d "$1" 2>/dev/null
}
path_is_link() {
    [[ -L "$1" ]] || sudo -n test -L "$1" 2>/dev/null
}
path_is_readable() {
    [[ -r "$1" ]] || sudo -n test -r "$1" 2>/dev/null
}
path_is_executable() {
    [[ -x "$1" ]] || sudo -n test -x "$1" 2>/dev/null
}
read_protected_file() {
    if [[ -r "$1" ]]; then
        tr -d '[:space:]' <"$1"
    else
        sudo -n cat "$1" | tr -d '[:space:]'
    fi
}
readlink_protected() {
    readlink -f "$1" 2>/dev/null || sudo -n readlink -f "$1" 2>/dev/null || true
}
version_match_result() {
    label="$1"
    actual="$2"
    expected="$3"
    if [[ -z "$expected" ]]; then
        warn "source ${label} could not be read for release version comparison"
        return
    fi
    if [[ "$actual" == "$expected" ]]; then
        pass "current release ${label} matches source ${label}: ${actual}"
        return
    fi
    path_missing_result \
        "$require_current_version_match" \
        "current release ${label}=${actual:-<empty>} differs from source ${label}=${expected}"
}
protected_file_result() {
    path="$1"
    label="$2"
    if [[ -r "$path" ]]; then
        pass "${label} exists and is readable without printing contents"
        return
    fi
    if sudo -n test -r "$path" 2>/dev/null; then
        pass "${label} exists and is readable via sudo without printing contents"
        return
    fi
    if [[ -e "$path" ]]; then
        pass "${label} exists and is protected from the current SSH/user context"
        return
    fi
    if sudo -n test -e "$path" 2>/dev/null; then
        pass "${label} exists and is protected from the current SSH/user context"
        return
    fi
    warn "${label} was not found"
}

if ! path_is_dir "$root"; then
    path_missing_result "$require_release_root" "release root is missing or not a directory: ${root}"
    exit 0
fi
pass "release root exists: ${root}"

current_link="${root%/}/current"
if ! path_is_link "$current_link"; then
    path_missing_result "$require_release_root" "current release symlink is missing: ${current_link}"
    exit 0
fi
current_target="$(readlink_protected "$current_link")"
if [[ -z "$current_target" ]] || ! path_is_dir "$current_target"; then
    path_missing_result "$require_release_root" "current release symlink target is not a directory: ${current_link}"
    exit 0
fi
pass "current release symlink resolves to ${current_target}"

if path_is_readable "$current_target/VERSION_APP" && path_is_readable "$current_target/VERSION_DB"; then
    current_app_version="$(read_protected_file "$current_target/VERSION_APP" 2>/dev/null || true)"
    current_db_version="$(read_protected_file "$current_target/VERSION_DB" 2>/dev/null || true)"
    pass "current release carries VERSION_APP=${current_app_version:-<empty>} and VERSION_DB=${current_db_version:-<empty>}"
    version_match_result "VERSION_APP" "$current_app_version" "$expected_app_version"
    version_match_result "VERSION_DB" "$current_db_version" "$expected_db_version"
else
    fail "current release is missing VERSION_APP or VERSION_DB"
fi

protected_file_result "$current_target/environment_type.env" "current release environment_type.env"
protected_file_result "$current_target/.env" "current release preserved .env"

if path_is_executable "$current_target/easelect"; then
    pass "current release has executable easelect binary"
else
    fail "current release is missing executable easelect binary"
fi

if path_is_dir "$current_target/server_tools/migrations"; then
    pass "current release carries migration files"
else
    warn "current release does not carry server_tools/migrations"
fi

rollback_count=0
while IFS= read -r release_dir; do
    [[ "$release_dir" == "$current_target" ]] && continue
    release_name="$(basename "$release_dir")"
    if [[ "$release_name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]]; then
        rollback_count=$((rollback_count + 1))
    fi
done < <((find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null || sudo -n find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null) | sort)

if [[ "$rollback_count" -gt 0 ]]; then
    pass "release root has ${rollback_count} previous timestamped rollback target(s)"
else
    path_missing_result "$require_rollback_target" "release root has no previous timestamped rollback target"
fi
REMOTE
    then
        parse_remote_report "$output_file" "ssh ${SSH_TARGET}"
    else
        fail_check "ssh ${SSH_TARGET}: release-root check failed"
        sed 's/^/  /' "$error_file" >&2
    fi
    rm -f "$output_file" "$error_file"
}

check_remote_backup_dir() {
    local dir="$1"
    local output_file
    local error_file

    if [[ -z "$dir" ]]; then
        path_missing_result "$REQUIRE_BACKUP" "no --backup-dir provided; skipping SSH DB backup artifact evidence"
        return
    fi

    output_file="$(mktemp)"
    error_file="$(mktemp)"
    info "checking backup directory ${dir:-<none>} over SSH ${SSH_TARGET}"
    if ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" -- \
        "$dir" "$REQUIRE_BACKUP" >"$output_file" 2>"$error_file" <<'REMOTE'
dir="$1"
require_backup="$2"

pass() { printf 'PASS\t%s\n' "$1"; }
warn() { printf 'WARN\t%s\n' "$1"; }
fail() { printf 'FAIL\t%s\n' "$1"; }
path_missing_result() {
    if [[ "$1" == true ]]; then
        fail "$2"
    else
        warn "$2"
    fi
}
check_gzip_integrity() {
    gzip_file="$1"
    label="$2"
    output_file="$(mktemp)"
    if gzip -t "$gzip_file" >"$output_file" 2>&1; then
        pass "${label} passes integrity test"
        rm -f "$output_file"
        return
    fi
    if [[ ! -r "$gzip_file" ]] && command -v sudo >/dev/null 2>&1; then
        if sudo -n gzip -t "$gzip_file" >"$output_file" 2>&1; then
            pass "${label} passes integrity test via sudo read-only access"
            rm -f "$output_file"
            return
        fi
    fi
    if [[ ! -r "$gzip_file" ]]; then
        fail "${label} could not be integrity-tested because it is not readable and sudo read-only gzip test was unavailable: ${gzip_file}"
    else
        fail "${label} failed integrity test: ${gzip_file}"
    fi
    rm -f "$output_file"
}
file_sha256() {
    path="$1"
    value=""
    if command -v sha256sum >/dev/null 2>&1; then
        value="$(sha256sum "$path" 2>/dev/null | awk 'NR == 1 { print $1 }')"
        if [[ -n "$value" ]]; then
            printf '%s' "$value"
            return 0
        fi
        sudo -n sha256sum "$path" 2>/dev/null | awk 'NR == 1 { print $1 }'
    fi
}

if [[ ! -d "$dir" ]]; then
    if sudo -n test -d "$dir" 2>/dev/null; then
        :
    else
        path_missing_result "$require_backup" "backup directory is missing: ${dir}"
        exit 0
    fi
fi
read_mode="direct"
if [[ ! -r "$dir" ]]; then
    if sudo -n test -r "$dir" 2>/dev/null; then
        read_mode="sudo"
    else
        path_missing_result "$require_backup" "backup directory is not readable: ${dir}"
        exit 0
    fi
fi
if [[ "$read_mode" == "sudo" ]]; then
    pass "backup directory is readable via sudo read-only access: ${dir}"
else
    pass "backup directory is readable: ${dir}"
fi

if [[ "$read_mode" == "sudo" ]]; then
    latest_line="$(
        sudo -n find "$dir" -maxdepth 1 -type f \
            \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.dump' -o -name 'backup_*.sql' -o -name 'easelect_*.sql.gz' \) \
            -size +0c -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1
    )"
else
    latest_line="$(
        find "$dir" -maxdepth 1 -type f \
            \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.dump' -o -name 'backup_*.sql' -o -name 'easelect_*.sql.gz' \) \
            -size +0c -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1
    )"
fi
latest_file="${latest_line#* }"
if [[ -z "$latest_line" || "$latest_file" == "$latest_line" ]]; then
    path_missing_result "$require_backup" "no non-empty SQL/custom backup artifact found in ${dir}"
    exit 0
fi
if [[ "$read_mode" == "sudo" ]]; then
    sudo -n test -f "$latest_file" 2>/dev/null || {
        path_missing_result "$require_backup" "no non-empty SQL/custom backup artifact found in ${dir}"
        exit 0
    }
elif [[ ! -f "$latest_file" ]]; then
    path_missing_result "$require_backup" "no non-empty SQL/custom backup artifact found in ${dir}"
    exit 0
fi

if [[ "$read_mode" == "sudo" ]]; then
    latest_size="$(sudo -n du -h "$latest_file" 2>/dev/null | awk '{print $1}')"
else
    latest_size="$(du -h "$latest_file" 2>/dev/null | awk '{print $1}')"
fi
pass "latest backup artifact exists: ${latest_file} (${latest_size:-unknown size})"
if command -v sha256sum >/dev/null 2>&1; then
    latest_sha256="$(file_sha256 "$latest_file")"
    if [[ -n "$latest_sha256" ]]; then
        pass "latest backup artifact sha256=${latest_sha256}"
    else
        warn "latest backup artifact SHA256 was not available"
    fi
else
    warn "sha256sum is not available; backup SHA256 was not recorded"
fi

if [[ "$latest_file" == *.gz ]]; then
    if command -v gzip >/dev/null 2>&1; then
        check_gzip_integrity "$latest_file" "latest gzip backup"
    else
        warn "gzip is not available; compressed backup integrity was not tested"
    fi
fi
REMOTE
    then
        parse_remote_report "$output_file" "ssh ${SSH_TARGET}"
    else
        fail_check "ssh ${SSH_TARGET}: backup directory check failed"
        sed 's/^/  /' "$error_file" >&2
    fi
    rm -f "$output_file" "$error_file"
}

check_remote_storage_root() {
    local root="$1"
    local label="${2:-storage root}"
    local required="${3:-$REQUIRE_STORAGE_ROOT}"
    local option_name="${4:---storage-root}"
    local output_file
    local error_file

    if [[ -z "$root" ]]; then
        path_missing_result "$required" "no ${option_name} provided; skipping SSH ${label} evidence"
        return
    fi

    output_file="$(mktemp)"
    error_file="$(mktemp)"
    info "checking ${label} ${root:-<none>} over SSH ${SSH_TARGET}"
    if ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" -- \
        "$root" "$required" "$label" >"$output_file" 2>"$error_file" <<'REMOTE'
root="$1"
require_storage_root="$2"
label="$3"

pass() { printf 'PASS\t%s\n' "$1"; }
warn() { printf 'WARN\t%s\n' "$1"; }
fail() { printf 'FAIL\t%s\n' "$1"; }
path_missing_result() {
    if [[ "$1" == true ]]; then
        fail "$2"
    else
        warn "$2"
    fi
}

if [[ ! -d "$root" ]]; then
    if sudo -n test -d "$root" 2>/dev/null; then
        :
    else
        path_missing_result "$require_storage_root" "${label} is missing: ${root}"
        exit 0
    fi
fi
read_mode="direct"
if [[ ! -r "$root" ]]; then
    if sudo -n test -r "$root" 2>/dev/null; then
        read_mode="sudo"
    else
        path_missing_result "$require_storage_root" "${label} is not readable: ${root}"
        exit 0
    fi
fi
if [[ "$read_mode" == "sudo" ]]; then
    top_count="$(sudo -n find "$root" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
    pass "${label} is readable via sudo read-only access with ${top_count} top-level item(s)"
    df_line="$(sudo -n df -Pk "$root" 2>/dev/null | awk 'NR==2 {print "available_kb="$4" used_percent="$5" mount="$6}')"
else
    top_count="$(find "$root" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
    pass "${label} is readable with ${top_count} top-level item(s)"
    df_line="$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print "available_kb="$4" used_percent="$5" mount="$6}')"
fi
if [[ -n "$df_line" ]]; then
    pass "${label} filesystem reports ${df_line}"
else
    warn "${label} filesystem free-space check was unavailable"
fi
REMOTE
    then
        parse_remote_report "$output_file" "ssh ${SSH_TARGET}"
    else
        fail_check "ssh ${SSH_TARGET}: ${label} check failed"
        sed 's/^/  /' "$error_file" >&2
    fi
    rm -f "$output_file" "$error_file"
}

check_remote_systemd_service() {
    local service_name="$1"
    local output_file
    local error_file

    if [[ -z "$service_name" ]]; then
        return
    fi

    output_file="$(mktemp)"
    error_file="$(mktemp)"
    info "checking systemd service ${service_name} over SSH ${SSH_TARGET}"
    if ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" -- \
        "$service_name" "$REQUIRE_SERVICE_ACTIVE" >"$output_file" 2>"$error_file" <<'REMOTE'
service_name="$1"
require_service_active="$2"

pass() { printf 'PASS\t%s\n' "$1"; }
warn() { printf 'WARN\t%s\n' "$1"; }
fail() { printf 'FAIL\t%s\n' "$1"; }
path_missing_result() {
    if [[ "$1" == true ]]; then
        fail "$2"
    else
        warn "$2"
    fi
}

if ! command -v systemctl >/dev/null 2>&1; then
    path_missing_result "$require_service_active" "systemctl is not available for service status evidence"
    exit 0
fi

state="$(systemctl is-active "$service_name" 2>/dev/null || true)"
if [[ "$state" == "active" ]]; then
    pass "systemd service ${service_name} is active"
else
    path_missing_result "$require_service_active" "systemd service ${service_name} is ${state:-unknown}"
fi

if systemctl status "$service_name" --no-pager >/dev/null 2>&1; then
    pass "systemd service ${service_name} status is readable"
else
    warn "systemd service ${service_name} status was not readable"
fi

if command -v journalctl >/dev/null 2>&1; then
    if journalctl -u "$service_name" -n 1 --no-pager >/dev/null 2>&1; then
        pass "journalctl is readable for ${service_name}"
    else
        warn "journalctl was not readable for ${service_name}"
    fi
else
    warn "journalctl is not available for service log evidence"
fi
REMOTE
    then
        parse_remote_report "$output_file" "ssh ${SSH_TARGET}"
    else
        fail_check "ssh ${SSH_TARGET}: systemd service check failed"
        sed 's/^/  /' "$error_file" >&2
    fi
    rm -f "$output_file" "$error_file"
}

json_field_report() {
    local json_file="$1"
    local payload_kind="$2"

    python3 - "$json_file" "$payload_kind" <<'PY'
import json
import sys

path, payload_kind = sys.argv[1], sys.argv[2]
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception as exc:
    print(f"FAIL\t{payload_kind}: response was not valid JSON: {exc}")
    raise SystemExit(0)

def truthy(value):
    return value is True or str(value).lower() == "true"

if payload_kind == "ready":
    if truthy(data.get("ready")):
        print("PASS\t/system/ready reports ready=true")
    else:
        print(f"FAIL\t/system/ready reports ready={data.get('ready')} reasons={data.get('reasons', [])}")

    if truthy(data.get("db_compatible")):
        print("PASS\t/system/ready reports db_compatible=true")
    else:
        print(f"FAIL\t/system/ready reports db_compatible={data.get('db_compatible')}")

    if truthy(data.get("accepting_new_work")):
        print("PASS\t/system/ready reports accepting_new_work=true")
    else:
        print(f"WARN\t/system/ready reports accepting_new_work={data.get('accepting_new_work')}")

elif payload_kind == "instance-status":
    app_version = str(data.get("app_version") or "").strip()
    db_version = str(data.get("db_version") or "").strip()
    desired_state = str(data.get("desired_state") or data.get("desired_state_seen_by_app") or "").strip()
    drain_state = str(data.get("drain_state") or "").strip()
    storage_root = str(data.get("storage_root") or "").strip()
    active_requests = data.get("active_requests")
    active_long_jobs = data.get("active_long_jobs")
    background_worker_role = str(data.get("background_worker_role") or "").strip()

    if app_version and db_version:
        print(f"PASS\t/system/instance-status reports app_version={app_version} db_version={db_version}")
    else:
        print("WARN\t/system/instance-status did not report both app_version and db_version")

    if desired_state:
        print(f"PASS\t/system/instance-status reports desired_state={desired_state}")
    else:
        print("WARN\t/system/instance-status did not report desired_state")

    if drain_state:
        print(f"PASS\t/system/instance-status reports drain_state={drain_state}")
    else:
        print("WARN\t/system/instance-status did not report drain_state")

    if storage_root:
        print(f"PASS\t/system/instance-status reports storage_root={storage_root}")
    else:
        print("WARN\t/system/instance-status did not report storage_root")

    if active_requests is not None:
        print(f"PASS\t/system/instance-status reports active_requests={active_requests}")
    else:
        print("WARN\t/system/instance-status did not report active_requests")

    if active_long_jobs is not None:
        print(f"PASS\t/system/instance-status reports active_long_jobs={active_long_jobs}")
    else:
        print("WARN\t/system/instance-status did not report active_long_jobs")

    if background_worker_role and background_worker_role != "unspecified":
        print(f"PASS\t/system/instance-status reports background_worker_role={background_worker_role}")
    else:
        print("WARN\t/system/instance-status reports background_worker_role as unspecified")
PY
}

record_report_line() {
    local level="$1"
    local message="$2"

    case "$level" in
        PASS) pass_check "$message" ;;
        WARN) warn_check "$message" ;;
        FAIL) fail_check "$message" ;;
        *) info "$message" ;;
    esac
}

json_storage_root_value() {
    local json_file="$1"

    python3 - "$json_file" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    raise SystemExit(0)

value = str(data.get("storage_root") or "").strip()
if value:
    print(value)
PY
}

check_remote_instance_status_storage_contract() {
    local body_file="$1"
    local reported_storage_root
    local output_file
    local error_file
    local level
    local message

    [[ -n "$STORAGE_ROOT" ]] || return

    reported_storage_root="$(json_storage_root_value "$body_file")"
    if [[ -z "$reported_storage_root" ]]; then
        fail_check "ssh ${SSH_TARGET}: /system/instance-status did not report storage_root for comparison with --storage-root"
        return
    fi

    output_file="$(mktemp)"
    error_file="$(mktemp)"
    if ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" -- \
        "$reported_storage_root" "$STORAGE_ROOT" >"$output_file" 2>"$error_file" <<'REMOTE'
reported_storage_root="$1"
expected_storage_root="$2"

resolve_path() {
    local path="$1"

    readlink -f "$path" 2>/dev/null && return 0
    sudo -n readlink -f "$path" 2>/dev/null && return 0
    realpath -m "$path" 2>/dev/null && return 0
    printf '%s\n' "$path"
}

reported_resolved="$(resolve_path "$reported_storage_root")"
expected_resolved="$(resolve_path "$expected_storage_root")"

if [[ "$reported_resolved" == "$expected_resolved" ]]; then
    printf 'PASS\t/system/instance-status storage_root resolves to expected --storage-root: %s -> %s\n' "$reported_storage_root" "$expected_resolved"
else
    printf 'FAIL\t/system/instance-status storage_root=%s resolves to %s, expected --storage-root=%s resolving to %s\n' \
        "$reported_storage_root" "$reported_resolved" "$expected_storage_root" "$expected_resolved"
fi
REMOTE
    then
        while IFS=$'\t' read -r level message; do
            [[ -z "${level:-}" ]] && continue
            record_report_line "$level" "ssh ${SSH_TARGET}: ${message}"
        done <"$output_file"
    else
        fail_check "ssh ${SSH_TARGET}: could not compare /system/instance-status storage_root with --storage-root"
        sed 's/^/  /' "$error_file" >&2
    fi

    rm -f "$output_file" "$error_file"
}

check_live_base_url() {
    local base_url="$1"
    local endpoint
    local url
    local tmp_file
    local http_code
    local level
    local message

    require_command curl || return
    require_command python3 || return

    info "checking live recovery status surface ${base_url}"
    for endpoint in ready instance-status; do
        url="${base_url%/}/system/${endpoint}"
        tmp_file="$(mktemp)"
        if ! http_code="$(curl -skS --max-time "$TIMEOUT_SECONDS" -o "$tmp_file" -w '%{http_code}' "$url" 2>/dev/null)"; then
            http_code="000"
        fi
        if [[ "$http_code" != "200" ]]; then
            fail_check "${url} returned HTTP ${http_code}"
            rm -f "$tmp_file"
            continue
        fi

        while IFS=$'\t' read -r level message; do
            [[ -z "${level:-}" ]] && continue
            record_report_line "$level" "$message"
        done < <(json_field_report "$tmp_file" "$endpoint")
        rm -f "$tmp_file"
    done
}

check_remote_live_base_url() {
    local base_url="$1"
    local endpoint
    local url
    local output_file
    local error_file
    local body_file
    local http_code
    local redirect_location
    local content_type
    local failure_detail
    local level
    local message

    require_command python3 || return

    info "checking remote live recovery status surface ${base_url} over SSH ${SSH_TARGET}"
    for endpoint in ready instance-status; do
        url="${base_url%/}/system/${endpoint}"
        output_file="$(mktemp)"
        error_file="$(mktemp)"
        body_file="$(mktemp)"

        if ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" -- \
            "$url" "$TIMEOUT_SECONDS" >"$output_file" 2>"$error_file" <<'REMOTE'
url="$1"
timeout_seconds="$2"
if ! command -v curl >/dev/null 2>&1; then
    printf 'curl command not found on remote host\n' >&2
    exit 127
fi
headers_file="$(mktemp)"
body_file="$(mktemp)"
trap 'rm -f "$headers_file" "$body_file"' EXIT
http_code="$(curl -skS --max-time "$timeout_seconds" -D "$headers_file" -o "$body_file" -w '%{http_code}' "$url")"
cat "$body_file"
printf '\n__HTTP_CODE__%s\n' "$http_code"
awk 'BEGIN { IGNORECASE=1 } /^Location:/ { sub(/\r$/, ""); sub(/^Location:[[:space:]]*/, ""); print "__LOCATION__"$0; exit }' "$headers_file"
awk 'BEGIN { IGNORECASE=1 } /^Content-Type:/ { sub(/\r$/, ""); sub(/^Content-Type:[[:space:]]*/, ""); print "__CONTENT_TYPE__"$0; exit }' "$headers_file"
REMOTE
        then
            http_code="$(awk -F'__HTTP_CODE__' '/^__HTTP_CODE__/ { code=$2 } END { print code }' "$output_file")"
            redirect_location="$(awk -F'__LOCATION__' '/^__LOCATION__/ { value=$2 } END { print value }' "$output_file")"
            content_type="$(awk -F'__CONTENT_TYPE__' '/^__CONTENT_TYPE__/ { value=$2 } END { print value }' "$output_file")"
            sed \
                -e '/^__HTTP_CODE__/d' \
                -e '/^__LOCATION__/d' \
                -e '/^__CONTENT_TYPE__/d' \
                "$output_file" >"$body_file"
            if [[ "$http_code" != "200" ]]; then
                failure_detail="ssh ${SSH_TARGET}: ${url} returned HTTP ${http_code:-unknown}"
                if [[ -n "$redirect_location" ]]; then
                    failure_detail="${failure_detail} location=${redirect_location}"
                fi
                if [[ -n "$content_type" ]]; then
                    failure_detail="${failure_detail} content_type=${content_type}"
                fi
                fail_check "$failure_detail"
            else
                while IFS=$'\t' read -r level message; do
                    [[ -z "${level:-}" ]] && continue
                    record_report_line "$level" "ssh ${SSH_TARGET}: ${message}"
                done < <(json_field_report "$body_file" "$endpoint")
                if [[ "$endpoint" == "instance-status" ]]; then
                    check_remote_instance_status_storage_contract "$body_file"
                fi
            fi
        else
            fail_check "ssh ${SSH_TARGET}: remote curl failed for ${url}"
            sed 's/^/  /' "$error_file" >&2
        fi

        rm -f "$output_file" "$error_file" "$body_file"
    done
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --release-root)
            [[ $# -ge 2 ]] || fail_usage "--release-root requires a path"
            RELEASE_ROOT="$2"
            shift 2
            ;;
        --backup-dir)
            [[ $# -ge 2 ]] || fail_usage "--backup-dir requires a path"
            BACKUP_DIR="$2"
            shift 2
            ;;
        --storage-root)
            [[ $# -ge 2 ]] || fail_usage "--storage-root requires a path"
            STORAGE_ROOT="$2"
            shift 2
            ;;
        --storage-deleted-root)
            [[ $# -ge 2 ]] || fail_usage "--storage-deleted-root requires a path"
            STORAGE_DELETED_ROOT="$2"
            shift 2
            ;;
        --base-url)
            [[ $# -ge 2 ]] || fail_usage "--base-url requires a URL"
            BASE_URLS+=("$2")
            shift 2
            ;;
        --remote-base-url)
            [[ $# -ge 2 ]] || fail_usage "--remote-base-url requires a URL"
            REMOTE_BASE_URLS+=("$2")
            shift 2
            ;;
        --ssh-target)
            [[ $# -ge 2 ]] || fail_usage "--ssh-target requires user@host"
            SSH_TARGET="$2"
            shift 2
            ;;
        --ssh-key)
            [[ $# -ge 2 ]] || fail_usage "--ssh-key requires a path"
            SSH_KEY="$2"
            shift 2
            ;;
        --service-name)
            [[ $# -ge 2 ]] || fail_usage "--service-name requires a systemd unit name"
            SYSTEMD_SERVICE="$2"
            shift 2
            ;;
        --timeout)
            [[ $# -ge 2 ]] || fail_usage "--timeout requires seconds"
            TIMEOUT_SECONDS="$2"
            shift 2
            ;;
        --require-release-root)
            REQUIRE_RELEASE_ROOT=true
            shift
            ;;
        --require-backup)
            REQUIRE_BACKUP=true
            shift
            ;;
        --require-storage-root)
            REQUIRE_STORAGE_ROOT=true
            shift
            ;;
        --require-storage-deleted-root)
            REQUIRE_STORAGE_DELETED_ROOT=true
            shift
            ;;
        --require-rollback-target)
            REQUIRE_ROLLBACK_TARGET=true
            shift
            ;;
        --require-repo-runbooks)
            REQUIRE_REPO_RUNBOOKS=true
            shift
            ;;
        --require-service-active)
            REQUIRE_SERVICE_ACTIVE=true
            shift
            ;;
        --require-current-version-match)
            REQUIRE_CURRENT_VERSION_MATCH=true
            shift
            ;;
        --skip-network)
            SKIP_NETWORK=true
            shift
            ;;
        --strict)
            STRICT=true
            shift
            ;;
        --print-operator-commands)
            PRINT_OPERATOR_COMMANDS=true
            shift
            ;;
        --print-restore-rehearsal-plan)
            PRINT_RESTORE_REHEARSAL_PLAN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail_usage "unknown option: $1"
            ;;
    esac
done

REQUIRE_CURRENT_VERSION_MATCH="$(normalize_bool "$REQUIRE_CURRENT_VERSION_MATCH")"
is_positive_integer "$TIMEOUT_SECONDS" || fail_usage "--timeout must be a positive integer"
if [[ -n "$SSH_KEY" && ! -r "$SSH_KEY" ]]; then
    fail_usage "--ssh-key is not readable: ${SSH_KEY}"
fi
if [[ -n "$SYSTEMD_SERVICE" && -z "$SSH_TARGET" ]]; then
    fail_usage "--service-name requires --ssh-target"
fi
if [[ "${#REMOTE_BASE_URLS[@]}" -gt 0 && -z "$SSH_TARGET" ]]; then
    fail_usage "--remote-base-url requires --ssh-target"
fi
if [[ "$REQUIRE_SERVICE_ACTIVE" == true && -z "$SYSTEMD_SERVICE" ]]; then
    fail_usage "--require-service-active requires --service-name"
fi
if [[ -n "$SSH_TARGET" ]]; then
    require_command ssh >/dev/null
    build_ssh_args
fi

if [[ -z "$BACKUP_DIR" && -n "$RELEASE_ROOT" ]]; then
    BACKUP_DIR="${RELEASE_ROOT%/}/backups"
fi

info "Easelect first-cloud recovery readiness check is non-mutating."
info "AI agents must not run DB restores or direct SQL mutations; restore drills are human/operator-owned."

if [[ "$PRINT_OPERATOR_COMMANDS" == true ]]; then
    print_operator_commands
fi
if [[ "$PRINT_RESTORE_REHEARSAL_PLAN" == true ]]; then
    print_restore_rehearsal_plan
fi

check_repo_recovery_inputs
if [[ -n "$SSH_TARGET" ]]; then
    check_remote_release_root "$RELEASE_ROOT"
    check_remote_backup_dir "$BACKUP_DIR"
    check_remote_storage_root "$STORAGE_ROOT" "storage-root" "$REQUIRE_STORAGE_ROOT" "--storage-root"
    if [[ -n "$STORAGE_DELETED_ROOT" || "$REQUIRE_STORAGE_DELETED_ROOT" == true ]]; then
        check_remote_storage_root "$STORAGE_DELETED_ROOT" "storage_deleted-root" "$REQUIRE_STORAGE_DELETED_ROOT" "--storage-deleted-root"
    fi
    check_remote_systemd_service "$SYSTEMD_SERVICE"
else
    check_release_root "$RELEASE_ROOT"
    check_backup_dir "$BACKUP_DIR"
    check_storage_root "$STORAGE_ROOT" "storage-root" "$REQUIRE_STORAGE_ROOT" "--storage-root"
    if [[ -n "$STORAGE_DELETED_ROOT" || "$REQUIRE_STORAGE_DELETED_ROOT" == true ]]; then
        check_storage_root "$STORAGE_DELETED_ROOT" "storage_deleted-root" "$REQUIRE_STORAGE_DELETED_ROOT" "--storage-deleted-root"
    fi
fi

if [[ "$SKIP_NETWORK" == true ]]; then
    warn_check "network checks skipped by request"
elif [[ "${#BASE_URLS[@]}" -eq 0 && "${#REMOTE_BASE_URLS[@]}" -eq 0 ]]; then
    warn_check "no --base-url provided; skipping live /system recovery status evidence"
else
    for base_url in "${BASE_URLS[@]}"; do
        check_live_base_url "$base_url"
    done
    for base_url in "${REMOTE_BASE_URLS[@]}"; do
        check_remote_live_base_url "$base_url"
    done
fi

printf '\nSummary: checks=%d warnings=%d failures=%d\n' "$CHECKS_RUN" "$WARNINGS" "$FAILURES"

if [[ "$STRICT" == true && "$WARNINGS" -gt 0 ]]; then
    printf '[FAIL] --strict treats %d warning(s) as blocking\n' "$WARNINGS" >&2
    exit 1
fi

if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
fi

exit 0
