#!/usr/bin/env bash
# sql_dump_policy.sh
# Builds pg_dump exclusion flags from system_db_tables.sql_dump_policy metadata.
# Bridges source-database metadata queries and SQL export shell scripts.
# Exists so deploy and migration flows share one policy-aware dump implementation.

SQL_DUMP_POLICY_QUERY=$(cat <<'SQL'
SELECT
    COALESCE(NULLIF(schema_name, ''), 'public') AS schema_name,
    table_name,
    COALESCE(to_jsonb(system_db_tables) ->> 'sql_dump_policy', 'all') AS sql_dump_policy
FROM system_db_tables
WHERE COALESCE(to_jsonb(system_db_tables) ->> 'sql_dump_policy', 'all') <> 'all'
ORDER BY COALESCE(NULLIF(schema_name, ''), 'public'), table_name;
SQL
)

# Validate a caller-owned array name before using Bash 3.2-compatible eval.
# Between public dump-policy functions and their output arrays it limits dynamic
# assignment to shell identifiers. Why: Bash 3.2 has no nameref support.
_validate_sql_dump_policy_flags_array_name() {
    local flags_var_name="$1"

    if [[ ! "$flags_var_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        echo "error: invalid SQL dump policy output array name: ${flags_var_name}" >&2
        return 2
    fi
}

# Reset a caller-owned flag array without Bash 4's nameref feature.
# Between dump-policy loaders and their caller it preserves the existing output
# parameter contract. Why: deployments must also run under macOS /bin/bash 3.2.
reset_sql_dump_policy_flags() {
    local flags_var_name="$1"

    _validate_sql_dump_policy_flags_array_name "$flags_var_name" || return
    eval "$flags_var_name=()"
}

# Append one value to a caller-owned flag array through its validated name.
# Between metadata row parsing and pg_dump invocation it keeps each flag as one
# array item. Why: whitespace and glob characters must never split dump flags.
append_sql_dump_policy_flag() {
    local flags_var_name="$1"
    local flag="$2"

    _validate_sql_dump_policy_flags_array_name "$flags_var_name" || return
    eval "$flags_var_name+=(\"\$flag\")"
}

build_sql_dump_policy_flags_from_rows() {
    local output_var_name="$1"
    local query_rows="$2"

    reset_sql_dump_policy_flags "$output_var_name" || return

    while IFS=$'\t' read -r schema_name table_name sql_dump_policy; do
        [[ -n "${table_name}" ]] || continue

        case "${sql_dump_policy}" in
            schema_only)
                append_sql_dump_policy_flag "$output_var_name" "--exclude-table-data=${schema_name}.${table_name}" || return
                ;;
            none)
                append_sql_dump_policy_flag "$output_var_name" "--exclude-table=${schema_name}.${table_name}" || return
                ;;
            all|"")
                ;;
            *)
                echo "warning: ignoring unknown sql_dump_policy '${sql_dump_policy}' for ${schema_name}.${table_name}" >&2
                ;;
        esac
    done <<< "${query_rows}"
}

load_sql_dump_policy_flags_from_docker() {
    local container_name="$1"
    local db_name="$2"
    local output_var_name="$3"
    local db_user="${4:-postgres}"
    local query_rows=""

    reset_sql_dump_policy_flags "$output_var_name" || return

    if ! query_rows=$(docker exec "${container_name}" psql -U "${db_user}" -d "${db_name}" -At -F $'\t' -c "${SQL_DUMP_POLICY_QUERY}" 2>/dev/null); then
        return 1
    fi

    build_sql_dump_policy_flags_from_rows "${output_var_name}" "${query_rows}"
}

load_sql_dump_policy_flags_from_local_credentials() {
    local db_host="$1"
    local db_port="$2"
    local db_name="$3"
    local db_user="$4"
    local db_password="$5"
    local output_var_name="$6"
    local query_rows=""

    reset_sql_dump_policy_flags "$output_var_name" || return

    if ! query_rows=$(PGPASSWORD="${db_password}" psql -h "${db_host}" -p "${db_port}" -U "${db_user}" -d "${db_name}" -At -F $'\t' -c "${SQL_DUMP_POLICY_QUERY}" 2>/dev/null); then
        return 1
    fi

    build_sql_dump_policy_flags_from_rows "${output_var_name}" "${query_rows}"
}

load_sql_dump_policy_flags_from_local_superuser() {
    local db_port="$1"
    local db_name="$2"
    local output_var_name="$3"
    local query_rows=""

    reset_sql_dump_policy_flags "$output_var_name" || return

    if ! query_rows=$(sudo -u postgres psql -p "${db_port}" -d "${db_name}" -At -F $'\t' -c "${SQL_DUMP_POLICY_QUERY}" 2>/dev/null); then
        return 1
    fi

    build_sql_dump_policy_flags_from_rows "${output_var_name}" "${query_rows}"
}

sql_dump_policy_flags_preview() {
    local flags_var_name="$1"
    local flag_count=0
    local flag_index=0
    local current_flag=""

    _validate_sql_dump_policy_flags_array_name "$flags_var_name" || return
    eval "flag_count=\${#${flags_var_name}[@]}"
    if [[ "$flag_count" -eq 0 ]]; then
        return 0
    fi

    for ((flag_index = 0; flag_index < flag_count; flag_index++)); do
        eval "current_flag=\${${flags_var_name}[\$flag_index]}"
        printf '%q ' "$current_flag"
    done
}
