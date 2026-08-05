#!/bin/bash
# ==============================================================================
# docker.sh: Docker mode for Easelect Control CLI
#
# Starts Easelect in Docker containers.
# ==============================================================================

# ------------------------------------------------------------------------------
# Docker mode
# ------------------------------------------------------------------------------
_local_docker_compose() {
    easelect_prepare_docker_context_boundaries "$PROJECT_ROOT"
    docker compose --env-file "$EASELECT_RUNTIME_ENV_FILE" -f docker/docker-compose.dev.yml "$@"
}

# Resolve one host port for the entire local Docker startup workflow.
# Between Docker Compose, readiness checks, and the success message it keeps
# the published port consistent. Why: an APP_PORT override must not leave ctl
# checking or displaying the native development default instead.
resolve_local_docker_host_port() {
    export APP_PORT="${APP_PORT:-$PORT}"
    PORT="$APP_PORT"
    export PORT
}

# Stream a native full dump into the pre-initialized local Docker database.
# The Docker database image creates the PostGIS schema before restore, while a
# native pg_dump also emits an unconditional CREATE SCHEMA postgis statement.
# Making only that statement idempotent preserves the dump while preventing a
# fresh Docker restore from failing before application data is imported.
stream_local_docker_restore_sql() {
    sed 's/^CREATE SCHEMA postgis;$/CREATE SCHEMA IF NOT EXISTS postgis;/'
}

# Prepare host-owned bind mounts for the non-root development container.
# Between Linux/WSL user IDs and Docker Compose it prevents root-owned source or
# media artifacts while failing early on storage left behind by another user.
prepare_local_docker_storage() {
    local private_file
    local storage_name
    local storage_path
    local mismatched_path
    local write_probe

    resolve_local_docker_host_port
    export EASELECT_RUNTIME_UID="${EASELECT_RUNTIME_UID:-$(id -u)}"
    export EASELECT_RUNTIME_GID="${EASELECT_RUNTIME_GID:-$(id -g)}"
    if [[ ! "$EASELECT_RUNTIME_UID" =~ ^[0-9]+$ ]] ||
       [[ ! "$EASELECT_RUNTIME_GID" =~ ^[0-9]+$ ]] ||
       (( EASELECT_RUNTIME_UID < 1000 || EASELECT_RUNTIME_GID < 1000 )); then
        echo "error: Docker runtime UID/GID must be numeric non-root IDs" >&2
        return 1
    fi

    for private_file in "$EASELECT_TLS_CERT_FILE" "$EASELECT_TLS_KEY_FILE"; do
        if [[ ! -r "$private_file" ]]; then
            echo "error: Docker TLS file is missing or unreadable: $private_file" >&2
            return 1
        fi
    done
    mkdir -p "$FILTEREST_PROJECTS_HOME"

    for storage_name in storage storage_deleted db_backups; do
        storage_path="${PROJECT_ROOT}/${storage_name}"
        mkdir -p "$storage_path"
        chmod u+rwx,g+rwx,o-rwx "$storage_path"
        mismatched_path="$(find "$storage_path" \
            \( ! -uid "$EASELECT_RUNTIME_UID" -o ! -gid "$EASELECT_RUNTIME_GID" \) \
            -print -quit)"
        if [[ -n "$mismatched_path" ]]; then
            echo "error: Docker bind-mount ownership does not match runtime ${EASELECT_RUNTIME_UID}:${EASELECT_RUNTIME_GID}: ${mismatched_path}" >&2
            return 1
        fi
        if ! write_probe="$(mktemp "${storage_path}/.easelect-write-probe.XXXXXX")"; then
            echo "error: Docker bind mount is not writable: ${storage_path}" >&2
            return 1
        fi
        rm -f "$write_probe"
    done
}

start_docker() {
    docker_query_public_table_count() {
        docker exec easelect-db-dev psql -U admin_user -d easelect -tAc \
            "SELECT COUNT(*)
               FROM pg_class AS c
               JOIN pg_namespace AS n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind IN ('r', 'p')
                AND NOT EXISTS (
                    SELECT 1
                      FROM pg_depend AS d
                     WHERE d.classid = 'pg_class'::regclass
                       AND d.objid = c.oid
                       AND d.deptype = 'e'
                );" 2>/dev/null | tr -d '[:space:]'
    }

    docker_import_sql_file() {
        local import_label="$1"
        local sql_file="$2"
        local log_file=""

        log_file="$(mktemp)"
        if ! stream_local_docker_restore_sql < "$sql_file" |
            docker exec -i easelect-db-dev psql -v ON_ERROR_STOP=1 -U admin_user -d easelect >"$log_file" 2>&1; then
            echo -e "${RED}❌ ${import_label} failed.${NC}"
            echo "   First diagnostics:"
            grep -E "^(ERROR|psql:|NOTICE:)" "$log_file" | head -20 | sed 's/^/   /' || sed -n '1,20p' "$log_file" | sed 's/^/   /'
            rm -f "$log_file"
            exit 1
        fi
        rm -f "$log_file"
    }

    echo -e "${BLUE}🐳 Starting Easelect in Docker...${NC}"
    
    check_env_file "$EASELECT_RUNTIME_ENV_FILE"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker not found. Install Docker Engine or Docker Desktop.${NC}"
        exit 1
    fi
    
    if ! docker info &> /dev/null 2>&1; then
        echo -e "${RED}❌ Docker daemon is not available. Start Docker Engine or Docker Desktop.${NC}"
        exit 1
    fi

    prepare_local_docker_storage
    
    # Stop conflicting processes
    check_port_available
    
    # Start containers
    echo "🐳 Starting Docker containers..."
    _local_docker_compose down 2>/dev/null || true
    if [[ "$RESTORE_DB" == true ]]; then
        # Build both images first, but keep the app stopped until the database
        # restore is complete. Starting the app against a partially imported
        # schema lets background jobs race the seed and create duplicate rows.
        _local_docker_compose build
        _local_docker_compose up -d db
    else
        _local_docker_compose up -d --build
    fi
    
    echo "⏳ Waiting for database..."
    sleep 5
    
    # Restore database if requested
    if [[ "$RESTORE_DB" == true ]]; then
        # Find most recent dump: check data/db_backups/ first, then project root (legacy)
        local dump_file
        local bootstrap_zip=""
        local bootstrap_password=""
        local bootstrap_tmp_dir=""
        local bootstrap_schema_stream=""
        local config_count=""
        local existing_public_tables=""
        dump_file=$(ls -t data/db_backups/easelect_full_dump_*.sql data/db_backups/easelect_full_dump.sql easelect_full_dump_*.sql easelect_full_dump.sql 2>/dev/null | head -1 || true)
        existing_public_tables="$(docker_query_public_table_count)"
        if [[ -n "$existing_public_tables" && "$existing_public_tables" != "0" ]]; then
            echo -e "${RED}❌ Docker database already contains ${existing_public_tables} public tables.${NC}"
            echo "   --restore-db expects a fresh DB volume so the import does not collide with existing objects."
            echo "   Recreate the DB volume first, for example:"
            echo "   docker compose -f docker/docker-compose.dev.yml down -v"
            exit 1
        fi

        if [[ -n "$dump_file" ]]; then
            echo "📦 Restoring database from ${dump_file}..."
            docker_import_sql_file "Docker dump restore" "$dump_file"
            config_count="$(docker exec easelect-db-dev psql -U admin_user -d easelect -tAc "SELECT COUNT(*) FROM system_config;" 2>/dev/null | tr -d '[:space:]')"
            if [[ -z "$config_count" || "$config_count" == "0" ]]; then
                echo -e "${RED}❌ Restore verification failed: system_config has no rows after dump import.${NC}"
                exit 1
            fi
            _local_docker_compose up -d app
        else
            bootstrap_zip="$(current_bootstrap_seed_zip_path 2>/dev/null || true)"
            if [[ -n "$bootstrap_zip" ]]; then
                command -v unzip >/dev/null 2>&1 || {
                    echo -e "${RED}❌ unzip not found. Install unzip to restore from the committed bootstrap zip.${NC}"
                    exit 1
                }
                bootstrap_password="$(read_bootstrap_seed_password || true)"
                if [[ -z "$bootstrap_password" ]]; then
                    echo -e "${RED}❌ Bootstrap zip password missing.${NC}"
                    echo "Expected gitignored local file: $(bootstrap_seed_password_file_path)"
                    exit 1
                fi

                bootstrap_tmp_dir="$(mktemp -d)"
                trap 'rm -rf "${bootstrap_tmp_dir:-}"' EXIT

                echo "📦 Restoring database from committed bootstrap zip ${bootstrap_zip}..."
                if ! extract_bootstrap_seed_zip "$bootstrap_zip" "$bootstrap_tmp_dir" "$bootstrap_password"; then
                    echo -e "${RED}❌ Failed to extract bootstrap zip. Check the password file.${NC}"
                    exit 1
                fi

                [[ -f "${bootstrap_tmp_dir}/schema.sql" ]] || { echo -e "${RED}❌ bootstrap zip missing schema.sql${NC}"; exit 1; }
                [[ -f "${bootstrap_tmp_dir}/seed_data.sql" ]] || { echo -e "${RED}❌ bootstrap zip missing seed_data.sql${NC}"; exit 1; }

                bootstrap_schema_stream="${bootstrap_tmp_dir}/schema.rendered.sql"
                stream_bootstrap_schema_sql "${bootstrap_tmp_dir}/schema.sql" "1" > "${bootstrap_schema_stream}"
                docker_import_sql_file "Docker bootstrap schema restore" "${bootstrap_schema_stream}"
                docker_import_sql_file "Docker bootstrap seed restore" "${bootstrap_tmp_dir}/seed_data.sql"
                config_count="$(docker exec easelect-db-dev psql -U admin_user -d easelect -tAc "SELECT COUNT(*) FROM system_config;" 2>/dev/null | tr -d '[:space:]')"
                if [[ -z "$config_count" || "$config_count" == "0" ]]; then
                    echo -e "${RED}❌ Restore verification failed: system_config has no rows after bootstrap import.${NC}"
                    exit 1
                fi
                _local_docker_compose up -d app
            else
                echo -e "${RED}❌ No database dump or committed bootstrap zip found for --restore-db${NC}"
                exit 1
            fi
        fi
    fi
    
    # Wait for app startup (Go compilation takes time)
    echo "⏳ Waiting for application (may take ~60s on first run)..."
    for i in {1..120}; do
        if curl -k -s -o /dev/null https://localhost:${PORT}/ --max-time 2 2>/dev/null; then
            break
        fi
        if (( i % 10 == 0 )); then
            echo "   Still waiting... (${i}s)"
        fi
        sleep 1
    done
    
    if curl -k -s -o /dev/null https://localhost:${PORT}/ --max-time 2 2>/dev/null; then
        print_success "docker"
    else
        echo -e "${RED}❌ Application failed to start${NC}"
        echo "Check logs: docker logs easelect-dev"
        exit 1
    fi
}
