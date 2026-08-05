#!/bin/bash
# ==============================================================================
# resolve_env.sh: Shared environment resolver for all Easelect CLI wrappers
#
# Sourced by wrapper scripts (ctl, db, db_task, task, safe_grep, safe_test,
# guardian, dev_status, and related root developer tools)
# to ensure they work correctly regardless of:
#   - Current user (normal user or root via su/sudo)
#   - Current working directory
#   - PATH configuration
#
# Provides:
#   - PROJECT_ROOT: Absolute path to the Easelect project root
#   - Augmented PATH with /snap/bin, /usr/local/go/bin, etc.
#   - cd to PROJECT_ROOT
#
# Usage (from a wrapper script in project root):
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/server_tools/ctl/lib/resolve_env.sh"
#
# Usage (from a script inside server_tools/ctl/):
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/resolve_env.sh"
# ==============================================================================

# If PROJECT_ROOT is already set by the calling script, use it.
# Otherwise, try to resolve it from this file's location.
if [[ -z "${PROJECT_ROOT:-}" ]]; then
    _RESOLVE_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(cd "$_RESOLVE_ENV_DIR/../../.." && pwd)"
    unset _RESOLVE_ENV_DIR
fi

# cd to project root so relative paths work
cd "$PROJECT_ROOT" || {
    echo -e "\033[0;31mError: Cannot cd to PROJECT_ROOT: $PROJECT_ROOT\033[0m" >&2
    exit 1
}

# --- PATH augmentation for root / su / sudo environments ---
# These paths may be missing when running as root since root's default PATH
# is typically just /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
_EXTRA_PATHS=(
    "$PROJECT_ROOT/.venv/bin"    # Project-local Python tools/dependencies
    "/snap/bin"              # Ubuntu snap packages (go, etc.)
    "/usr/local/go/bin"      # Manual Go installations
    "$HOME/go/bin"           # Go user binaries
    "$HOME/.local/bin"       # pip --user installs, pipx, etc.
    "/usr/local/bin"         # Homebrew, manually installed tools
    "/opt/homebrew/opt/postgresql@16/bin"  # macOS Homebrew keg-only PostgreSQL
    "/opt/homebrew/opt/postgresql@17/bin"  # macOS Homebrew keg-only PostgreSQL
)

for _p in "${_EXTRA_PATHS[@]}"; do
    if [[ -d "$_p" ]] && [[ ":$PATH:" != *":$_p:"* ]]; then
        PATH="$_p:$PATH"
    fi
done
unset _p _EXTRA_PATHS

export PATH
export PROJECT_ROOT

# Resolve native Easelect private files from the one external key-root contract.
# Generated Filterest checkouts deliberately resolve to their root-local runtime files.
source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
easelect_resolve_private_paths "$PROJECT_ROOT"
