#!/usr/bin/env bash
# T18_custom_root_fixture.sh
# Places, checks, hides and removes only the coordinator's owned K378 fixture.
# Connects the administrator-reported native site_root path to an offline file helper.
# Refuses existing files and preserves unrelated or operator-modified contents.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/custom_root_fixture_operator.py" "$@"
