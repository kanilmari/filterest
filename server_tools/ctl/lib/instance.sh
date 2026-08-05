#!/bin/bash
# ==============================================================================
# instance.sh: Multi-tenant instance management for Easelect Control CLI
#
# This file is a dispatcher that sources modular sub-files and routes
# instance commands to the appropriate handler function.
#
# Module files (sourced in dependency order):
#   instance_helpers.sh    — Shared utilities (links, separators, DB config, health checks)
#   instance_list.sh       — Instance listing and status table
#   instance_lifecycle.sh  — Start, stop, logs
#   instance_crud.sh       — Create, delete
#   instance_backup.sh     — Backup, restore
#   instance_sync.sh       — Init (full load) and sync (merge) from seed DB
#   instance_mass.sh       — Upgrade, upgrade-all, sync-all, status-all, backup-all
# ==============================================================================

# Determine the directory where this script lives
INSTANCE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source modules in dependency order
source "$INSTANCE_LIB_DIR/instance_helpers.sh"
source "$INSTANCE_LIB_DIR/instance_list.sh"
source "$INSTANCE_LIB_DIR/instance_lifecycle.sh"
source "$INSTANCE_LIB_DIR/instance_crud.sh"
source "$INSTANCE_LIB_DIR/instance_backup.sh"
source "$INSTANCE_LIB_DIR/instance_sync.sh"
source "$INSTANCE_LIB_DIR/instance_mass.sh"

# ------------------------------------------------------------------------------
# Instance management dispatcher
# Routes subcommands to the appropriate handler function.
# ------------------------------------------------------------------------------
manage_instance() {
    local action="$1"
    local name="$2"
    
    case "$action" in
        list)
            list_instances
            ;;
        create)
            create_instance "$name" "$INSTANCE_DOMAIN" "$INSTANCE_ROLE"
            ;;
        start)
            start_instance "$name"
            ;;
        stop)
            stop_instance "$name"
            ;;
        logs)
            instance_logs "$name"
            ;;
        backup)
            backup_instance "$name"
            ;;
        restore)
            restore_instance "$name" "$RESTORE_FILE"
            ;;
        delete)
            delete_instance "$name"
            ;;
        upgrade)
            upgrade_instance "$name"
            ;;
        upgrade-all)
            upgrade_all_instances
            ;;
        status-all)
            status_all_instances
            ;;
        backup-all)
            backup_all_instances
            ;;
        init)
            init_instance "$name"
            ;;
        sync)
            sync_instance "$name"
            ;;
        sync-all)
            sync_all_instances
            ;;
        *)
            echo -e "${RED}Unknown instance action: ${action}${NC}"
            echo "   Valid actions: list, create, start, stop, logs, backup, restore, delete, init, sync, upgrade, upgrade-all, status-all, backup-all, sync-all"
            exit 1
            ;;
    esac
}
