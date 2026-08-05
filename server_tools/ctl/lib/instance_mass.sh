#!/bin/bash
# ==============================================================================
# instance_mass.sh: Mass operations across all Docker instances
#
# Provides upgrade/status/backup batch helpers plus the shared single-instance
# upgrade path used by targeted refresh workflows.
# - upgrade:     Backup + rebuild + restart + health check for one instance
# - upgrade-all: Same as above for every configured instance
# - sync-all:    Merge seed data into all instances
# - status-all:  Health dashboard for all instances
# - backup-all:  pg_dump backup for all running instances
# ==============================================================================

# ------------------------------------------------------------------------------
# Helper: Rebuild one Docker instance with backup + health verification.
# Between one instance's env file / compose project and the running containers
# it performs the safe code-refresh path used by both targeted and mass upgrades.
# Why: local derivative instances need the same repeatable rebuild path whether
# we refresh one named target or all configured instances.
# ------------------------------------------------------------------------------
_upgrade_instance_with_checks() {
    local instance="$1"
    local env_file="instances/${instance}/.env"

    if [[ ! -f "$env_file" ]]; then
        echo -e "${YELLOW}⚠️  Skipping '${instance}' (no .env file)${NC}"
        return 1
    fi

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Upgrading '${instance}'${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Source env to get variables (selective grep to avoid unquoted-space issues)
    eval "$(grep -E '^(APP_PORT|DB_ADMIN_USER|DB_NAME)=' "$env_file" 2>/dev/null)"
    prepare_instance_compose_env "$env_file"
    export INSTANCE="$instance"

    local port="${APP_PORT:-8082}"
    local ccmd
    ccmd=$(compose_cmd "$instance")

    # ── Step 1: Backup (if DB is running) ─────────────────────────────────────
    echo "   [1/4] Backing up database..."
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${instance}-db"; then
        local backup_dir="instances/${instance}/backups"
        local timestamp
        timestamp=$(date +%Y%m%d_%H%M%S)
        local backup_file="${backup_dir}/backup_pre_upgrade_${timestamp}.sql.gz"
        mkdir -p "$backup_dir"

        if write_instance_database_backup "$instance" "$backup_file" "${DB_ADMIN_USER:-admin_user}" "${DB_NAME:-filterest}" 2>/dev/null; then
            local backup_size
            backup_size=$(du -h "$backup_file" | cut -f1)
            echo -e "   ${GREEN}✓ Backup: ${backup_file} (${backup_size})${NC}"
        else
            echo -e "   ${YELLOW}⚠️  Backup failed (continuing anyway)${NC}"
            rm -f "$backup_file"
        fi
    else
        echo -e "   ${YELLOW}⚠️  DB not running — skipping backup${NC}"
    fi

    # ── Step 2: Rebuild Docker image ──────────────────────────────────────────
    echo "   [2/4] Rebuilding containers..."
    if ! $ccmd build --no-cache 2>&1 | tail -3; then
        echo -e "   ${RED}❌ Build failed for '${instance}'${NC}"
        echo ""
        return 1
    fi
    echo -e "   ${GREEN}✓ Build complete${NC}"

    # ── Step 3: Restart containers ────────────────────────────────────────────
    echo "   [3/4] Restarting containers..."
    normalize_instance_storage_permissions "$instance"
    $ccmd up -d --force-recreate 2>&1 | tail -5

    # ── Step 3b: Sync storage (new files only) ────────────────────────────────
    local instance_storage="instances/${instance}/storage"
    mkdir -p "$instance_storage"
    if [[ -d "$PROJECT_ROOT/storage" ]] && [[ -n "$(ls -A "$PROJECT_ROOT/storage/" 2>/dev/null)" ]]; then
        cp -rn "$PROJECT_ROOT/storage/"* "$instance_storage/" 2>/dev/null || true
    fi
    normalize_instance_storage_permissions "$instance"

    # ── Step 4: Health check ──────────────────────────────────────────────────
    echo "   [4/4] Waiting for application (up to 60s)..."
    if wait_for_instance_app "$instance" "$port" 60; then
        echo -e "   ${GREEN}✅ '${instance}' upgraded and healthy (https://localhost:${port})${NC}"
        echo ""
        return 0
    fi

    echo -e "   ${RED}❌ '${instance}' — app not responding after upgrade${NC}"
    echo "      Check logs: docker logs easelect-${instance}-app"
    echo ""
    return 1
}

# ------------------------------------------------------------------------------
# Upgrade one named instance with the same safety checks used by upgrade-all.
# Between the CLI dispatcher and one Docker instance it provides the targeted
# refresh path needed for local derivative-instance testing.
# Why: users often want to rebuild only easelect.com locally without touching
# every other derivative instance.
# ------------------------------------------------------------------------------
upgrade_instance() {
    local instance="$1"

    if [[ -z "$instance" ]]; then
        echo -e "${RED}❌ Instance name required. Usage: ./ctl --instance <name> --upgrade${NC}"
        exit 1
    fi

    if ! command -v docker &>/dev/null || ! docker info &>/dev/null 2>&1; then
        echo -e "${RED}❌ Docker not available. Start Docker first.${NC}"
        exit 1
    fi

    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}🔄 Upgrading Docker instance '${instance}'${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    if _upgrade_instance_with_checks "$instance"; then
        echo -e "${GREEN}✅ Targeted upgrade complete${NC}"
        exit 0
    fi

    echo -e "${RED}❌ Targeted upgrade failed${NC}"
    exit 1
}

# ------------------------------------------------------------------------------
# Mass operation: Upgrade all instances
#
# Rebuilds and restarts all configured instances with the latest code.
# Improvements over naive rebuild:
#   1. Pre-flight Docker check (fail fast)
#   2. Backup each instance's DB before rebuilding
#   3. Rebuild Docker image with --no-cache
#   4. Restart containers
#   5. Proper HTTP health check with timeout (not just docker ps)
#   6. Storage sync (new files from seed, existing preserved)
#   7. Summary report with per-instance results
# ------------------------------------------------------------------------------
upgrade_all_instances() {
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}🔄 Upgrading all instances (backup → rebuild → restart)${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    # ── Pre-flight: Docker must be available ──────────────────────────────────
    if ! command -v docker &>/dev/null || ! docker info &>/dev/null 2>&1; then
        echo -e "${RED}❌ Docker not available. Start Docker first.${NC}"
        exit 1
    fi

    # ── Collect instances ─────────────────────────────────────────────────────
    local -a instances=()

    for dir in instances/*/; do
        if [[ -d "$dir" ]] && [[ "$(basename "$dir")" != "template" ]]; then
            instances+=("$(basename "$dir")")
        fi
    done

    if [[ ${#instances[@]} -eq 0 ]]; then
        echo -e "${YELLOW}⚠️  No instances found${NC}"
        exit 0
    fi

    echo "Found ${#instances[@]} instance(s):"
    for inst in "${instances[@]}"; do
        echo "   • ${inst}"
    done
    echo ""

    local success_count=0
    local fail_count=0
    local -a results=()

    for instance in "${instances[@]}"; do
        if _upgrade_instance_with_checks "$instance"; then
            ((success_count++)) || true
            results+=("${instance}: OK")
        else
            ((fail_count++)) || true
            results+=("${instance}: FAILED")
        fi
    done

    # ── Summary ───────────────────────────────────────────────────────────────
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Upgrade complete: ${success_count} succeeded, ${fail_count} failed${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Results:"
    for result in "${results[@]}"; do
        echo "   ${result}"
    done
    echo ""
}

# ------------------------------------------------------------------------------
# Mass operation: Sync all instances from seed
# Rebuilds all instances and merges seed data (additive only) into each one
# ------------------------------------------------------------------------------
sync_all_instances() {
    echo -e "${BLUE}🔄 Syncing all instances from seed (merge mode)...${NC}"
    echo ""

    # Pre-check: seed DB must be running (fail fast before touching any instance)
    local seed_host seed_port
    seed_host=$(grep -E "^DB_HOST=" "$EASELECT_DEV_ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2)
    seed_port=$(grep -E "^DB_PORT=" "$EASELECT_DEV_ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2)
    if [[ -z "$seed_host" ]]; then
        seed_host=$(grep -E "^DB_HOST=" "$EASELECT_RUNTIME_ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2)
    fi
    if [[ -z "$seed_port" ]]; then
        seed_port=$(grep -E "^DB_PORT=" "$EASELECT_RUNTIME_ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2)
    fi
    seed_host="${seed_host:-localhost}"
    seed_port="${seed_port:-5432}"

    if ! pg_isready -h "$seed_host" -p "$seed_port" >/dev/null 2>&1; then
        echo -e "${RED}❌ Seed database is not running (${seed_host}:${seed_port})${NC}"
        echo "   All instances need the seed DB — aborting."
        exit 1
    fi

    local instances=()
    local success_count=0
    local fail_count=0

    for dir in instances/*/; do
        if [[ -d "$dir" ]] && [[ "$(basename "$dir")" != "template" ]]; then
            instances+=("$(basename "$dir")")
        fi
    done

    if [[ ${#instances[@]} -eq 0 ]]; then
        echo -e "${YELLOW}⚠️  No instances found${NC}"
        exit 0
    fi

    echo "Found ${#instances[@]} instance(s):"
    for inst in "${instances[@]}"; do
        echo "   • ${inst}"
    done
    echo ""

    for instance in "${instances[@]}"; do
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        # Run sync in a subshell so 'exit' in sync_instance doesn't kill the loop
        if ( sync_instance "$instance" ); then
            ((success_count++)) || true
        else
            ((fail_count++)) || true
        fi
        echo ""
    done

    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Sync complete: ${success_count} succeeded, ${fail_count} failed${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
}

# ------------------------------------------------------------------------------
# Mass operation: Status check all instances
# Shows health status of all configured instances
# ------------------------------------------------------------------------------
status_all_instances() {
    echo -e "${BLUE}📊 Status of all instances${NC}"
    echo ""
    
    # Header
    echo "────────────────────────────────────────────────────────────────────────────"
    printf "%-15s %-12s %-12s %-10s %-20s\n" "INSTANCE" "APP" "DB" "PORT" "HEALTH"
    echo "────────────────────────────────────────────────────────────────────────────"
    
    local running_count=0
    local stopped_count=0
    local unhealthy_count=0
    
    for dir in instances/*/; do
        if [[ -d "$dir" ]] && [[ "$(basename "$dir")" != "template" ]]; then
            local name=$(basename "$dir")
            local env_file="${dir}.env"
            local app_status="${RED}down${NC}"
            local db_status="${RED}down${NC}"
            local port="-"
            local health="${RED}unhealthy${NC}"
            
            if [[ -f "$env_file" ]]; then
                # Use selective grep instead of source to avoid issues
                # with unquoted values containing spaces
                eval "$(grep -E '^(APP_PORT)=' "$env_file" 2>/dev/null)"
                port="${APP_PORT:-8082}"
                
                # Check app container
                if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${name}-app"; then
                    app_status="${GREEN}up${NC}"
                fi
                
                # Check db container
                if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${name}-db"; then
                    db_status="${GREEN}up${NC}"
                fi
                
                # Health check - support both HTTP and HTTPS derivative instances
                if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${name}-app"; then
                    if wait_for_instance_app "$name" "$port" 3; then
                        health="${GREEN}healthy${NC}"
                        ((running_count++)) || true
                    else
                        health="${YELLOW}starting${NC}"
                        ((unhealthy_count++)) || true
                    fi
                else
                    ((stopped_count++)) || true
                fi
            fi
            
            printf "%-15s " "$name"
            echo -e "${app_status}          ${db_status}          ${port}       ${health}"
        fi
    done
    
    echo "────────────────────────────────────────────────────────────────────────────"
    echo ""
    echo -e "Summary: ${GREEN}${running_count} healthy${NC}, ${YELLOW}${unhealthy_count} unhealthy${NC}, ${RED}${stopped_count} stopped${NC}"
}

# ------------------------------------------------------------------------------
# Mass operation: Backup all instances
# Creates pg_dump backups for all running instances
# ------------------------------------------------------------------------------
backup_all_instances() {
    echo -e "${BLUE}💾 Backing up all instances...${NC}"
    echo ""
    
    local success_count=0
    local skip_count=0
    local fail_count=0
    local backups=()
    
    for dir in instances/*/; do
        if [[ -d "$dir" ]] && [[ "$(basename "$dir")" != "template" ]]; then
            local name=$(basename "$dir")
            local env_file="${dir}.env"
            
            if [[ ! -f "$env_file" ]]; then
                echo -e "${YELLOW}⚠️  Skipping '${name}' (no .env file)${NC}"
                ((skip_count++)) || true
                continue
            fi
            
            # Check if DB is running
            if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${name}-db"; then
                echo -e "${YELLOW}⚠️  Skipping '${name}' (database not running)${NC}"
                ((skip_count++)) || true
                continue
            fi
            
            source "$env_file"
            
            local backup_dir="instances/${name}/backups"
            local timestamp=$(date +%Y%m%d_%H%M%S)
            local backup_file="${backup_dir}/backup_${timestamp}.sql.gz"
            
            mkdir -p "$backup_dir"
            
            echo -n "   Backing up '${name}'... "
            
            if write_instance_database_backup "$name" "$backup_file" "${DB_ADMIN_USER:-admin_user}" "${DB_NAME:-filterest}" >/dev/null 2>&1; then
                local size=$(du -h "$backup_file" | cut -f1)
                echo -e "${GREEN}✅ ${size}${NC}"
                backups+=("${backup_file}")
                ((success_count++)) || true
            else
                echo -e "${RED}❌ failed${NC}"
                rm -f "$backup_file"
                ((fail_count++)) || true
            fi
        fi
    done
    
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Backup complete: ${success_count} succeeded, ${skip_count} skipped, ${fail_count} failed${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    
    if [[ ${#backups[@]} -gt 0 ]]; then
        echo ""
        echo "Backup files created:"
        for backup in "${backups[@]}"; do
            echo "   ${backup}"
        done
    fi
}
