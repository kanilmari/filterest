#!/bin/bash
# ==============================================================================
# setup_local_dev_environment.sh: Automated local development environment setup
#
# This script sets up a fresh local development environment for Easelect or
# generated Filterest public checkouts.
# It handles all the issues discovered during manual setup (see ticket:
# agent_tasks/50_done/2026-02-12-incident-fresh-clone-setup-difficulties.md)
#
# Prerequisites:
#   - Ubuntu/Debian-based system
#   - PostgreSQL 16 installed (apt install postgresql-16 postgresql-16-pgvector)
#   - Go 1.26.5+ and Node.js 24+ installed for the development profile
#   - Neither Go nor Node.js is required for the prebuilt admin profile
#   - Native environment files present at the resolved runtime/development paths
#   - Local TLS files present or openssl available for generating them
#
# Usage:
#   ./server_tools/setup_local_dev_environment.sh [--profile admin|development]
#
# What it does:
#   1. Detects the correct PostgreSQL 16 cluster and port
#   2. Creates required database roles with passwords from the runtime env
#   3. Creates the configured database
#   4. Imports the dump/bootstrap source (auto-strips \restrict/\unrestrict lines)
#   5. Applies schema patches for code-vs-dump mismatches
#   6. Grants required permissions
#   7. Updates the runtime and development env files with the correct port
#   8. Installs npm and Go dependencies
# ==============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
source "$PROJECT_ROOT/server_tools/lib/bootstrap_seed.sh"
source "$PROJECT_ROOT/server_tools/lib/toolchain_version.sh"
source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
easelect_resolve_private_paths "$PROJECT_ROOT"

FORCE_RECREATE=false
RESUME_EXISTING=false
DUMP_SOURCE_KIND=""
SETUP_PROFILE="${FILTEREST_INSTALL_PROFILE:-development}"

project_display_name() {
    if project_is_generated_filterest; then
        printf 'Filterest'
        return
    fi
    printf 'Easelect'
}

project_is_generated_filterest() {
    [[ -f "$PROJECT_ROOT/VERSION_APP" && ! -f "$PROJECT_ROOT/VERSION_EASELECT" ]]
}

project_default_db_name() {
    if project_is_generated_filterest; then
        printf 'filterest'
        return
    fi
    printf 'easelect'
}

project_app_version() {
    if [[ -f "$PROJECT_ROOT/VERSION_APP" ]]; then
        tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_APP"
        return
    fi
    if [[ -f "$PROJECT_ROOT/VERSION_EASELECT" ]]; then
        tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_EASELECT"
        return
    fi
    printf 'unknown'
}

resolve_private_bootstrap_source() {
    local private_dump_slug="easelect"
    local had_nullglob=0
    local dump_candidates=()

    shopt -q nullglob && had_nullglob=1 || true
    shopt -s nullglob
    dump_candidates=(
        "data/db_backups/${private_dump_slug}_full_dump_"*.sql
        "${private_dump_slug}_full_dump_"*.sql
    )
    if [[ "$had_nullglob" -eq 0 ]]; then
        shopt -u nullglob
    fi
    if [[ -f "data/db_backups/${private_dump_slug}_full_dump.sql" ]]; then
        dump_candidates+=("data/db_backups/${private_dump_slug}_full_dump.sql")
    fi
    if [[ -f "${private_dump_slug}_full_dump.sql" ]]; then
        dump_candidates+=("${private_dump_slug}_full_dump.sql")
    fi

    if [[ "${#dump_candidates[@]}" -gt 0 ]]; then
        DUMP_FILE="$(ls -t "${dump_candidates[@]}" | head -1)"
        DUMP_SOURCE_KIND="full_dump"
        return
    fi

    DUMP_FILE="$(current_bootstrap_seed_zip_path 2>/dev/null || true)"
    if [[ -n "$DUMP_FILE" ]]; then
        DUMP_SOURCE_KIND="bootstrap_zip"
    fi
}

ensure_local_tls_files() {
    if [[ -f "$EASELECT_TLS_CERT_FILE" && -f "$EASELECT_TLS_KEY_FILE" ]]; then
        return
    fi

    if ! command -v openssl &>/dev/null; then
        return
    fi

    echo "  Generating local development TLS certificate..."
    mkdir -p "$(dirname "$EASELECT_TLS_CERT_FILE")"
    if easelect_is_private_source_checkout "$PROJECT_ROOT"; then
        chmod 700 "$(dirname "$EASELECT_TLS_CERT_FILE")"
    fi
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$EASELECT_TLS_KEY_FILE" \
        -out "$EASELECT_TLS_CERT_FILE" \
        -days 365 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1
    chmod 600 "$EASELECT_TLS_KEY_FILE"
    chmod 644 "$EASELECT_TLS_CERT_FILE"
}

show_setup_usage() {
    echo "Usage: ./server_tools/setup_local_dev_environment.sh [--force|--resume-existing] [--profile admin|development]"
    echo "  --force                 Drop and recreate an existing non-empty configured database before import"
    echo "  --resume-existing       Skip import for an existing bootstrapped database and finish setup steps"
    echo "  --profile admin         Bootstrap runtime data without Go or Node.js dependencies"
    echo "  --profile development   Bootstrap runtime data and install source-development dependencies"
}

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --force)
            FORCE_RECREATE=true
            shift
            ;;
        --resume-existing)
            RESUME_EXISTING=true
            shift
            ;;
        --profile)
            [[ "$#" -ge 2 ]] || { echo -e "${RED}❌ --profile requires admin or development${NC}"; exit 1; }
            SETUP_PROFILE="$2"
            shift 2
            ;;
        --help|-h)
            show_setup_usage
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Unknown argument: $1${NC}"
            show_setup_usage
            exit 1
            ;;
    esac
done

case "$SETUP_PROFILE" in
    admin|development) ;;
    *)
        echo -e "${RED}❌ Setup profile must be admin or development: ${SETUP_PROFILE}${NC}"
        exit 1
        ;;
esac

if [[ "$FORCE_RECREATE" == true && "$RESUME_EXISTING" == true ]]; then
    echo -e "${RED}❌ --force and --resume-existing cannot be used together${NC}"
    exit 1
fi

echo -e "${BLUE}========================================${NC}"
PROJECT_NAME="$(project_display_name)"

echo -e "${BLUE}  ${PROJECT_NAME} Local Dev Environment Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# --------------------------------------------------------------------------
# Step 0: Check prerequisites
# --------------------------------------------------------------------------
echo -e "${BLUE}[0/8] Checking prerequisites...${NC}"

MISSING=()
[[ ! -f "$EASELECT_RUNTIME_ENV_FILE" ]] && MISSING+=("$EASELECT_RUNTIME_ENV_FILE")
[[ ! -f "$EASELECT_DEV_ENV_FILE" ]] && MISSING+=("$EASELECT_DEV_ENV_FILE")

ensure_local_tls_files
[[ ! -f "$EASELECT_TLS_CERT_FILE" ]] && MISSING+=("$EASELECT_TLS_CERT_FILE")
[[ ! -f "$EASELECT_TLS_KEY_FILE" ]] && MISSING+=("$EASELECT_TLS_KEY_FILE")

# Generated public Filterest checkouts must bootstrap from their own public
# seed path. Private Easelect can still use private full dumps/bootstrap zips.
if project_is_generated_filterest; then
    if [[ -f "server_tools/public_bootstrap/schema.sql" && -f "server_tools/public_bootstrap/seed_data.sql" ]]; then
        DUMP_SOURCE_KIND="public_plain_seed"
        DUMP_FILE="server_tools/public_bootstrap"
    else
        MISSING+=("server_tools/public_bootstrap/{schema.sql,seed_data.sql}")
    fi
else
    resolve_private_bootstrap_source
    if [[ -n "$DUMP_FILE" ]]; then
        :
    elif [[ -f "server_tools/public_bootstrap/schema.sql" && -f "server_tools/public_bootstrap/seed_data.sql" ]]; then
        DUMP_SOURCE_KIND="public_plain_seed"
        DUMP_FILE="server_tools/public_bootstrap"
    else
        MISSING+=("private full dump, private bootstrap zip, or server_tools/public_bootstrap/{schema.sql,seed_data.sql}")
    fi
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo -e "${RED}❌ Missing required files: ${MISSING[*]}${NC}"
    echo "   Generate local env files from scaffold templates, or copy private-only backups only in the private Easelect repo."
    echo "   See README.md for details."
    exit 1
fi

if [[ "$SETUP_PROFILE" == "development" ]]; then
    command -v go &>/dev/null || { echo -e "${RED}❌ Go not found. Install Go ${EASELECT_MIN_GO_VERSION}+${NC}"; exit 1; }
    GO_VERSION="$(easelect_detect_go_version || true)"
    easelect_go_meets_minimum "$GO_VERSION" || {
        echo -e "${RED}❌ Go ${GO_VERSION:-unknown} is unsupported. Install Go ${EASELECT_MIN_GO_VERSION}+${NC}"
        exit 1
    }
    command -v node &>/dev/null || { echo -e "${RED}❌ Node.js not found. Install Node.js 24+${NC}"; exit 1; }
else
    echo -e "${GREEN}  ✓ Admin profile: prebuilt binary selected; Go and Node.js are not required${NC}"
fi
command -v psql &>/dev/null || { echo -e "${RED}❌ psql not found. Install PostgreSQL 16${NC}"; exit 1; }
if [[ "$DUMP_SOURCE_KIND" == "bootstrap_zip" ]]; then
    command -v unzip &>/dev/null || { echo -e "${RED}❌ unzip not found. Install unzip to use the committed bootstrap zip.${NC}"; exit 1; }
fi

echo -e "${GREEN}  ✓ All prerequisites found${NC}"
case "$DUMP_SOURCE_KIND" in
    full_dump)
        echo -e "${GREEN}  ✓ Bootstrap source: full dump (${DUMP_FILE})${NC}"
        ;;
    bootstrap_zip)
        echo -e "${GREEN}  ✓ Bootstrap source: committed bootstrap zip (${DUMP_FILE})${NC}"
        ;;
    public_plain_seed)
        echo -e "${GREEN}  ✓ Bootstrap source: public synthetic seed (${DUMP_FILE})${NC}"
        ;;
esac

# --------------------------------------------------------------------------
# Step 1: Detect PostgreSQL 16 cluster port
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[1/8] Detecting PostgreSQL 16 cluster...${NC}"

PG16_PORT=""
if command -v pg_lsclusters &>/dev/null; then
    PG16_PORT=$(pg_lsclusters -h 2>/dev/null | awk '$1 == "16" && $4 == "online" {print $3}' | head -1)
fi

if [[ -z "$PG16_PORT" ]]; then
    # Fallback: try common ports
    for PORT_TRY in 5432 5433 5434; do
        if pg_isready -p "$PORT_TRY" -q 2>/dev/null; then
            PG_VERSION=$(psql -p "$PORT_TRY" -U postgres -tAc "SHOW server_version_num;" 2>/dev/null || echo "0")
            if [[ "${PG_VERSION:0:2}" == "16" ]]; then
                PG16_PORT="$PORT_TRY"
                break
            fi
        fi
    done
fi

if [[ -z "$PG16_PORT" ]]; then
    echo -e "${RED}❌ PostgreSQL 16 cluster not found or not running.${NC}"
    echo "   Install: sudo apt install postgresql-16 postgresql-16-pgvector"
    echo "   Start:   sudo pg_ctlcluster 16 main start"
    exit 1
fi

echo -e "${GREEN}  ✓ PostgreSQL 16 found on port ${PG16_PORT}${NC}"

# --------------------------------------------------------------------------
# Step 2: Load credentials from the runtime environment
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[2/8] Loading credentials from the runtime environment...${NC}"

get_env_value() {
    local key="$1"
    grep "^${key}=" "$EASELECT_RUNTIME_ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2- || true
}

require_env_value() {
    local key="$1"
    local value="$2"
    if [[ -n "$value" ]]; then
        return 0
    fi
    echo -e "${RED}❌ Required runtime environment value missing: ${key}${NC}"
    echo "   Fill ${key}=... in $EASELECT_RUNTIME_ENV_FILE before running setup on a fresh clone."
    exit 1
}

DB_ADMIN_USER=$(get_env_value "DB_ADMIN_USER")
DB_ADMIN_PASSWORD=$(get_env_value "DB_ADMIN_PASSWORD")
DB_NAME=$(get_env_value "DB_NAME")
DB_SSLMODE=$(get_env_value "DB_SSLMODE")
DB_READONLY_USER=$(get_env_value "DB_READONLY_USER")
DB_READONLY_PASSWORD=$(get_env_value "DB_READONLY_PASSWORD")
DB_CONFIDENTIAL_USER=$(get_env_value "DB_CONFIDENTIAL_USER")
DB_CONFIDENTIAL_PASSWORD=$(get_env_value "DB_CONFIDENTIAL_PASSWORD")
DB_BASIC_USER=$(get_env_value "DB_BASIC_USER")
DB_BASIC_PASSWORD=$(get_env_value "DB_BASIC_PASSWORD")
DB_GUEST_USER=$(get_env_value "DB_GUEST_USER")
DB_GUEST_PASSWORD=$(get_env_value "DB_GUEST_PASSWORD")
SITE_SLUG=$(get_env_value "SITE_SLUG")
FILTEREST_SITE_SLUG=$(get_env_value "FILTEREST_SITE_SLUG")
ENVIRONMENT_TYPE=$(get_env_value "ENVIRONMENT_TYPE")
LOGIN_OTP_CODE=$(get_env_value "LOGIN_OTP_CODE")
FILTEREST_INITIAL_ADMIN_EMAIL=$(get_env_value "FILTEREST_INITIAL_ADMIN_EMAIL")
FILTEREST_INITIAL_ADMIN_HANDOFF_FILE=$(get_env_value "FILTEREST_INITIAL_ADMIN_HANDOFF_FILE")

# Default DB name if not in the runtime environment
DB_NAME="${DB_NAME:-$(project_default_db_name)}"

require_env_value "DB_ADMIN_USER" "$DB_ADMIN_USER"
require_env_value "DB_ADMIN_PASSWORD" "$DB_ADMIN_PASSWORD"

echo -e "${GREEN}  ✓ Credentials loaded${NC}"

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

    run_superuser_psql -qAt \
        --set=role_name="$role_name" \
        --set=role_password="$role_password" \
        --set=role_attributes="$extra_opts" <<'SQL'
\o /dev/null
SELECT format(
    'CREATE ROLE %I WITH LOGIN%s PASSWORD %L',
    :'role_name',
    CASE WHEN btrim(:'role_attributes') = '' THEN '' ELSE ' ' || btrim(:'role_attributes') END,
    :'role_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name');
\gexec
SELECT format(
    'ALTER ROLE %I WITH LOGIN%s PASSWORD %L',
    :'role_name',
    CASE WHEN btrim(:'role_attributes') = '' THEN '' ELSE ' ' || btrim(:'role_attributes') END,
    :'role_password'
);
\gexec
\o
SQL
}

run_local_db_psql_stdin() {
    local operation_label="$1"
    shift
    local log_file=""

    log_file="$(mktemp)"
    if ! PGPASSWORD="$DB_ADMIN_PASSWORD" psql -v ON_ERROR_STOP=1 "$@" \
        -h localhost -p "$PG16_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" >"$log_file" 2>&1; then
        echo -e "${RED}❌ ${operation_label} failed.${NC}"
        echo "   First diagnostics:"
        grep -E "^(ERROR|psql:|NOTICE:)" "$log_file" | head -20 | sed 's/^/   /' || sed -n '1,20p' "$log_file" | sed 's/^/   /'
        rm -f "$log_file"
        exit 1
    fi
    rm -f "$log_file"
}

# Rewrites DB_PORT without relying on GNU sed's incompatible -i syntax.
# Between local PostgreSQL port detection and persisted dev configuration.
# Why: macOS ships BSD sed, where `sed -i` requires a different argument shape.
update_db_port_setting() {
    local config_file="$1"
    local port="$2"
    local temp_file
    local write_target="$config_file"

    temp_file="$(mktemp "${write_target}.tmp.XXXXXX")"
    cp -p "$write_target" "$temp_file"
    if ! sed "s/^DB_PORT=.*/DB_PORT=$port/" "$write_target" > "$temp_file"; then
        rm -f "$temp_file"
        return 1
    fi
    mv "$temp_file" "$write_target"
}

# Creates a generated admin only for the explicitly isolated automated preview.
# Normal fresh installs leave first_run pending for the browser-owned setup form.
ensure_generated_filterest_initial_admin() {
    if ! project_is_generated_filterest; then
        return
    fi

    if [[ "${FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN:-}" != "1" ]]; then
        echo ""
        echo -e "${BLUE}First administrator will be created in the browser on first access.${NC}"
        return
    fi

    local site_slug="${FILTEREST_SITE_SLUG:-${SITE_SLUG:-filterest}}"
    local handoff_file="${FILTEREST_INITIAL_ADMIN_HANDOFF_FILE:-data/bootstrap/initial_admin_credentials.txt}"
    local environment_type_lc
    environment_type_lc="$(printf '%s' "${ENVIRONMENT_TYPE:-}" | tr '[:upper:]' '[:lower:]')"
    local initial_admin_args=(
        --host "localhost"
        --port "$PG16_PORT"
        --db-name "$DB_NAME"
        --db-user "$DB_ADMIN_USER"
        --sslmode "${DB_SSLMODE:-disable}"
        --site-slug "${site_slug:-filterest}"
        --email "${FILTEREST_INITIAL_ADMIN_EMAIL:-}"
        --handoff-file "$handoff_file"
    )

    if [[ "$environment_type_lc" == "dev" && -n "${LOGIN_OTP_CODE:-}" ]]; then
        initial_admin_args+=(--allow-invalid-email)
    fi

    echo ""
    echo -e "${BLUE}Creating isolated automated-preview admin credentials...${NC}"
    FILTEREST_DB_PASSWORD="$DB_ADMIN_PASSWORD" go run ./server_tools/initial_admin_bootstrap "${initial_admin_args[@]}"
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
        local_bootstrap_dir="$(mktemp -d)"
        trap 'rm -rf "${local_bootstrap_dir:-}"' EXIT

        BOOTSTRAP_PASSWORD="$(read_bootstrap_seed_password || true)"
        if [[ -z "${BOOTSTRAP_PASSWORD}" ]]; then
            echo -e "${RED}❌ Bootstrap zip password missing.${NC}"
            echo "   Expected gitignored local file: $(bootstrap_seed_password_file_path)"
            exit 1
        fi

        echo "  Extracting committed bootstrap zip..."
        if ! extract_bootstrap_seed_zip "$DUMP_FILE" "$local_bootstrap_dir" "$BOOTSTRAP_PASSWORD"; then
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
            run_local_db_psql_stdin "Bootstrap schema import" < <(stream_bootstrap_schema_sql "$BOOTSTRAP_SCHEMA_FILE" "1")
            run_local_db_psql_stdin "Bootstrap seed import" < <(sed '/^\\restrict/d;/^\\unrestrict/d' "$BOOTSTRAP_SEED_FILE")
        else
            echo -e "${YELLOW}  WARNING: PostGIS not available — using geometry fallback for bootstrap schema${NC}"
            run_local_db_psql_stdin "Bootstrap schema import" < <(stream_bootstrap_schema_sql "$BOOTSTRAP_SCHEMA_FILE" "0")
            run_local_db_psql_stdin "Bootstrap seed import" < <(sed '/^\\restrict/d;/^\\unrestrict/d' "$BOOTSTRAP_SEED_FILE")
        fi
    elif [[ "$DUMP_SOURCE_KIND" == "public_plain_seed" ]]; then
        PUBLIC_BOOTSTRAP_SCHEMA_FILE="server_tools/public_bootstrap/schema.sql"
        PUBLIC_BOOTSTRAP_SEED_FILE="server_tools/public_bootstrap/seed_data.sql"
        if [[ "$POSTGIS_OK" == "1" ]]; then
            echo "  PostGIS available — importing public schema + synthetic seed"
            run_local_db_psql_stdin "Public schema import" < <(stream_bootstrap_schema_sql "$PUBLIC_BOOTSTRAP_SCHEMA_FILE" "1")
            run_local_db_psql_stdin "Public seed import" < <(sed '/^\\restrict/d;/^\\unrestrict/d' "$PUBLIC_BOOTSTRAP_SEED_FILE")
        else
            echo -e "${YELLOW}  WARNING: PostGIS not available — using geometry fallback for public schema${NC}"
            run_local_db_psql_stdin "Public schema import" < <(stream_bootstrap_schema_sql "$PUBLIC_BOOTSTRAP_SCHEMA_FILE" "0")
            run_local_db_psql_stdin "Public seed import" < <(sed '/^\\restrict/d;/^\\unrestrict/d' "$PUBLIC_BOOTSTRAP_SEED_FILE")
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

REQUIRED_DB_VERSION=$(cat "$PROJECT_ROOT/VERSION_DB" 2>/dev/null | tr -d '[:space:]')
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

    run_local_db_psql_stdin "Database identity initialization" \
        --set=required_db_version="$REQUIRED_DB_VERSION" \
        --set=app_version="${APP_VERSION:-unknown}" <<'SQL'
CREATE TABLE IF NOT EXISTS system_database_identity (
    id                 BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    singleton_key      BOOLEAN     NOT NULL DEFAULT TRUE UNIQUE,
    database_id        VARCHAR(32) NOT NULL UNIQUE DEFAULT md5(random()::text || clock_timestamp()::text),
    database_role      TEXT        NOT NULL DEFAULT 'legacy_unclassified',
    source_database_id VARCHAR(32),
    source_db_version  VARCHAR(20),
    source_app_version VARCHAR(20),
    source_git_commit  VARCHAR(64),
    notes              TEXT        NOT NULL DEFAULT '',
    created            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated            TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_refresh_at    TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION set_system_database_identity_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'set_system_database_identity_updated'
    ) THEN
        CREATE TRIGGER set_system_database_identity_updated
            BEFORE UPDATE ON system_database_identity
            FOR EACH ROW EXECUTE FUNCTION set_system_database_identity_updated_timestamp();
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        GRANT SELECT ON TABLE system_database_identity TO readeronly;
    END IF;
END $$;

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

# --------------------------------------------------------------------------
# Step 7: Grant permissions
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[7/8] Granting permissions...${NC}"

run_local_db_psql_stdin "Permission grants" \
    --set=admin_user="$DB_ADMIN_USER" \
    --set=confidential_user="${DB_CONFIDENTIAL_USER:-limited_user}" \
    --set=readonly_user="${DB_READONLY_USER:-readeronly}" \
    --set=basic_user="${DB_BASIC_USER:-basic_user}" \
    --set=guest_user="${DB_GUEST_USER:-guest_user}" <<'SQL'
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'admin_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA restricted TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA restricted TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT SELECT ON TABLES TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'readonly_user');
\gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'readonly_user');
\gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'confidential_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'basic_user');
\gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'basic_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'guest_user');
\gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'guest_user');
\gexec
SQL

echo -e "${GREEN}  ✓ Permissions granted${NC}"

# --------------------------------------------------------------------------
# Step 8: Update runtime and development env files with correct port
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[8/8] Updating configuration files...${NC}"

# Update runtime environment
if grep -q "^DB_PORT=" "$EASELECT_RUNTIME_ENV_FILE"; then
    CURRENT_PORT=$(grep "^DB_PORT=" "$EASELECT_RUNTIME_ENV_FILE" | cut -d'=' -f2)
    if [[ "$CURRENT_PORT" != "$PG16_PORT" ]]; then
        update_db_port_setting "$EASELECT_RUNTIME_ENV_FILE" "$PG16_PORT"
        echo -e "${GREEN}  ✓ Runtime env: DB_PORT updated from $CURRENT_PORT to $PG16_PORT${NC}"
    else
        echo -e "${GREEN}  ✓ Runtime env: DB_PORT already correct ($PG16_PORT)${NC}"
    fi
fi

# Update development environment
if grep -q "^DB_PORT=" "$EASELECT_DEV_ENV_FILE"; then
    CURRENT_PORT=$(grep "^DB_PORT=" "$EASELECT_DEV_ENV_FILE" | cut -d'=' -f2)
    if [[ "$CURRENT_PORT" != "$PG16_PORT" ]]; then
        update_db_port_setting "$EASELECT_DEV_ENV_FILE" "$PG16_PORT"
        echo -e "${GREEN}  ✓ Development env: DB_PORT updated from $CURRENT_PORT to $PG16_PORT${NC}"
    else
        echo -e "${GREEN}  ✓ Development env: DB_PORT already correct ($PG16_PORT)${NC}"
    fi
fi

# --------------------------------------------------------------------------
# Install dependencies
# --------------------------------------------------------------------------
echo ""
if [[ "$SETUP_PROFILE" == "development" ]]; then
    echo -e "${BLUE}Installing source-development dependencies...${NC}"

    if [[ ! -d "node_modules" ]]; then
        echo "  Running npm ci..."
        npm ci --silent 2>&1 | tail -3
    fi

    echo "  Running go mod download..."
    go mod download 2>&1 | tail -3 || true
else
    echo -e "${GREEN}  ✓ Admin profile: source-development dependencies skipped${NC}"
fi

ensure_generated_filterest_initial_admin

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ Setup complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Database: ${DB_NAME} on port ${PG16_PORT}"
if [[ "$SETUP_PROFILE" == "admin" ]]; then
    echo -e "  Start server: ${BLUE}./filterest start${NC} (prebuilt binary)"
else
    echo -e "  Start server: ${BLUE}./filterest start${NC} (source development)"
fi
ACCESS_PORT="$(get_env_value "APP_PORT")"
ACCESS_PORT="${ACCESS_PORT:-$(get_env_value "PORT")}"
ACCESS_PORT="${ACCESS_PORT:-8082}"
if [[ "$SETUP_PROFILE" == "admin" ]]; then
    echo -e "  Access: ${BLUE}https://localhost:${ACCESS_PORT}${NC}"
else
    echo -e "  Access: ${BLUE}https://localhost:${ACCESS_PORT}${NC}"
fi
echo ""
echo -e "${YELLOW}  Note: storage/ directory is not in git.${NC}"
echo -e "${YELLOW}  If you need uploaded media, copy it from a backup.${NC}"
