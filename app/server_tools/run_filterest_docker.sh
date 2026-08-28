#!/usr/bin/env bash
# Manages the complete portable Filterest Docker stack from one source folder.
# Connects the root command, protected local settings, Compose, and readiness output.
# Makes a copied folder installable without manual secret generation or private tools.
# Stop preserves the installation folder; this command provides no destructive reset.

set -euo pipefail

SCRIPT_APPLICATION_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PROJECT_ROOT="${FILTEREST_PROJECT_ROOT_OVERRIDE:-$(cd "$SCRIPT_APPLICATION_ROOT/.." && pwd -P)}"
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd -P)"
APPLICATION_ROOT="$PROJECT_ROOT/app"
KEYS_DIRECTORY="$PROJECT_ROOT/keys"
TLS_DIRECTORY="$KEYS_DIRECTORY/tls"
ENV_FILE="$KEYS_DIRECTORY/docker.env"
LEGACY_ENV_FILE="$PROJECT_ROOT/.env"
ENV_TEMPLATE="$APPLICATION_ROOT/.env.example"
COMPOSE_FILE="$PROJECT_ROOT/compose.yml"
DRY_RUN=0
APP_PORT_OVERRIDE=""
DB_PORT_OVERRIDE=""

usage() {
    cat <<'USAGE'
Usage: ./filterest docker <action> [--dry-run]

Actions:
  start       Prepare protected local settings, build, and start Filterest
  setup       Prepare protected local settings without starting containers
  stop        Stop Filterest while preserving its database and uploaded files
  status      Show application and database container status
  logs        Follow application and database logs

Options:
  --dry-run   Show the intended setup or Docker command without changing anything
  --app-port  Bind the browser application to a different localhost port
  --db-port   Bind PostgreSQL to a different localhost port
  -h, --help  Show this help
USAGE
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

shell_join() {
    local rendered=""
    local argument=""
    for argument in "$@"; do
        printf -v argument '%q' "$argument"
        rendered+="${rendered:+ }${argument}"
    done
    printf '%s' "$rendered"
}

run() {
    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] %s\n' "$(shell_join "$@")"
        return 0
    fi
    "$@"
}

env_value() {
    local key="$1"
    grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2- || true
}

set_env_value() {
    local key="$1"
    local value="$2"
    local temp_file=""
    temp_file="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
    awk -v wanted_key="$key" -v wanted_value="$value" '
        BEGIN { found = 0 }
        index($0, wanted_key "=") == 1 { print wanted_key "=" wanted_value; found = 1; next }
        { print }
        END { if (!found) print wanted_key "=" wanted_value }
    ' "$ENV_FILE" > "$temp_file"
    chmod 600 "$temp_file"
    mv "$temp_file" "$ENV_FILE"
}

random_hex() {
    od -An -N 24 -tx1 /dev/urandom | tr -d ' \n'
}

is_placeholder_secret() {
    case "$1" in
        ""|replace-me|replace-me-with-32-plus-random-characters|readonly_pass|limited_pass|basic_pass|guest_pass) return 0 ;;
        *) return 1 ;;
    esac
}

validate_port() {
    local label="$1"
    local value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] && (( 10#$value >= 1 && 10#$value <= 65535 )) || \
        die "$label must be an integer from 1 through 65535"
}

prepare_directory() {
    local path="$1"
    local mode="$2"
    local tighten_existing="${3:-true}"

    [[ ! -L "$path" ]] || die "Installation directory must not be a symbolic link: $path"
    [[ ! -e "$path" || -d "$path" ]] || die "Installation path is not a directory: $path"
    if [[ ! -d "$path" ]]; then
        mkdir -m "$mode" "$path"
    elif [[ "$tighten_existing" == "true" ]]; then
        chmod "$mode" "$path"
    fi
}

directory_has_entries() {
    local directory="$1"
    local candidate=""

    for candidate in "$directory"/* "$directory"/.[!.]* "$directory"/..?*; do
        if [[ -e "$candidate" || -L "$candidate" ]]; then
            return 0
        fi
    done
    return 1
}

prepare_installation_directories() {
    local runtime_uid=""
    local runtime_gid=""

    [[ -d "$PROJECT_ROOT" ]] || die "Filterest installation root is missing: $PROJECT_ROOT"
    [[ ! -L "$APPLICATION_ROOT" ]] || die "Filterest application root must not be a symbolic link: $APPLICATION_ROOT"
    [[ -d "$APPLICATION_ROOT" ]] || die "Filterest application root is missing: $APPLICATION_ROOT"

    runtime_uid="$(id -u)"
    runtime_gid="$(id -g)"
    [[ "$runtime_uid" -ge 1 ]] || die "Filterest Docker setup must run as a non-root administrator"
    [[ "$runtime_gid" -ge 1 ]] || die "Filterest Docker setup requires a non-root primary group"

    prepare_directory "$PROJECT_ROOT/config" 0750
    prepare_directory "$KEYS_DIRECTORY" 0700
    prepare_directory "$TLS_DIRECTORY" 0700
    prepare_directory "$PROJECT_ROOT/projects" 0750
    prepare_directory "$PROJECT_ROOT/data" 0750
    prepare_directory "$PROJECT_ROOT/data/storage" 0750
    prepare_directory "$PROJECT_ROOT/data/storage_deleted" 0750
    prepare_directory "$PROJECT_ROOT/data/runtime" 0750
    # PostgreSQL owns this directory after first start. Do not chmod an existing
    # database directory from the host on later setup runs.
    prepare_directory "$PROJECT_ROOT/data/postgres" 0750 false
    prepare_directory "$PROJECT_ROOT/backups" 0750

    set_env_value FILTEREST_RUNTIME_UID "$runtime_uid"
    set_env_value FILTEREST_RUNTIME_GID "$runtime_gid"
}

migrate_legacy_environment() {
    [[ ! -L "$ENV_FILE" ]] || die "Docker settings path must not be a symbolic link: $ENV_FILE"
    [[ ! -e "$ENV_FILE" || -f "$ENV_FILE" ]] || die "Docker settings path is not a regular file: $ENV_FILE"
    [[ ! -L "$LEGACY_ENV_FILE" ]] || die "Legacy Docker settings path must not be a symbolic link: $LEGACY_ENV_FILE"
    [[ ! -e "$LEGACY_ENV_FILE" || -f "$LEGACY_ENV_FILE" ]] || die "Legacy Docker settings path is not a regular file: $LEGACY_ENV_FILE"

    if [[ -f "$LEGACY_ENV_FILE" && -f "$ENV_FILE" ]]; then
        die "Both legacy .env and keys/docker.env exist; keep one reviewed settings file before setup"
    fi
    if [[ -f "$LEGACY_ENV_FILE" ]]; then
        mv "$LEGACY_ENV_FILE" "$ENV_FILE"
        chmod 0600 "$ENV_FILE"
        printf '✓ Moved legacy Docker settings into the protected keys directory.\n'
    fi
}

prepare_tls_identity() {
    local certificate_file="$TLS_DIRECTORY/localhost.crt"
    local key_file="$TLS_DIRECTORY/localhost.key"

    [[ ! -L "$certificate_file" ]] || die "TLS certificate must not be a symbolic link: $certificate_file"
    [[ ! -L "$key_file" ]] || die "TLS key must not be a symbolic link: $key_file"
    [[ ! -e "$certificate_file" || -f "$certificate_file" ]] || die "TLS certificate is not a regular file: $certificate_file"
    [[ ! -e "$key_file" || -f "$key_file" ]] || die "TLS key is not a regular file: $key_file"

    if [[ -f "$certificate_file" && ! -f "$key_file" ]] || \
       [[ ! -f "$certificate_file" && -f "$key_file" ]]; then
        die "TLS certificate and key must either both exist or both be absent"
    fi
    if [[ -f "$certificate_file" ]]; then
        chmod 0644 "$certificate_file"
        chmod 0600 "$key_file"
        return
    fi

    command -v openssl >/dev/null 2>&1 || \
        die "OpenSSL is required once to create the local TLS identity"
    umask 077
    openssl req \
        -x509 \
        -newkey rsa:2048 \
        -sha256 \
        -nodes \
        -days 365 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
        -keyout "$key_file" \
        -out "$certificate_file" >/dev/null 2>&1
    chmod 0600 "$key_file"
    chmod 0644 "$certificate_file"
    printf '✓ Created the protected local TLS identity.\n'
}

prepare_environment() {
    local installation_id=""
    local compose_project=""
    local admin_password=""
    local key=""
    local value=""

    [[ -f "$ENV_TEMPLATE" ]] || die "Filterest environment template is missing: $ENV_TEMPLATE"
    [[ -f "$COMPOSE_FILE" ]] || die "Filterest Compose contract is missing: $COMPOSE_FILE"

    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] prepare protected directories, TLS, and %s\n' "$ENV_FILE"
        return
    fi

    prepare_directory "$KEYS_DIRECTORY" 0700
    migrate_legacy_environment
    if [[ ! -f "$ENV_FILE" ]]; then
        (umask 077; cp "$ENV_TEMPLATE" "$ENV_FILE")
    fi
    chmod 600 "$ENV_FILE"

    prepare_installation_directories
    prepare_tls_identity

    set_env_value FILTEREST_INSTALL_PROFILE docker
    set_env_value ENVIRONMENT_TYPE prod
    set_env_value FILTEREST_LOCAL_TLS true
    if [[ -n "$APP_PORT_OVERRIDE" ]]; then
        set_env_value APP_PORT "$APP_PORT_OVERRIDE"
        set_env_value BASE_URL "https://localhost:${APP_PORT_OVERRIDE}"
    fi
    if [[ -n "$DB_PORT_OVERRIDE" ]]; then
        set_env_value DB_PORT "$DB_PORT_OVERRIDE"
    fi

    compose_project="$(env_value COMPOSE_PROJECT_NAME)"
    if [[ -z "$compose_project" || "$compose_project" == "filterest-local" ]]; then
        installation_id="$(random_hex)"
        installation_id="${installation_id:0:8}"
        compose_project="filterest-${installation_id}"
        set_env_value COMPOSE_PROJECT_NAME "$compose_project"
        if [[ "$(env_value INSTANCE_NAME)" == "filterest-local" || -z "$(env_value INSTANCE_NAME)" ]]; then
            set_env_value INSTANCE_NAME "$compose_project"
        fi
    fi

    admin_password="$(env_value DB_ADMIN_PASSWORD)"
    if is_placeholder_secret "$admin_password"; then
        admin_password="$(random_hex)"
        set_env_value DB_ADMIN_PASSWORD "$admin_password"
    fi
    if is_placeholder_secret "$(env_value DB_PASSWORD)"; then
        set_env_value DB_PASSWORD "$admin_password"
    fi

    for key in \
        DB_READONLY_PASSWORD \
        DB_CONFIDENTIAL_PASSWORD \
        DB_BASIC_PASSWORD \
        DB_GUEST_PASSWORD \
        SESSION_SECRET_KEY \
        SESSION_KEY
    do
        value="$(env_value "$key")"
        if is_placeholder_secret "$value"; then
            set_env_value "$key" "$(random_hex)"
        fi
    done

    if [[ -f "$APPLICATION_ROOT/VERSION_APP" ]]; then
        set_env_value FILTEREST_APP_VERSION "$(tr -d '[:space:]' < "$APPLICATION_ROOT/VERSION_APP")"
    fi
    if [[ -f "$APPLICATION_ROOT/VERSION_DB" ]]; then
        set_env_value FILTEREST_DB_VERSION "$(tr -d '[:space:]' < "$APPLICATION_ROOT/VERSION_DB")"
    fi

    printf '✓ Protected Docker settings are ready: %s\n' "$ENV_FILE"
}

require_docker_compose() {
    command -v docker >/dev/null 2>&1 || die "Docker is required; install Docker Engine or Docker Desktop first"
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
}

require_existing_environment() {
    if [[ ! -f "$ENV_FILE" && -f "$LEGACY_ENV_FILE" ]]; then
        prepare_environment
    fi
    [[ -f "$ENV_FILE" ]] || die "Docker settings are missing; run ./filterest docker start first"
    [[ -f "$COMPOSE_FILE" ]] || die "Filterest Compose contract is missing: $COMPOSE_FILE"
}

migrate_legacy_named_volumes() {
    local compose_project=""
    local running_containers=""
    local migration_marker="$PROJECT_ROOT/config/docker-named-volume-migration-complete"
    local mapping=""
    local volume_suffix=""
    local destination=""
    local ownership_mode=""
    local volume_name=""
    local attached_container=""
    local existing_volume_count=0
    local runtime_uid=""
    local runtime_gid=""
    local temporary_marker=""
    local -a mappings=(
        "filterest_storage|$PROJECT_ROOT/data/storage|runtime"
        "filterest_storage_deleted|$PROJECT_ROOT/data/storage_deleted|runtime"
        "filterest_db_backups|$PROJECT_ROOT/backups|runtime"
        "filterest_runtime|$PROJECT_ROOT/data/runtime|runtime"
        "filterest_postgres_data|$PROJECT_ROOT/data/postgres|database"
    )

    [[ ! -e "$migration_marker" ]] || return 0
    compose_project="$(env_value COMPOSE_PROJECT_NAME)"
    [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || \
        die "Docker project identity is invalid: $compose_project"

    for mapping in "${mappings[@]}"; do
        volume_suffix="${mapping%%|*}"
        volume_name="${compose_project}_${volume_suffix}"
        if docker volume inspect "$volume_name" >/dev/null 2>&1; then
            existing_volume_count=$((existing_volume_count + 1))
        fi
    done
    [[ "$existing_volume_count" -gt 0 ]] || return 0

    running_containers="$(docker ps \
        --quiet \
        --filter "label=com.docker.compose.project=$compose_project")"
    [[ -z "$running_containers" ]] || \
        die "Legacy Docker volumes require a stopped stack; run ./filterest docker stop, then start again"

    for mapping in "${mappings[@]}"; do
        volume_suffix="${mapping%%|*}"
        volume_name="${compose_project}_${volume_suffix}"
        docker volume inspect "$volume_name" >/dev/null 2>&1 || continue
        attached_container="$(docker ps --quiet --filter "volume=$volume_name")"
        [[ -z "$attached_container" ]] || \
            die "Legacy volume $volume_name is attached to a running container; stop it before migration"
    done

    # Validate every destination before copying any volume. A non-empty target
    # is never merged automatically because it could belong to a newer install.
    for mapping in "${mappings[@]}"; do
        volume_suffix="${mapping%%|*}"
        volume_name="${compose_project}_${volume_suffix}"
        docker volume inspect "$volume_name" >/dev/null 2>&1 || continue
        destination="${mapping#*|}"
        destination="${destination%%|*}"
        if directory_has_entries "$destination"; then
            die "Legacy volume $volume_name cannot be merged into non-empty $destination"
        fi
    done

    runtime_uid="$(env_value FILTEREST_RUNTIME_UID)"
    runtime_gid="$(env_value FILTEREST_RUNTIME_GID)"
    for mapping in "${mappings[@]}"; do
        volume_suffix="${mapping%%|*}"
        volume_name="${compose_project}_${volume_suffix}"
        docker volume inspect "$volume_name" >/dev/null 2>&1 || continue
        destination="${mapping#*|}"
        ownership_mode="${destination##*|}"
        destination="${destination%%|*}"

        printf 'Migrating retained Docker volume %s into %s.\n' "$volume_name" "$destination"
        if [[ "$ownership_mode" == "runtime" ]]; then
            docker run --rm \
                --volume "$volume_name:/legacy:ro" \
                --volume "$destination:/installation" \
                alpine:3.24 \
                sh -eu -c \
                'cp -a /legacy/. /installation/; chown -R "$1:$2" /installation' \
                sh "$runtime_uid" "$runtime_gid"
        else
            docker run --rm \
                --volume "$volume_name:/legacy:ro" \
                --volume "$destination:/installation" \
                alpine:3.24 \
                sh -eu -c 'cp -a /legacy/. /installation/'
        fi
    done

    temporary_marker="${migration_marker}.tmp.$$"
    printf 'migrated_from_project=%s\n' "$compose_project" > "$temporary_marker"
    chmod 0600 "$temporary_marker"
    mv "$temporary_marker" "$migration_marker"
    printf '✓ Legacy Docker data is inside the installation folder; original volumes were retained for recovery.\n'
}

compose() {
    run docker compose \
        --project-directory "$PROJECT_ROOT" \
        --file "$COMPOSE_FILE" \
        --env-file "$ENV_FILE" \
        "$@"
}

parse_arguments() {
    ACTION="${1:-start}"
    [[ "$#" -eq 0 ]] || shift
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=1
                ;;
            --app-port)
                [[ "$#" -ge 2 ]] || die "--app-port requires a port"
                APP_PORT_OVERRIDE="$2"
                validate_port "--app-port" "$APP_PORT_OVERRIDE"
                shift
                ;;
            --db-port)
                [[ "$#" -ge 2 ]] || die "--db-port requires a port"
                DB_PORT_OVERRIDE="$2"
                validate_port "--db-port" "$DB_PORT_OVERRIDE"
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                die "unknown Docker option: $1"
                ;;
        esac
        shift
    done
}

main() {
    local port="8100"
    parse_arguments "$@"
    cd "$PROJECT_ROOT"

    case "$ACTION" in
        setup)
            prepare_environment
            ;;
        start)
            prepare_environment
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
                migrate_legacy_named_volumes
            fi
            compose up --build --detach --wait
            if [[ "$DRY_RUN" -eq 0 ]]; then
                port="$(env_value APP_PORT)"
                printf 'Filterest is ready: https://localhost:%s/first-run\n' "${port:-8100}"
            fi
            ;;
        stop)
            require_existing_environment
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
            fi
            compose down
            printf 'Filterest stopped. Its database and uploaded files were preserved.\n'
            printf 'Raw PostgreSQL data may be copied only while the stack is stopped; keep portable database dumps under %s.\n' "$PROJECT_ROOT/backups"
            ;;
        status)
            require_existing_environment
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
            fi
            compose ps
            ;;
        logs)
            require_existing_environment
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
            fi
            compose logs --follow app db
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            die "unknown Docker action: $ACTION"
            ;;
    esac
}

if [[ "${FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY:-0}" != "1" ]]; then
    main "$@"
fi
