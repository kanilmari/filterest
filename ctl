#!/bin/bash
# ==============================================================================
# ctl: Easelect Control CLI - Wrapper
#
# This is a thin wrapper that calls the main implementation in:
#   server_tools/ctl/ctl_main.sh
#
# Usage:
#   ctl              # Local development (default)
#   ctl list         # List all instances
#   ctl logs         # Show local server logs
#   ctl journal serlog 100  # Show journalctl for instance (default 50 lines)
#   ctl i <name>     # Start instance (partial name match, e.g. 'ctl i serlog')
#   ctl --docker     # Docker environment
#   ctl --instance   # Multi-instance management (same as 'i')
#   ctl --traefik    # Traefik reverse proxy
#   ctl --stop       # Stop all running instances
#   ctl --help       # Show full help
# ==============================================================================

# Prevent sourcing - this script must be executed, not sourced
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    echo -e "\033[0;31mError: This script must be executed, not sourced.\033[0m"
    echo "Use: ./ctl [options]"
    return 1 2>/dev/null || exit 1
fi

# Get the directory where this script is located (project root)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve environment (PATH, cd to project root) — needed for su/root
source "$PROJECT_ROOT/server_tools/ctl/lib/resolve_env.sh"

# Bash completion installer
COMP_SCRIPT="$PROJECT_ROOT/server_tools/ctl/ctl_completions.bash"
if [[ "${1:-}" == "--setup-completion" ]]; then
    COMP_DIR="$HOME/.local/share/bash-completion/completions"
    BASHRC_FILE="$HOME/.bashrc"
    BASHRC_MARKER="# Easelect ctl bash completion"
    mkdir -p "$COMP_DIR"
    cp "$COMP_SCRIPT" "$COMP_DIR/ctl"
    echo "✓ Completion installed to $COMP_DIR/ctl"

    if [[ -f "$BASHRC_FILE" ]] && ! grep -Fq "$BASHRC_MARKER" "$BASHRC_FILE"; then
        {
            echo ""
            echo "$BASHRC_MARKER"
            echo "if [ -f \"$COMP_DIR/ctl\" ]; then"
            echo "    source \"$COMP_DIR/ctl\""
            echo "fi"
        } >> "$BASHRC_FILE"
        echo "✓ Added ctl completion autoload to $BASHRC_FILE"
    fi

    echo ""
    echo "To activate NOW in this terminal, run:"
    echo "  source $BASHRC_FILE"
    echo ""
    echo "New Bash terminals will auto-load completions."
    exit 0
fi

# Call the main implementation with all arguments
exec "$PROJECT_ROOT/server_tools/ctl/ctl_main.sh" "$@"
