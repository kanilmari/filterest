#!/bin/bash
# setup_native_database.sh
# Runs native database roles, guarded import and initial version/identity setup.
# Uses the installer's checked psql helpers and the product identity migration.
# Keeps database setup ordered while the entrypoint owns host/runtime setup.

# --------------------------------------------------------------------------
# Step 3: Create database roles
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[3/8] Creating database roles...${NC}"

# Database setup always uses an explicit database administrator connection.
# OS package and PostgreSQL-cluster provisioning remain separate host tasks.
POSTGRES_SUPERUSER="${POSTGRES_SUPERUSER:-$DB_ADMIN_USER}"
POSTGRES_SUPERUSER_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-$DB_ADMIN_PASSWORD}"
POSTGRES_SUPERUSER_HOST="${POSTGRES_SUPERUSER_HOST:-localhost}"
POSTGRES_SUPERUSER_DB="${POSTGRES_SUPERUSER_DB:-postgres}"

run_superuser_psql() {
    local args=("$@")
    local has_db_arg=0

    for arg in "${args[@]}"; do
        if [[ "$arg" == "-d" || "$arg" == --dbname=* ]]; then
            has_db_arg=1
            break
        fi
    done
    if [[ "$has_db_arg" -eq 0 ]]; then
        args=(-d "$POSTGRES_SUPERUSER_DB" "${args[@]}")
    fi

    PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" psql -v ON_ERROR_STOP=1 \
        -h "$POSTGRES_SUPERUSER_HOST" -p "$PG16_PORT" -U "$POSTGRES_SUPERUSER" \
        "${args[@]}"
}

detect_superuser_access() {
    if [[ -n "$POSTGRES_SUPERUSER_PASSWORD" ]] && \
        [[ "$(PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" psql -h "$POSTGRES_SUPERUSER_HOST" -p "$PG16_PORT" -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_SUPERUSER_DB" -tAc "SELECT rolsuper FROM pg_roles WHERE rolname = current_user;" 2>/dev/null | tr -d '[:space:]')" == "t" ]]; then
        echo -e "${GREEN}  ✓ PostgreSQL superuser access: ${POSTGRES_SUPERUSER}@${POSTGRES_SUPERUSER_HOST}:${PG16_PORT}${NC}"
        return
    fi

    echo -e "${RED}❌ PostgreSQL superuser access unavailable.${NC}"
    echo "   Set POSTGRES_SUPERUSER, POSTGRES_SUPERUSER_PASSWORD,"
    echo "   POSTGRES_SUPERUSER_HOST, and POSTGRES_SUPERUSER_DB to a PostgreSQL superuser connection."
    echo "   Database setup never requests sudo; host installation and cluster provisioning are separate."
    exit 1
}

detect_superuser_access

write_psql_secret_variable() {
    local variable_name="$1"
    local secret_value="$2"
    local encoded_value=""

    if [[ ! "$variable_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        echo -e "${RED}❌ Unsafe psql secret variable name${NC}" >&2
        return 1
    fi
    encoded_value="$(printf '%s' "$secret_value" | od -An -v -tx1 | tr -d ' \n')"
    printf "\\set %s '%s'\n" "$variable_name" "$encoded_value"
}

create_role() {
    local role_name="$1"
    local role_password="$2"
    local extra_opts="${3:-}"

    case "$extra_opts" in
        ""|"SUPERUSER")
            ;;
        *)
            echo -e "${RED}❌ Unsupported role option set for ${role_name}: ${extra_opts}${NC}"
            exit 1
            ;;
    esac

    {
        write_psql_secret_variable role_password_hex "$role_password"
        cat <<'SQL'
\o /dev/null
SELECT format(
    'CREATE ROLE %I WITH LOGIN%s PASSWORD %L',
    :'role_name',
    CASE WHEN btrim(:'role_attributes') = '' THEN '' ELSE ' ' || btrim(:'role_attributes') END,
    convert_from(decode(:'role_password_hex', 'hex'), 'UTF8')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name');
\gexec
SELECT format(
    'ALTER ROLE %I WITH LOGIN%s PASSWORD %L',
    :'role_name',
    CASE WHEN btrim(:'role_attributes') = '' THEN '' ELSE ' ' || btrim(:'role_attributes') END,
    convert_from(decode(:'role_password_hex', 'hex'), 'UTF8')
);
\gexec
\o
SQL
    } | run_superuser_psql -qAt \
        --set=role_name="$role_name" \
        --set=role_attributes="$extra_opts"
}

run_local_db_psql_stdin() {
    local operation_label="$1"
    shift
    local log_file=""

    log_file="$(filterest_recovery_mktemp "$INSTALLATION_ROOT" -- "${TMPDIR:-/tmp}/filterest-setup-log.XXXXXX")" || return
    if ! PGPASSWORD="$DB_ADMIN_PASSWORD" filterest_recovery_to_file "$INSTALLATION_ROOT" "$log_file" \
        _setup_psql_diagnostics "$@"; then
        echo -e "${RED}❌ ${operation_label} failed.${NC}"
        echo "   First diagnostics:"
        grep -E "^(ERROR|psql:|NOTICE:)" "$log_file" | head -20 | sed 's/^/   /' || sed -n '1,20p' "$log_file" | sed 's/^/   /'
        filterest_recovery_output "$INSTALLATION_ROOT" rm -f -- "$log_file" || return
        exit 1
    fi
    filterest_recovery_output "$INSTALLATION_ROOT" rm -f -- "$log_file" || return
}

_setup_psql_diagnostics() {
    psql -v ON_ERROR_STOP=1 "$@" -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" 2>&1
}

_setup_extract_bootstrap_zip() {
    if [[ -n "${FILTEREST_RECOVERY_CONTENT_ROOT:-}" ]]; then
        filterest_recovery_extract_zip "$INSTALLATION_ROOT" "$@"
    else
        extract_bootstrap_seed_zip "$@"
    fi
}

create_role "$DB_ADMIN_USER" "$DB_ADMIN_PASSWORD" "SUPERUSER"
create_role "${DB_READONLY_USER:-readeronly}" "${DB_READONLY_PASSWORD:-readonly_pass}"
create_role "${DB_CONFIDENTIAL_USER:-limited_user}" "${DB_CONFIDENTIAL_PASSWORD:-limited_pass}"
create_role "${DB_BASIC_USER:-basic_user}" "${DB_BASIC_PASSWORD:-basic_pass}"
create_role "${DB_GUEST_USER:-guest_user}" "${DB_GUEST_PASSWORD:-guest_pass}"

# Also create readonly_user and confidential_user if not the same as above
create_role "readonly_user" "${DB_READONLY_PASSWORD:-readonly_pass}"
create_role "confidential_user" "${DB_CONFIDENTIAL_PASSWORD:-limited_pass}"

echo -e "${GREEN}  ✓ Roles created/updated with passwords from the runtime environment${NC}"

public_user_relation_count_sql() {
    cat <<'SQL'
SELECT COUNT(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND NOT EXISTS (
      SELECT 1
      FROM pg_depend d
      WHERE d.objid = c.oid
        AND d.deptype = 'e'
  );
SQL
}

count_public_user_relations_as_superuser() {
    local db_name="$1"
    run_superuser_psql -d "$db_name" -qAt < <(public_user_relation_count_sql)
}

count_public_user_relations_as_admin() {
    PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h localhost -p "$PG16_PORT" \
        -U "$DB_ADMIN_USER" -d "$DB_NAME" -qAt < <(public_user_relation_count_sql)
}

database_overwrite_possible() {
    local db_name="$1"
    local has_config
    local guard_value

    has_config="$(run_superuser_psql -d "$db_name" -qAt 2>/dev/null <<'SQL' || true
SELECT to_regclass('public.system_config') IS NOT NULL;
SQL
)"
    [[ "$has_config" == "t" ]] || return 1

    guard_value="$(run_superuser_psql -d "$db_name" -qAt 2>/dev/null <<'SQL' || true
SELECT COALESCE((
    SELECT CASE WHEN boolean_value IS TRUE THEN 'true' ELSE 'false' END
    FROM public.system_config
    WHERE key = 'overwrite_possible'
    LIMIT 1
), 'missing');
SQL
)"
    [[ "$guard_value" == "true" ]]
}

database_overwrite_guard_summary() {
    local db_name="$1"
    local has_config
    local instance_kind="missing"
    local overwrite_possible="missing"

    has_config="$(run_superuser_psql -d "$db_name" -qAt 2>/dev/null <<'SQL' || true
SELECT to_regclass('public.system_config') IS NOT NULL;
SQL
)"
    if [[ "$has_config" == "t" ]]; then
        instance_kind="$(run_superuser_psql -d "$db_name" -qAt 2>/dev/null <<'SQL' || true
SELECT COALESCE((
    SELECT NULLIF(text_value, '')
    FROM public.system_config
    WHERE key = 'instance_kind'
    LIMIT 1
), 'missing');
SQL
)"
        overwrite_possible="$(run_superuser_psql -d "$db_name" -qAt 2>/dev/null <<'SQL' || true
SELECT COALESCE((
    SELECT CASE WHEN boolean_value IS TRUE THEN 'true' ELSE 'false' END
    FROM public.system_config
    WHERE key = 'overwrite_possible'
    LIMIT 1
), 'missing');
SQL
)"
    fi

    printf 'instance_kind=%s, overwrite_possible=%s' "$instance_kind" "$overwrite_possible"
}

allow_unguarded_filterest_preview_recreate() {
    local db_name="$1"
    local guard_summary

    [[ "${ALLOW_UNGUARDED_FILTEREST_PREVIEW_RECREATE:-}" == "1" ]] || return 1
    project_is_generated_filterest || return 1
    case "$db_name" in
        filterest_local_preview|filterest_preview|filterest) ;;
        *) return 1 ;;
    esac

    guard_summary="$(database_overwrite_guard_summary "$db_name")"
    [[ "$guard_summary" == "instance_kind=missing, overwrite_possible=missing" ]]
}

allow_incomplete_local_setup_recreate() {
    local db_name="$1"
    local has_config

    [[ "${ALLOW_INCOMPLETE_LOCAL_SETUP_RECREATE:-}" == "1" ]] || return 1
    [[ "$db_name" == "$(project_default_db_name)" ]] || return 1

    has_config="$(run_superuser_psql -d "$db_name" -qAt 2>/dev/null <<'SQL' || true
SELECT to_regclass('public.system_config') IS NOT NULL;
SQL
)"
    [[ "$has_config" != "t" ]]
}

# --------------------------------------------------------------------------
# Step 4: Create database
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[4/8] Creating database '${DB_NAME}'...${NC}"

DB_EXISTS=$(run_superuser_psql -qAt --set=db_name="$DB_NAME" 2>/dev/null <<'SQL' || echo ""
SELECT 1 FROM pg_database WHERE datname = :'db_name';
SQL
)

if [[ "$DB_EXISTS" == "1" ]]; then
    EXISTING_PUBLIC_TABLES=$(count_public_user_relations_as_superuser "$DB_NAME" 2>/dev/null || echo "0")
    EXISTING_PUBLIC_TABLES=$(echo "$EXISTING_PUBLIC_TABLES" | tr -d '[:space:]')

    if [[ "$FORCE_RECREATE" == true ]]; then
        if [[ "$EXISTING_PUBLIC_TABLES" -gt 0 ]] && ! database_overwrite_possible "$DB_NAME"; then
            if allow_unguarded_filterest_preview_recreate "$DB_NAME"; then
                echo -e "${YELLOW}  ⚠ Allowing cleanup of incomplete generated Filterest preview database '$DB_NAME'.${NC}"
                echo "   Existing database guard: $(database_overwrite_guard_summary "$DB_NAME")"
                echo "   This override is only accepted for the local sibling Filterest preview helper."
            elif allow_incomplete_local_setup_recreate "$DB_NAME"; then
                echo -e "${YELLOW}  ⚠ Allowing cleanup of incomplete local setup database '$DB_NAME'.${NC}"
                echo "   Existing database guard: $(database_overwrite_guard_summary "$DB_NAME")"
                echo "   This override is only accepted when system_config is absent after a failed setup import."
            else
                echo -e "${RED}❌ Refusing to drop and recreate protected database '$DB_NAME'.${NC}"
                echo "   Existing database guard: $(database_overwrite_guard_summary "$DB_NAME")"
                echo "   Destructive setup --force requires system_config.overwrite_possible=true."
                echo "   Treat missing or false as live/protected data; use migrations, API/admin flows, or a fresh disposable DB instead."
                exit 1
            fi
        fi
        echo -e "${YELLOW}  ⚠ --force enabled: dropping and recreating existing database '$DB_NAME'.${NC}"
        run_superuser_psql -qAt --set=db_name="$DB_NAME" >/dev/null <<'SQL'
SELECT format('DROP DATABASE %I', :'db_name');
\gexec
SQL
        run_superuser_psql -qAt --set=db_name="$DB_NAME" >/dev/null <<'SQL'
SELECT format('CREATE DATABASE %I', :'db_name');
\gexec
SQL
        echo -e "${GREEN}  ✓ Database recreated${NC}"
    elif [[ "$EXISTING_PUBLIC_TABLES" -gt 0 && "$RESUME_EXISTING" == true ]]; then
        SKIP_IMPORT=yes
        echo -e "${YELLOW}  ⚠ Resuming setup against the existing bootstrapped database '$DB_NAME'.${NC}"
    elif [[ "$EXISTING_PUBLIC_TABLES" -gt 0 ]]; then
        echo -e "${RED}❌ Database '$DB_NAME' already exists and is not empty (${EXISTING_PUBLIC_TABLES} public tables).${NC}"
        echo "   Re-run with --force to drop and recreate it before import."
        echo "   Or keep the current database and stop this migration run here."
        exit 1
    else
        echo -e "${YELLOW}  ⚠ Database '$DB_NAME' already exists but appears empty. Reusing it.${NC}"
    fi
else
    run_superuser_psql -qAt --set=db_name="$DB_NAME" >/dev/null <<'SQL'
SELECT format('CREATE DATABASE %I', :'db_name');
\gexec
SQL
    echo -e "${GREEN}  ✓ Database created${NC}"
fi

# --------------------------------------------------------------------------
# Step 5: Enable PostGIS when available and import dump
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[5/8] Preparing PostGIS and importing database dump...${NC}"

echo "  Checking PostGIS extension availability..."
echo "  OS packages are never installed by database setup; missing PostGIS uses the supported fallback."
POSTGIS_AVAILABLE="0"
if PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" \
    -tAc "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis');" 2>/dev/null | grep -q t; then
    POSTGIS_AVAILABLE="1"
fi

ROW_COUNT=$(count_public_user_relations_as_admin 2>/dev/null || echo "0")
ROW_COUNT=$(echo "$ROW_COUNT" | tr -d '[:space:]')

if [[ "$ROW_COUNT" -gt 0 && "${SKIP_IMPORT:-no}" != "yes" ]]; then
    echo -e "${RED}❌ Refusing to import into non-empty database '$DB_NAME' (${ROW_COUNT} public tables).${NC}"
    echo "   Re-run with --force to drop and recreate the database before import."
    exit 1
fi

if [[ "${SKIP_IMPORT:-no}" != "yes" ]]; then
    POSTGIS_OK="0"
    if [[ "$POSTGIS_AVAILABLE" == "1" ]]; then
        POSTGIS_OK="1"
    fi

    if [[ "$DUMP_SOURCE_KIND" == "bootstrap_zip" ]]; then
        local_bootstrap_dir="$(filterest_recovery_mktemp "$INSTALLATION_ROOT" -d -- "${TMPDIR:-/tmp}/filterest-bootstrap.XXXXXX")" || return
        trap 'filterest_recovery_output "$INSTALLATION_ROOT" rm -rf -- "${local_bootstrap_dir:-}" || true' EXIT

        BOOTSTRAP_PASSWORD="$(read_bootstrap_seed_password || true)"
        if [[ -z "${BOOTSTRAP_PASSWORD}" ]]; then
            echo -e "${RED}❌ Bootstrap zip password missing.${NC}"
            echo "   Expected gitignored local file: $(bootstrap_seed_password_file_path)"
            exit 1
        fi

        echo "  Extracting committed bootstrap zip..."
        if ! _setup_extract_bootstrap_zip "$DUMP_FILE" "$local_bootstrap_dir" "$BOOTSTRAP_PASSWORD"; then
            echo -e "${RED}❌ Failed to extract bootstrap zip.${NC}"
            echo "   Check the password in: $(bootstrap_seed_password_file_path)"
            exit 1
        fi

        BOOTSTRAP_SCHEMA_FILE="$local_bootstrap_dir/schema.sql"
        BOOTSTRAP_SEED_FILE="$local_bootstrap_dir/seed_data.sql"
        [[ -f "$BOOTSTRAP_SCHEMA_FILE" ]] || { echo -e "${RED}❌ Bootstrap zip missing schema.sql${NC}"; exit 1; }
        [[ -f "$BOOTSTRAP_SEED_FILE" ]] || { echo -e "${RED}❌ Bootstrap zip missing seed_data.sql${NC}"; exit 1; }

        if [[ "$POSTGIS_OK" == "1" ]]; then
            echo "  PostGIS available — importing bootstrap schema + seed"
        else
            echo -e "${YELLOW}  WARNING: PostGIS not available — using geometry fallback for bootstrap schema${NC}"
        fi
        if ! import_bootstrap_package "$BOOTSTRAP_SCHEMA_FILE" "$BOOTSTRAP_SEED_FILE" "$POSTGIS_OK" \
            env PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME"; then
            echo -e "${RED}❌ Bootstrap import failed.${NC}"
            exit 1
        fi
    elif [[ "$DUMP_SOURCE_KIND" == "public_plain_seed" ]]; then
        PUBLIC_BOOTSTRAP_SCHEMA_FILE="$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap/schema.sql"
        PUBLIC_BOOTSTRAP_SEED_FILE="$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap/seed_data.sql"
        if [[ "$POSTGIS_OK" == "1" ]]; then
            echo "  PostGIS available — importing public schema + synthetic seed"
        else
            echo -e "${YELLOW}  WARNING: PostGIS not available — using geometry fallback for public schema${NC}"
        fi
        if ! import_bootstrap_package "$PUBLIC_BOOTSTRAP_SCHEMA_FILE" "$PUBLIC_BOOTSTRAP_SEED_FILE" "$POSTGIS_OK" \
            env PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME"; then
            echo -e "${RED}❌ Public bootstrap import failed.${NC}"
            exit 1
        fi
    elif [[ "$POSTGIS_OK" == "1" ]]; then
        echo "  PostGIS available — importing dump directly"
        run_local_db_psql_stdin "Full dump import" < "$DUMP_FILE"
    else
        echo -e "${YELLOW}  WARNING: PostGIS not available — using sed fallback (geometry -> text)${NC}"
        echo "  - This prevents COPY data bleed-through when PostGIS tables fail"

        # Fallback fix: replace postgis.geometry(Point,4326) with text.
        # When COPY ... FROM stdin fails (table doesn't exist because PostGIS is missing),
        # psql does NOT consume the COPY data lines. They bleed into SQL parsing and
        # corrupt ALL subsequent tables until the parser recovers.
        # By replacing the geometry type with text, the table gets created, COPY succeeds,
        # and downstream tables are not affected.
        run_local_db_psql_stdin "Full dump import" < <(stream_bootstrap_schema_sql "$DUMP_FILE" "0")
    fi

    # Verify data was imported with a few canonical core tables, not just one config row.
    CONFIG_COUNT=$(PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM system_config;" 2>/dev/null || echo "0")
    DB_TABLE_COUNT=$(PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM system_db_tables;" 2>/dev/null || echo "0")

    if [[ "$CONFIG_COUNT" -gt 0 && "$DB_TABLE_COUNT" -gt 0 ]]; then
        echo -e "${GREEN}  ✓ Dump imported successfully (system_config=${CONFIG_COUNT}, system_db_tables=${DB_TABLE_COUNT})${NC}"
    else
        echo -e "${RED}  ❌ Import verification failed: system_config=${CONFIG_COUNT}, system_db_tables=${DB_TABLE_COUNT}${NC}"
        echo "     Check the output above for errors."
        exit 1
    fi
fi

# --------------------------------------------------------------------------
# Step 6: Apply schema patches (code newer than dump)
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[6/8] Applying schema patches...${NC}"

run_local_db_psql_stdin "Schema patches" <<'SQL'
ALTER TABLE system_db_tables ADD COLUMN IF NOT EXISTS is_main_table BOOLEAN DEFAULT false;
ALTER TABLE system_db_tables ADD COLUMN IF NOT EXISTS is_about_table BOOLEAN DEFAULT false;
SQL

echo -e "${GREEN}  ✓ Schema patches applied${NC}"

# --------------------------------------------------------------------------
# Step 6b: Initialize DB version tracking
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[6b/8] Initializing version tracking...${NC}"

if project_is_generated_filterest; then
    REQUIRED_DB_VERSION=$(cat "$FILTEREST_SOURCE_ROOT/VERSION_DB" 2>/dev/null | tr -d '[:space:]')
else
    REQUIRED_DB_VERSION=$(cat "$INSTALLATION_ROOT/VERSION_DB" 2>/dev/null | tr -d '[:space:]')
fi
APP_VERSION="$(project_app_version)"

if [[ -n "$REQUIRED_DB_VERSION" ]]; then
    run_local_db_psql_stdin "Version tracking initialization" \
        --set=required_db_version="$REQUIRED_DB_VERSION" \
        --set=app_version="${APP_VERSION:-unknown}" <<'SQL'
CREATE TABLE IF NOT EXISTS system_db_version (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    version VARCHAR(20) NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    description TEXT
);

INSERT INTO system_db_version (version, description)
SELECT
    :'required_db_version',
    format('Initial version from setup script (app v%s)', :'app_version')
WHERE NOT EXISTS (SELECT 1 FROM system_db_version);
SQL

    # Setup can import an older dump before application startup runs migrations.
    # Use the same migration transaction here; never define identity schema twice.
    run_local_db_psql_stdin "Database identity schema migration" --single-transaction \
        < "$SCRIPT_DIR/migrations/20261009000079_reconcile_system_database_identity_schema.sql"

    run_local_db_psql_stdin "Database identity initialization" \
        --set=required_db_version="$REQUIRED_DB_VERSION" \
        --set=app_version="${APP_VERSION:-unknown}" <<'SQL'
INSERT INTO system_database_identity (
    singleton_key,
    database_role,
    source_database_id,
    source_db_version,
    source_app_version,
    source_git_commit,
    notes,
    last_refresh_at
)
SELECT
    TRUE,
    'legacy_unclassified',
    NULL,
    :'required_db_version',
    :'app_version',
    NULL,
    'Initialized by setup_local_dev_environment.sh because the imported database did not include explicit identity tracking.',
    NOW()
WHERE NOT EXISTS (SELECT 1 FROM system_database_identity);
SQL

    ACTUAL_DB_VERSION=$(PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -tAc "SELECT version FROM system_db_version ORDER BY applied_at DESC, id DESC LIMIT 1;" 2>/dev/null || echo "unknown")
    IDENTITY_ROW_COUNT=$(PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM system_database_identity;" 2>/dev/null || echo "0")
    echo -e "${GREEN}  ✓ DB version: ${ACTUAL_DB_VERSION} (required: ≥ ${REQUIRED_DB_VERSION})${NC}"
    echo -e "${GREEN}  ✓ DB identity rows: ${IDENTITY_ROW_COUNT}${NC}"
else
    echo -e "${YELLOW}  ⚠ VERSION_DB file not found, skipping version tracking${NC}"
fi

