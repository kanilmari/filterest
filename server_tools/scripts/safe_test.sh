#!/usr/bin/env bash
# safe_test.sh
# Runs Playwright with bounded workers and without opening an HTML report.
# Bridges the Filterest command surface with the repository browser-test matrix.
# Exists so safe browser testing no longer requires a dedicated root file.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=../ctl/lib/resolve_env.sh
source "$PROJECT_ROOT/server_tools/ctl/lib/resolve_env.sh"

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
        echo "  → Run: sudo $PROJECT_ROOT/server_tools/scripts/setup_swap.sh"
    fi
fi

echo ""
PIDS_BEFORE=$(pgrep -f 'headless.*chromium|chromium.*headless|playwright' -u "$(id -u)" 2>/dev/null | sort)

if echo "$@" | grep -q -- '--workers'; then
    npx playwright test -c playwright.config.ts --reporter=list "$@"
else
    npx playwright test -c playwright.config.ts --reporter=list --workers="${WORKERS}" "$@"
fi
TEST_EXIT=$?

PIDS_AFTER=$(pgrep -f 'headless.*chromium|chromium.*headless|playwright' -u "$(id -u)" 2>/dev/null | sort)
ORPHANS=$(comm -13 <(echo "$PIDS_BEFORE") <(echo "$PIDS_AFTER") 2>/dev/null)

if [[ -n "$ORPHANS" ]]; then
    ORPHAN_COUNT=$(echo "$ORPHANS" | wc -l)
    echo ""
    echo "Cleaning up ${ORPHAN_COUNT} orphaned browser process(es)..."
    echo "$ORPHANS" | xargs kill 2>/dev/null
    sleep 2
    echo "$ORPHANS" | xargs kill -9 2>/dev/null
fi

exit $TEST_EXIT
