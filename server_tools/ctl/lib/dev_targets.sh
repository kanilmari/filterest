#!/bin/bash
# ==============================================================================
# dev_targets.sh: Refreshes native local dev and derivative Docker targets
#
# Bridges the local ctl startup path and instance mass-upgrade path.
# Exists so one command can start native dev first, then rebuild all instances.
# ==============================================================================

# ------------------------------------------------------------------------------
# Helper: render a one-line target summary for native + derivative instances
# ------------------------------------------------------------------------------
_print_dev_target_summary() {
    local -a instances=()

    for dir in instances/*/; do
        if [[ -d "$dir" ]] && [[ "$(basename "$dir")" != "template" ]]; then
            instances+=("$(basename "$dir")")
        fi
    done

    if [[ ${#instances[@]} -eq 0 ]]; then
        echo "Targets: native local only (no derivative Docker instances found)"
        return
    fi

    echo "Targets: native local -> ${instances[*]}"
}

# ------------------------------------------------------------------------------
# Refresh native dev first, then all derivative Docker instances
# ------------------------------------------------------------------------------
refresh_all_dev_targets() {
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}🔄 Refreshing native dev first, then all Docker instances${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    _print_dev_target_summary
    echo ""

    echo -e "${BLUE}[1/2] Refreshing native local dev...${NC}"
    start_local "" "true"
    echo ""

    echo -e "${BLUE}[2/2] Refreshing all derivative Docker instances...${NC}"
    upgrade_all_instances
}
