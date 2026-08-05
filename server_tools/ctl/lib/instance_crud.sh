#!/bin/bash
# ==============================================================================
# instance_crud.sh: Instance creation and recoverable retirement
#
# Handles the full lifecycle of instance directories and configuration:
# - Creating new instances with auto-generated ports and credentials
# - Retiring instances into a recoverable, owner-only project trash
# ==============================================================================

# Host-port slot bases for Docker instances. Keep one stable slot per instance so
# app/db/optional sidecars remain predictable as the stack grows.
INSTANCE_APP_PORT_BASE=8090
INSTANCE_DB_PORT_BASE=5490
INSTANCE_NGROK_PORT_BASE=4040
INSTANCE_AUX_PORT_BASE=6090

# ------------------------------------------------------------------------------
# Read a simple KEY=value entry from an instance env file.
# ------------------------------------------------------------------------------
_instance_env_value() {
    local env_file="$1"
    local key="$2"

    grep -E "^${key}=" "$env_file" 2>/dev/null | tail -1 | cut -d'=' -f2
}

# ------------------------------------------------------------------------------
# Resolve an instance slot from PORT_SLOT or, for older env files, from ports.
# ------------------------------------------------------------------------------
_instance_slot_from_env() {
    local env_file="$1"
    local slot
    local derived_port

    slot=$(_instance_env_value "$env_file" "PORT_SLOT")
    if [[ "$slot" =~ ^[0-9]+$ ]]; then
        echo "$slot"
        return 0
    fi

    derived_port=$(_instance_env_value "$env_file" "APP_PORT")
    if [[ "$derived_port" =~ ^[0-9]+$ ]] && (( derived_port >= INSTANCE_APP_PORT_BASE )); then
        echo $((derived_port - INSTANCE_APP_PORT_BASE))
        return 0
    fi

    derived_port=$(_instance_env_value "$env_file" "DB_PORT")
    if [[ "$derived_port" =~ ^[0-9]+$ ]] && (( derived_port >= INSTANCE_DB_PORT_BASE )); then
        echo $((derived_port - INSTANCE_DB_PORT_BASE))
        return 0
    fi

    return 1
}

# ------------------------------------------------------------------------------
# Find the next free host-port slot for a new instance.
# ------------------------------------------------------------------------------
_next_instance_slot() {
    local next_slot=0
    local existing_env=""
    local existing_slot=""
    local candidate_app_port=""
    local candidate_db_port=""
    local candidate_ngrok_port=""

    for existing_env in instances/*/.env; do
        [[ -f "$existing_env" ]] || continue

        if existing_slot=$(_instance_slot_from_env "$existing_env"); then
            if (( existing_slot >= next_slot )); then
                next_slot=$((existing_slot + 1))
            fi
        fi
    done

    while true; do
        candidate_app_port=$((INSTANCE_APP_PORT_BASE + next_slot))
        candidate_db_port=$((INSTANCE_DB_PORT_BASE + next_slot))
        candidate_ngrok_port=$((INSTANCE_NGROK_PORT_BASE + next_slot))

        if lsof -nP -iTCP:${candidate_app_port} -sTCP:LISTEN > /dev/null 2>&1 ||
           lsof -nP -iTCP:${candidate_db_port} -sTCP:LISTEN > /dev/null 2>&1 ||
           lsof -nP -iTCP:${candidate_ngrok_port} -sTCP:LISTEN > /dev/null 2>&1; then
            next_slot=$((next_slot + 1))
            continue
        fi

        echo "$next_slot"
        return 0
    done
}

# ------------------------------------------------------------------------------
# Create new instance
# ------------------------------------------------------------------------------
create_instance() {
    local name="$1"
    local domain="${2:-${name}.localhost}"
    local instance_role="${3:-application}"
    
    if [[ -z "$name" ]]; then
        echo -e "${RED}❌ Instance name required${NC}"
        echo "   Usage: ./ctl --instance create <name> [--domain <domain>] [--role application|management]"
        exit 1
    fi

    instance_role="$(normalize_instance_role "$instance_role")" || exit 1
    
    local instance_dir="instances/${name}"
    local env_file="${instance_dir}/.env"
    
    if [[ -d "$instance_dir" ]]; then
        echo -e "${RED}❌ Instance '${name}' already exists${NC}"
        echo "   Directory: ${instance_dir}"
        exit 1
    fi
    
    echo -e "${BLUE}🆕 Creating instance '${name}'...${NC}"
    
    # Create directories
    mkdir -p "${instance_dir}"/{storage,storage_deleted,backups}
    echo "   ✓ Created ${instance_dir}/"
    
    # Reserve a stable slot per instance so app/db/optional sidecars stay in a
    # predictable host-port block as the stack evolves.
    local port_slot=""
    local app_port=""
    local db_port=""
    local ngrok_port=""
    local aux_port=""
    local sanitized_name=$(echo "$name" | tr -c 'a-zA-Z0-9' '_' | sed 's/__*/_/g' | sed 's/^_//; s/_$//')
    sanitized_name="${sanitized_name:-instance}"

    port_slot=$(_next_instance_slot)
    app_port=$((INSTANCE_APP_PORT_BASE + port_slot))
    db_port=$((INSTANCE_DB_PORT_BASE + port_slot))
    ngrok_port=$((INSTANCE_NGROK_PORT_BASE + port_slot))
    aux_port=$((INSTANCE_AUX_PORT_BASE + port_slot))
    
    # Generate random passwords
    local db_password=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
    local db_readonly_password=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
    local db_confidential_password=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
    local db_basic_password=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
    local db_guest_password=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
    local session_key=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    local session_secret_key=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
    
    # Create .env file
    cat > "$env_file" << EOF
# ==============================================================================
# Instance: ${name}
# Created: $(date +%Y-%m-%d)
# ==============================================================================

# Instance identification
INSTANCE=${name}
DOMAIN=${domain}

# Stable host-port slot for this instance.
PORT_SLOT=${port_slot}
# Slot convention: APP_PORT=8090+slot, DB_PORT=5490+slot, NGROK_PORT=4040+slot.
APP_PORT=${app_port}
DB_PORT=${db_port}
APP_BIND_HOST=127.0.0.1
DB_BIND_HOST=127.0.0.1

# Environment type: dev (direct ports) or prod (Traefik)
ENVIRONMENT_TYPE=dev
# Runtime role: application instances run domain/app data; management instances
# own cloud/instance-management surfaces and use the management bootstrap seed.
INSTANCE_ROLE=${instance_role}
BOOTSTRAP_SEED_PROFILE=${instance_role}
# Instance type: seed (golden master) or derivative (provisioned from seed)
INSTANCE_TYPE=derivative

# Database credentials (auto-generated)
DB_ADMIN_USER=admin_${sanitized_name}
DB_ADMIN_PASSWORD=${db_password}
DB_NAME=easelect

# Role passwords
DB_READONLY_USER=readeronly
DB_READONLY_PASSWORD=${db_readonly_password}
DB_CONFIDENTIAL_USER=limited_user
DB_CONFIDENTIAL_PASSWORD=${db_confidential_password}
DB_BASIC_USER=basic_user
DB_BASIC_PASSWORD=${db_basic_password}
DB_GUEST_USER=guest_user
DB_GUEST_PASSWORD=${db_guest_password}

# Session key (auto-generated)
SESSION_KEY=${session_key}
SESSION_SECRET_KEY=${session_secret_key}

# Optional webhook/ngrok settings
NGROK_AUTHTOKEN=
NGROK_PORT=${ngrok_port}
EOF

    if [[ "$instance_role" == "management" ]]; then
        # These keys are introduced by the block below, so appending them once
        # is the canonical write. The old GNU-style `sed -i` matched no keys in
        # a fresh file and failed silently with BSD sed on macOS.
        cat >> "$env_file" << EOF

# Management-Easelect cloud view
SITE_NAME="Management Easelect"
CLOUD_MANAGEMENT_UI_ENABLED=1
CLOUD_ACTION_VISIBILITY_MODE=disabled
CLOUD_MANAGEMENT_ENABLE_AGENTS=0
CLOUD_MANAGEMENT_AGENTS=
CLOUD_MANAGEMENT_AGENT_URL=
CLOUD_MANAGEMENT_AGENT_ID=
CLOUD_MANAGEMENT_AGENT_NAME=
CLOUD_MANAGEMENT_AGENT_TOKEN_ENV=INSTANCE_PANEL_AGENT_TOKEN
CLOUD_MANAGEMENT_AGENT_TOKEN=
EOF
    else
        cat >> "$env_file" << EOF

# Management-Easelect cloud view
CLOUD_MANAGEMENT_UI_ENABLED=0
CLOUD_ACTION_VISIBILITY_MODE=disabled
CLOUD_MANAGEMENT_ENABLE_AGENTS=0
CLOUD_MANAGEMENT_AGENTS=
CLOUD_MANAGEMENT_AGENT_URL=
CLOUD_MANAGEMENT_AGENT_ID=
CLOUD_MANAGEMENT_AGENT_NAME=
CLOUD_MANAGEMENT_AGENT_TOKEN_ENV=INSTANCE_PANEL_AGENT_TOKEN
CLOUD_MANAGEMENT_AGENT_TOKEN=
EOF
    fi
    
    echo "   ✓ Created ${env_file}"
    
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Instance '${name}' created!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "   📁 Directory:  ${instance_dir}/"
    echo "   🌐 Domain:     ${domain}"
    echo "   🧭 Role:       ${instance_role}"
    echo "   🧩 Slot:       ${port_slot}"
    echo "   🔌 App Port:   ${app_port}"
    echo "   🗄️  DB Port:    ${db_port}"
    echo "   🪝 Ngrok UI:   ${ngrok_port} (reserved)"
    echo "   🔭 Future host-side sidecar slot: ${aux_port} (reserved)"
    echo ""
    echo "   Next steps:"
    echo "   1. Review config: cat ${env_file}"
    echo "   2. Start:         ./ctl --instance ${name}"
    echo ""
}

# ------------------------------------------------------------------------------
# Retire one instance without permanently deleting its files or Docker volume.
# Between the live instance tree, optional DB dump, and project trash it keeps
# every local recovery surface available after the operator confirmation.
# Why: an ordinary cleanup action must not destroy media or the named DB volume.
# ------------------------------------------------------------------------------
delete_instance() {
    local instance="$1"
    
    if [[ -z "$instance" ]]; then
        echo -e "${RED}❌ Instance name required${NC}"
        exit 1
    fi
    
    local instance_dir="instances/${instance}"
    local env_file="${instance_dir}/.env"
    
    if [[ ! -d "$instance_dir" ]]; then
        echo -e "${RED}❌ Instance '${instance}' not found${NC}"
        exit 1
    fi
    
    echo -e "${RED}⚠️  WARNING: This will retire instance '${instance}'${NC}"
    echo "   Directory: ${instance_dir}/"
    echo "   Files move to the protected project trash; Docker volumes are retained."
    echo ""

    local backup_confirm="no"
    local database_running=false
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${instance}-db"; then
        database_running=true
        read -p "   Create a portable DB backup before retirement? (yes/no): " backup_confirm
    fi

    read -p "   Type instance name to confirm retirement: " confirm
    
    if [[ "$confirm" != "$instance" ]]; then
        echo "   Cancelled."
        exit 0
    fi

    local retirement_timestamp
    local retirement_root
    local retired_instance_dir
    local retirement_db_dir
    local retirement_db_file
    retirement_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    retirement_root="${PROJECT_ROOT}/data/instance_trash/deleted_instances/${instance}_${retirement_timestamp}"
    retired_instance_dir="${retirement_root}/instance"
    retirement_db_dir="${retirement_root}/database"
    retirement_db_file="${retirement_db_dir}/backup_before_retirement_${retirement_timestamp}.sql.gz"

    if [[ -e "$retirement_root" ]]; then
        echo -e "${RED}❌ Retirement target already exists: ${retirement_root}${NC}"
        exit 1
    fi
    mkdir -p "$retirement_db_dir"
    chmod 700 "$retirement_root" "$retirement_db_dir"

    if [[ "$database_running" == true ]] && [[ "$backup_confirm" == "yes" ]]; then
        backup_instance "$instance" "$retirement_db_file"
    fi

    echo -e "${YELLOW}🗑️  Moving instance '${instance}' to protected trash...${NC}"

    # Keep named Docker volumes recoverable. Purging them is a separate,
    # explicitly destructive operator action.
    if [[ -f "$env_file" ]]; then
        export INSTANCE="$instance"
        if ! $(compose_cmd "$instance") down; then
            echo -e "${RED}❌ Could not stop the instance; retirement cancelled${NC}"
            exit 1
        fi
    fi

    mv "$instance_dir" "$retired_instance_dir"
    (
        umask 077
        {
            printf 'INSTANCE=%s\n' "$instance"
            printf 'RETIRED_AT=%s\n' "$retirement_timestamp"
            printf 'SOURCE_PATH=%s\n' "$instance_dir"
            printf 'RETIRED_INSTANCE_PATH=%s\n' "$retired_instance_dir"
            printf 'DOCKER_VOLUMES_RETAINED=true\n'
            if [[ -f "$retirement_db_file" ]]; then
                printf 'DATABASE_BACKUP=%s\n' "$retirement_db_file"
            else
                printf 'DATABASE_BACKUP=not_created\n'
            fi
        } > "${retirement_root}/RESTORE.env"
    )

    echo -e "${GREEN}✅ Instance '${instance}' moved to protected trash${NC}"
    echo "   Recovery path: ${retirement_root}"
    echo "   Docker named volumes were retained."
}
