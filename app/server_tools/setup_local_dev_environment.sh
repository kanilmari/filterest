#!/bin/bash
# ==============================================================================
# setup_local_dev_environment.sh: Automated local development environment setup
#
# This script sets up a fresh local development environment for Filterest.
# The outer Easelect checkout can invoke the same implementation through its
# transition wrapper while the public source move is in progress.
#
# Prerequisites:
#   - Ubuntu/Debian-based system
#   - PostgreSQL 16 installed (apt install postgresql-16 postgresql-16-pgvector)
#   - Go 1.26.9+ and Node.js 24+ installed for the development profile
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

SCRIPT_SOURCE_DIRECTORY="$(dirname -- "${BASH_SOURCE[0]}" 2>/dev/null)" || { printf 'Recovery launcher location unavailable; sensitive details withheld.\n' >&2; exit 1; }
SCRIPT_DIR="$(cd -- "$SCRIPT_SOURCE_DIRECTORY" 2>/dev/null && pwd 2>/dev/null)" 2>/dev/null || { printf 'Recovery launcher location unavailable; sensitive details withheld.\n' >&2; exit 1; }
FILTEREST_SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/.." 2>/dev/null && pwd -P 2>/dev/null)" || { printf 'Recovery source location unavailable; sensitive details withheld.\n' >&2; exit 1; }
INSTALLATION_ROOT="${FILTEREST_ROOT:-${FILTEREST_PROJECT_ROOT_OVERRIDE:-$FILTEREST_SOURCE_ROOT}}"
INSTALLATION_ROOT="$(cd -- "$INSTALLATION_ROOT" 2>/dev/null && pwd -P 2>/dev/null)" 2>/dev/null || { printf 'Recovery installation root unavailable; sensitive details withheld.\n' >&2; exit 1; }
PROJECT_ROOT="$INSTALLATION_ROOT"
FILTEREST_BUILD_ROOT="${FILTEREST_BUILD_ROOT_OVERRIDE:-$FILTEREST_SOURCE_ROOT}"
if [[ -f "$INSTALLATION_ROOT/VERSION_EASELECT" ]]; then
    FILTEREST_BUILD_ROOT="${FILTEREST_BUILD_ROOT_OVERRIDE:-$INSTALLATION_ROOT}"
fi
RUNTIME_ROOT="$INSTALLATION_ROOT/runtime"
if [[ "$FILTEREST_SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
    RUNTIME_ROOT="$INSTALLATION_ROOT/data/runtime"
fi
NODE_DEPENDENCY_ROOT="$FILTEREST_BUILD_ROOT"
if [[ "$FILTEREST_SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
    NODE_DEPENDENCY_ROOT="$RUNTIME_ROOT/node"
fi
cd "$INSTALLATION_ROOT"

source "$SCRIPT_DIR/lib/installation_records.sh"
source "$SCRIPT_DIR/lib/public_bootstrap.sh"
source "$SCRIPT_DIR/lib/toolchain_version.sh"
source "$SCRIPT_DIR/lib/easelect_private_paths.sh"
source "$SCRIPT_DIR/lib/source_dependency_installer.sh"
source "$SCRIPT_DIR/lib/setup_runtime_paths.sh"
if [[ -n "${FILTEREST_PRIVATE_BOOTSTRAP_LIB:-}" ]]; then
    # Private Easelect may additionally restore its encrypted release-paired
    # bootstrap archive. Standalone Filterest intentionally does not ship this
    # private artifact contract and always uses its plain public bootstrap.
    [[ -f "$FILTEREST_PRIVATE_BOOTSTRAP_LIB" ]] || {
        echo "Private bootstrap helper not found: $FILTEREST_PRIVATE_BOOTSTRAP_LIB" >&2
        exit 1
    }
    source "$FILTEREST_PRIVATE_BOOTSTRAP_LIB"
fi
resolve_installation_private_paths() {
    easelect_resolve_private_paths "$INSTALLATION_ROOT"
    if [[ "$FILTEREST_SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
        local protected_runtime_root="$FILTEREST_KEYS_HOME/filterest_runtime"
        EASELECT_RUNTIME_ENV_FILE="$protected_runtime_root/runtime_environment.env"
        EASELECT_DEV_ENV_FILE="$protected_runtime_root/development_environment.env"
        EASELECT_TLS_CERT_FILE="$protected_runtime_root/local_tls_certificate/localhost_certificate.crt"
        EASELECT_TLS_KEY_FILE="$protected_runtime_root/local_tls_certificate/localhost_private_key.key"
        export EASELECT_RUNTIME_ENV_FILE EASELECT_DEV_ENV_FILE
        export EASELECT_TLS_CERT_FILE EASELECT_TLS_KEY_FILE
    fi
}
resolve_installation_private_paths

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
    [[ -f "$FILTEREST_SOURCE_ROOT/VERSION_APP" && ! -f "$INSTALLATION_ROOT/VERSION_EASELECT" ]]
}

project_default_db_name() {
    if project_is_generated_filterest; then
        printf 'filterest'
        return
    fi
    printf 'easelect'
}

project_app_version() {
    if project_is_generated_filterest; then
        tr -d '[:space:]' < "$FILTEREST_SOURCE_ROOT/VERSION_APP"
        return
    fi
    if [[ -f "$INSTALLATION_ROOT/VERSION_EASELECT" ]]; then
        tr -d '[:space:]' < "$INSTALLATION_ROOT/VERSION_EASELECT"
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
    local certificate_directory=""
    if [[ -f "$EASELECT_TLS_CERT_FILE" && -f "$EASELECT_TLS_KEY_FILE" ]]; then
        return
    fi

    if ! command -v openssl &>/dev/null; then
        return
    fi

    echo "  Generating local development TLS certificate..."
    certificate_directory="$(filterest_recovery_utility "$INSTALLATION_ROOT" dirname -- "$EASELECT_TLS_CERT_FILE")" || return
    (umask 077; filterest_recovery_output "$INSTALLATION_ROOT" mkdir -p -- "$certificate_directory") || return
    if easelect_is_private_source_checkout "$PROJECT_ROOT"; then
        filterest_recovery_output "$INSTALLATION_ROOT" chmod 700 -- "$certificate_directory" || return
    fi
    if [[ -n "${FILTEREST_RECOVERY_CONTENT_ROOT:-}" ]]; then
        filterest_recovery_tls_identity "$INSTALLATION_ROOT" "$EASELECT_TLS_CERT_FILE" "$EASELECT_TLS_KEY_FILE" \
            -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" \
            -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1" || return
        filterest_recovery_output "$INSTALLATION_ROOT" chmod 644 -- "$EASELECT_TLS_CERT_FILE" || return
        return
    fi
    filterest_recovery_output "$INSTALLATION_ROOT" openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$EASELECT_TLS_KEY_FILE" \
        -out "$EASELECT_TLS_CERT_FILE" \
        -days 365 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1" >/dev/null || return
    filterest_recovery_output "$INSTALLATION_ROOT" chmod 600 -- "$EASELECT_TLS_KEY_FILE" || return
    filterest_recovery_output "$INSTALLATION_ROOT" chmod 644 -- "$EASELECT_TLS_CERT_FILE" || return
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
    if [[ -f "$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap/schema.sql" && -f "$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap/seed_data.sql" ]]; then
        DUMP_SOURCE_KIND="public_plain_seed"
        DUMP_FILE="$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap"
    else
        MISSING+=("$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap/{schema.sql,seed_data.sql}")
    fi
else
    resolve_private_bootstrap_source
    if [[ -n "$DUMP_FILE" ]]; then
        :
    elif [[ -f "$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap/schema.sql" && -f "$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap/seed_data.sql" ]]; then
        DUMP_SOURCE_KIND="public_plain_seed"
        DUMP_FILE="$FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap"
    else
        MISSING+=("private full dump, private bootstrap zip, or $FILTEREST_SOURCE_ROOT/server_tools/public_bootstrap/{schema.sql,seed_data.sql}")
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

filterest_recovery_python "$INSTALLATION_ROOT" python3 "$SCRIPT_DIR/lib/database_recovery.py" setup-key \
    --root "$INSTALLATION_ROOT" --profile native \
    --settings "$EASELECT_DEV_ENV_FILE" --settings "$EASELECT_RUNTIME_ENV_FILE"

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

# Rewrites DB_PORT without relying on GNU sed's incompatible -i syntax.
# Between local PostgreSQL port detection and persisted dev configuration.
# Why: macOS ships BSD sed, where `sed -i` requires a different argument shape.
update_db_port_setting() {
    local config_file="$1"
    local port="$2"
    local temp_file
    local write_target="$config_file"

    if [[ -n "${FILTEREST_RECOVERY_CONTENT_ROOT:-}" ]]; then
        filterest_recovery_content_to_file "$INSTALLATION_ROOT" "$write_target" sed "s/^DB_PORT=.*/DB_PORT=$port/" "$write_target"
        return
    fi

    temp_file="$(filterest_recovery_utility "$INSTALLATION_ROOT" mktemp -- "${write_target}.tmp.XXXXXX")" || return
    filterest_recovery_output "$INSTALLATION_ROOT" cp -p -- "$write_target" "$temp_file" || return
    if ! sed "s/^DB_PORT=.*/DB_PORT=$port/" "$write_target" > "$temp_file"; then
        filterest_recovery_output "$INSTALLATION_ROOT" rm -f -- "$temp_file" || return
        return 1
    fi
    filterest_recovery_output "$INSTALLATION_ROOT" mv -- "$temp_file" "$write_target" || return
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
    if [[ -n "${FILTEREST_RECOVERY_CONTENT_ROOT:-}" ]]; then
        printf 'Recovery refuses automated-preview credential file creation.\n' >&2
        return 1
    fi

    local handoff_file=""
    handoff_file="$(filterest_resolve_initial_admin_handoff_file \
        "$FILTEREST_SOURCE_ROOT" \
        "$INSTALLATION_ROOT" \
        "${FILTEREST_INITIAL_ADMIN_HANDOFF_FILE:-}")" || return 1
    local environment_type_lc
    environment_type_lc="$(printf '%s' "${ENVIRONMENT_TYPE:-}" | tr '[:upper:]' '[:lower:]')"
    local initial_admin_args=(
        --host "localhost"
        --port "$PG16_PORT"
        --db-name "$DB_NAME"
        --db-user "$DB_ADMIN_USER"
        --sslmode "${DB_SSLMODE:-disable}"
        --email "${FILTEREST_INITIAL_ADMIN_EMAIL:-}"
        --handoff-file "$handoff_file"
    )

    if [[ "$environment_type_lc" == "dev" && -n "${LOGIN_OTP_CODE:-}" ]]; then
        initial_admin_args+=(--allow-invalid-email)
    fi

    echo ""
    echo -e "${BLUE}Creating isolated automated-preview admin credentials...${NC}"
    # The isolated preview admin hashes the configured local PIN. Keep the PIN
    # scoped to this child process just like the database password instead of
    # exporting either secret into the parent shell.
    FILTEREST_SITE_SLUG="${FILTEREST_SITE_SLUG:-}" \
        SITE_SLUG="${SITE_SLUG:-}" \
        LOGIN_OTP_CODE="$LOGIN_OTP_CODE" \
        FILTEREST_DB_PASSWORD="$DB_ADMIN_PASSWORD" \
        GOMODCACHE="$RUNTIME_ROOT/go/module-cache" \
        GOCACHE="$RUNTIME_ROOT/go/build-cache" \
        GOFLAGS=-mod=readonly \
        go -C "$FILTEREST_SOURCE_ROOT" run ./server_tools/initial_admin_bootstrap \
            "${initial_admin_args[@]}"
}

# Database roles, guarded import and identity initialization share one setup step.
source "$SCRIPT_DIR/lib/setup_native_database.sh"

# --------------------------------------------------------------------------
# Step 7: Grant permissions
# --------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[7/8] Granting permissions...${NC}"

source "$SCRIPT_DIR/lib/setup_database_grants.sh"
grant_local_database_permissions

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

    filterest_install_node_dependencies "$FILTEREST_BUILD_ROOT" "$RUNTIME_ROOT" "$NODE_DEPENDENCY_ROOT"
    echo "  Running go mod download..."
    filterest_download_go_modules "$FILTEREST_SOURCE_ROOT" "$RUNTIME_ROOT"
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
if [[ -z "$ACCESS_PORT" ]]; then
    # shellcheck source=server_tools/lib/filterest_port_preflight.sh
    source "$SCRIPT_DIR/lib/filterest_port_preflight.sh"
    ACCESS_PORT="$(filterest_native_default_port "$PROJECT_ROOT")"
fi
if [[ "$SETUP_PROFILE" == "admin" ]]; then
    echo -e "  Access: ${BLUE}https://localhost:${ACCESS_PORT}${NC}"
else
    echo -e "  Access: ${BLUE}https://localhost:${ACCESS_PORT}${NC}"
fi
echo ""
STORAGE_DISPLAY_PATH="storage/"
if [[ "$FILTEREST_SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
    STORAGE_DISPLAY_PATH="data/storage/"
fi
echo -e "${YELLOW}  Note: ${STORAGE_DISPLAY_PATH} directory is not in git.${NC}"
echo -e "${YELLOW}  If you need uploaded media, copy it from a backup.${NC}"
