#!/usr/bin/env bash
# coding_agent_test.sh
# Verifies ./ctl agent start|stop|status|check and the server wiring with a fake Codex CLI.
# Uses private temporary state, runtime and checkout folders; no model, site or database is contacted.
# Exists so the runner keeps starting as the developer, without web-server secrets, and survives server stops.

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_ROOT="$(cd "$TEST_DIR/../../.." && pwd -P)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ctl-agent.XXXXXX")"
cleanup() {
    [[ -n "${CODING_AGENT_CONFIG:-}" ]] && coding_agent_stop > /dev/null 2>&1 || true
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
    printf 'test failure: %s\n' "$*" >&2
    exit 1
}

PINNED="$(python3 "$SOURCE_ROOT/server_tools/agent_tools/coding_agent/codex_engine.py" version)"
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/project" "$TEST_ROOT/state"
mkdir -m 700 "$TEST_ROOT/run"
cat > "$TEST_ROOT/bin/codex" <<EOF
#!/bin/sh
if [ "\$1" = "--version" ]; then echo "codex-cli $PINNED"; exit 0; fi
if [ "\$1" = "login" ]; then exit 0; fi
exit 97
EOF
chmod +x "$TEST_ROOT/bin/codex"
git init -q "$TEST_ROOT/project"
printf 'APP_PORT=18555\n' > "$TEST_ROOT/dev_env.txt"

export FILTEREST_SOURCE_ROOT="$SOURCE_ROOT"
# shellcheck source=../lib/coding_agent.sh
source "$SOURCE_ROOT/server_tools/ctl/lib/coding_agent.sh"
# Report only the disposable checkout, never the real source repository.
FILTEREST_SOURCE_ROOT="$TEST_ROOT/project"
PROJECT_ROOT="$TEST_ROOT/project"
EASELECT_DEV_ENV_FILE="$TEST_ROOT/dev_env.txt"
EASELECT_RUNTIME_ENV_FILE="$TEST_ROOT/missing.env"
export XDG_STATE_HOME="$TEST_ROOT/state" XDG_RUNTIME_DIR="$TEST_ROOT/run"
export FILTEREST_CODEX_BIN="$TEST_ROOT/bin/codex"
# A web-server secret in the calling shell must not reach the runner.
export DATABASE_PASSWORD="fixture-secret-must-not-leak"

output="$(manage_coding_agent status)"
grep -q "not running" <<< "$output" || fail "status before start: $output"
grep -q "localhost-18555" <<< "$output" || fail "site id follows the configured port: $output"

output="$(manage_coding_agent start)"
grep -q "started" <<< "$output" || fail "start: $output"
coding_agent_resolve
[[ -S "$CODING_AGENT_SOCKET" ]] || fail "socket missing at $CODING_AGENT_SOCKET"
[[ "$(stat -c %a "$CODING_AGENT_CONFIG")" == "600" ]] || fail "config must be private"
[[ "$(stat -c %a "$CODING_AGENT_STATE_DIR")" == "700" ]] || fail "state folder must be private"
[[ "$(stat -c %a "$(dirname "$CODING_AGENT_SOCKET")")" == "700" ]] || fail "socket folder must be private"
[[ "$(stat -c %a "$CODING_AGENT_SOCKET")" == "600" ]] || fail "socket must be private"
grep -q '"identity": "same_user_workstation"' "$CODING_AGENT_CONFIG" || fail "workstation identity"
grep -q "\"workspace\": \"$TEST_ROOT/project\"" "$CODING_AGENT_CONFIG" || fail "workspace is the checkout"

pid="$(_coding_agent_pid)"
[[ -n "$pid" ]] || fail "runner pid not found"
if tr '\0' '\n' < "/proc/$pid/environ" | grep -q '^DATABASE_PASSWORD='; then
    fail "the runner inherited a web-server secret"
fi

grep -q "already running" <<< "$(manage_coding_agent start)" || fail "second start must reuse the runner"

report="$(manage_coding_agent check)" || fail "check reported not ready: $report"
grep -q '"modes": \["code_workspace", "site_assistant"\]' <<< "$report" || fail "both modes ready: $report"

# ./ctl stop matches only these server patterns and fixed TCP ports; the runner
# uses a Unix socket and none of the patterns, so a server stop leaves it running.
for pattern in "go run main.go" "/tmp/go-build.*/main" "/easelect$" "/easelect_dev$"; do
    if pgrep -f -- "$pattern" | grep -qx "$pid"; then
        fail "server stop pattern '$pattern' would stop the runner"
    fi
done

unset FILTEREST_CODING_AGENT_SOCKET FILTEREST_CODING_AGENT_SITE_ID FILTEREST_SITE_ASSISTANT_BASE_URL
coding_agent_prepare_server 18555 > /dev/null
[[ "$FILTEREST_CODING_AGENT_SOCKET" == "$CODING_AGENT_SOCKET" ]] || fail "server socket export"
[[ "$FILTEREST_CODING_AGENT_SITE_ID" == "localhost-18555" ]] || fail "server site id export"
[[ "$FILTEREST_SITE_ASSISTANT_BASE_URL" == "https://localhost:18555" ]] || fail "server base URL export"

grep -q "stopped" <<< "$(manage_coding_agent stop)" || fail "stop"
[[ ! -e "$CODING_AGENT_SOCKET" ]] || fail "stop must remove the socket"
grep -q "not running" <<< "$(manage_coding_agent status)" || fail "status after stop"

# An operator-configured runner in the env file is left alone.
unset FILTEREST_CODING_AGENT_SOCKET
printf 'APP_PORT=18555\nFILTEREST_CODING_AGENT_SOCKET=/run/operator/runner.sock\n' > "$TEST_ROOT/dev_env.txt"
coding_agent_prepare_server 18555 > /dev/null
[[ -z "${FILTEREST_CODING_AGENT_SOCKET:-}" ]] || fail "operator socket must not be overridden"
coding_agent_is_running && fail "an operator-configured runner must not be auto-started"

# Without Codex the server still starts; the chat then shows the runner as not running.
printf 'APP_PORT=18555\n' > "$TEST_ROOT/dev_env.txt"
FILTEREST_CODEX_BIN="$TEST_ROOT/bin/absent" output="$(coding_agent_prepare_server 18555)"
grep -q "Codex CLI not found" <<< "$output" || fail "missing Codex hint: $output"

printf 'coding agent ctl tests passed\n'
