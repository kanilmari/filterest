#!/usr/bin/env bash
# browser_open_helper.sh
# Centralizes optional browser opening so agents can get URLs/paths without
# forcing popup windows in the user's desktop session.

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    echo "Usage: $0 <url-or-path>" >&2
    exit 1
fi

AUTO_OPEN="${EASELECT_BROWSER_AUTO_OPEN:-never}"
OPEN_CMD="${EASELECT_BROWSER_OPEN_CMD:-}"

case "${AUTO_OPEN,,}" in
    1|true|yes|always)
        ;;
    *)
        printf 'Browser auto-open disabled. Open manually if needed: %s\n' "$TARGET"
        exit 0
        ;;
esac

if [ -n "$OPEN_CMD" ]; then
    if "$OPEN_CMD" "$TARGET" >/dev/null 2>&1; then
        printf 'Opened with custom browser command: %s\n' "$TARGET"
        exit 0
    fi
    printf 'Custom browser command failed, target remains available manually: %s\n' "$TARGET" >&2
    exit 0
fi

if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$TARGET" >/dev/null 2>&1 || true
    printf 'Open attempted via xdg-open: %s\n' "$TARGET"
    exit 0
fi

printf 'No browser opener available. Open manually if needed: %s\n' "$TARGET"
