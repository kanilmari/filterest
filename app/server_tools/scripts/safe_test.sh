#!/usr/bin/env bash
# safe_test.sh
# Runs Playwright with bounded workers and without opening an HTML report.
# Bridges the Filterest command surface with the repository browser-test matrix.
# Exists so safe browser testing no longer requires a dedicated root file, and so
# a run cleans up only the leftover browsers it started itself: several sessions
# may run browser tests on the same machine at once.

APPLICATION_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ROOT="$(
    node "$APPLICATION_ROOT/server_tools/lib/filterest_project_boundary_cli.mjs" \
        --print-project-boundary "$APPLICATION_ROOT"
)" || exit $?

# shellcheck source=../ctl/lib/resolve_env.sh
source "$APPLICATION_ROOT/server_tools/ctl/lib/resolve_env.sh"
cd "$APPLICATION_ROOT"

# Every process this run starts inherits this marker. Playwright launches each
# browser detached into its own session and passes its environment on, so the
# marker, not the process tree or group, identifies what this run started.
RUN_MARKER_NAME="FILTEREST_SAFE_TEST_RUN_ID"
RUN_ID="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || printf '%s-%s-%s' "$$" "$(date +%s)" "$RANDOM")"
BROWSER_COMMAND_PATTERN='chrom|headless|firefox|webkit|playwright'

# Finds Playwright in the installation's own dependency root first, then PATH.
resolve_playwright_command() {
    local candidate=""
    if [[ -n "${FILTEREST_NODE_MODULES_ROOT:-}" && -x "$FILTEREST_NODE_MODULES_ROOT/.bin/playwright" ]]; then
        printf '%s\n' "$FILTEREST_NODE_MODULES_ROOT/.bin/playwright"
        return 0
    fi
    candidate="$(command -v playwright 2>/dev/null || true)"
    [[ -n "$candidate" ]] || return 1
    printf '%s\n' "$candidate"
}

# Lists live browser processes that carry this run's marker. Another run's
# browsers carry a different marker and are never listed.
list_run_browser_processes() {
    local environ_file pid command_line
    [[ -r /proc/self/environ ]] || return 0
    while IFS= read -r environ_file; do
        pid="${environ_file#/proc/}"
        pid="${pid%/environ}"
        [[ "$pid" =~ ^[0-9]+$ && "$pid" != "$$" ]] || continue
        command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        if [[ -n "$command_line" ]] && grep -Eiq "$BROWSER_COMMAND_PATTERN" <<< "$command_line"; then
            printf '%s\n' "$pid"
        fi
    done < <(grep -l -s -z -x -F "${RUN_MARKER_NAME}=${RUN_ID}" /proc/[0-9]*/environ 2>/dev/null)
}

# Ends this run's leftover browsers: TERM first, then KILL for any that remain.
# Each round re-reads the marker, so a reused PID is never signalled.
cleanup_run_browser_processes() {
    local leftovers="" attempt
    if [[ ! -r /proc/self/environ ]]; then
        echo "Leftover browser cleanup skipped: process environments cannot be inspected here."
        return 0
    fi
    leftovers="$(list_run_browser_processes)"
    [[ -n "$leftovers" ]] || return 0
    echo ""
    echo "Cleaning up $(wc -l <<< "$leftovers") leftover browser process(es) started by this run..."
    # shellcheck disable=SC2086
    kill $leftovers 2>/dev/null
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        sleep 0.2
        leftovers="$(list_run_browser_processes)"
        [[ -n "$leftovers" ]] || return 0
    done
    # shellcheck disable=SC2086
    kill -9 $leftovers 2>/dev/null
}

PLAYWRIGHT_COMMAND="$(resolve_playwright_command)" || {
    echo "error: Playwright is not installed for this installation." >&2
    echo "  Install the development dependencies with: ./filterest setup --profile development --dependencies-only" >&2
    echo "  (or point FILTEREST_NODE_MODULES_ROOT at a node_modules folder that contains Playwright)" >&2
    exit 127
}
if [[ -n "${FILTEREST_NODE_MODULES_ROOT:-}" && ":${NODE_PATH:-}:" != *":$FILTEREST_NODE_MODULES_ROOT:"* ]]; then
    export NODE_PATH="$FILTEREST_NODE_MODULES_ROOT${NODE_PATH:+:$NODE_PATH}"
fi

RAM_PER_WORKER_GB=5
MAX_WORKERS_CAP=6

if [[ -f /proc/meminfo ]]; then
    AVAIL_KB=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
    AVAIL_GB=$(( AVAIL_KB / 1048576 ))
    WORKERS=$(( AVAIL_GB / RAM_PER_WORKER_GB ))
    (( WORKERS < 1 )) && WORKERS=1
    (( WORKERS > MAX_WORKERS_CAP )) && WORKERS=$MAX_WORKERS_CAP
    echo "RAM: ${AVAIL_GB} GB available → ${WORKERS} worker(s)  (${RAM_PER_WORKER_GB} GB/worker, cap ${MAX_WORKERS_CAP})"
elif [[ "$(uname -s)" == "Darwin" ]]; then
    WORKERS=1
    echo "RAM: macOS detected → defaulting to ${WORKERS} worker(s)"
else
    WORKERS=2
    echo "RAM: /proc/meminfo not found → defaulting to ${WORKERS} worker(s)"
fi

if [[ -f /proc/meminfo ]]; then
    SWAP_TOTAL=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
    if [[ "$SWAP_TOTAL" -eq 0 ]]; then
        echo "WARNING: No swap configured. OOM-killer may terminate tests under memory pressure."
        echo "  → Run: sudo $APPLICATION_ROOT/server_tools/scripts/setup_swap.sh"
    fi
fi

echo ""
trap 'cleanup_run_browser_processes; exit 130' INT
trap 'cleanup_run_browser_processes; exit 143' TERM

if echo "$@" | grep -q -- '--workers'; then
    env "${RUN_MARKER_NAME}=${RUN_ID}" "$PLAYWRIGHT_COMMAND" test -c playwright.config.ts --reporter=list "$@"
else
    env "${RUN_MARKER_NAME}=${RUN_ID}" "$PLAYWRIGHT_COMMAND" test -c playwright.config.ts --reporter=list --workers="${WORKERS}" "$@"
fi
TEST_EXIT=$?

cleanup_run_browser_processes
exit $TEST_EXIT
