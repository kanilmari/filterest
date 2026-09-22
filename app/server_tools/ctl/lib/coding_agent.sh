#!/bin/bash
# coding_agent.sh
# Starts, stops and checks this developer machine's coding-agent runner for ./ctl.
# Bridges ./ctl, the runner process with its private config and socket, and the web server's environment.
# Exists so the chat's code workspace and site assistant work locally without sudo and survive server restarts.
#
# The runner is the developer's own user: no new security boundary, but Codex no
# longer inherits the web server's secrets, and a job outlives a server restart.
# `./ctl` starts it when missing and never stops it; `./ctl agent stop` does.

CODING_AGENT_RUNNER="${FILTEREST_SOURCE_ROOT:-$PROJECT_ROOT}/server_tools/agent_tools/coding_agent/coding_agent_runner.py"

CODING_AGENT_ENGINE="${CODING_AGENT_RUNNER%/*}/codex_engine.py"

# The env file ./ctl start reads: the development env, else the runtime env.
_coding_agent_env_file() {
    if [[ -f "${EASELECT_DEV_ENV_FILE:-}" ]]; then
        printf '%s' "$EASELECT_DEV_ENV_FILE"
        return
    fi
    printf '%s' "${EASELECT_RUNTIME_ENV_FILE:-}"
}

_coding_agent_env_value() {
    local key="$1"
    local file
    file="$(_coding_agent_env_file)"
    [[ -f "$file" ]] || return 0
    grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d'=' -f2- || true
}

# The web server's port, resolved the same way start_local resolves it.
coding_agent_port() {
    local port="${1:-}"
    [[ -n "$port" ]] || port="$(_coding_agent_env_value APP_PORT)"
    [[ -n "$port" ]] || port="$(_coding_agent_env_value PORT)"
    [[ -n "$port" ]] || port="$(_coding_agent_env_value EASELECT_PORT)"
    printf '%s' "${port:-${PORT:-8082}}"
}

# Resolve every runner path for one local site. Sets CODING_AGENT_* variables.
coding_agent_resolve() {
    local port
    port="$(coding_agent_port "${1:-}")"
    [[ "$port" =~ ^[0-9]+$ ]] || { echo "error: invalid local port '$port'" >&2; return 1; }
    CODING_AGENT_PORT="$port"
    CODING_AGENT_SITE_ID="localhost-$port"
    local state_base="${XDG_STATE_HOME:-$HOME/.local/state}/filterest-coding-agent"
    CODING_AGENT_STATE_DIR="$state_base/$CODING_AGENT_SITE_ID"
    CODING_AGENT_CONFIG="$CODING_AGENT_STATE_DIR/runner.json"
    CODING_AGENT_JOBS="$CODING_AGENT_STATE_DIR/jobs"
    CODING_AGENT_LOG="$CODING_AGENT_STATE_DIR/runner.log"
    local runtime_base="${XDG_RUNTIME_DIR:-}"
    if [[ -z "$runtime_base" || ! -d "$runtime_base" ]]; then
        # Without a session runtime folder, use a private per-user folder in /tmp
        # and refuse one that another user created first.
        runtime_base="${TMPDIR:-/tmp}/filterest-coding-agent-$(id -u)"
        mkdir -p -m 700 "$runtime_base" 2>/dev/null || true
        if [[ ! -O "$runtime_base" || -L "$runtime_base" ]] ||
            [[ "$(stat -c %a "$runtime_base" 2>/dev/null || stat -f %Lp "$runtime_base")" != "700" ]]; then
            echo "error: $runtime_base must be a private folder owned by $(id -un)" >&2
            return 1
        fi
    fi
    CODING_AGENT_SOCKET="$runtime_base/filterest-coding-agent/$CODING_AGENT_SITE_ID/runner.sock"
}

# The installed Codex CLI; the runner itself verifies it is the pinned version.
coding_agent_codex_path() {
    local candidate="${FILTEREST_CODEX_BIN:-${WORKER_CODEX_BIN:-codex}}"
    candidate="$(type -P -- "$candidate" 2>/dev/null)" || return 1
    realpath -e -- "$candidate"
}

_coding_agent_repositories() {
    local root top
    for root in "$PROJECT_ROOT" "${FILTEREST_SOURCE_ROOT:-}"; do
        [[ -n "$root" && -d "$root" ]] || continue
        top="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)" || continue
        printf '%s\n' "$top"
    done | awk '!seen[$0]++'
}

_coding_agent_python() {
    command -v python3 2>/dev/null
}

coding_agent_is_running() {
    [[ -f "$CODING_AGENT_CONFIG" ]] || return 1
    "$(_coding_agent_python)" "$CODING_AGENT_RUNNER" --config "$CODING_AGENT_CONFIG" --status 2>/dev/null |
        grep -q '"running": true'
}

_coding_agent_pid() {
    local pattern
    pattern="$(printf '%s' "coding_agent_runner.py --config $CODING_AGENT_CONFIG" | sed 's/[][\.*^$+?(){}|]/\\&/g')"
    pgrep -u "$(id -u)" -f -- "${pattern}\$" | head -1
}

_coding_agent_write_config() {
    local codex="$1"
    local -a arguments=(
        --config "$CODING_AGENT_CONFIG" --init-workstation
        --site-id "$CODING_AGENT_SITE_ID" --socket "$CODING_AGENT_SOCKET"
        --jobs-root "$CODING_AGENT_JOBS" --codex "$codex" --workspace "$PROJECT_ROOT"
    )
    local repository certificate
    while IFS= read -r repository; do
        [[ -n "$repository" ]] && arguments+=(--repository "$repository")
    done < <(_coding_agent_repositories)
    certificate="${TLS_CERT_FILE:-${EASELECT_TLS_CERT_FILE:-}}"
    if [[ -n "$certificate" && -f "$certificate" ]]; then
        arguments+=(--site-tls-ca-file "$(realpath -e -- "$certificate")")
    fi
    "$(_coding_agent_python)" "$CODING_AGENT_RUNNER" "${arguments[@]}"
}

coding_agent_start() {
    coding_agent_resolve "${1:-}" || return 1
    if coding_agent_is_running; then
        echo "✅ Coding agent runner already running (${CODING_AGENT_SITE_ID})"
        return 0
    fi
    if [[ -z "$(_coding_agent_python)" ]]; then
        echo "❌ Coding agent runner needs python3" >&2
        return 1
    fi
    local codex
    if ! codex="$(coding_agent_codex_path)"; then
        echo "❌ Codex CLI not found. Install @openai/codex@$("$(_coding_agent_python)" \
            "$CODING_AGENT_ENGINE" version) and sign in with: codex login" >&2
        return 1
    fi
    mkdir -p -m 700 "$CODING_AGENT_STATE_DIR"
    _coding_agent_write_config "$codex" || return 1
    # Only the engine module's allowlist of ordinary session settings goes on;
    # everything else in the calling shell stays behind.
    local -a environment=()
    local key
    while IFS= read -r key; do
        [[ -n "$key" && -n "${!key:-}" ]] && environment+=("$key=${!key}")
    done < <("$(_coding_agent_python)" "$CODING_AGENT_ENGINE" workstation-environment)
    # A new session keeps the runner alive after this terminal and ./ctl exit;
    # env -i starts it without the calling shell's other variables.
    if command -v setsid > /dev/null 2>&1; then
        nohup setsid env -i "${environment[@]}" "$(_coding_agent_python)" "$CODING_AGENT_RUNNER" \
            --config "$CODING_AGENT_CONFIG" >> "$CODING_AGENT_LOG" 2>&1 < /dev/null &
    else
        nohup env -i "${environment[@]}" "$(_coding_agent_python)" "$CODING_AGENT_RUNNER" \
            --config "$CODING_AGENT_CONFIG" >> "$CODING_AGENT_LOG" 2>&1 < /dev/null &
    fi
    disown 2>/dev/null || true
    local _i
    for _i in {1..50}; do
        if coding_agent_is_running; then
            echo "🤖 Coding agent runner started (${CODING_AGENT_SITE_ID})"
            return 0
        fi
        sleep 0.1
    done
    echo "❌ Coding agent runner did not start. See $CODING_AGENT_LOG" >&2
    return 1
}

coding_agent_stop() {
    coding_agent_resolve "${1:-}" || return 1
    local pid
    pid="$(_coding_agent_pid)"
    if [[ -z "$pid" ]]; then
        echo "Coding agent runner is not running (${CODING_AGENT_SITE_ID})"
        return 0
    fi
    # TERM lets the runner end its running job's process group and remove its socket.
    kill -TERM "$pid" 2>/dev/null || true
    local _i
    for _i in {1..150}; do
        kill -0 "$pid" 2>/dev/null || { echo "🛑 Coding agent runner stopped (${CODING_AGENT_SITE_ID})"; return 0; }
        sleep 0.1
    done
    kill -KILL "$pid" 2>/dev/null || true
    echo "🛑 Coding agent runner killed after it ignored TERM (${CODING_AGENT_SITE_ID})"
}

coding_agent_status() {
    coding_agent_resolve "${1:-}" || return 1
    local pid
    pid="$(_coding_agent_pid)"
    if coding_agent_is_running; then
        echo "Coding agent runner: running${pid:+ (pid $pid)}"
    else
        echo "Coding agent runner: not running. Start it with: ./ctl agent start"
    fi
    echo "  site:   $CODING_AGENT_SITE_ID"
    echo "  socket: $CODING_AGENT_SOCKET"
    echo "  config: $CODING_AGENT_CONFIG"
    echo "  jobs:   $CODING_AGENT_JOBS"
    echo "  log:    $CODING_AGENT_LOG"
}

# Local tools, pinned version, account and per-mode readiness; never a model request.
coding_agent_check() {
    coding_agent_resolve "${1:-}" || return 1
    if [[ ! -f "$CODING_AGENT_CONFIG" ]]; then
        local codex
        codex="$(coding_agent_codex_path)" || { echo "❌ Codex CLI not found" >&2; return 1; }
        mkdir -p -m 700 "$CODING_AGENT_STATE_DIR"
        _coding_agent_write_config "$codex" || return 1
    fi
    local report
    report="$("$(_coding_agent_python)" "$CODING_AGENT_RUNNER" --config "$CODING_AGENT_CONFIG" --check)" || return 1
    printf '%s\n' "$report"
    grep -q '"runner_ready": true' <<< "$report"
}

# Called by ./ctl start before the web server launches: point the server at the
# runner and start the runner when it is missing. Never blocks the server start.
coding_agent_prepare_server() {
    local port="$1"
    if [[ -n "$(_coding_agent_env_value FILTEREST_CODING_AGENT_SOCKET)" ]]; then
        # An operator-configured runner in the env file wins; leave it alone.
        return 0
    fi
    coding_agent_resolve "$port" || return 0
    export FILTEREST_CODING_AGENT_SOCKET="$CODING_AGENT_SOCKET"
    export FILTEREST_CODING_AGENT_SITE_ID="$CODING_AGENT_SITE_ID"
    export FILTEREST_SITE_ASSISTANT_BASE_URL="https://localhost:$CODING_AGENT_PORT"
    local autostart="${FILTEREST_CODING_AGENT_AUTOSTART:-$(_coding_agent_env_value FILTEREST_CODING_AGENT_AUTOSTART)}"
    if [[ "$autostart" == "0" ]]; then
        return 0
    fi
    if ! coding_agent_codex_path > /dev/null; then
        echo "ℹ️  Coding agent runner not started: Codex CLI not found (the chat shows it as not running)"
        return 0
    fi
    coding_agent_start "$port" || echo "⚠️  Continuing without the coding agent runner"
    return 0
}

manage_coding_agent() {
    local action="${1:-status}"
    case "$action" in
        start) coding_agent_start ;;
        stop) coding_agent_stop ;;
        restart) coding_agent_stop && coding_agent_start ;;
        status) coding_agent_status ;;
        check) coding_agent_check ;;
        *)
            echo "Usage: ./ctl agent start|stop|restart|status|check" >&2
            return 1
            ;;
    esac
}
