#!/usr/bin/env bash
# safe_grep.sh
# Searches repository text with non-interactive output and a portable fallback.
# Bridges the Filterest command surface with Git-aware text inspection.
# Exists so search behavior no longer requires a dedicated root file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=../ctl/lib/resolve_env.sh
source "$PROJECT_ROOT/server_tools/ctl/lib/resolve_env.sh"

if [[ -z "${1:-}" ]]; then
    echo "Usage: ./filterest search \"pattern\" [path]"
    exit 1
fi

PATTERN="$1"
PATH_ARG="${2:-.}"

GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$GIT_ROOT" && "$(cd "$GIT_ROOT" && pwd)" == "$PROJECT_ROOT" ]]; then
    git --no-pager grep -I -n "$PATTERN" "$PATH_ARG"
else
    grep -rIn "$PATTERN" "$PATH_ARG"
fi
