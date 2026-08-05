#!/bin/bash
# ==============================================================================
# instance_sync.sh: Instance initialization and synchronization from seed
#
# Handles provisioning Docker instances from the local development (seed) DB:
# - init: Full wipe-and-load from seed (for new/empty instances)
# - sync: Merge-insert from seed (preserves derivative data)
# ==============================================================================

detect_instance_postgis_schema() {
    local instance="$1"
    local db_admin="$2"
    local db_name="$3"
    local schema=""
    local attempt=""

    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        schema="$(docker exec "easelect-${instance}-db" \
            psql -U "$db_admin" -d "$db_name" -tAc \
            "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'postgis';" \
            2>/dev/null | tr -d '[:space:]' || true)"
        if [[ -n "$schema" ]]; then
            printf '%s\n' "$schema"
            return 0
        fi
        sleep 1
    done

    return 0
}

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
        echo "   Expected under: server_tools/versioning/bootstrap_seeds/db-$(tr -d '[:space:]' < "${PROJECT_ROOT}/VERSION_DB")/"
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
    db_name="${DB_NAME:-filterest}"

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

    echo -e "${BLUE}[2/4] Importing ${seed_profile} bootstrap schema...${NC}"
    schema_apply_file="$bootstrap_schema_file"
    target_postgis_schema="$(detect_instance_postgis_schema "$instance" "$db_admin" "$db_name")"
    if [[ -n "$target_postgis_schema" && "$target_postgis_schema" != "postgis" ]]; then
        schema_apply_file="$bootstrap_tmp_dir/schema_apply.sql"
        sed -E "s/postgis\\.(geometry|geography|raster)/${target_postgis_schema}.\\1/g" "$bootstrap_schema_file" > "$schema_apply_file"
        echo "   Adjusted PostGIS schema references for target extension schema '${target_postgis_schema}'."
    fi

    docker cp "$schema_apply_file" "easelect-${instance}-db:/tmp/bootstrap_schema.sql"
    docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" -f /tmp/bootstrap_schema.sql >/tmp/easelect_bootstrap_schema_${instance}.log 2>&1 || true

    core_table_count=$(docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" -tAc \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_db_version';" \
        2>/dev/null | tr -d '[:space:]')
    core_table_count="${core_table_count:-0}"
    if [[ "$core_table_count" == "0" ]]; then
        echo -e "${RED}❌ Bootstrap schema import failed.${NC}"
        grep -E "^(ERROR|psql:)" "/tmp/easelect_bootstrap_schema_${instance}.log" | head -10 | sed 's/^/   /' || true
        rm -rf "$bootstrap_tmp_dir"
        docker exec "easelect-${instance}-db" rm -f /tmp/bootstrap_schema.sql 2>/dev/null || true
        exit 1
    fi
    rm -f "/tmp/easelect_bootstrap_schema_${instance}.log"

    echo -e "${BLUE}[3/4] Importing ${seed_profile} bootstrap data...${NC}"
    docker cp "$bootstrap_seed_file" "easelect-${instance}-db:/tmp/bootstrap_seed_data.sql"
    if ! docker exec "easelect-${instance}-db" \
        psql -v ON_ERROR_STOP=1 -U "$db_admin" -d "$db_name" -f /tmp/bootstrap_seed_data.sql >/tmp/easelect_bootstrap_seed_${instance}.log 2>&1; then
        echo -e "${RED}❌ Bootstrap seed import failed.${NC}"
        grep -E "^(ERROR|psql:)" "/tmp/easelect_bootstrap_seed_${instance}.log" | head -10 | sed 's/^/   /' || true
        rm -rf "$bootstrap_tmp_dir"
        docker exec "easelect-${instance}-db" rm -f /tmp/bootstrap_schema.sql /tmp/bootstrap_seed_data.sql 2>/dev/null || true
        exit 1
    fi
    rm -f "/tmp/easelect_bootstrap_seed_${instance}.log"

    role_value=$(docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" -tAc \
        "SELECT text_value FROM public.system_config WHERE key = 'easelect_instance_role';" \
        2>/dev/null | tr -d '[:space:]')
    if [[ "$role_value" != "$seed_profile" ]]; then
        echo -e "${RED}❌ Bootstrap role verification failed: expected ${seed_profile}, got ${role_value:-empty}.${NC}"
        rm -rf "$bootstrap_tmp_dir"
        docker exec "easelect-${instance}-db" rm -f /tmp/bootstrap_schema.sql /tmp/bootstrap_seed_data.sql 2>/dev/null || true
        exit 1
    fi
    echo -e "   ${GREEN}✓ easelect_instance_role=${role_value}${NC}"

    echo -e "${BLUE}[4/4] Restarting application...${NC}"
    $(compose_cmd "$instance") up -d app 2>&1 | tail -5
    docker exec "easelect-${instance}-db" rm -f /tmp/bootstrap_schema.sql /tmp/bootstrap_seed_data.sql 2>/dev/null || true
    rm -rf "$bootstrap_tmp_dir"

    if wait_for_instance_app "$instance" "${APP_PORT:-8090}" 30; then
        echo -e "${GREEN}✅ Instance '${instance}' initialized from ${seed_profile} bootstrap seed.${NC}"
    else
        echo -e "${YELLOW}⚠️  Bootstrap data loaded but app is not yet responding.${NC}"
        echo "   Check logs: docker logs easelect-${instance}-app"
    fi
}

# ------------------------------------------------------------------------------
# Initialize instance: Full provisioning from dev (seed) database
#
# One-command workflow for getting a new or empty instance running:
#   1. Copies storage files from dev storage to instance storage
#   2. Dumps schema + ALL data from seed DB (excluding large log tables)
#   3. Creates schema for fresh DB volumes, then loads fresh data
#   4. Restarts the app container
#
# Usage: ./ctl --instance <name> --init
# Safe to re-run — truncates and reloads each time.
# ------------------------------------------------------------------------------
init_instance() {
    local instance="$1"

    if [[ -z "$instance" ]]; then
        echo -e "${RED}❌ Instance name required. Usage: ./ctl --instance <name> --init${NC}"
        exit 1
    fi

    local env_file="instances/${instance}/.env"

    if [[ ! -f "$env_file" ]]; then
        echo -e "${RED}❌ Instance '${instance}' not found (no .env file)${NC}"
        exit 1
    fi

    local seed_profile=""
    seed_profile="$(instance_seed_profile_from_env "$env_file")" || exit 1
    if [[ "$seed_profile" == "management" ]]; then
        init_instance_from_bootstrap_seed_profile "$instance" "$env_file" "$seed_profile"
        return
    fi

    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}🏗️  Initializing instance '${instance}' from dev seed${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    # ── Read seed DB config ────────────────────────────────────────────────────
    local seed_host seed_port seed_user seed_name seed_password
    read_seed_db_config

    # ── Step 1: Verify seed DB is running ─────────────────────────────────────
    echo -e "${BLUE}[1/6] Verifying seed database...${NC}"

    if ! pg_isready -h "$seed_host" -p "$seed_port" >/dev/null 2>&1; then
        echo -e "${RED}❌ Seed database is not running (${seed_host}:${seed_port})${NC}"
        echo "   Start it with:  sudo systemctl start postgresql"
        exit 1
    fi
    echo -e "   ${GREEN}✓ Seed DB reachable at ${seed_host}:${seed_port}${NC}"

    # ── Step 2: Backup existing instance DB (if running) ──────────────────────
    echo ""
    echo -e "${BLUE}[2/6] Backing up existing instance database...${NC}"

    local backup_dir="$PROJECT_ROOT/data/db_backups"
    mkdir -p "$backup_dir"

    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${instance}-db"; then
        source "$env_file"
        local backup_admin="${DB_ADMIN_USER:-admin_user}"
        local backup_dbname="${DB_NAME:-filterest}"
        local instance_short=$(echo "$instance" | sed 's/\..*//') # e.g. serlog from serlog.com
        local backup_ts=$(date +%Y-%m-%d--%H-%M)
        local backup_file="${backup_dir}/easelect_${instance_short}_full_dump_${backup_ts}.sql"

        if docker exec "easelect-${instance}-db" \
            pg_dump -U "$backup_admin" "$backup_dbname" > "$backup_file" 2>/dev/null; then
            local backup_size=$(du -h "$backup_file" | cut -f1)
            echo -e "   ${GREEN}✓ Backup saved: ${backup_file} (${backup_size})${NC}"
        else
            echo -e "   ${YELLOW}⚠️  Backup failed (empty DB?) — continuing${NC}"
            rm -f "$backup_file"
        fi
    else
        echo -e "   ${YELLOW}⚠️  Instance DB not running — no backup needed${NC}"
    fi

    # ── Step 3: Copy storage files ────────────────────────────────────────────
    echo ""
    echo -e "${BLUE}[3/6] Copying storage files...${NC}"

    local instance_storage="instances/${instance}/storage"
    mkdir -p "$instance_storage"

    if [[ -d "$PROJECT_ROOT/storage" ]] && [[ -n "$(ls -A "$PROJECT_ROOT/storage/" 2>/dev/null)" ]]; then
        cp -r "$PROJECT_ROOT/storage/"* "$instance_storage/" 2>/dev/null || true
        local storage_size=$(du -sh "$instance_storage" | cut -f1)
        echo -e "   ${GREEN}✓ Storage copied (${storage_size})${NC}"
    else
        echo -e "   ${YELLOW}⚠️  No dev storage files found — skipping${NC}"
    fi
    normalize_instance_storage_permissions "$instance"

    # ── Step 4: Dump dev schema + data ────────────────────────────────────────
    echo ""
    echo -e "${BLUE}[4/6] Dumping seed database schema + data...${NC}"

    local schema_dump="/tmp/easelect_init_schema_${instance}.sql"
    local dump_file="/tmp/easelect_init_data_${instance}.sql"

    if ! PGPASSWORD="$seed_password" pg_dump \
        -h "$seed_host" -p "$seed_port" -U "$seed_user" \
        --schema-only --no-owner --no-privileges \
        "$seed_name" > "$schema_dump" 2>/dev/null; then
        echo -e "${RED}❌ Schema dump failed${NC}"
        rm -f "$schema_dump" "$dump_file"
        exit 1
    fi

    if ! PGPASSWORD="$seed_password" pg_dump \
        -h "$seed_host" -p "$seed_port" -U "$seed_user" \
        --data-only --disable-triggers --no-owner --no-privileges \
        --exclude-table=system_transaction_log \
        --exclude-table=system_log \
        --exclude-table=system_audit_log \
        --exclude-table=postgis.spatial_ref_sys \
        "$seed_name" > "$dump_file" 2>/dev/null; then
        echo -e "${RED}❌ Data dump failed${NC}"
        rm -f "$schema_dump" "$dump_file"
        exit 1
    fi

    local schema_size=$(du -h "$schema_dump" | cut -f1)
    local dump_size=$(du -h "$dump_file" | cut -f1)
    local dump_lines=$(wc -l < "$dump_file" | tr -d ' ')
    echo -e "   ${GREEN}✓ Schema dump created (${schema_size})${NC}"
    echo -e "   ${GREEN}✓ Data dump created (${dump_size}, ${dump_lines} lines)${NC}"

    # ── Step 5: Truncate + load into Docker DB ────────────────────────────────
    echo ""
    echo -e "${BLUE}[5/6] Loading data into instance database...${NC}"

    # Verify Docker DB is running
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${instance}-db"; then
        echo -e "${YELLOW}   DB container not running — starting instance first...${NC}"
        source "$env_file"
        prepare_instance_compose_env "$env_file"
        export INSTANCE="$instance"
        $(compose_cmd "$instance") up -d 2>&1 | tail -3

        echo "   ⏳ Waiting for database..."
        wait_for_instance_db "$instance" "${DB_ADMIN_USER:-admin_user}" "${DB_NAME:-filterest}" 60
    fi

    # Read DB_ADMIN_USER from instance env
    source "$env_file"
    local db_admin="${DB_ADMIN_USER:-admin_user}"
    local db_name="${DB_NAME:-filterest}"
    local schema_apply_file="$schema_dump"
    local target_postgis_schema
    target_postgis_schema="$(detect_instance_postgis_schema "$instance" "$db_admin" "$db_name")"
    if [[ -n "$target_postgis_schema" && "$target_postgis_schema" != "postgis" ]]; then
        schema_apply_file="/tmp/easelect_init_schema_apply_${instance}.sql"
        sed -E "s/postgis\\.(geometry|geography|raster)/${target_postgis_schema}.\\1/g" "$schema_dump" > "$schema_apply_file"
        echo "   Adjusted PostGIS schema references for target extension schema '${target_postgis_schema}'."
    fi

    local core_table_count
    core_table_count=$(docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" -tAc \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_db_version';" \
        2>/dev/null | tr -d '[:space:]')
    core_table_count="${core_table_count:-0}"

    if [[ "$core_table_count" == "0" ]]; then
        echo "   Applying seed schema to fresh instance DB..."
        docker cp "$schema_apply_file" "easelect-${instance}-db:/tmp/init_schema.sql"
        local schema_errors
        schema_errors=$(docker exec "easelect-${instance}-db" \
            psql -U "$db_admin" -d "$db_name" -f /tmp/init_schema.sql 2>&1 | \
            grep -i "error" | head -10 || true)
        core_table_count=$(docker exec "easelect-${instance}-db" \
            psql -U "$db_admin" -d "$db_name" -tAc \
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_db_version';" \
            2>/dev/null | tr -d '[:space:]')
        core_table_count="${core_table_count:-0}"
        if [[ "$core_table_count" == "0" ]]; then
            echo -e "   ${RED}❌ Schema load failed${NC}"
            echo "$schema_errors" | sed 's/^/      /'
            rm -f "$schema_dump" "$schema_apply_file" "$dump_file"
            docker exec "easelect-${instance}-db" rm -f /tmp/init_schema.sql 2>/dev/null || true
            exit 1
        fi
        if [[ -n "$schema_errors" ]]; then
            echo -e "   ${YELLOW}Schema warnings (usually existing objects from a previous partial init):${NC}"
            echo "$schema_errors" | sed 's/^/      /'
        fi
    else
        echo "   Existing Easelect schema detected; reusing it."
    fi

    echo "   Truncating existing data..."
    docker exec "easelect-${instance}-db" psql -U "$db_admin" -d "$db_name" -c "
    DO \$\$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                AND tablename NOT IN ('system_transaction_log','system_log')) LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END \$\$;
    " 2>&1 | grep -v "^NOTICE" | cat

    echo "   Loading seed data..."
    docker cp "$dump_file" "easelect-${instance}-db:/tmp/init_data.sql"
    local load_errors
    load_errors=$(docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" -f /tmp/init_data.sql 2>&1 | \
        grep -i "error" | head -5 || true)

    if [[ -n "$load_errors" ]]; then
        echo -e "   ${YELLOW}Warnings (usually non-fatal):${NC}"
        echo "$load_errors" | sed 's/^/      /'
    fi
    echo -e "   ${GREEN}✓ Data loaded${NC}"

    # Cleanup
    rm -f "$schema_dump" "$schema_apply_file" "$dump_file"
    docker exec "easelect-${instance}-db" rm -f /tmp/init_schema.sql 2>/dev/null || true
    docker exec "easelect-${instance}-db" rm -f /tmp/init_data.sql 2>/dev/null || true

    # ── Step 6: Restart app ───────────────────────────────────────────────────
    echo ""
    echo -e "${BLUE}[6/6] Restarting application...${NC}"

    docker restart "easelect-${instance}-app" 2>/dev/null || true

    # Wait for app
    local port="${APP_PORT:-8082}"

    echo ""
    if wait_for_instance_app "$instance" "$port" 30; then
        echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}✅ Instance '${instance}' initialized successfully!${NC}"
        echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo "   🌐 Application:  http://localhost:${port}"
        echo "   📦 Storage:      instances/${instance}/storage/"
        echo "   🗄️  Database:     Full dev data loaded"
    else
        echo -e "${YELLOW}════════════════════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}⚠️  Data loaded but app not yet responding${NC}"
        echo -e "${YELLOW}════════════════════════════════════════════════════════════════${NC}"
        echo "   Check logs: docker logs easelect-${instance}-app"
    fi
    echo ""
}

# ------------------------------------------------------------------------------
# Sync instance from seed: rebuild code + merge-insert missing rows
#
# Strategy (safe for production derivatives with their own data):
#   1. Schema sync  — pg_dump --schema-only from seed → apply with errors
#                     suppressed (new tables created, existing objects skipped)
#   2. Data merge   — pg_dump --data-only --column-inserts from seed →
#                     UPSERT with COALESCE per table (via primary key):
#                     → missing rows: inserted from seed
#                     → existing rows: NULL columns filled from seed,
#                       non-NULL columns preserved (derivative data wins)
#   3. Code update  — rebuild Docker image with latest source
#
# Requires: Seed PostgreSQL must be running (no fallback to static dump).
# Offers:   Optional dated full dump (easelect_full_dump_YYYY-MM-DD.sql).
# ------------------------------------------------------------------------------
sync_instance() {
    local instance="$1"

    if [[ -z "$instance" ]]; then
        echo -e "${RED}❌ Instance name required. Usage: ./ctl --instance <name> --sync${NC}"
        exit 1
    fi

    local env_file="instances/${instance}/.env"

    if [[ ! -f "$env_file" ]]; then
        echo -e "${RED}❌ Instance '${instance}' not found${NC}"
        exit 1
    fi

    prepare_instance_compose_env "$env_file"

    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}🔄 Syncing instance '${instance}' from seed (merge mode)${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    # ── Read seed DB config from the resolved native development env ──────────
    local seed_host seed_port seed_user seed_name seed_password
    read_seed_db_config

    # ── Step 1: Verify seed DB is running ─────────────────────────────────────
    echo -e "${BLUE}[1/6] Verifying seed database...${NC}"

    if ! pg_isready -h "$seed_host" -p "$seed_port" >/dev/null 2>&1; then
        echo -e "${RED}❌ Seed database is not running (${seed_host}:${seed_port})${NC}"
        echo ""
        echo "   The seed DB must be running for sync — no fallback is used."
        echo "   Start it with:  sudo systemctl start postgresql"
        echo "   Or check port:  pg_isready -h $seed_host -p $seed_port"
        exit 1
    fi
    echo -e "   ${GREEN}✓ Seed DB reachable at ${seed_host}:${seed_port}${NC}"

    # ── Step 2: Create schema + data dumps from seed ──────────────────────────
    echo ""
    echo -e "${BLUE}[2/6] Creating seed dumps (schema + data)...${NC}"

    local ts=$(date +%s)
    local schema_dump="/tmp/easelect_seed_schema_${ts}.sql"
    local data_dump="/tmp/easelect_seed_data_${ts}.sql"
    local pk_map="/tmp/easelect_pk_map_${ts}.txt"
    local schema_log="/tmp/easelect_schema_apply_${ts}.log"
    local merge_log="/tmp/easelect_merge_${ts}.log"
    local target_tables="/tmp/easelect_target_tables_${ts}.txt"
    local target_columns="/tmp/easelect_target_columns_${ts}.txt"
    local target_required_columns="/tmp/easelect_target_required_columns_${ts}.txt"
    local target_pkey_tables="/tmp/easelect_target_pkeys_${ts}.txt"
    local seed_table_uids="/tmp/easelect_seed_table_uids_${ts}.txt"
    local schema_apply_dump="/tmp/easelect_schema_apply_input_${ts}.sql"

    # Schema-only dump (no --clean so we don't drop existing objects)
    echo "   Dumping schema..."
    if ! PGPASSWORD="$seed_password" pg_dump \
        -h "$seed_host" -p "$seed_port" -U "$seed_user" \
        --schema-only --no-owner --no-privileges \
        "$seed_name" > "$schema_dump" 2>/dev/null; then
        echo -e "${RED}❌ Schema dump failed${NC}"
        exit 1
    fi
    local schema_size=$(du -h "$schema_dump" | cut -f1)
    echo -e "   ${GREEN}✓ Schema dump: ${schema_size}${NC}"

    # Data-only dump as column-qualified INSERT statements (needed for COALESCE upsert)
    echo "   Dumping data (column-INSERT format — may take a moment)..."
    if ! PGPASSWORD="$seed_password" pg_dump \
        -h "$seed_host" -p "$seed_port" -U "$seed_user" \
        --data-only --column-inserts --no-owner --no-privileges \
        --exclude-table=system_transaction_log \
        --exclude-table=system_log \
        --exclude-table=system_audit_log \
        "$seed_name" > "$data_dump" 2>/dev/null; then
        echo -e "${RED}❌ Data dump failed${NC}"
        rm -f "$schema_dump" "$target_columns" "$target_required_columns" "$target_pkey_tables" "$schema_apply_dump"
        exit 1
    fi
    local data_size=$(du -h "$data_dump" | cut -f1)
    local insert_count=$(grep -c "^INSERT INTO " "$data_dump" || echo "0")
    echo -e "   ${GREEN}✓ Data dump: ${data_size} (${insert_count} INSERT statements)${NC}"

    # ── Step 2b: Offer to save a dated full dump ──────────────────────────────
    echo ""
    local today=$(date +%Y-%m-%d)
    local dump_dir="$PROJECT_ROOT/data/db_backups"
    mkdir -p "$dump_dir"
    local dated_dump_name="easelect_full_dump_${today}.sql"

    # Rename existing undated dump to include its modification date
    if [[ -f "$PROJECT_ROOT/easelect_full_dump.sql" ]]; then
        local old_date=$(date -r "$PROJECT_ROOT/easelect_full_dump.sql" +%Y-%m-%d 2>/dev/null || echo "unknown")
        local old_name="easelect_full_dump_${old_date}.sql"
        if [[ ! -f "$dump_dir/$old_name" ]]; then
            mv "$PROJECT_ROOT/easelect_full_dump.sql" "$dump_dir/$old_name"
            echo -e "   ${BLUE}ℹ️  Moved existing dump → data/db_backups/${old_name}${NC}"
        fi
    fi

    read -p "   Save a dated full dump (data/db_backups/${dated_dump_name})? [y/N]: " save_dump
    if [[ "$(ascii_lowercase "$save_dump")" == "y" ]]; then
        echo "   Creating full dump..."
        if PGPASSWORD="$seed_password" pg_dump \
            -h "$seed_host" -p "$seed_port" -U "$seed_user" \
            --no-owner --no-privileges \
            "$seed_name" > "$dump_dir/$dated_dump_name" 2>/dev/null; then
            local full_size=$(du -h "$dump_dir/$dated_dump_name" | cut -f1)
            echo -e "   ${GREEN}✓ Saved data/db_backups/${dated_dump_name} (${full_size})${NC}"
        else
            echo -e "   ${YELLOW}⚠️  Full dump creation failed — continuing sync${NC}"
        fi
    fi

    # ── Step 3: Backup instance's current DB ──────────────────────────────────
    echo ""
    echo -e "${BLUE}[3/6] Backing up instance '${instance}' current database...${NC}"

    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${instance}-db"; then
        backup_instance "$instance"
    else
        echo "   Instance DB not running — skipping backup"
    fi

    # ── Step 4: Rebuild & restart containers (code update) ────────────────────
    echo ""
    echo -e "${BLUE}[4/6] Rebuilding containers (code update)...${NC}"

    source "$env_file"
    export INSTANCE="$instance"

    local ccmd=$(compose_cmd "$instance")

    echo "   🔨 Building with latest code..."
    if ! $ccmd build --no-cache 2>&1 | tail -5; then
        echo -e "${RED}❌ Build failed${NC}"
        rm -f "$schema_dump" "$data_dump" "$pk_map" "$schema_log" "$merge_log" "$target_tables" "$target_columns" "$target_required_columns" "$target_pkey_tables" "$seed_table_uids" "$schema_apply_dump"
        exit 1
    fi

    echo "   🚀 Starting containers..."
    normalize_instance_storage_permissions "$instance"
    $ccmd up -d --force-recreate 2>&1 | tail -5

    # Wait for DB to be healthy
    echo "   ⏳ Waiting for database..."
    if ! wait_for_instance_db "$instance" "${DB_ADMIN_USER}" "${DB_NAME:-filterest}" 60; then
        echo -e "${RED}❌ Database container failed to become healthy${NC}"
        rm -f "$schema_dump" "$data_dump" "$pk_map" "$schema_log" "$merge_log" "$target_tables" "$target_columns" "$target_required_columns" "$target_pkey_tables" "$seed_table_uids" "$schema_apply_dump"
        exit 1
    fi
    echo -e "   ${GREEN}✓ Database ready${NC}"

    # ── Step 5: Merge seed into instance (schema + data) ──────────────────────
    local db_admin="${DB_ADMIN_USER}"
    local db_name="${DB_NAME:-filterest}"

    # 5a: Apply schema (new tables, indexes, etc. — existing objects cause
    #     harmless "already exists" errors that are suppressed)
    echo ""
    echo -e "${BLUE}[5/6] Merging seed into instance...${NC}"
    echo "   Applying schema (new tables/indexes)..."

    echo "   Reading target primary-key table list before schema apply..."
    docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" --no-psqlrc -t -A -c "
        SELECT table_schema || '.' || table_name
        FROM information_schema.table_constraints
        WHERE constraint_type = 'PRIMARY KEY'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
    " > "$target_pkey_tables" 2>/dev/null

    SCHEMA_DUMP_PATH="$schema_dump" \
    TARGET_PKEY_TABLES_PATH="$target_pkey_tables" \
    SCHEMA_APPLY_DUMP_PATH="$schema_apply_dump" \
    python3 - <<'PY'
import re
import os

schema_dump_path = os.environ["SCHEMA_DUMP_PATH"]
target_pkey_tables_path = os.environ["TARGET_PKEY_TABLES_PATH"]
schema_apply_dump_path = os.environ["SCHEMA_APPLY_DUMP_PATH"]

target_pkey_tables = set()
try:
    with open(target_pkey_tables_path) as f:
        for line in f:
            table_name = line.strip()
            if table_name:
                target_pkey_tables.add(table_name)
except OSError:
    pass

with open(schema_dump_path) as f:
    schema_lines = f.readlines()

preamble = """-- instance_sync targeted schema backfills for older derivative tables
ALTER TABLE public.system_db_tables
    ADD COLUMN IF NOT EXISTS sql_dump_policy character varying(20) DEFAULT 'all';
UPDATE public.system_db_tables
SET sql_dump_policy = 'all'
WHERE sql_dump_policy IS NULL;
ALTER TABLE public.system_db_tables
    ALTER COLUMN sql_dump_policy SET DEFAULT 'all',
    ALTER COLUMN sql_dump_policy SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_db_tables_sql_dump_policy'
          AND conrelid = 'public.system_db_tables'::regclass
    ) THEN
        ALTER TABLE public.system_db_tables
            ADD CONSTRAINT ck_system_db_tables_sql_dump_policy
            CHECK (sql_dump_policy IN ('all', 'schema_only', 'none')) NOT VALID;
    END IF;
END $$;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_db_tables_sql_dump_policy'
          AND conrelid = 'public.system_db_tables'::regclass
          AND NOT convalidated
    ) THEN
        ALTER TABLE public.system_db_tables
            VALIDATE CONSTRAINT ck_system_db_tables_sql_dump_policy;
    END IF;
END $$;
ALTER TABLE public.dev_agent_tasks
    ADD COLUMN IF NOT EXISTS queue_id INTEGER;
ALTER TABLE public.dev_agent_tasks
    ADD COLUMN IF NOT EXISTS cached_image TEXT;
UPDATE public.dev_agent_tasks
SET status = CASE trim(status)
    WHEN 'awaiting_review' THEN 'awaiting_human_decision'
    WHEN 'closed' THEN 'done'
    WHEN 'done_autonomously' THEN 'done'
    WHEN 'human_decided' THEN 'new'
    WHEN 'later' THEN 'backlog_later'
    WHEN 'nice_to_have' THEN 'backlog_nice_to_have'
    ELSE trim(status)
END
WHERE status IS DISTINCT FROM CASE trim(status)
    WHEN 'awaiting_review' THEN 'awaiting_human_decision'
    WHEN 'closed' THEN 'done'
    WHEN 'done_autonomously' THEN 'done'
    WHEN 'human_decided' THEN 'new'
    WHEN 'later' THEN 'backlog_later'
    WHEN 'nice_to_have' THEN 'backlog_nice_to_have'
    ELSE trim(status)
END;

"""

filtered_lines = []
i = 0
while i < len(schema_lines):
    line = schema_lines[i]
    if line.startswith("ALTER TABLE ONLY "):
        table_name = line[len("ALTER TABLE ONLY "):].strip()
        next_line = schema_lines[i + 1] if i + 1 < len(schema_lines) else ""
        if table_name in target_pkey_tables and re.search(r"ADD CONSTRAINT\\s+.+\\s+PRIMARY KEY\\b", next_line):
            i += 2
            continue
    filtered_lines.append(line)
    i += 1

with open(schema_apply_dump_path, "w") as f:
    f.write(preamble)
    f.writelines(filtered_lines)
PY

    if ! cat "$schema_apply_dump" | docker exec -i "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" --quiet --no-psqlrc > "$schema_log" 2>&1; then
        true
    fi

    local schema_errors
    schema_errors=$(grep -i "error" "$schema_log" | grep -v "already exists" | grep -v "multiple primary keys" | head -5 || true)

    if [[ -n "$schema_errors" ]]; then
        echo -e "   ${YELLOW}Schema warnings (non-fatal):${NC}"
        echo "$schema_errors" | sed 's/^/      /'
    else
        echo -e "   ${GREEN}✓ Schema applied (new objects created, existing unchanged)${NC}"
    fi

    echo "   Reading target table list after schema apply..."
    docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" --no-psqlrc -t -A -c "
        SELECT table_schema || '.' || table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
    " > "$target_tables" 2>/dev/null

    echo "   Reading target column list after schema apply..."
    docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" --no-psqlrc -t -A -F'|' -c "
        SELECT table_schema || '.' || table_name, column_name
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name, ordinal_position
    " > "$target_columns" 2>/dev/null

    echo "   Reading target required-column list after schema apply..."
    docker exec "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" --no-psqlrc -t -A -F'|' -c "
        SELECT table_schema || '.' || table_name, column_name
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND is_nullable = 'NO'
          AND column_default IS NULL
          AND COALESCE(is_identity, 'NO') = 'NO'
          AND COALESCE(is_generated, 'NEVER') = 'NEVER'
        ORDER BY table_schema, table_name, ordinal_position
    " > "$target_required_columns" 2>/dev/null

    echo "   Reading seed table UID map..."
    PGPASSWORD="$seed_password" psql -h "$seed_host" -p "$seed_port" -U "$seed_user" -d "$seed_name" \
        --no-psqlrc -t -A -F'|' -c "
        SELECT 'public.' || table_name, table_uid
        FROM system_db_tables
        WHERE table_name IS NOT NULL
        ORDER BY table_name
    " > "$seed_table_uids" 2>/dev/null

    # 5b: COALESCE upsert — fills new columns on existing rows, adds missing rows
    # Query primary keys from seed to generate per-table ON CONFLICT clauses
    echo "   Querying table primary keys from seed..."
    PGPASSWORD="$seed_password" psql -h "$seed_host" -p "$seed_port" -U "$seed_user" -d "$seed_name" \
        --no-psqlrc -t -A -F'|' -c "
        SELECT tc.table_schema || '.' || tc.table_name,
               string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position)
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        GROUP BY tc.table_schema, tc.table_name" > "$pk_map" 2>/dev/null

    local pk_count=$(wc -l < "$pk_map" | tr -d ' ')
    echo -e "   ${GREEN}✓ Found primary keys for ${pk_count} tables${NC}"

    echo "   Merging data (COALESCE upsert — fills NULL columns, preserves existing)..."
    echo "   Missing rows → inserted. Existing rows → NULL columns filled from seed."

    # Transform each INSERT INTO ... VALUES into an UPSERT with COALESCE.
    # Uses Python for reliable parsing of column-qualified INSERT statements.
    # For tables WITH a PK:
    #   INSERT INTO t (pk, col) VALUES (1, 'x')
    #   → ON CONFLICT (pk) DO UPDATE SET col = COALESCE(t.col, EXCLUDED.col)
    # For tables WITHOUT a PK:
    #   → ON CONFLICT DO NOTHING (best effort — no unique constraint to merge on)
if ! python3 -c "
import json, sys, re

pk_map = {}
with open('$pk_map') as f:
    for line in f:
        line = line.strip()
        if '|' in line:
            table, pks = line.split('|', 1)
            pk_map[table.strip()] = [c.strip() for c in pks.split(',')]

target_tables = set()
with open('$target_tables') as f:
    for line in f:
        line = line.strip()
        if line:
            target_tables.add(line)

target_columns = {}
with open('$target_columns') as f:
    for line in f:
        line = line.strip()
        if '|' not in line:
            continue
        table, column = line.split('|', 1)
        table = table.strip()
        column = column.strip()
        if not table or not column:
            continue
        target_columns.setdefault(table, set()).add(column)

target_required_columns = {}
with open('$target_required_columns') as f:
    for line in f:
        line = line.strip()
        if '|' not in line:
            continue
        table, column = line.split('|', 1)
        table = table.strip()
        column = column.strip()
        if not table or not column:
            continue
        target_required_columns.setdefault(table, set()).add(column)

no_sync_tables = set()
try:
    with open('$PROJECT_ROOT/server_tools/sync_tool/sync_config.json') as f:
        sync_config = json.load(f)
    for table_name, table_config in sync_config.get('tables', {}).items():
        if table_config.get('sync_direction') == 'no_sync':
            no_sync_tables.add(f'public.{table_name}')
except (OSError, ValueError, TypeError):
    pass

missing_seed_table_uids = set()
with open('$seed_table_uids') as f:
    for line in f:
        line = line.strip()
        if '|' not in line:
            continue
        table_name, table_uid = line.split('|', 1)
        table_name = table_name.strip()
        table_uid = table_uid.strip()
        if table_name and table_uid and table_name not in target_tables:
            missing_seed_table_uids.add(table_uid)

conflict_override_map = {
    # Derivative instances may already have the same lang_key values under
    # different ids, so merge on the stable natural key instead of the seed id.
    'public.system_lang_keys': ['lang_key'],
    'public.system_db_tables': ['table_name'],
    'public.system_functions': ['name'],
}

insert_exclude_map = {
    # When merging on a natural key, keep derivative-local surrogate ids stable.
    'public.system_lang_keys': {'id'},
    'public.system_db_tables': {'id'},
    'public.system_functions': {'id'},
}

table_uid_fk_columns = {
    'table_uid',
    'source_table_uid',
    'target_table_uid',
    'bridging_table_uid',
    'table_a_uid',
    'table_b_uid',
}

def split_sql_csv(items_sql):
    parts = []
    current = []
    in_string = False
    i = 0

    while i < len(items_sql):
        ch = items_sql[i]
        if ch == \"'\":
            current.append(ch)
            if in_string:
                if i + 1 < len(items_sql) and items_sql[i + 1] == \"'\":
                    current.append(items_sql[i + 1])
                    i += 1
                else:
                    in_string = False
            else:
                in_string = True
        elif ch == ',' and not in_string:
            parts.append(''.join(current).strip())
            current = []
        else:
            current.append(ch)
        i += 1

    parts.append(''.join(current).strip())
    return parts

def decode_sql_value(token):
    token = token.strip()
    if token.upper() == 'NULL':
        return None
    if token.startswith(\"'\") and token.endswith(\"'\"):
        return token[1:-1].replace(\"''\", \"'\")
    return token

def should_skip_insert(table, bare_cols, raw_values):
    if table in no_sync_tables:
        return True

    if table not in target_tables:
        return True

    missing_required_cols = target_required_columns.get(table, set()) - set(bare_cols)
    if missing_required_cols:
        return True

    row = {}
    for col, value in zip(bare_cols, raw_values):
        row[col] = decode_sql_value(value)

    if table == 'public.system_db_tables':
        table_name = row.get('table_name')
        if table_name and f'public.{table_name}' not in target_tables:
            return True

    for col in table_uid_fk_columns:
        value = row.get(col)
        if value is not None and str(value) in missing_seed_table_uids:
            return True

    return False

def is_complete_sql_statement(statement):
    trimmed = statement.rstrip()
    if not trimmed.endswith(';'):
        return False

    in_string = False
    i = 0
    while i < len(trimmed):
        ch = trimmed[i]
        if ch == \"'\":
            if in_string:
                if i + 1 < len(trimmed) and trimmed[i + 1] == \"'\":
                    i += 1
                else:
                    in_string = False
            else:
                in_string = True
        i += 1

    return not in_string

def print_transformed_insert(statement):
    s = statement.rstrip('\n')
    m = re.match(
        r'^INSERT INTO\s+(\S+)\s+\(([^)]+)\)\s+'
        r'((?:OVERRIDING\s+(?:SYSTEM|USER)\s+VALUE\s+)?)VALUES\s+',
        s,
    )
    if not m:
        print(s)
        return

    table = m.group(1)
    if table not in target_tables:
        return

    raw_cols = [c.strip() for c in m.group(2).split(',')]
    bare_cols = [c.strip('\"') for c in raw_cols]
    override_clause = m.group(3) or ''
    exclude_cols = insert_exclude_map.get(table, set())
    body = s.rstrip()[:-1] if s.rstrip().endswith(';') else s.rstrip()
    values_sql = body[m.end():].strip()
    has_semicolon = s.rstrip().endswith(';')

    if not (values_sql.startswith('(') and values_sql.endswith(')')):
        print(s)
        return

    raw_values = split_sql_csv(values_sql[1:-1])

    def rebuild_insert_sql():
        statement = f'INSERT INTO {table} AS easelect_sync_target (' + ', '.join(raw_cols) + ') '
        if override_clause:
            statement += override_clause
        statement += 'VALUES (' + ', '.join(raw_values) + ')'
        return statement

    s = rebuild_insert_sql() + (';' if has_semicolon else '')

    if exclude_cols:
        keep_indexes = [i for i, b in enumerate(bare_cols) if b not in exclude_cols]
        raw_cols = [raw_cols[i] for i in keep_indexes]
        bare_cols = [bare_cols[i] for i in keep_indexes]
        raw_values = [raw_values[i] for i in keep_indexes]
        s = rebuild_insert_sql() + (';' if has_semicolon else '')

    existing_target_cols = target_columns.get(table, set())
    if existing_target_cols:
        keep_indexes = [i for i, b in enumerate(bare_cols) if b in existing_target_cols]
        if not keep_indexes:
            return
        if len(keep_indexes) != len(bare_cols):
            raw_cols = [raw_cols[i] for i in keep_indexes]
            bare_cols = [bare_cols[i] for i in keep_indexes]
            raw_values = [raw_values[i] for i in keep_indexes]
            s = rebuild_insert_sql() + (';' if has_semicolon else '')

    # Some derivative targets intentionally or historically lack a subset of
    # seed tables (for example PostGIS-backed tables). Skip data rows for
    # tables that never materialized in the target after schema apply, and
    # skip metadata rows whose table_uid points at those missing tables.
    if should_skip_insert(table, bare_cols, raw_values):
        return

    pk_cols = conflict_override_map.get(table) or pk_map.get(table)
    if pk_cols and any(col not in bare_cols for col in pk_cols):
        pk_cols = None

    if not pk_cols:
        if s.rstrip().endswith(';'):
            print(s.rstrip()[:-1] + ' ON CONFLICT DO NOTHING;')
        else:
            print(s)
        return

    pk_set = set(pk_cols)
    pk_raw = [raw_cols[i] for i, b in enumerate(bare_cols) if b in pk_set]
    non_pk_raw = [raw_cols[i] for i, b in enumerate(bare_cols) if b not in pk_set]

    if not non_pk_raw:
        if s.rstrip().endswith(';'):
            print(s.rstrip()[:-1] + ' ON CONFLICT (' + ', '.join(pk_raw) + ') DO NOTHING;')
        else:
            print(s)
        return

    pk_list = ', '.join(pk_raw)
    set_parts = ', '.join(
        f'{c} = COALESCE(easelect_sync_target.{c}, EXCLUDED.{c})' for c in non_pk_raw
    )
    conflict = f' ON CONFLICT ({pk_list}) DO UPDATE SET {set_parts}'
    if s.rstrip().endswith(';'):
        print(s.rstrip()[:-1] + conflict + ';')
    else:
        print(s)

insert_buffer = []

for line in sys.stdin:
    s = line.rstrip('\n')

    # pg_dump emits an empty search_path reset for restore safety, but the
    # merge phase intentionally replays data into a live derivative where
    # row-level triggers may still use unqualified application table names.
    # Keep the target session's normal search_path instead of forcing '' here.
    if s == \"SELECT pg_catalog.set_config('search_path', '', false);\":
        continue

    if insert_buffer:
        insert_buffer.append(s)
        if is_complete_sql_statement('\n'.join(insert_buffer)):
            print_transformed_insert('\n'.join(insert_buffer))
            insert_buffer = []
        continue

    if s.startswith('INSERT INTO '):
        insert_buffer.append(s)
        if is_complete_sql_statement('\n'.join(insert_buffer)):
            print_transformed_insert('\n'.join(insert_buffer))
            insert_buffer = []
        continue

    print(s)

if insert_buffer:
    print_transformed_insert('\n'.join(insert_buffer))
" < "$data_dump" | \
        docker exec -i "easelect-${instance}-db" \
        psql -U "$db_admin" -d "$db_name" --quiet --no-psqlrc > "$merge_log" 2>&1; then
        true
    fi

    local merge_errors
    merge_errors=$(grep -i "error" "$merge_log" | head -10 || true)

    if [[ -n "$merge_errors" ]]; then
        echo -e "   ${YELLOW}Data merge warnings (non-fatal):${NC}"
        echo "$merge_errors" | sed 's/^/      /'
    fi

    echo -e "   ${GREEN}✓ Data merge complete${NC}"
    echo "     Seed had ${insert_count} rows. Existing values preserved, NULLs filled."

    # ── Step 5b: Sync storage files ───────────────────────────────────────────
    echo ""
    echo "   Syncing storage files..."
    local instance_storage="instances/${instance}/storage"
    mkdir -p "$instance_storage"
    if [[ -d "$PROJECT_ROOT/storage" ]] && [[ -n "$(ls -A "$PROJECT_ROOT/storage/" 2>/dev/null)" ]]; then
        cp -rn "$PROJECT_ROOT/storage/"* "$instance_storage/" 2>/dev/null || true
        echo -e "   ${GREEN}✓ Storage synced (new files only, existing preserved)${NC}"
    fi

    # Restart app so it picks up any DB changes
    echo ""
    echo "   Restarting app container..."
    $(compose_cmd "$instance") restart app 2>/dev/null

    # ── Step 6: Wait for app to be accessible ─────────────────────────────────
    echo ""
    echo -e "${BLUE}[6/6] Waiting for application...${NC}"

    local port="${APP_PORT:-8082}"

    # Cleanup temp files
    rm -f "$schema_dump" "$data_dump" "$pk_map" "$schema_log" "$merge_log" "$target_tables" "$target_columns" "$target_required_columns" "$target_pkey_tables" "$seed_table_uids" "$schema_apply_dump"

    echo ""
    if wait_for_instance_app "$instance" "$port" 60; then
        echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}✅ Instance '${instance}' synced from seed! (merge mode)${NC}"
        echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo "   🌐 Application:  http://localhost:${port}"
        echo "   📦 Code:         rebuilt from latest source"
        echo "   🗄️  Database:     schema updated + ${insert_count} seed rows merged"
        echo "   🔒 Derivative data preserved (COALESCE: existing kept, NULLs filled)"
        echo ""
    else
        echo -e "${YELLOW}════════════════════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}⚠️  Instance '${instance}' sync completed but app not yet responding${NC}"
        echo -e "${YELLOW}════════════════════════════════════════════════════════════════${NC}"
        echo "   Check logs: docker logs easelect-${instance}-app"
        echo ""
    fi
}
