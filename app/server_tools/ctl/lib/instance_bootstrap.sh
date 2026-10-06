#!/bin/bash
# instance_bootstrap.sh
# Owns the committed-seed instance initialization path and its readiness refusal.
# Sourced by instance_sync.sh with the same lifecycle and import helpers.
# Keeps bootstrap policy work out of the oversized seed-sync implementation.

# ------------------------------------------------------------------------------
# Initialize instance from a committed bootstrap seed profile.
#
# Used for management instances because they must not clone the native dev DB.
# The committed management seed contains the role-enforcing system_config upsert
# and profile-specific data boundaries produced by build_bootstrap_seed.py.
# ------------------------------------------------------------------------------
init_instance_from_bootstrap_seed_profile() {
    local instance="$1"
    local env_file="$2"
    local seed_profile="$3"
    local bootstrap_zip=""
    local bootstrap_password=""
    local bootstrap_tmp_dir=""
    local bootstrap_schema_file=""
    local bootstrap_seed_file=""
    local schema_apply_file=""
    local db_admin=""
    local db_name=""
    local target_postgis_schema=""
    local core_table_count=""
    local role_value=""

    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}🏗️  Initializing instance '${instance}' from ${seed_profile} bootstrap seed${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    bootstrap_zip="$(current_bootstrap_seed_zip_path "$seed_profile" 2>/dev/null || true)"
    if [[ -z "$bootstrap_zip" ]]; then
        echo -e "${RED}❌ No committed bootstrap zip found for seed profile '${seed_profile}'.${NC}"
        if declare -F bootstrap_seed_zip_path_for_version >/dev/null 2>&1; then
            echo "   Expected: $(bootstrap_seed_zip_path_for_version "$(tr -d '[:space:]' < "${PROJECT_ROOT}/VERSION_DB")" "$seed_profile")"
        fi
        exit 1
    fi

    bootstrap_password="$(read_bootstrap_seed_password || true)"
    if [[ -z "$bootstrap_password" ]]; then
        echo -e "${RED}❌ Bootstrap zip password missing.${NC}"
        echo "   Expected gitignored local file: $(bootstrap_seed_password_file_path)"
        exit 1
    fi

    bootstrap_tmp_dir="$(mktemp -d)"
    if ! extract_bootstrap_seed_zip "$bootstrap_zip" "$bootstrap_tmp_dir" "$bootstrap_password"; then
        echo -e "${RED}❌ Failed to extract bootstrap zip for seed profile '${seed_profile}'.${NC}"
        rm -rf "$bootstrap_tmp_dir"
        exit 1
    fi

    bootstrap_schema_file="$bootstrap_tmp_dir/schema.sql"
    bootstrap_seed_file="$bootstrap_tmp_dir/seed_data.sql"
    [[ -f "$bootstrap_schema_file" ]] || { echo -e "${RED}❌ Bootstrap zip missing schema.sql${NC}"; rm -rf "$bootstrap_tmp_dir"; exit 1; }
    [[ -f "$bootstrap_seed_file" ]] || { echo -e "${RED}❌ Bootstrap zip missing seed_data.sql${NC}"; rm -rf "$bootstrap_tmp_dir"; exit 1; }

    source "$env_file"
    prepare_instance_compose_env "$env_file"
    export INSTANCE="$instance"
    db_admin="${DB_ADMIN_USER:-admin_user}"
    db_name="${DB_NAME:-$(project_default_db_name)}"

    echo -e "${BLUE}[1/4] Starting instance database if needed...${NC}"
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${instance}-db"; then
        $(compose_cmd "$instance") up -d db 2>&1 | tail -5
    fi
    wait_for_instance_db "$instance" "$db_admin" "$db_name" 60 || {
        echo -e "${RED}❌ Instance database did not become ready.${NC}"
        rm -rf "$bootstrap_tmp_dir"
        exit 1
    }

    core_table_count=$(docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" -tAc \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('system_config', 'system_db_tables', 'system_db_version');" \
        2>/dev/null | tr -d '[:space:]')
    core_table_count="${core_table_count:-0}"
    if [[ "$core_table_count" != "0" ]]; then
        echo -e "${RED}❌ Instance database already contains Easelect core tables.${NC}"
        echo "   ${seed_profile} bootstrap init expects a fresh DB volume."
        echo "   Recreate the instance DB volume before retrying."
        rm -rf "$bootstrap_tmp_dir"
        exit 1
    fi

    if docker inspect "easelect-${instance}-app" >/dev/null 2>&1; then
        docker stop --time 30 "easelect-${instance}-app" >/dev/null || return 1
    fi
    echo -e "${BLUE}[2/4] Importing ${seed_profile} bootstrap schema and data...${NC}"
    schema_apply_file="$bootstrap_schema_file"
    target_postgis_schema="$(detect_instance_postgis_schema "$instance" "$db_admin" "$db_name")"
    if [[ -n "$target_postgis_schema" && "$target_postgis_schema" != "postgis" ]]; then
        schema_apply_file="$bootstrap_tmp_dir/schema_apply.sql"
        sed -E "s/postgis\\.(geometry|geography|raster)/${target_postgis_schema}.\\1/g" "$bootstrap_schema_file" > "$schema_apply_file"
        echo "   Adjusted PostGIS schema references for target extension schema '${target_postgis_schema}'."
    fi

    # The schema used to be imported with its errors ignored and judged by one table
    # existing; now the first failed statement of either file stops the whole init.
    if ! import_bootstrap_package "$schema_apply_file" "$bootstrap_seed_file" 1 \
        docker exec -i "easelect-${instance}-db" psql -U "$db_admin" -d "$db_name"; then
        echo -e "${RED}❌ Bootstrap import failed; the application was not started.${NC}"
        rm -rf "$bootstrap_tmp_dir"
        exit 1
    fi

    echo -e "${BLUE}[3/4] Verifying the ${seed_profile} instance role...${NC}"

    role_value=$(docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" -tAc \
        "SELECT text_value FROM public.system_config WHERE key = 'easelect_instance_role';" \
        2>/dev/null | tr -d '[:space:]')
    if [[ "$role_value" != "$seed_profile" ]]; then
        echo -e "${RED}❌ Bootstrap role verification failed: expected ${seed_profile}, got ${role_value:-empty}.${NC}"
        rm -rf "$bootstrap_tmp_dir"
        exit 1
    fi
    echo -e "   ${GREEN}✓ easelect_instance_role=${role_value}${NC}"

    echo -e "${BLUE}[4/4] Restarting application...${NC}"
    $(compose_cmd "$instance") up -d app 2>&1 | tail -5
    rm -rf "$bootstrap_tmp_dir"

    if wait_for_instance_app "$instance" "${APP_PORT:-8090}" 30; then
        echo -e "${GREEN}✅ Instance '${instance}' initialized from ${seed_profile} bootstrap seed.${NC}"
    else
        docker stop --time 30 "easelect-${instance}-app" >/dev/null 2>&1 || true
        echo "Bootstrap imported, but reconciliation/readiness failed; application stopped." >&2
        return 1
    fi
}

