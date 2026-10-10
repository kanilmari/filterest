#!/bin/bash
# instance_backup.sh
# Creates checked instance backups and restores through a verified replacement.
# Connects operator confirmation, read-only prerequisites and Docker lifecycle.
# Existing restore input refusals precede shutdown; live verification stays intact.

if ! declare -F filterest_recovery_diagnostic >/dev/null; then
    source "${BASH_SOURCE[0]%/*}/../../lib/installation_records.sh"
fi

if [[ -n "${FILTEREST_SOURCE_ROOT:-${PROJECT_ROOT:-}}" && -f "${FILTEREST_SOURCE_ROOT:-$PROJECT_ROOT}/server_tools/lib/sql_dump_policy.sh" ]]; then
    # shellcheck source=/dev/null
    source "${FILTEREST_SOURCE_ROOT:-$PROJECT_ROOT}/server_tools/lib/sql_dump_policy.sh"
fi

INSTANCE_BACKUP_DEFAULT_EXCLUDE_TABLE_DATA=(
    public.system_log
    public.system_audit_log
    public.system_transaction_log
    public.ai_usage_logs
    public.mcp_query_log
    public.deletion_log
)

# ------------------------------------------------------------------------------
# Validate a caller-owned instance backup flag array name before dynamic access.
# Between backup helpers and their output arrays it makes Bash 3.2-compatible
# eval safe. Why: macOS /bin/bash has no nameref support.
# ------------------------------------------------------------------------------
_validate_instance_backup_flags_array_name() {
    local output_var_name="$1"

    if [[ ! "$output_var_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        echo "error: invalid instance backup output array name: ${output_var_name}" >&2
        return 2
    fi
}

# ------------------------------------------------------------------------------
# Build per-table pg_dump flags for an instance backup when metadata is available.
# Between the instance database and pg_dump it translates sql_dump_policy rows into
# exclusion flags. Why: runtime-heavy cache/history tables should not bloat routine
# instance backups when the DB already marks them as schema-only or excluded.
# ------------------------------------------------------------------------------
load_instance_backup_policy_flags() {
    filterest_recovery_scan "${PROJECT_ROOT:-.}" stderr _load_instance_backup_policy_flags "$@"
}

_load_instance_backup_policy_flags() {
    local container_name="$1"
    local db_name="$2"
    local db_user="$3"
    local output_var_name="$4"

    _validate_instance_backup_flags_array_name "$output_var_name" || return
    eval "$output_var_name=()"

    if ! declare -F load_sql_dump_policy_flags_from_docker >/dev/null; then
        echo -e "${YELLOW}⚠️  SQL dump policy helper unavailable; using full-table data dump${NC}" >&2
        return 0
    fi

    if ! load_sql_dump_policy_flags_from_docker "$container_name" "$db_name" "$output_var_name" "$db_user"; then
        filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" '⚠️  Could not read sql_dump_policy from %s; using full-table data dump\n' "$container_name" >&2
        eval "$output_var_name=()"
        return 0
    fi
}

# ------------------------------------------------------------------------------
# Add baseline log-data exclusions to every instance backup.
# Between pg_dump policy metadata and the final command-line it guarantees that
# operational log rows stay out even if an old database cannot expose
# sql_dump_policy. Why: backups need structure for restore, not old request logs.
# ------------------------------------------------------------------------------
append_default_instance_backup_exclusions() {
    local output_var_name="$1"
    local output_flag_count=0
    local output_flag_index=0
    local table_name

    _validate_instance_backup_flags_array_name "$output_var_name" || return

    for table_name in "${INSTANCE_BACKUP_DEFAULT_EXCLUDE_TABLE_DATA[@]}"; do
        local flag="--exclude-table-data=${table_name}"
        local existing_flag
        local already_present=false

        eval "output_flag_count=\${#${output_var_name}[@]}"
        for ((output_flag_index = 0; output_flag_index < output_flag_count; output_flag_index++)); do
            eval "existing_flag=\${${output_var_name}[\$output_flag_index]}"
            if [[ "$existing_flag" == "$flag" || "$existing_flag" == "--exclude-table=${table_name}" ]]; then
                already_present=true
                break
            fi
        done
        if [[ "$already_present" == false ]]; then
            eval "$output_var_name+=(\"\$flag\")"
        fi
    done
}

# ------------------------------------------------------------------------------
# Write a compressed, policy-aware instance database backup.
# Between one Docker DB container and an instance backup file it streams pg_dump
# through gzip. Why: instance backups are frequent, so they should be portable,
# smaller on disk, and consistent with the shared sql_dump_policy contract.
# ------------------------------------------------------------------------------
write_instance_database_backup() {
    filterest_recovery_scan "${PROJECT_ROOT:-.}" stderr _write_instance_database_backup "$@"
}

_write_instance_database_backup() {
    local instance="$1"
    local backup_file="$2"
    local db_user="${3:-admin_user}"
    local db_name="${4:-$(project_default_db_name)}"
    local container_name="easelect-${instance}-db"
    local dump_policy_flags=()

    load_instance_backup_policy_flags "$container_name" "$db_name" "$db_user" dump_policy_flags
    append_default_instance_backup_exclusions dump_policy_flags

    if [[ "${#dump_policy_flags[@]}" -gt 0 ]]; then
        local policy_preview
        policy_preview="$(sql_dump_policy_flags_preview dump_policy_flags)"
        filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" '   SQL dump policy: %s\n' "$policy_preview"
    fi

    # Scan decoded SQL and compressed bytes before publication. The shared
    # writer owns only its private partial file; refused runs preserve old files.
    filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$backup_file" --gzip --exclusive \
        docker exec "$container_name" \
        pg_dump -U "$db_user" --no-owner --no-privileges "${dump_policy_flags[@]}" "$db_name"
}

# ------------------------------------------------------------------------------
# Backup instance database
# ------------------------------------------------------------------------------
backup_instance() {
    local instance="$1"
    local requested_backup_file="${2:-}"
    
    if [[ -z "$instance" ]]; then
        echo -e "❌ Instance name required"
        exit 1
    fi
    
    local env_file="instances/${instance}/.env"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${requested_backup_file:-instances/${instance}/backups/backup_${timestamp}.sql.gz}"
    local backup_dir
    backup_dir="$(filterest_recovery_utility "${PROJECT_ROOT:-.}" dirname -- "$backup_file")" || return
    filterest_recovery_content_names "${PROJECT_ROOT:-.}" "$backup_file" "$backup_dir" || return 1
    
    if [[ ! -f "$env_file" ]]; then
        filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" "❌ Instance '%s' not found\n" "$instance"
        exit 1
    fi
    
    filterest_recovery_source "${PROJECT_ROOT:-.}" "$env_file" || return
    
    filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" "💾 Backing up instance '%s'...\n" "$instance"
    
    # Check if container is running
    if ! filterest_recovery_utility "${PROJECT_ROOT:-.}" docker ps --format '{{.Names}}' | grep -Fq -- "easelect-${instance}-db"; then
        echo -e "❌ Database container not running"
        exit 1
    fi
    
    (umask 077; filterest_recovery_output "${PROJECT_ROOT:-.}" mkdir -p -- "$backup_dir") || return
    filterest_recovery_output "${PROJECT_ROOT:-.}" chmod 700 -- "$backup_dir" || return

    if ! write_instance_database_backup "$instance" "$backup_file" "${DB_ADMIN_USER:-admin_user}" "${DB_NAME:-$(project_default_db_name)}"; then
        echo -e "❌ Backup failed"
        exit 1
    fi
    
    local size
    size="$(filterest_recovery_utility "${PROJECT_ROOT:-.}" du -h -- "$backup_file" | cut -f1)" || return
    filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" '✅ Backup created: %s (%s)\n' "$backup_file" "$size"
}

# Import into a verified empty database; keep the populated original for recovery.
source "${BASH_SOURCE[0]%/*}/instance_restore.sh"

# ------------------------------------------------------------------------------
# Restore instance database
# ------------------------------------------------------------------------------
restore_instance() {
    local instance="$1"
    local restore_file="$2"
    local FILTEREST_INSTANCE_RESTORE_STAMP=""
    filterest_recovery_require_safe_names "${PROJECT_ROOT:-.}" "$instance" "$restore_file" || return 1
    
    if [[ -z "$instance" ]] || [[ -z "$restore_file" ]]; then
        echo -e "❌ Usage: ./ctl --instance <name> --restore <file>"
        exit 1
    fi
    
    local env_file="instances/${instance}/.env"
    
    if [[ ! -f "$env_file" ]]; then
        filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" "❌ Instance '%s' not found\n" "$instance"
        exit 1
    fi
    
    if [[ ! -f "$restore_file" ]]; then
        filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" '❌ Restore file not found: %s\n' "$restore_file"
        exit 1
    fi
    
    filterest_recovery_source "${PROJECT_ROOT:-.}" "$env_file" || return
    
    # Present scanned target context on original stdout before requesting input.
    if [[ "${FILTEREST_RECOVERY_CONTEXT_FD:-}" == 7 ]] && { true >&7; } 2>/dev/null; then
        filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" "⚠️  This will overwrite the database for '%s'\n" "$instance" >&7
    else
    filterest_recovery_diagnostic "${PROJECT_ROOT:-.}" "⚠️  This will overwrite the database for '%s'\n" "$instance"
    fi
    local confirm="${EASELECT_RESTORE_CONFIRM:-}"
    if [[ "$confirm" != "yes" ]]; then
        if [[ "${FILTEREST_RECOVERY_PROMPT_FD:-}" == 8 ]] && { true >&8; } 2>/dev/null; then
            [[ ! -t 0 ]] || printf '   Continue? (yes/no): ' >&8
            read confirm
        else
            read -p "   Continue? (yes/no): " confirm
        fi
    else
        echo "   Continue? (yes/no): yes (EASELECT_RESTORE_CONFIRM)"
    fi
    
    if [[ "$confirm" != "yes" ]]; then
        echo "   Cancelled."
        exit 0
    fi
    preflight_instance_restore "$instance" "$restore_file" || return 1
    
    # SIGTERM drains HTTP requests and stops workers. The database stays up.
    # A failed import or reconciliation leaves the application stopped.
    if ! filterest_recovery_output "${PROJECT_ROOT:-.}" docker stop --time 30 "easelect-${instance}-app" >/dev/null; then
        echo "Restore refused: could not stop and drain the application." >&2
        return 1
    fi
    restore_instance_database_replacement "$instance" "$restore_file" "$FILTEREST_INSTANCE_RESTORE_STAMP"
}
