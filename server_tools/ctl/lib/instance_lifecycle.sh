#!/bin/bash
# ==============================================================================
# instance_lifecycle.sh: Instance start, stop, and log viewing
#
# Handles the runtime lifecycle of individual Docker instances:
# - Starting an instance (with port checks and health verification)
# - Stopping an instance
# - Viewing instance logs
# ==============================================================================

# ------------------------------------------------------------------------------
# Start specific instance
# ------------------------------------------------------------------------------
start_instance() {
    local instance="$1"
    
    if [[ -z "$instance" ]]; then
        echo -e "${RED}❌ Instance name required. Usage: ./ctl --instance <name>${NC}"
        echo "   Available instances:"
        ls -1 instances/ 2>/dev/null | grep -v template | grep -v ".env" | sed 's/^/     /'
        exit 1
    fi
    
    local instance_dir="instances/${instance}"
    local env_file="${instance_dir}/.env"
    
    if [[ ! -f "$env_file" ]]; then
        echo -e "${RED}❌ Instance '${instance}' not found${NC}"
        echo "   Expected: ${env_file}"
        echo ""
        echo "   To create a new instance:"
        echo "   1. mkdir -p ${instance_dir}/{storage,storage_deleted,backups}"
        echo "   2. cp instances/template.env ${env_file}"
        echo "   3. Edit ${env_file} with unique ports and credentials"
        exit 1
    fi

    warn_secret_env_file_permissions "$env_file" "instance startup"
    
    # Load instance config
    source "$env_file"
    prepare_instance_compose_env "$env_file"
    
    # Determine environment type
    local env_type="${ENVIRONMENT_TYPE:-dev}"
    
    echo -e "${BLUE}🚀 Starting instance '${instance}' (${env_type} mode)...${NC}"
    
    # Check Docker
    if ! command -v docker &> /dev/null || ! docker info &> /dev/null 2>&1; then
        echo -e "${RED}❌ Docker not available. Start Docker Desktop.${NC}"
        exit 1
    fi
    
    # Refuse to disrupt existing services. A parallel VPS may already be running
    # a native instance (for example serlog.com) on the host.
    if [[ -n "$APP_PORT" ]] && lsof -nP -iTCP:${APP_PORT} -sTCP:LISTEN > /dev/null 2>&1; then
        echo -e "${RED}❌ APP_PORT ${APP_PORT} is already in use${NC}"
        echo "   Refusing to stop the existing process automatically."
        echo "   Choose another APP_PORT in ${env_file} or stop that service manually."
        lsof -nP -iTCP:${APP_PORT} -sTCP:LISTEN 2>/dev/null | sed 's/^/   /'
        exit 1
    fi

    if [[ -n "$DB_PORT" ]] && [[ "$DB_PORT" != "0" ]] && lsof -nP -iTCP:${DB_PORT} -sTCP:LISTEN > /dev/null 2>&1; then
        echo -e "${RED}❌ DB_PORT ${DB_PORT} is already in use${NC}"
        echo "   Refusing to stop the existing process automatically."
        echo "   Choose another DB_PORT in ${env_file} or stop that service manually."
        lsof -nP -iTCP:${DB_PORT} -sTCP:LISTEN 2>/dev/null | sed 's/^/   /'
        exit 1
    fi
    
    # Build compose command with correct project name
    local ccmd=$(compose_cmd "$instance")
    
    if [[ "$env_type" == "prod" ]] && [[ -f "docker/docker-compose.traefik.yml" ]]; then
        echo "   Using Traefik reverse proxy (production mode)"
        local project=$(compose_project_name "$instance")
        ccmd="docker compose -p ${project} -f docker/docker-compose.traefik.yml -f docker/docker-compose.instance.yml --env-file ${env_file}"
    else
        echo "   Using direct ports (${APP_PORT:-8082})"
    fi

    normalize_instance_storage_permissions "$instance"
    
    # Set instance name for Docker Compose
    export INSTANCE="$instance"
    
    # Start the instance
    echo "🐳 Starting containers..."
    $ccmd up -d
    
    # Wait for startup
    local port="${APP_PORT:-8082}"
    echo "⏳ Waiting for application..."
    
    if wait_for_instance_app "$instance" "$port" 60; then
        echo ""
        echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}✅ Instance '${instance}' is running!${NC}"
        echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo "   🌐 Application:  http://localhost:${port}"
        echo "   📁 Storage:      ${instance_dir}/storage/"
        echo "   💾 Backups:      ${instance_dir}/backups/"
        
        # Start ngrok if enabled (via flag or .env)
        local ngrok_enabled="${NGROK_FLAG:-${NGROK_ENABLED:-false}}"
        if [[ "$ngrok_enabled" == "true" ]]; then
            start_ngrok "$port" "$instance"
        fi
        
        echo ""
        echo "   Logs:    docker logs easelect-${instance}-app"
        echo "   Stop:    $(compose_cmd "$instance") down"
        echo ""
    else
        echo -e "${RED}❌ Instance failed to start${NC}"
        echo "   Check logs: docker logs easelect-${instance}-app"
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# Stop specific instance
# ------------------------------------------------------------------------------
stop_instance() {
    local instance="$1"
    
    if [[ -z "$instance" ]]; then
        echo -e "${RED}❌ Instance name required${NC}"
        exit 1
    fi
    
    local env_file="instances/${instance}/.env"
    
    if [[ ! -f "$env_file" ]]; then
        echo -e "${RED}❌ Instance '${instance}' not found${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}🛑 Stopping instance '${instance}'...${NC}"
    
    export INSTANCE="$instance"
    $(compose_cmd "$instance") down
    
    echo -e "${GREEN}✅ Instance '${instance}' stopped${NC}"
}

# ------------------------------------------------------------------------------
# View instance logs
# ------------------------------------------------------------------------------
instance_logs() {
    local instance="$1"
    
    if [[ -z "$instance" ]]; then
        echo -e "${RED}❌ Instance name required${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}📋 Logs for instance '${instance}'${NC}"
    docker logs -f "easelect-${instance}-app" 2>/dev/null || echo -e "${RED}❌ Container not found${NC}"
}
