#!/usr/bin/env bash
# guardian.sh
# Captures responsive browser screenshots and optionally runs Visual Guardian analysis.
# Bridges the public Filterest command and npm scripts with Playwright and AI analysis.
# Exists so Visual Guardian functionality no longer requires a root-level implementation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=../ctl/lib/resolve_env.sh
source "$PROJECT_ROOT/server_tools/ctl/lib/resolve_env.sh"

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

if ! $SKIP_CAPTURE; then
    echo "=== Visual Guardian: Capturing screenshots ==="
    mkdir -p "$PROJECT_ROOT/testing/test-results/visual_guardian"
    rm -f "$PROJECT_ROOT/testing/test-results/visual_guardian"/*.png \
          "$PROJECT_ROOT/testing/test-results/visual_guardian"/report.json
    env -u NO_COLOR npx playwright test --config "$VISUAL_CONFIG" --reporter=list 2>&1 | cat
    echo ""
fi

if ! $CAPTURE_ONLY; then
    echo "=== Visual Guardian: Analyzing with AI ==="
    python3 "$ANALYZE_SCRIPT" "${PASSTHROUGH_ARGS[@]}"
fi
