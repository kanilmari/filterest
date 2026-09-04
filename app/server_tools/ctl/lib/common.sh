#!/bin/bash
# common.sh
# Provides shared lifecycle, port, process, and presentation helpers for ctl.
# Bridges standalone Filterest ownership checks with embedded Easelect legacy control paths.
# Exists so destructive runtime actions remain centralized and product-boundary aware.
# ==============================================================================
# common.sh: Shared utilities for Easelect Control CLI
#
# Contains colors, helper functions, and shared variables.
# ==============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default values
LOG_FILE="${FILTEREST_LOG_FILE_OVERRIDE:-server_output.log}"
PORT=${EASELECT_PORT:-${FILTEREST_STANDALONE_DEFAULT_PORT:-8082}}
LOCAL_BINARY_DIR="${FILTEREST_RUNTIME_ROOT:-${PROJECT_ROOT:-.}/runtime}/bin"
LOCAL_BINARY_PATH="$LOCAL_BINARY_DIR/easelect_dev"
: "${EASELECT_RUNTIME_ENV_FILE:=${PROJECT_ROOT:-.}/.env}"
: "${EASELECT_DEV_ENV_FILE:=${PROJECT_ROOT:-.}/dev_env.txt}"
: "${EASELECT_TLS_CERT_FILE:=${PROJECT_ROOT:-.}/dev-cert.crt}"
: "${EASELECT_TLS_KEY_FILE:=${PROJECT_ROOT:-.}/dev-cert.key}"

# ------------------------------------------------------------------------------
# Convert ASCII text to lowercase with POSIX tools.
# Between ctl arguments and case-insensitive comparisons it replaces Bash 4's
# built-in case conversion. Why: macOS still ships Bash 3.2 for /bin/bash scripts.
# ------------------------------------------------------------------------------
ascii_lowercase() {
    printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]'
}

project_display_name() {
    if filterest_is_standalone_public_install; then
        printf 'Filterest'
        return
    fi
    printf 'Easelect'
}

# Identify a standalone public Filterest source even when its mutable
# installation root is the parent directory of the immutable app source.
filterest_is_standalone_public_install() {
    [[ -f "${FILTEREST_SOURCE_ROOT:-$PROJECT_ROOT}/VERSION_APP" ]] &&
        [[ ! -f "$PROJECT_ROOT/VERSION_EASELECT" ]]
}

filterest_uses_standalone_root_ctl() {
    [[ "${FILTEREST_STANDALONE_ROOT_CTL:-0}" == "1" ]] &&
        filterest_is_standalone_public_install
}

filterest_default_vite_port() {
    if filterest_uses_standalone_root_ctl; then
        printf '%s' "${FILTEREST_STANDALONE_DEFAULT_VITE_PORT:-9100}"
        return
    fi
    printf '5173'
}

_standalone_runtime_env_file() {
    if [[ -f "$EASELECT_DEV_ENV_FILE" ]]; then
        printf '%s' "$EASELECT_DEV_ENV_FILE"
        return
    fi
    printf '%s' "$EASELECT_RUNTIME_ENV_FILE"
}

_standalone_configured_backend_port() {
    local env_file
    local configured=""
    env_file="$(_standalone_runtime_env_file)"
    configured="$(_read_local_env_value "APP_PORT" "$env_file")"
    [[ -n "$configured" ]] || configured="$(_read_local_env_value "PORT" "$env_file")"
    [[ -n "$configured" ]] || configured="$(_read_local_env_value "EASELECT_PORT" "$env_file")"
    printf '%s' "${configured:-${FILTEREST_STANDALONE_DEFAULT_PORT:-8100}}"
}

_standalone_configured_vite_port() {
    local env_file
    env_file="$(_standalone_runtime_env_file)"
    _read_local_env_value "VITE_DEV_PORT" "$env_file" "$(filterest_default_vite_port)"
}

_standalone_configured_vite_hmr_port() {
    local env_file
    local vite_port
    env_file="$(_standalone_runtime_env_file)"
    vite_port="$(_standalone_configured_vite_port)"
    _read_local_env_value "VITE_HMR_PORT" "$env_file" "$vite_port"
}

_standalone_listener_matches_role() {
    local index="$1"
    local role="$2"
    local pid="${FILTEREST_PREFLIGHT_CAPTURED_PIDS[$index]}"
    local cwd="${FILTEREST_PREFLIGHT_CAPTURED_CWDS[$index]}"
    local executable="${FILTEREST_PREFLIGHT_CAPTURED_EXECUTABLES[$index]}"
    local expected_backend=""
    local command_line=""

    if [[ "$role" == "backend" ]]; then
        [[ "$cwd" == "$(cd "$PROJECT_ROOT" && pwd -P)" ]] || return 1
        expected_backend="$(readlink -f "$LOCAL_BINARY_PATH" 2>/dev/null || true)"
        [[ -n "$expected_backend" ]] || expected_backend="$LOCAL_BINARY_PATH"
        [[ "$executable" == "$expected_backend" || \
           "$executable" == "$expected_backend (deleted)" ]]
        return
    fi

    [[ "$cwd" == "$(cd "$FILTEREST_BUILD_ROOT" && pwd -P)" ]] || return 1
    command_line="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    [[ "$command_line" == *"node_modules/vite/"* || \
       "$command_line" == *"node_modules/.bin/vite"* ]]
}

_stop_standalone_listener_on_port() {
    local port="$1"
    local role="$2"
    local pids=""
    local index=0
    local listening_status=0

    filterest_port_is_listening "$port" || listening_status=$?
    case "$listening_status" in
        1) return 0 ;;
        0) ;;
        *) return 1 ;;
    esac
    pids="$(filterest_port_listener_pids "$port" || true)"
    [[ -n "$pids" ]] || {
        echo "error: listener on port $port could not be identified safely" >&2
        return 1
    }
    filterest_capture_interactive_listener_snapshot "$port" "$pids" || return 1
    for index in "${!FILTEREST_PREFLIGHT_CAPTURED_PIDS[@]}"; do
        if ! _standalone_listener_matches_role "$index" "$role"; then
            echo "error: refusing to stop unrelated listener on standalone $role port $port" >&2
            return 1
        fi
    done
    filterest_stop_listener_pids \
        "$port" "$pids" "Standalone Filterest $role stopped." \
        "" "" "" "" "" 1
}

_stop_standalone_local_runtime() {
    local backend_port
    local vite_port
    local vite_hmr_port
    backend_port="$(_standalone_configured_backend_port)"
    vite_port="$(_standalone_configured_vite_port)"
    vite_hmr_port="$(_standalone_configured_vite_hmr_port)"
    _stop_standalone_listener_on_port "$backend_port" backend || return 1
    if [[ "$vite_port" != "$backend_port" ]]; then
        _stop_standalone_listener_on_port "$vite_port" vite || return 1
    fi
    if [[ "$vite_hmr_port" != "$backend_port" && "$vite_hmr_port" != "$vite_port" ]]; then
        _stop_standalone_listener_on_port "$vite_hmr_port" vite || return 1
    fi
}

# Resolve the product's bare database default without overriding an explicit
# DB_NAME from an existing environment file. Standalone Filterest owns the
# `filterest` default; the embedded Easelect composition retains `easelect`.
project_default_db_name() {
    if filterest_is_standalone_public_install; then
        printf 'filterest'
        return
    fi
    printf 'easelect'
}

# Resolve the single-instance Docker definition without coupling Filterest to
# an embedding product's private directory layout. Standalone Filterest uses
# its canonical public stack; Easelect's outer launcher supplies its private
# development Compose file explicitly.
filterest_local_docker_compose_file() {
    printf '%s\n' "${FILTEREST_LOCAL_DOCKER_COMPOSE_FILE:-${FILTEREST_SOURCE_ROOT:-$PROJECT_ROOT}/docker/docker-compose.yml}"
}

_shared_dev_storage_helper() {
    printf '%s\n' "${FILTEREST_SHARED_DEV_STORAGE_HELPER:-}"
}

_shared_dev_storage_deactivate_if_enabled() {
    local helper
    helper="$(_shared_dev_storage_helper)"
    [[ -x "$helper" ]] || return 0
    # Normal lifecycle output stays owner-facing; the helper still emits
    # failure diagnostics, while its explicit status action retains details.
    "$helper" deactivate --quiet
}

# ------------------------------------------------------------------------------
# Stop local runtime pieces that conflict with native dev startup
# ------------------------------------------------------------------------------
_stop_local_runtime_components() {
    local go_run_process_pattern="${FILTEREST_GO_RUN_PROCESS_PATTERN:-go run main.go}"

    # Stop local Go processes (including temp build binaries)
    if pgrep -f "$go_run_process_pattern" > /dev/null 2>&1; then
        echo "   Stopping local Go processes..."
        pkill -f "$go_run_process_pattern" 2>/dev/null || true
    fi

    # Stop Go temp build binaries (/tmp/go-build...)
    if pgrep -f "/tmp/go-build.*/main" > /dev/null 2>&1; then
        echo "   Stopping Go temp binaries..."
        pkill -f "/tmp/go-build.*/main" 2>/dev/null || true
    fi

    # Stop compiled binary
    if pgrep -f "/easelect$" > /dev/null 2>&1; then
        echo "   Stopping compiled binary..."
        pkill -f "/easelect$" 2>/dev/null || true
    fi

    # Stop the local ctl-built binary so it can run graceful shutdown hooks.
    if pgrep -f "/easelect_dev$" > /dev/null 2>&1; then
        echo "   Stopping local compiled binary..."
        pkill -f "/easelect_dev$" 2>/dev/null || true
    fi

    # Stop systemd service
    if systemctl is-active --quiet easelect 2>/dev/null; then
        echo "   Stopping systemd service..."
        sudo systemctl stop easelect
    fi
}

# ------------------------------------------------------------------------------
# Stop local Docker dev stack only (preserves derivative instances)
# ------------------------------------------------------------------------------
_stop_local_dev_docker_stack() {
    local compose_file
    compose_file="$(filterest_local_docker_compose_file)"

    if ! command -v docker &> /dev/null || ! docker info &> /dev/null 2>&1; then
        return
    fi

    if docker compose --env-file "$EASELECT_RUNTIME_ENV_FILE" -f "$compose_file" ps -q 2>/dev/null | grep -q .; then
        echo "   Stopping local Docker dev stack..."
        docker compose --env-file "$EASELECT_RUNTIME_ENV_FILE" -f "$compose_file" down 2>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# Free a fixed list of local development ports
# ------------------------------------------------------------------------------
_free_local_dev_ports() {
    for port in 8082 8083 5173; do
        if fuser ${port}/tcp > /dev/null 2>&1; then
            echo "   Freeing port ${port}..."

            # Try a graceful TERM first so app shutdown hooks can flush logs/stats.
            fuser -k -TERM ${port}/tcp > /dev/null 2>&1 || true
            for _i in {1..50}; do
                fuser ${port}/tcp > /dev/null 2>&1 || break
                sleep 0.1
            done

            # Escalate only if the process ignored TERM.
            if fuser ${port}/tcp > /dev/null 2>&1; then
                echo "   Escalating port ${port} to SIGKILL..."
                fuser -k ${port}/tcp > /dev/null 2>&1 || true
                for _i in {1..50}; do
                    fuser ${port}/tcp > /dev/null 2>&1 || break
                    sleep 0.1
                done
            fi
        fi
    done
}

# ------------------------------------------------------------------------------
# Stop local runtime without touching derivative Docker instances
# ------------------------------------------------------------------------------
stop_local_runtime() {
    echo -e "${YELLOW}🛑 Stopping local $(project_display_name) runtime...${NC}"
    if filterest_uses_standalone_root_ctl; then
        _stop_standalone_local_runtime
        echo -e "${GREEN}✅ Local standalone Filterest runtime stopped${NC}"
        return
    fi
    _stop_local_runtime_components
    _stop_local_dev_docker_stack
    _free_local_dev_ports
    _shared_dev_storage_deactivate_if_enabled
    echo -e "${GREEN}✅ Local runtime stopped${NC}"
}

# ------------------------------------------------------------------------------
# Stop all instances
# ------------------------------------------------------------------------------
stop_all() {
    echo -e "${YELLOW}🛑 Stopping all $(project_display_name) instances...${NC}"
    if filterest_uses_standalone_root_ctl; then
        _stop_standalone_local_runtime
        echo -e "${GREEN}✅ Standalone Filterest runtime stopped${NC}"
        return
    fi
    _stop_local_runtime_components
    _stop_local_dev_docker_stack
    _free_local_dev_ports
    _shared_dev_storage_deactivate_if_enabled

    echo -e "${GREEN}✅ All instances stopped${NC}"
}

# ------------------------------------------------------------------------------
# Check prerequisites
# ------------------------------------------------------------------------------
check_env_file() {
    local env_file="${1:-$EASELECT_RUNTIME_ENV_FILE}"

    if [[ ! -f "$env_file" ]]; then
        echo -e "${RED}❌ ${env_file} file not found${NC}"
        echo "   Create one with database credentials before starting."
        exit 1
    fi

    warn_secret_env_file_permissions "$env_file" "ctl startup"
}

check_port_available() {
    local preserve_derivative_instances="${1:-false}"

    if lsof -i :${PORT} > /dev/null 2>&1; then
        if filterest_uses_standalone_root_ctl; then
            echo -e "${YELLOW}⚠️  Port ${PORT} is in use. Verifying this installation's backend...${NC}"
            _stop_standalone_listener_on_port "$PORT" backend
            return
        fi
        if [[ "${FILTEREST_REFUSE_OCCUPIED_PORT:-0}" == "1" ]]; then
            echo -e "${RED}❌ Port ${PORT} is already in use; refusing broad automatic cleanup.${NC}" >&2
            return 1
        fi
        echo -e "${YELLOW}⚠️  Port ${PORT} is in use. Stopping existing processes...${NC}"
        if [[ "$preserve_derivative_instances" == "true" ]]; then
            stop_local_runtime
        else
            stop_all
        fi
    fi
}

# ------------------------------------------------------------------------------
# Success message
# ------------------------------------------------------------------------------
print_success() {
    local mode="${1:-local}"
    local project_name
    project_name="$(project_display_name)"
    local db_env_file="$EASELECT_RUNTIME_ENV_FILE"
    if [[ -f "$EASELECT_DEV_ENV_FILE" ]]; then
        db_env_file="$EASELECT_DEV_ENV_FILE"
    fi
    local vite_port
    vite_port="$(_read_local_env_value "VITE_DEV_PORT" "$db_env_file" "$(filterest_default_vite_port)")"
    vite_port="${vite_port:-$(filterest_default_vite_port)}"
    local db_host
    db_host="$(_read_local_env_value "DB_HOST" "$db_env_file")"
    local db_port
    db_port="$(_read_local_env_value "DB_PORT" "$db_env_file")"
    local shared_dev_storage_enabled
    shared_dev_storage_enabled="$(_read_local_env_value "SHARED_DEV_STORAGE_ENABLED" "$db_env_file")"
    db_host="${db_host:-localhost}"
    db_port="${db_port:-5432}"
    shared_dev_storage_enabled="${shared_dev_storage_enabled:-false}"
    if [[ "$mode" == "docker" ]]; then
        vite_port="${VITE_PORT:-$vite_port}"
        db_host="${DB_BIND_HOST:-127.0.0.1}"
        db_port="${DB_PORT:-$db_port}"
    fi
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ ${project_name} is running! (${mode} mode)${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "   🌐 Application:  https://localhost:${PORT}"
    if [[ "$mode" == "docker" ]]; then
        echo "   🔧 Vite Dev:     http://localhost:${vite_port}/frontend/"
        echo "   🗄️  Database:     ${db_host}:${db_port} (Docker PostgreSQL)"
    else
        if _vite_dev_server_is_ready "$vite_port"; then
            echo "   ⚡ HMR Dev:      http://localhost:${vite_port}  (live CSS/JS reload)"
        else
            echo "   ⚠️  HMR Dev:     not responding on http://localhost:${vite_port}"
        fi
        local db_label="Local PostgreSQL"
        if [[ "$db_port" != "5433" ]]; then
            db_label="Shared dev DB target"
        fi
        echo "   🗄️  Database:     ${db_host}:${db_port} (${db_label})"
        if [[ "$(printf '%s' "$shared_dev_storage_enabled" | tr '[:upper:]' '[:lower:]')" == "true" ]]; then
            echo "   📦 Shared development data ready (app runs locally; files synchronized with VPS)"
        else
            echo "   📦 Development data: local only"
        fi
        echo "   📋 Logs:         tail -f ${LOG_FILE}"
    fi
    echo ""
    echo "   To stop: ./ctl --stop"
    echo ""
}

# ------------------------------------------------------------------------------
# Ngrok tunnel
# ------------------------------------------------------------------------------
start_ngrok() {
    local port="$1"
    local instance="$2"
    
    echo ""
    echo -e "${BLUE}🔗 Starting ngrok tunnel...${NC}"
    
    # Check if ngrok is installed
    if ! command -v ngrok &> /dev/null; then
        echo -e "${YELLOW}⚠️  ngrok not found. Install with: snap install ngrok${NC}"
        echo "   Skipping ngrok tunnel."
        return 1
    fi
    
    # Kill any existing ngrok processes for this port
    pkill -f "ngrok.*${port}" 2>/dev/null || true
    sleep 1
    
    # Start ngrok in background
    local ngrok_log="${PROJECT_ROOT}/instances/${instance}/ngrok.log"
    nohup ngrok http https://localhost:${port} --log=stdout > "$ngrok_log" 2>&1 &
    local ngrok_pid=$!
    
    # Wait for ngrok to start and get URL
    echo "   Waiting for ngrok tunnel..."
    sleep 3
    
    # Try to get the public URL from ngrok API
    local ngrok_url=""
    for i in {1..10}; do
        ngrok_url=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4)
        if [[ -n "$ngrok_url" ]]; then
            break
        fi
        sleep 1
    done
    
    if [[ -n "$ngrok_url" ]]; then
        echo -e "${GREEN}   ✅ Ngrok tunnel active${NC}"
        echo "   🌍 Public URL: ${ngrok_url}"
        echo "   📋 Ngrok log:  ${ngrok_log}"
        echo "   🔧 Dashboard:  http://localhost:4040"
    else
        echo -e "${YELLOW}   ⚠️  Could not get ngrok URL. Check ${ngrok_log}${NC}"
        echo "   Dashboard: http://localhost:4040"
    fi
}

# ------------------------------------------------------------------------------
# Resolve instance name from partial match
# If query matches exactly one instance, returns it. Otherwise shows options.
# Usage: INSTANCE_NAME=$(resolve_instance_name "serlog")
# ------------------------------------------------------------------------------
resolve_instance_name() {
    local query="$1"
    local query_lower=""
    
    if [[ -z "$query" ]]; then
        echo ""
        return 1
    fi

    query_lower="$(ascii_lowercase "$query")"
    
    # Collect all matching instances
    local matches=()
    for dir in instances/*/; do
        if [[ -d "$dir" ]] && [[ "$(basename "$dir")" != "template" ]]; then
            local name=$(basename "$dir")
            local name_lower
            name_lower="$(ascii_lowercase "$name")"
            # Check if query matches (case-insensitive partial match)
            if [[ "$name_lower" == *"$query_lower"* ]]; then
                matches+=("$name")
            fi
        fi
    done
    
    # Exact match check first
    for dir in instances/*/; do
        if [[ -d "$dir" ]]; then
            local name=$(basename "$dir")
            if [[ "$name" == "$query" ]]; then
                echo "$name"
                return 0
            fi
        fi
    done
    
    # Handle match results
    if [[ ${#matches[@]} -eq 0 ]]; then
        echo -e "${RED}❌ No instance matching '${query}'${NC}" >&2
        echo "   Available instances:" >&2
        ls -1 instances/ 2>/dev/null | grep -v template | grep -v ".env" | sed 's/^/     /' >&2
        return 1
    elif [[ ${#matches[@]} -eq 1 ]]; then
        echo "${matches[0]}"
        return 0
    else
        echo -e "${YELLOW}⚠️  Multiple instances match '${query}':${NC}" >&2
        for m in "${matches[@]}"; do
            echo "     $m" >&2
        done
        echo "   Please be more specific." >&2
        return 1
    fi
}
