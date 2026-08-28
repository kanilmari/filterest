#!/usr/bin/env bash
# guardian.sh
# Captures responsive browser screenshots and optionally runs Visual Guardian analysis.
# Bridges the public Filterest command and npm scripts with Playwright and AI analysis.
# Exists so Visual Guardian functionality no longer requires a root-level implementation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLICATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="$(
    node "$APPLICATION_ROOT/server_tools/lib/filterest_project_boundary_cli.mjs" \
        --print-project-boundary "$APPLICATION_ROOT"
)"

# shellcheck source=../ctl/lib/resolve_env.sh
source "$APPLICATION_ROOT/server_tools/ctl/lib/resolve_env.sh"
cd "$APPLICATION_ROOT"

FILTEREST_PRODUCT_ROOT="$(cd "$APPLICATION_ROOT/.." && pwd)"
FILTEREST_TEST_RUNTIME_ROOT="${FILTEREST_TEST_RUNTIME_ROOT:-$FILTEREST_PRODUCT_ROOT/data/testing}"
if [[ "$FILTEREST_TEST_RUNTIME_ROOT" != /* ]]; then
    FILTEREST_TEST_RUNTIME_ROOT="$FILTEREST_PRODUCT_ROOT/$FILTEREST_TEST_RUNTIME_ROOT"
fi
FILTEREST_TEST_RUNTIME_ROOT="$(realpath -m -- "$FILTEREST_TEST_RUNTIME_ROOT")"
case "$FILTEREST_TEST_RUNTIME_ROOT/" in
    "$APPLICATION_ROOT/"*)
        echo "Error: FILTEREST_TEST_RUNTIME_ROOT must be outside immutable app/: $APPLICATION_ROOT" >&2
        exit 1
        ;;
esac
export FILTEREST_TEST_RUNTIME_ROOT
VISUAL_OUTPUT_DIR="$FILTEREST_TEST_RUNTIME_ROOT/test-results/visual_guardian"

ANALYZE_SCRIPT="testing/visual_guardian/analyze_ui.py"
VISUAL_CONFIG="playwright.visual.config.ts"
CAPTURE_ONLY=false
ANALYZE_ONLY=false
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --capture-only)
            CAPTURE_ONLY=true
            shift
            ;;
        --analyze-only)
            ANALYZE_ONLY=true
            shift
            ;;
        *)
            PASSTHROUGH_ARGS+=("$1")
            shift
            ;;
    esac
done

SKIP_CAPTURE=false
if $ANALYZE_ONLY; then
    SKIP_CAPTURE=true
fi
for argument in "${PASSTHROUGH_ARGS[@]}"; do
    if [[ "$argument" == "--screenshot" ]]; then
        SKIP_CAPTURE=true
        break
    fi
done

FILTEREST_PYTHON="${FILTEREST_PYTHON:-python3}"
if ! $CAPTURE_ONLY && ! command -v "$FILTEREST_PYTHON" >/dev/null 2>&1; then
    echo "Error: FILTEREST_PYTHON command is unavailable: $FILTEREST_PYTHON" >&2
    exit 1
fi

if ! $SKIP_CAPTURE; then
    echo "=== Visual Guardian: Capturing screenshots ==="
    mkdir -p "$VISUAL_OUTPUT_DIR"
    rm -f "$VISUAL_OUTPUT_DIR"/*.png "$VISUAL_OUTPUT_DIR"/report.json
    env -u NO_COLOR playwright test --config "$VISUAL_CONFIG" --reporter=list 2>&1 | cat
    echo ""
fi

if ! $CAPTURE_ONLY; then
    echo "=== Visual Guardian: Analyzing with AI ==="
    PYTHONPYCACHEPREFIX="$FILTEREST_TEST_RUNTIME_ROOT/python-cache" \
        "$FILTEREST_PYTHON" "$ANALYZE_SCRIPT" "${PASSTHROUGH_ARGS[@]}"
fi
