#!/bin/bash
# check_import_boundaries.sh
# Enforces library and feature-component imports with the shared source resolvers.
# Bridges QA and public/private strict callers to one offline Python checker.
# Preserves the command line, including --strict and unrelated working directories.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
exec python3 "$PROJECT_ROOT/testing/python/import_boundary_checker.py" "$@"
