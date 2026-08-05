#!/bin/bash
# setup_swap.sh — Create a swapfile if none exists.
# Usage: sudo ./server_tools/scripts/setup_swap.sh [SIZE_GB]
#
# Default size: 16 GB (6 Playwright workers × ~5 GB each can use ~30 GB).
# Requires root privileges.

set -euo pipefail

SWAP_SIZE_GB="${1:-16}"
SWAPFILE="/swapfile"

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (sudo)."
    exit 1
fi

# Check if swap already exists
CURRENT_SWAP=$(swapon --show --noheadings 2>/dev/null | wc -l)
if [[ "$CURRENT_SWAP" -gt 0 ]]; then
    echo "Swap is already configured:"
    swapon --show
    free -h | grep -i swap
    exit 0
fi

echo "Creating ${SWAP_SIZE_GB} GB swapfile at ${SWAPFILE}..."

# Create swapfile
fallocate -l "${SWAP_SIZE_GB}G" "$SWAPFILE" 2>/dev/null || \
    dd if=/dev/zero of="$SWAPFILE" bs=1G count="$SWAP_SIZE_GB" status=progress

# Secure permissions
chmod 600 "$SWAPFILE"

# Format and enable
mkswap "$SWAPFILE"
swapon "$SWAPFILE"

# Make persistent across reboots
if ! grep -q "$SWAPFILE" /etc/fstab; then
    echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
    echo "Added $SWAPFILE to /etc/fstab for persistence."
fi

echo ""
echo "Swap configured successfully:"
swapon --show
free -h | grep -i swap
