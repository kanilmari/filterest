#!/bin/bash
# ==============================================================================
# instance_helpers.sh: Shared helper functions for instance management
#
# Contains utility functions used by multiple instance management modules:
# - Terminal hyperlink helper (OSC 8)
# - Table separator printing
# - Seed database configuration reader
# - Docker health-check waiter
# ==============================================================================

: "${EASELECT_RUNTIME_ENV_FILE:=${PROJECT_ROOT:-.}/.env}"
: "${EASELECT_DEV_ENV_FILE:=${PROJECT_ROOT:-.}/dev_env.txt}"

# ------------------------------------------------------------------------------
# Helper: Normalize an Easelect instance role / bootstrap seed profile.
# Between instance .env files and bootstrap consumers it keeps one small role
# vocabulary. Why: management instances must be initialized from management
# seeds, not from normal application/dev data.
# ------------------------------------------------------------------------------
normalize_instance_role() {
    local instance_role="${1:-application}"

    case "${instance_role}" in
        application|management)
            printf '%s\n' "${instance_role}"
            ;;
        *)
            echo -e "${RED}❌ Unsupported instance role: ${instance_role}${NC}" >&2
            echo "   Expected: application or management" >&2
            return 1
            ;;
    esac
}

# ------------------------------------------------------------------------------
# Helper: Resolve bootstrap seed profile from an instance env file.
# Between INSTANCE_ROLE and BOOTSTRAP_SEED_PROFILE it preserves one import
# decision. Why: old envs may know only the role, while new envs can pin the
# seed profile explicitly.
# ------------------------------------------------------------------------------
instance_seed_profile_from_env() {
    local env_file="$1"
    local seed_profile=""
    local instance_role=""

    seed_profile=$(grep -E "^BOOTSTRAP_SEED_PROFILE=" "$env_file" 2>/dev/null | tail -1 | cut -d'=' -f2)
    instance_role=$(grep -E "^INSTANCE_ROLE=" "$env_file" 2>/dev/null | tail -1 | cut -d'=' -f2)

    normalize_instance_role "${seed_profile:-${instance_role:-application}}"
}

# ------------------------------------------------------------------------------
# Helper: Create clickable terminal hyperlink (OSC 8)
# Usage: make_link "https://url" "display text"
# Falls back to plain text if terminal doesn't support hyperlinks.
# ------------------------------------------------------------------------------
make_link() {
    local url="$1"
    local text="$2"
    # OSC 8 hyperlink: \e]8;;URL\e\\TEXT\e]8;;\e\\
    printf '\e]8;;%s\e\\%s\e]8;;\e\\' "$url" "$text"
}

# ------------------------------------------------------------------------------
# Helper: Print a row of dashes matching total table width
# Uses plain ASCII dash for reliable width in all terminals.
# ------------------------------------------------------------------------------
print_separator() {
    local width="$1"
    printf '%*s\n' "$width" '' | tr ' ' '-'
}

# ------------------------------------------------------------------------------
# Helper: Read seed DB credentials from the resolved development environment.
# Used by both sync_instance and init_instance to connect to the local dev DB.
# Returns variables: seed_host, seed_port, seed_user, seed_name, seed_password
# ------------------------------------------------------------------------------
read_seed_db_config() {
    local config_file="$EASELECT_DEV_ENV_FILE"

    if [[ ! -f "$config_file" ]]; then
        echo -e "${RED}❌ Development environment file not found: ${config_file}${NC}"
        exit 1
    fi

    # Read DB_HOST and DB_PORT from the canonical native development config.
    seed_host=$(grep -E "^DB_HOST=" "$config_file" | tail -1 | cut -d'=' -f2)
    seed_port=$(grep -E "^DB_PORT=" "$config_file" | tail -1 | cut -d'=' -f2)
    seed_name=$(grep -E "^DB_NAME=" "$config_file" | tail -1 | cut -d'=' -f2)

    # Admin credentials are marked with ###. This basic-regex form works with
    # the BSD sed shipped on macOS; BSD grep has no GNU Perl-regex option.
    seed_user=$(sed -n 's/^###DB_USER=\([^#]*\).*/\1/p' "$config_file" | head -1)
    seed_password=$(sed -n 's/^###DB_PASSWORD=\([^#]*\).*/\1/p' "$config_file" | head -1)

    seed_host="${seed_host:-localhost}"
    seed_port="${seed_port:-5433}"
    seed_user="${seed_user:-admin_user}"
    seed_name="${seed_name:-easelect}"
}

# ------------------------------------------------------------------------------
# Helper: Wait for a Docker instance's app to become reachable via HTTP(S)
# Usage: wait_for_instance_app <instance_name> <port> [timeout_seconds]
# Returns 0 if healthy, 1 if timed out.
# ------------------------------------------------------------------------------
wait_for_instance_app() {
    local instance="$1"
    local port="$2"
    local timeout="${3:-60}"

    for i in $(seq 1 "$timeout"); do
        if curl -s -o /dev/null "http://localhost:${port}/" --max-time 2 2>/dev/null; then
            return 0
        fi
        if curl -k -s -o /dev/null "https://localhost:${port}/" --max-time 2 2>/dev/null; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# ------------------------------------------------------------------------------
# Helper: Wait for a Docker instance's database to become ready
# Usage: wait_for_instance_db <instance_name> <db_admin_user> <db_name> [timeout]
# Returns 0 if ready, 1 if timed out.
# ------------------------------------------------------------------------------
wait_for_instance_db() {
    local instance="$1"
    local db_admin="$2"
    local db_name="$3"
    local timeout="${4:-60}"

    for i in $(seq 1 "$timeout"); do
        if docker exec "easelect-${instance}-db" pg_isready -h 127.0.0.1 -U "$db_admin" -d "$db_name" &>/dev/null; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# ------------------------------------------------------------------------------
# Helper: Derive Docker Compose project name from instance name
# Matches the convention used by existing containers (first segment before dot).
# Examples: "serlog.com" → "serlog", "example.com" → "example"
# Usage: local proj=$(compose_project_name "serlog.com")
# ------------------------------------------------------------------------------
compose_project_name() {
    local instance="$1"
    echo "${instance%%.*}"
}

# ------------------------------------------------------------------------------
# Helper: Build the docker compose file list for an instance.
# Adds the DB port reset override when DB_PORT=0, so host DB publication can be
# disabled without changing the default compose template for older instances.
# ------------------------------------------------------------------------------
compose_files_for_instance() {
    local env_file="$1"
    local db_port=""

    printf '%s' "-f docker/docker-compose.instance.yml"

    db_port=$(grep -E "^DB_PORT=" "$env_file" 2>/dev/null | tail -1 | cut -d'=' -f2)
    if [[ "${db_port}" == "0" ]]; then
        printf ' %s' "-f docker/docker-compose.instance.no-db-port.yml"
    fi
}

# ------------------------------------------------------------------------------
# Helper: Build the base docker compose command for an instance
# Includes the correct project name, compose file, and env file.
# Usage: local cmd=$(compose_cmd "serlog.com")
#        $cmd up -d
# ------------------------------------------------------------------------------
compose_cmd() {
    local instance="$1"
    local env_file="instances/${instance}/.env"
    local project=$(compose_project_name "$instance")
    local compose_files
    compose_files=$(compose_files_for_instance "$env_file")
    echo "docker compose -p ${project} ${compose_files} --env-file ${env_file}"
}

# ------------------------------------------------------------------------------
# Helper: Validate the numeric non-root identity used by Docker bind mounts.
# Between instance env values and image creation it rejects malformed or
# privileged IDs before Docker can create an unusable runtime user.
# Why: Linux and WSL storage ownership must match a real non-root host account.
# ------------------------------------------------------------------------------
validate_docker_runtime_identity() {
    local runtime_uid="$1"
    local runtime_gid="$2"

    if [[ ! "$runtime_uid" =~ ^[0-9]+$ ]] || [[ ! "$runtime_gid" =~ ^[0-9]+$ ]]; then
        echo "error: Docker runtime UID and GID must be numeric" >&2
        return 1
    fi
    if (( runtime_uid < 1000 || runtime_gid < 1000 )); then
        echo "error: Docker runtime UID and GID must be non-root IDs (1000 or greater)" >&2
        return 1
    fi
}

# ------------------------------------------------------------------------------
# Helper: Export build/runtime overrides for one local Docker instance command.
# Between the instance env file, the root dev env, and docker compose it keeps
# local derivative containers aligned with the intended dev/prod auth behavior.
# Why: local instance refreshes should honor ENVIRONMENT_TYPE for the binary
# build, and reserved dev fixtures reuse LOGIN_OTP_CODE when the root dev env provides it.
# ------------------------------------------------------------------------------
prepare_instance_compose_env() {
    local env_file="$1"
    local env_type=""
    local root_env_file="$EASELECT_RUNTIME_ENV_FILE"
    local root_login_otp=""
    local configured_runtime_uid=""
    local configured_runtime_gid=""

    easelect_prepare_docker_context_boundaries "$PROJECT_ROOT"
    env_type=$(grep -E "^ENVIRONMENT_TYPE=" "$env_file" 2>/dev/null | tail -1 | cut -d'=' -f2)
    env_type="${env_type:-dev}"

    export BUILD_ENV="${BUILD_ENV:-${env_type}}"
    export EASELECT_APP_VERSION="${EASELECT_APP_VERSION:-$(tr -d '[:space:]' < "${PROJECT_ROOT}/VERSION_EASELECT" 2>/dev/null || printf 'unknown')}"
    export EASELECT_DB_VERSION="${EASELECT_DB_VERSION:-$(tr -d '[:space:]' < "${PROJECT_ROOT}/VERSION_DB" 2>/dev/null || printf 'unknown')}"
    export EASELECT_GIT_COMMIT="${EASELECT_GIT_COMMIT:-$(git -C "${PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || printf 'unknown')}"
    configured_runtime_uid=$(grep -E "^EASELECT_RUNTIME_UID=" "$env_file" 2>/dev/null | tail -1 | cut -d'=' -f2)
    configured_runtime_gid=$(grep -E "^EASELECT_RUNTIME_GID=" "$env_file" 2>/dev/null | tail -1 | cut -d'=' -f2)
    export EASELECT_RUNTIME_UID="${EASELECT_RUNTIME_UID:-${configured_runtime_uid:-$(id -u)}}"
    export EASELECT_RUNTIME_GID="${EASELECT_RUNTIME_GID:-${configured_runtime_gid:-$(id -g)}}"
    validate_docker_runtime_identity "$EASELECT_RUNTIME_UID" "$EASELECT_RUNTIME_GID"

    if [[ "$env_type" == "dev" ]]; then
        if [[ -z "${LOGIN_OTP_CODE:-}" && -f "$root_env_file" ]]; then
            root_login_otp=$(grep -E "^LOGIN_OTP_CODE=" "$root_env_file" 2>/dev/null | tail -1 | cut -d'=' -f2-)
            if [[ -n "$root_login_otp" ]]; then
                export LOGIN_OTP_CODE="$root_login_otp"
            fi
        fi
    else
        unset LOGIN_OTP_CODE || true
    fi
}

# ------------------------------------------------------------------------------
# Helper: Normalize one instance's active and recoverable media bind mounts.
# Between the host-side storage trees and the app container it ensures the
# non-root container user can traverse, read, and archive media files.
# Why: both storage roots must remain writable across Docker rebuilds.
# ------------------------------------------------------------------------------
normalize_instance_storage_permissions() {
    local instance="$1"
    local storage_name
    local instance_storage
    local write_probe

    for storage_name in storage storage_deleted; do
        instance_storage="${PROJECT_ROOT}/instances/${instance}/${storage_name}"
        mkdir -p "$instance_storage"

        if ! chmod -R u+rwX,g+rwX,o-rwx "$instance_storage"; then
            echo "error: cannot normalize Docker storage permissions: ${instance_storage}" >&2
            return 1
        fi
        if ! write_probe="$(mktemp "${instance_storage}/.easelect-write-probe.XXXXXX")"; then
            echo "error: Docker storage is not writable by the current user: ${instance_storage}" >&2
            return 1
        fi
        rm -f "$write_probe"
    done
}
