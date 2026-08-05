#!/bin/bash
# ==============================================================================
# local.sh: Local development mode for Easelect Control CLI
#
# Starts the Go backend locally without Docker.
# Includes logging reliability checks (snap Go detection, log verification).
# ==============================================================================

source "$PROJECT_ROOT/server_tools/lib/toolchain_version.sh"

# ------------------------------------------------------------------------------
# Helper: show local dev server log
# ------------------------------------------------------------------------------
_show_local_journal() {
    local lines="${1:-50}"
    if [[ ! -f "$LOG_FILE" ]]; then
        echo -e "${YELLOW}⚠️  No log file found at ${LOG_FILE}${NC}"
        echo "   Start the local server first with: ./ctl"
        exit 1
    fi
    local line_count
    line_count=$(wc -l < "$LOG_FILE")
    if [[ "$line_count" -eq 0 ]]; then
        echo -e "${YELLOW}⚠️  Log file exists but is empty (${LOG_FILE})${NC}"
        echo "   This may indicate the server process cannot write to the file."
        echo "   If using snap Go, ensure the server was built with 'go build' first."
        return
    fi
    echo -e "${BLUE}📋 Showing last ${lines} lines of local server log (${LOG_FILE}) [${line_count} total]${NC}"
    echo ""
    tail -n "$lines" "$LOG_FILE"
}

# ------------------------------------------------------------------------------
# Helper: verify logging works after server start
# Waits briefly and checks that log file has content.
# ------------------------------------------------------------------------------
_verify_logging() {
    sleep 2
    if [[ -f "$LOG_FILE" ]]; then
        local line_count
        line_count=$(wc -l < "$LOG_FILE")
        if [[ "$line_count" -eq 0 ]]; then
            echo -e "${YELLOW}⚠️  Warning: server_output.log is empty after startup${NC}"
            echo "   The server process may not be writing logs correctly."
            # Check if this is a snap Go issue
            local go_path
            go_path=$(which go 2>/dev/null)
            if [[ "$go_path" == *"/snap/"* ]]; then
                echo -e "${YELLOW}   Detected snap Go (${go_path}).${NC}"
                echo "   Snap Go's 'go run' creates sandboxed subprocesses that cannot write logs."
                echo "   The server should be started via 'go build' + binary (which ctl already does)."
            fi
        fi
    fi
}

# ------------------------------------------------------------------------------
# Helper: launch a long-lived child detached from the current shell/session
# Uses setsid when available so terminal runners do not reap the child when the
# parent ctl command exits.
# ------------------------------------------------------------------------------
_launch_detached() {
    local stdout_target="$1"
    shift

    if command -v setsid > /dev/null 2>&1; then
        nohup setsid "$@" > "$stdout_target" 2>&1 < /dev/null &
    else
        nohup "$@" > "$stdout_target" 2>&1 < /dev/null &
    fi

    disown || true
}

# ------------------------------------------------------------------------------
# Helper: read one env value from the active local env with runtime fallback
# ------------------------------------------------------------------------------
_read_local_env_value() {
    local key="$1"
    local primary_env_file="$2"
    local default_value="${3:-}"
    local candidate_file=""
    local value=""

    for candidate_file in "$primary_env_file" "$EASELECT_RUNTIME_ENV_FILE"; do
        [[ -f "$candidate_file" ]] || continue
        value=$(grep -E "^${key}=" "$candidate_file" 2>/dev/null | tail -1 | cut -d'=' -f2- || true)
        if [[ -n "$value" ]]; then
            printf '%s\n' "$value"
            return 0
        fi
    done

    printf '%s\n' "$default_value"
}

# ------------------------------------------------------------------------------
# Helper: suggest the shared-dev SSH tunnel when the configured local DB target
# looks like a localhost tunnel instead of the default native PostgreSQL port.
# ------------------------------------------------------------------------------
_print_shared_dev_db_tunnel_hint() {
    local db_host="$1"
    local db_port="$2"
    local db_env_file="$3"
    local shared_dev_host=""
    local shared_dev_user=""
    local ssh_key=""

    if [[ "$db_host" != "127.0.0.1" && "$db_host" != "localhost" ]]; then
        return 0
    fi
    if [[ "$db_port" == "5433" ]]; then
        return 0
    fi

    shared_dev_host="$(_read_local_env_value "SHARED_DEV_VPS_HOST" "$db_env_file")"
    shared_dev_user="$(_read_local_env_value "SHARED_DEV_VPS_USER" "$db_env_file")"
    if [[ -z "$shared_dev_host" || -z "$shared_dev_user" ]]; then
        return 0
    fi

    ssh_key="$(_read_local_env_value "SHARED_DEV_DB_SSH_KEY_PATH" "$db_env_file")"
    if [[ -z "$ssh_key" ]]; then
        ssh_key="$(_read_local_env_value "DOCKER_VPS_SSH_KEY_PATH" "$db_env_file")"
    fi
    if [[ -z "$ssh_key" ]]; then
        ssh_key="$(_read_local_env_value "DEPLOY_SSH_KEY_PATH" "$db_env_file" "$HOME/.ssh/easelect_key")"
    fi

    echo "   Shared-dev DB tunnel may be down."
    echo "   Start it with:"
    echo "   ssh -N -L ${db_port}:127.0.0.1:${db_port} -i ${ssh_key} ${shared_dev_user}@${shared_dev_host}"
}

# ------------------------------------------------------------------------------
# Helper: start Vite dev server for HMR (if not already running)
# ------------------------------------------------------------------------------
_vite_dev_server_is_ready() {
    local vite_port="$1"
    curl -s -o /dev/null "http://localhost:${vite_port}/" --max-time 1 2>/dev/null
}

_start_vite_dev() {
    local db_env_file="${1:-$EASELECT_RUNTIME_ENV_FILE}"
    local vite_port
    local vite_hmr_port
    local vite_backend_url

    vite_port="$(_read_local_env_value "VITE_DEV_PORT" "$db_env_file" "5173")"
    vite_hmr_port="$(_read_local_env_value "VITE_HMR_PORT" "$db_env_file" "$vite_port")"
    vite_backend_url="$(_read_local_env_value "VITE_BACKEND_URL" "$db_env_file")"
    if [[ -z "$vite_backend_url" ]]; then
        vite_backend_url="$(_read_local_env_value "VITE_GO_BACKEND" "$db_env_file" "https://localhost:${PORT}")"
    fi

    if fuser "${vite_port}/tcp" > /dev/null 2>&1; then
        if _vite_dev_server_is_ready "$vite_port"; then
            echo -e "${BLUE}⚡ Vite dev server already running on port ${vite_port}${NC}"
            return 0
        fi
        echo -e "${YELLOW}⚠️  Port ${vite_port} is in use, but Vite did not respond${NC}"
        echo "   CSS/JS HMR unavailable. Free the port or start Vite manually."
        return 1
    fi
    if ! command -v npx &> /dev/null; then
        echo -e "${YELLOW}⚠️  npx not found — skipping Vite dev server${NC}"
        return 1
    fi
    echo "⚡ Starting Vite dev server (HMR) on port ${vite_port}..."
    _launch_detached /dev/null env \
        VITE_DEV_PORT="$vite_port" \
        VITE_HMR_PORT="$vite_hmr_port" \
        VITE_BACKEND_URL="$vite_backend_url" \
        npx vite frontend --host 127.0.0.1 --strictPort
    # Wait for Vite to be ready (100ms intervals, max 10s)
    for _i in {1..100}; do
        if _vite_dev_server_is_ready "$vite_port"; then
            echo -e "${GREEN}⚡ Vite dev server ready on http://localhost:${vite_port}${NC}"
            return 0
        fi
        sleep 0.1
    done
    echo -e "${YELLOW}⚠️  Vite dev server did not start in time — CSS HMR unavailable${NC}"
    echo "   Start manually with: VITE_DEV_PORT=${vite_port} VITE_HMR_PORT=${vite_hmr_port} npm run dev"
    return 1
}

_shared_dev_storage_helper() {
    printf '%s\n' "$PROJECT_ROOT/server_tools/shared_dev_db/sync_shared_dev_storage.sh"
}

_shared_dev_storage_prepare() {
    local helper
    helper="$(_shared_dev_storage_helper)"
    [[ -x "$helper" ]] || return 0
    "$helper" prepare
}

_shared_dev_storage_start_sync() {
    local helper
    helper="$(_shared_dev_storage_helper)"
    [[ -x "$helper" ]] || return 0
    "$helper" start-sync
}

_shared_dev_storage_release() {
    local helper
    helper="$(_shared_dev_storage_helper)"
    [[ -x "$helper" ]] || return 0
    "$helper" release
}

# ------------------------------------------------------------------------------
# Local mode
# ------------------------------------------------------------------------------
start_local() {
    local custom_port="${1:-}"
    local preserve_derivative_instances="${2:-false}"
    local shared_dev_storage_prepared=false
    local project_name
    project_name="$(project_display_name)"
    
    check_env_file "$EASELECT_RUNTIME_ENV_FILE"
    if [[ -f "$EASELECT_DEV_ENV_FILE" ]]; then
        warn_secret_env_file_permissions "$EASELECT_DEV_ENV_FILE" "ctl startup"
    fi

    # Native local mode is defined by the resolved development env; runtime env
    # remains the fallback for generated Filterest and incomplete local setups.
    local db_env_file="$EASELECT_DEV_ENV_FILE"
    if [[ ! -f "$db_env_file" ]]; then
        db_env_file="$EASELECT_RUNTIME_ENV_FILE"
    fi
    local configured_port
    configured_port="$(_read_local_env_value "APP_PORT" "$db_env_file")"
    if [[ -z "$configured_port" ]]; then
        configured_port="$(_read_local_env_value "PORT" "$db_env_file")"
    fi
    if [[ -z "$configured_port" ]]; then
        configured_port="$(_read_local_env_value "EASELECT_PORT" "$db_env_file")"
    fi

    if [[ -n "$custom_port" ]]; then
        PORT="$custom_port"
    elif [[ -n "$configured_port" ]]; then
        PORT="$configured_port"
    fi
    export PORT
    export EASELECT_PORT="$PORT"
    export APP_PORT="$PORT"

    if [[ -n "$custom_port" || -n "$configured_port" ]]; then
        echo -e "${BLUE}🖥️  Starting ${project_name} locally on port ${PORT}...${NC}"
    else
        echo -e "${BLUE}🖥️  Starting ${project_name} locally...${NC}"
    fi

    check_port_available "$preserve_derivative_instances"
    
    # Check Go
    if ! command -v go &> /dev/null; then
        echo -e "${RED}❌ Go not found. Please install Go 1.26.5+${NC}"
        exit 1
    fi
    local go_version
    go_version="$(easelect_detect_go_version || true)"
    if ! easelect_go_meets_minimum "$go_version"; then
        echo -e "${RED}❌ Go ${go_version:-unknown} is unsupported. Please install Go ${EASELECT_MIN_GO_VERSION}+${NC}"
        exit 1
    fi

    local db_host=$(_read_local_env_value "DB_HOST" "$db_env_file")
    local db_port=$(_read_local_env_value "DB_PORT" "$db_env_file")
    db_host="${db_host:-localhost}"
    db_port="${db_port:-5432}"
    echo "🔍 Checking database connection on ${db_host}:${db_port}..."
    if ! pg_isready -h "$db_host" -p "$db_port" > /dev/null 2>&1; then
        echo -e "${RED}❌ PostgreSQL not running on ${db_host}:${db_port}${NC}"
        _print_shared_dev_db_tunnel_hint "$db_host" "$db_port" "$db_env_file"
        echo "   Start PostgreSQL or use --docker mode"
        exit 1
    fi

    if ! _shared_dev_storage_prepare; then
        echo -e "${RED}❌ Shared-dev storage preflight failed${NC}"
        exit 1
    fi
    shared_dev_storage_prepared=true
    
    # Start server in background
    echo "🚀 Building Go binary..."
    # The resolver keeps Easelect TLS outside the repo while generated Filterest
    # continues to use its own root-local certificate and private key.
    export TLS_CERT_FILE="${TLS_CERT_FILE:-$EASELECT_TLS_CERT_FILE}"
    export TLS_KEY_FILE="${TLS_KEY_FILE:-$EASELECT_TLS_KEY_FILE}"
    mkdir -p "$LOCAL_BINARY_DIR"
    if ! go build -o "$LOCAL_BINARY_PATH" . 2>&1; then
        echo -e "${RED}❌ Build failed${NC}"
        if [[ "$shared_dev_storage_prepared" == true ]]; then
            _shared_dev_storage_release || true
        fi
        exit 1
    fi
    echo "🚀 Starting server..."
    _launch_detached "$LOG_FILE" "$LOCAL_BINARY_PATH"
    
    # Shared-dev tunnel targets start more slowly because startup still performs
    # DB-backed route/permission sync against the remote canonical dev DB.
    local startup_wait_ticks=300
    if [[ "$db_port" != "5433" ]]; then
        startup_wait_ticks=1500
        echo "   Shared dev DB target detected — allowing up to 150s for startup..."
    fi

    # Wait for startup (100ms intervals)
    echo "⏳ Waiting for server..."
    for ((i=1; i<=startup_wait_ticks; i++)); do
        if curl -k -s -o /dev/null https://localhost:${PORT}/ --max-time 1 2>/dev/null; then
            break
        fi
        sleep 0.1
    done
    
    if curl -k -s -o /dev/null https://localhost:${PORT}/ --max-time 2 2>/dev/null; then
        if ! _shared_dev_storage_start_sync; then
            echo -e "${RED}❌ Shared-dev storage sync daemon failed to start${NC}"
            _stop_local_runtime_components
            _free_local_dev_ports
            if [[ "$shared_dev_storage_prepared" == true ]]; then
                _shared_dev_storage_release || true
            fi
            exit 1
        fi
        if ! _start_vite_dev "$db_env_file"; then
            echo -e "${YELLOW}⚠️  Continuing because Go backend is healthy, but Vite/HMR is unavailable.${NC}"
        fi
        print_success
        _verify_logging
    elif curl -s -o /dev/null http://localhost:${PORT}/ --max-time 2 2>/dev/null; then
        echo -e "${RED}❌ Server responded on plain HTTP, but native local dev expects HTTPS on port ${PORT}.${NC}"
        echo "   Check ENVIRONMENT_TYPE loading (the native development env should keep local dev in TLS mode)."
        if [[ "$shared_dev_storage_prepared" == true ]]; then
            _shared_dev_storage_release || true
        fi
        tail -20 "$LOG_FILE"
        exit 1
    else
        echo -e "${RED}❌ Server failed to start. Check ${LOG_FILE}${NC}"
        if [[ "$shared_dev_storage_prepared" == true ]]; then
            _shared_dev_storage_release || true
        fi
        tail -20 "$LOG_FILE"
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# Show local logs
# ------------------------------------------------------------------------------
show_local_logs() {
    if [[ ! -f "$LOG_FILE" ]]; then
        echo -e "${YELLOW}⚠️  No log file found at ${LOG_FILE}${NC}"
        echo "   Start the local server first with: ./ctl"
        exit 1
    fi
    
    echo -e "${BLUE}📋 Showing logs from ${LOG_FILE}${NC}"
    echo -e "${YELLOW}   (Press Ctrl+C to stop)${NC}"
    echo ""
    tail -f "$LOG_FILE"
}

# ------------------------------------------------------------------------------
# Show journal/logs for an instance or local dev server
# Usage: show_journal <instance_or_local> <lines>
# Examples:
#   show_journal "" 50          → local dev log (tail server_output.log)
#   show_journal "local" 100    → local dev log (tail server_output.log)
#   show_journal "serlog" 100   → journalctl -u easelect-serlog.com -n 100
#                                  (falls back to local log if systemd has no entries)
# ------------------------------------------------------------------------------
show_journal() {
    local instance_partial="${1:-}"
    local lines="${2:-50}"

    # Validate lines is a number
    if ! [[ "$lines" =~ ^[0-9]+$ ]]; then
        echo -e "${RED}❌ Invalid line count: ${lines}${NC}"
        echo "   Usage: ./ctl journal [instance|local] [lines]"
        exit 1
    fi

    # "local" or empty → show local dev server log file
    if [[ -z "$instance_partial" || "$instance_partial" == "local" ]]; then
        _show_local_journal "$lines"
        return
    fi

    # Otherwise resolve instance name → journalctl
    local full_name
    full_name=$(resolve_instance_name "$instance_partial") || exit 1
    local service_name="easelect-${full_name}"

    echo -e "${BLUE}📋 Showing last ${lines} lines of journalctl for ${service_name}.service${NC}"
    echo ""

    # Check if the service has any entries in journalctl
    local entry_count
    entry_count=$(journalctl -u "${service_name}.service" -n 1 --no-pager 2>/dev/null | grep -cv "^-- " || true)

    if [[ "$entry_count" -eq 0 ]]; then
        echo -e "${YELLOW}⚠️  No journalctl entries for ${service_name}.service${NC}"
        echo "   The systemd service may not be running on this machine."
        echo "   To start the service:  sudo systemctl start ${service_name}"
        echo "   For local dev logs:    ./ctl journal local"
        return
    fi

    journalctl -u "${service_name}.service" -n "$lines" --no-pager | cat
}
