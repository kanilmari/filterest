#!/bin/bash
# ==============================================================================
# traefik.sh: Traefik reverse proxy management for Easelect Control CLI
#
# Handles starting, stopping, and managing the Traefik reverse proxy.
# ==============================================================================

# ------------------------------------------------------------------------------
# Traefik reverse proxy management
# ------------------------------------------------------------------------------
manage_traefik() {
    local action="${1:-start}"
    
    echo -e "${BLUE}🔀 Traefik reverse proxy (${action})...${NC}"
    
    # Check Docker
    if ! command -v docker &> /dev/null || ! docker info &> /dev/null 2>&1; then
        echo -e "${RED}❌ Docker not available. Start Docker Desktop.${NC}"
        exit 1
    fi
    
    case $action in
        start)
            # Check if Traefik is already running
            if docker ps | grep -q "traefik"; then
                echo -e "${YELLOW}⚠️  Traefik is already running${NC}"
                docker ps --filter "name=traefik" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
                return 0
            fi
            
            # Check for traefik network (create if doesn't exist)
            if ! docker network ls | grep -q "traefik-network"; then
                echo "   Creating traefik-network..."
                docker network create traefik-network
            fi
            
            # Start Traefik
            echo "🚀 Starting Traefik..."
            docker compose -f docker/docker-compose.traefik.yml up -d
            
            # Wait for startup
            sleep 3
            
            if docker ps | grep -q "traefik"; then
                echo ""
                echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
                echo -e "${GREEN}✅ Traefik is running!${NC}"
                echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
                echo ""
                echo "   🌐 HTTP:       http://localhost:80  (→ redirects to HTTPS)"
                echo "   🔒 HTTPS:      https://localhost:443"
                echo "   📊 Dashboard:  https://traefik.\${BASE_DOMAIN}/dashboard/"
                echo ""
                echo "   Next steps:"
                echo "   1. Start instances:  ./ctl --instance serlog.com"
                echo "   2. Check status:     docker ps"
                echo "   3. View logs:        docker logs -f traefik"
                echo ""
            else
                echo -e "${RED}❌ Traefik failed to start${NC}"
                docker logs traefik 2>&1 | tail -20
                exit 1
            fi
            ;;
        
        stop)
            echo "🛑 Stopping Traefik..."
            docker compose -f docker/docker-compose.traefik.yml down
            echo -e "${GREEN}✅ Traefik stopped${NC}"
            ;;
        
        restart)
            echo "🔄 Restarting Traefik..."
            docker compose -f docker/docker-compose.traefik.yml restart
            echo -e "${GREEN}✅ Traefik restarted${NC}"
            ;;
        
        logs)
            docker logs -f traefik
            ;;
        
        status)
            if docker ps | grep -q "traefik"; then
                echo -e "${GREEN}✅ Traefik is running${NC}"
                docker ps --filter "name=traefik" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
            else
                echo -e "${YELLOW}⚠️  Traefik is not running${NC}"
            fi
            ;;
        
        *)
            echo -e "${RED}Unknown Traefik action: $action${NC}"
            echo "   Valid actions: start, stop, restart, logs, status"
            exit 1
            ;;
    esac
}
