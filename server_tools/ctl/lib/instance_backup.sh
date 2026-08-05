#!/bin/bash
# ==============================================================================
# instance_backup.sh: Instance database backup and restore
#
# Handles database backup (pg_dump) and restore operations for individual
# Docker instances.
# ==============================================================================

if [[ -n "${PROJECT_ROOT:-}" && -f "$PROJECT_ROOT/server_tools/lib/sql_dump_policy.sh" ]]; then
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/server_tools/lib/sql_dump_policy.sh"
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
        echo -e "${YELLOW}⚠️  Could not read sql_dump_policy from ${container_name}; using full-table data dump${NC}" >&2
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
    local instance="$1"
    local backup_file="$2"
    local db_user="${3:-admin_user}"
    local db_name="${4:-easelect}"
    local container_name="easelect-${instance}-db"
    local dump_policy_flags=()

    load_instance_backup_policy_flags "$container_name" "$db_name" "$db_user" dump_policy_flags
    append_default_instance_backup_exclusions dump_policy_flags

    if [[ "${#dump_policy_flags[@]}" -gt 0 ]]; then
        local policy_preview
        policy_preview="$(sql_dump_policy_flags_preview dump_policy_flags)"
        echo -e "${BLUE}   SQL dump policy: ${policy_preview}${NC}"
    fi

    (
        umask 077
        set -o pipefail
        docker exec "$container_name" \
            pg_dump -U "$db_user" --no-owner --no-privileges "${dump_policy_flags[@]}" "$db_name" \
            | gzip -9 > "$backup_file"
    ) || return

    chmod 600 "$backup_file"
}

# ------------------------------------------------------------------------------
# Backup instance database
# ------------------------------------------------------------------------------
backup_instance() {
    local instance="$1"
    local requested_backup_file="${2:-}"
    
    if [[ -z "$instance" ]]; then
        echo -e "${RED}❌ Instance name required${NC}"
        exit 1
    fi
    
    local env_file="instances/${instance}/.env"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${requested_backup_file:-instances/${instance}/backups/backup_${timestamp}.sql.gz}"
    local backup_dir
    backup_dir="$(dirname "$backup_file")"
    
    if [[ ! -f "$env_file" ]]; then
        echo -e "${RED}❌ Instance '${instance}' not found${NC}"
        exit 1
    fi
    
    source "$env_file"
    
    echo -e "${BLUE}💾 Backing up instance '${instance}'...${NC}"
    
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "easelect-${instance}-db"; then
        echo -e "${RED}❌ Database container not running${NC}"
        exit 1
    fi
    
    mkdir -p "$backup_dir"
    chmod 700 "$backup_dir"

    if ! write_instance_database_backup "$instance" "$backup_file" "${DB_ADMIN_USER:-admin_user}" "${DB_NAME:-filterest}"; then
        rm -f "$backup_file"
        echo -e "${RED}❌ Backup failed${NC}"
        exit 1
    fi
    
    local size=$(du -h "$backup_file" | cut -f1)
    echo -e "${GREEN}✅ Backup created: ${backup_file} (${size})${NC}"
}

# ------------------------------------------------------------------------------
# Restore instance database
# ------------------------------------------------------------------------------
restore_instance() {
    local instance="$1"
    local restore_file="$2"
    
    if [[ -z "$instance" ]] || [[ -z "$restore_file" ]]; then
        echo -e "${RED}❌ Usage: ./ctl --instance <name> --restore <file>${NC}"
        exit 1
    fi
    
    local env_file="instances/${instance}/.env"
    
    if [[ ! -f "$env_file" ]]; then
        echo -e "${RED}❌ Instance '${instance}' not found${NC}"
        exit 1
    fi
    
    if [[ ! -f "$restore_file" ]]; then
        echo -e "${RED}❌ Restore file not found: ${restore_file}${NC}"
        exit 1
    fi
    
    source "$env_file"
    
    echo -e "${YELLOW}⚠️  This will overwrite the database for '${instance}'${NC}"
    local confirm="${EASELECT_RESTORE_CONFIRM:-}"
    if [[ "$confirm" != "yes" ]]; then
        read -p "   Continue? (yes/no): " confirm
    else
        echo "   Continue? (yes/no): yes (EASELECT_RESTORE_CONFIRM)"
    fi
    
    if [[ "$confirm" != "yes" ]]; then
        echo "   Cancelled."
        exit 0
    fi
    
    echo -e "${BLUE}🔄 Restoring database...${NC}"

    if ! (
        set -o pipefail
        case "$restore_file" in
            *.gz)
                gzip -dc "$restore_file" | docker exec -i "easelect-${instance}-db" psql -U "${DB_ADMIN_USER}" "${DB_NAME:-filterest}"
                ;;
            *)
                cat "$restore_file" | docker exec -i "easelect-${instance}-db" psql -U "${DB_ADMIN_USER}" "${DB_NAME:-filterest}"
                ;;
        esac
    ); then
        echo -e "${RED}❌ Restore failed${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Database restored from: ${restore_file}${NC}"
}
