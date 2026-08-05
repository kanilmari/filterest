#!/bin/bash
# check_import_boundaries.sh
# Enforces the layering rule: reusable_components must not import from core_components.
# Reusable components should be portable and framework-agnostic.
#
# Exits 1 on new violations. Known backlog files warn but do not fail.
# Remove entries from KNOWN_BACKLOG as violations are fixed.
#
# Usage:
#   ./server_tools/scripts/check_import_boundaries.sh        # warn only for backlog
#   ./server_tools/scripts/check_import_boundaries.sh --strict  # fail on ANY violation

STRICT=false
if [ "$1" = "--strict" ]; then
    STRICT=true
fi

# Known backlog — remove each file as its violation is fixed.
# All 13 original violations fixed in ticket #819.
KNOWN_BACKLOG=()

is_known_backlog() {
    local file="$1"
    for known in "${KNOWN_BACKLOG[@]}"; do
        if [ "$file" = "$known" ]; then
            return 0
        fi
    done
    return 1
}

VIOLATIONS=0
NEW_VIOLATIONS=0

while IFS= read -r file; do
    if is_known_backlog "$file"; then
        echo "  ⚠️  $file [backlog]"
        VIOLATIONS=$((VIOLATIONS + 1))
    else
        echo "  ❌ $file [NEW VIOLATION]"
        VIOLATIONS=$((VIOLATIONS + 1))
        NEW_VIOLATIONS=$((NEW_VIOLATIONS + 1))
    fi
done < <(grep -rl 'from.*core_components' \
    frontend/reusable_components \
    --include='*.js' \
    2>/dev/null | sort)

if [ "$NEW_VIOLATIONS" -gt 0 ]; then
    echo ""
    echo "  ❌ $NEW_VIOLATIONS new import boundary violation(s) found."
    echo "  Reusable components must not import from core_components."
    echo "  Fix the violation or move the file to core_components/ if it is app-specific."
    exit 1
fi

if [ "$VIOLATIONS" -gt 0 ] && [ "$STRICT" = true ]; then
    echo ""
    echo "  ❌ $VIOLATIONS backlog violation(s) remain (--strict mode)."
    exit 1
fi

if [ "$VIOLATIONS" -gt 0 ]; then
    echo ""
    echo "  ⚠️  $VIOLATIONS backlog violation(s) remain (ticket #819)."
else
    echo "  ✅ No import boundary violations."
fi
