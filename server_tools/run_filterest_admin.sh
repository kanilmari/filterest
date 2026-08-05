#!/usr/bin/env bash
# run_filterest_admin.sh
# Runs the prebuilt Filterest binary without source-development toolchains.
# Bridges protected runtime configuration, process lifecycle, logs, and readiness checks.
# Exists so the admin installation profile never needs Go, Node.js, or Vite to start.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# shellcheck source=server_tools/lib/easelect_private_paths.sh
source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
easelect_resolve_private_paths "$PROJECT_ROOT"
# shellcheck source=server_tools/lib/filterest_port_preflight.sh
source "$PROJECT_ROOT/server_tools/lib/filterest_port_preflight.sh"

BINARY="$PROJECT_ROOT/runtime/bin/filterest-server"
PID_FILE="$PROJECT_ROOT/runtime/filterest-admin.pid"
LOG_FILE="$PROJECT_ROOT/runtime/logs/filterest-admin.log"

env_value() {
    local key="$1"
    local file=""
    for file in "$EASELECT_DEV_ENV_FILE" "$EASELECT_RUNTIME_ENV_FILE"; do
        [[ -f "$file" ]] || continue
        grep -E "^${key}=" "$file" | tail -1 | cut -d'=' -f2- && return
    done
}

configured_port() {
    local port=""
    port="$(env_value APP_PORT || true)"
    [[ -n "$port" ]] || port="$(env_value PORT || true)"
    printf '%s' "${port:-8100}"
}

running_pid() {
    local pid=""
    local process_binary=""
    local expected_binary=""
    [[ -f "$PID_FILE" ]] || return 1
    pid="$(tr -d '[:space:]' < "$PID_FILE")"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    process_binary="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
    expected_binary="$(readlink -f "$BINARY" 2>/dev/null || true)"
    [[ -n "$process_binary" && "$process_binary" == "$expected_binary" ]] || return 1
    printf '%s' "$pid"
}

stop_runtime() {
    local pid=""
    pid="$(running_pid || true)"
    if [[ -z "$pid" ]]; then
        rm -f "$PID_FILE"
        printf 'Filterest is not running through the admin launcher.\n'
        return
    fi
    kill -TERM "$pid"
    for _ in $(seq 1 100); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
        printf 'error: Filterest did not stop gracefully; process %s is still running\n' "$pid" >&2
        exit 1
    fi
    rm -f "$PID_FILE"
    printf 'Filterest stopped.\n'
}

show_status() {
    local pid=""
    local port=""
    pid="$(running_pid || true)"
    port="$(configured_port)"
    if [[ -n "$pid" ]] && curl --insecure --silent --fail --max-time 2 "https://localhost:${port}/system/ready" >/dev/null; then
        printf 'Filterest is running (process %s): https://localhost:%s\n' "$pid" "$port"
        return
    fi
    printf 'Filterest is not ready. Log: %s\n' "$LOG_FILE"
    return 1
}

start_runtime() {
    local pid=""
    local port=""
    [[ -x "$BINARY" ]] || {
        printf 'error: prebuilt Filterest binary is missing; run ./filterest setup --profile admin\n' >&2
        exit 1
    }
    [[ -f "$EASELECT_RUNTIME_ENV_FILE" ]] || {
        printf 'error: protected Filterest runtime configuration is missing; run ./filterest setup --profile admin\n' >&2
        exit 1
    }
    pid="$(running_pid || true)"
    if [[ -n "$pid" ]]; then
        show_status
        return
    fi
    port="$(configured_port)"
    filterest_preflight_port "$port"

    mkdir -p "$(dirname "$LOG_FILE")"
    if command -v setsid >/dev/null 2>&1; then
        nohup setsid "$BINARY" >> "$LOG_FILE" 2>&1 < /dev/null &
    else
        nohup "$BINARY" >> "$LOG_FILE" 2>&1 < /dev/null &
    fi
    pid="$!"
    printf '%s\n' "$pid" > "$PID_FILE"
    # Poll slowly enough that the readiness probe cannot trip the application's
    # own per-IP rate limiter during first-start metadata maintenance.
    for _ in $(seq 1 60); do
        if curl --insecure --silent --fail --max-time 1 "https://localhost:${port}/system/ready" >/dev/null; then
            printf 'Filterest is ready: https://localhost:%s/first-run\n' "$port"
            return
        fi
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
    done
    printf 'error: Filterest did not become ready; see %s\n' "$LOG_FILE" >&2
    tail -n 30 "$LOG_FILE" || true
    exit 1
}

case "${1:-start}" in
    start) start_runtime ;;
    stop|--stop) stop_runtime ;;
    status|--status) show_status ;;
    logs|--logs) tail -f "$LOG_FILE" ;;
    -h|--help)
        printf 'Usage: ./filterest start [start|stop|status|logs]\n'
        ;;
    *)
        printf 'error: unknown admin runtime action: %s\n' "$1" >&2
        exit 2
        ;;
esac
