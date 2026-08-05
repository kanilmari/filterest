#!/bin/bash
# ==============================================================================
# ctl_main.sh: Easelect Control CLI - Main Entry Point
#
# Unified management tool for Easelect instances, Docker, and Traefik.
#
# Usage:
#   ./ctl              # Local development (default)
#   ./ctl --docker     # Docker environment
#   ./ctl --instance   # Multi-instance management
#   ./ctl --traefik    # Traefik reverse proxy
#   ./ctl --stop       # Stop all running instances
#
# Options:
#   --docker        Run in Docker containers
#   --restore-db    (Docker only) Restore database from a full dump or committed bootstrap zip
#   --role          (instance create only) application or management
#   --stop          Stop all running Easelect instances
#   --help          Show this help message
# ==============================================================================

# Prevent sourcing - this script must be executed, not sourced
# (sourcing would cause 'exit' to close the user's terminal)
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    echo -e "\033[0;31mError: This script must be executed, not sourced.\033[0m"
    echo "Use: ./ctl [options]"
    echo "Not:  . ctl [options]"
    return 1 2>/dev/null || exit 1
fi

set -euo pipefail

# Determine script location and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Resolve environment (PATH, cd to project root) — needed for su/root
source "$SCRIPT_DIR/lib/resolve_env.sh"

# Source library modules
source "$SCRIPT_DIR/lib/env_permissions.sh"
source "$SCRIPT_DIR/lib/common.sh"
source "$PROJECT_ROOT/server_tools/lib/bootstrap_seed.sh"
source "$SCRIPT_DIR/lib/local.sh"
source "$SCRIPT_DIR/lib/docker.sh"
source "$SCRIPT_DIR/lib/instance.sh"
source "$SCRIPT_DIR/lib/dev_targets.sh"
source "$SCRIPT_DIR/lib/traefik.sh"

MODE="local"
RESTORE_DB=false

# ------------------------------------------------------------------------------
# Parse arguments
# ------------------------------------------------------------------------------
show_help() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════════════════════╗
║                           EASELECT CONTROL CLI                               ║
╚══════════════════════════════════════════════════════════════════════════════╝

QUICK START
───────────────────────────────────────────────────────────────────────────────
  ./ctl                     Käynnistä paikallisesti (kehitys)
                            → Go-backend portissa 8082
                            → Käyttää ratkaistua native development env -tiedostoa
                            → Hot reload: muutokset näkyvät heti

  ./ctl -p 8090             Käynnistä paikallisesti custom-portissa
                            → Sama kuin yllä, mutta portissa 8090

  ./ctl list                Listaa kaikki instanssit (local + Docker)

  ./ctl logs                Näytä lokaalin palvelimen lokit (tail -f)

  ./ctl journal serlog 100  Näytä journalctl-lokit (systemd-palvelu)
                            → 1. arg: instanssin nimi (osittainen riittää)
                            → 2. arg: rivien määrä (oletus: 50)

  ./ctl --docker            Käynnistä Docker-kontissa
                            → Rakentaa Go-binäärin ja frontend-buildin
                            → Käyttää ratkaistua native runtime env -tiedostoa
                            → PostgreSQL + PostGIS + pgvector

  ./ctl --stop              Pysäytä kaikki käynnissä olevat instanssit
  ./ctl --refresh-all-dev-targets
                            Päivitä natiivi ensin ja käynnistä se,
                            sitten rebuildaa kaikki Docker-instanssit
  ./ctl --setup-completion  Asenna Bash-tab-completion ctl-komennolle

DOCKER-TILA (single-instance)
───────────────────────────────────────────────────────────────────────────────
  ./ctl --docker                    Käynnistä yhden instanssin Docker-tilassa
  ./ctl --docker --restore-db       Käynnistä ja palauta tietokanta 
                                    easelect_full_dump_*.sql -tiedostosta
                                    tai VERSION_DB:hen sidotusta bootstrap-zipistä

INSTANSSI-TILA (multi-tenant)
───────────────────────────────────────────────────────────────────────────────
Jokainen instanssi on erillinen Easelect-asennus omalla tietokannalla.
Instanssit sijaitsevat kansiossa: ./instances/<nimi>/

  ./ctl --instance list             Listaa kaikki instanssit
  ./ctl --instance create uusi.fi   Luo uusi instanssi
  ./ctl --instance create mgmt.local --role management
                                    Luo hallinta-Easelectin management-seedillä

Käynnistys:
  ./ctl --instance serlog.com       Käynnistä serlog.com-instanssi

Ngrok-tunneli (julkinen URL webhookeja varten):
  ./ctl --instance example.com --ngrok     Käynnistä instanssi + ngrok
  
  Vinkki: Lisää NGROK_ENABLED=true instanssin .env-tiedostoon,
          niin ngrok käynnistyy automaattisesti ilman --ngrok -lippua.

Synkronointi (koodi + kanta seedistä):
  ./ctl --instance serlog.com --init      Alusta instanssi (storage + koko kanta devistä)
  ./ctl --instance serlog.com --sync      Päivitä koodi ja kanta seedistä (merge-tila)
  ./ctl --instance sync-all               Synkronoi kaikki instanssit seedistä

Hallinta:
  ./ctl --instance serlog.com --stop      Pysäytä instanssi
  ./ctl --instance serlog.com --upgrade   Rebuildaa ja käynnistää instanssin uudella koodilla
  ./ctl --instance serlog.com --logs      Näytä lokit
  ./ctl --instance serlog.com --backup    Varmuuskopioi tietokanta
  ./ctl --instance serlog.com --restore   Palauta varmuuskopiosta
  ./ctl --instance serlog.com --delete    Poista instanssi

Massatoiminnot:
  ./ctl --instance upgrade-all      Päivitä ja käynnistä kaikki instanssit
  ./ctl --instance sync-all         Synkronoi kaikki instanssit seedistä
  ./ctl --instance status-all       Tarkista kaikkien instanssien tila
  ./ctl --instance backup-all       Varmuuskopioi kaikki tietokannat

TRAEFIK (reverse proxy, dedikoitu tuotantohosti)
───────────────────────────────────────────────────────────────────────────────
  ./ctl --traefik start             Käynnistä Traefik-proxy
  ./ctl --traefik stop              Pysäytä Traefik
  ./ctl --traefik logs              Näytä Traefik-lokit

Kun Traefik on käynnissä, instanssit rekisteröityvät automaattisesti:
  dev (development)   → Suorat instanssiportit (8090, 8091, 8092, ...)
  prod (production)   → Traefik (:80, :443 + SSL, dedikoitu hosti)

ESIMERKKEJÄ
───────────────────────────────────────────────────────────────────────────────
# Kehitys paikallisesti (yleisin)
./ctl

# Testaa Docker-build
./ctl --docker

# Käynnistä paikallinen Docker-instanssi
./ctl --instance serlog.com

# Varmuuskopioi ja päivitä kaikki
./ctl --instance backup-all && ./ctl --instance upgrade-all

# Päivitä natiivi ensin, sitten kaikki Docker-instanssit
./ctl --refresh-all-dev-targets

# Pysäytä kaikki
./ctl --stop
EOF
}

INSTANCE_NAME=""
INSTANCE_ACTION=""
TRAEFIK_ACTION=""
INSTANCE_DOMAIN=""
INSTANCE_ROLE="application"
RESTORE_FILE=""
NGROK_FLAG=""
LOCAL_PORT=""
LOCAL_ACTION="start"
JOURNAL_LINES=""
JOURNAL_INSTANCE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        journal)
            # Shorthand: ./ctl journal [instance] [lines]
            # If first arg after "journal" is a number, treat it as lines (local)
            MODE="journal"
            if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
                # ./ctl journal 100 → local, 100 lines
                JOURNAL_INSTANCE=""
                JOURNAL_LINES="${2:-50}"
            else
                # ./ctl journal serlog 100
                JOURNAL_INSTANCE="${2:-}"
                JOURNAL_LINES="${3:-50}"
            fi
            shift $#
            ;;
        list)
            # Shorthand: ./ctl list = ./ctl --instance list
            MODE="instance"
            INSTANCE_ACTION="list"
            shift
            ;;
        --docker)
            MODE="docker"
            shift
            ;;
        i|--instance)
            MODE="instance"
            # Check if next arg is a special command or instance name
            if [[ -n "${2:-}" ]]; then
                case "$2" in
                    list|create|upgrade-all|status-all|backup-all|sync-all)
                        INSTANCE_ACTION="$2"
                        INSTANCE_NAME="${3:-}"
                        shift 3 2>/dev/null || shift 2
                        ;;
                    *)
                        # Use partial match resolution
                        INSTANCE_NAME=$(resolve_instance_name "$2") || exit 1
                        INSTANCE_ACTION="start"
                        shift 2
                        ;;
                esac
            else
                shift
            fi
            ;;
        --domain)
            INSTANCE_DOMAIN="$2"
            shift 2
            ;;
        --role|--instance-role)
            INSTANCE_ROLE="$2"
            shift 2
            ;;
        --init)
            INSTANCE_ACTION="init"
            shift
            ;;
        --sync)
            INSTANCE_ACTION="sync"
            shift
            ;;
        --upgrade)
            INSTANCE_ACTION="upgrade"
            shift
            ;;
        --backup)
            INSTANCE_ACTION="backup"
            shift
            ;;
        --logs)
            INSTANCE_ACTION="logs"
            shift
            ;;
        --delete)
            INSTANCE_ACTION="delete"
            shift
            ;;
        --restore)
            INSTANCE_ACTION="restore"
            RESTORE_FILE="${2:-}"
            shift 2 2>/dev/null || shift
            ;;
        --traefik)
            MODE="traefik"
            TRAEFIK_ACTION="${2:-start}"
            shift 2 2>/dev/null || shift
            ;;
        --restore-db)
            RESTORE_DB=true
            shift
            ;;
        --ngrok)
            NGROK_FLAG="true"
            shift
            ;;
        -p|--port)
            LOCAL_PORT="$2"
            shift 2
            ;;
        logs)
            # Shorthand: ./ctl logs = show local logs
            MODE="local"
            LOCAL_ACTION="logs"
            shift
            ;;
        --stop)
            if [[ "$MODE" == "instance" ]]; then
                INSTANCE_ACTION="stop"
            else
                MODE="stop"
            fi
            shift
            ;;
        --refresh-all-dev-targets)
            MODE="dev-targets"
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        --setup-completion)
            echo -e "${YELLOW}Run this via the top-level ./ctl wrapper so completion can install itself:${NC}"
            echo "  ./ctl --setup-completion"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------
case $MODE in
    local)
        if [[ "$LOCAL_ACTION" == "logs" ]]; then
            show_local_logs
        else
            start_local "$LOCAL_PORT"
        fi
        ;;
    journal)
        show_journal "$JOURNAL_INSTANCE" "$JOURNAL_LINES"
        ;;
    docker)
        start_docker
        ;;
    traefik)
        manage_traefik "$TRAEFIK_ACTION"
        ;;
    instance)
        manage_instance "$INSTANCE_ACTION" "$INSTANCE_NAME"
        ;;
    dev-targets)
        refresh_all_dev_targets
        ;;
    stop)
        stop_all
        ;;
esac
