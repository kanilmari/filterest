#!/usr/bin/env bash
# run_filterest_docker.sh
# Manages the complete portable Filterest Docker stack from one source folder.
# Connects the root command, protected local settings, Compose, and readiness output.
# Makes a copied folder installable without manual secret generation or private tools.
# Stop preserves the installation folder; this command provides no destructive reset.

set -euo pipefail

SCRIPT_APPLICATION_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=server_tools/lib/database_dump_options.sh
source "$SCRIPT_APPLICATION_ROOT/server_tools/lib/database_dump_options.sh"
# shellcheck source=server_tools/lib/docker_deployment_settings.sh
source "$SCRIPT_APPLICATION_ROOT/server_tools/lib/docker_deployment_settings.sh"
PROJECT_ROOT="${FILTEREST_PROJECT_ROOT_OVERRIDE:-$(cd "$SCRIPT_APPLICATION_ROOT/.." && pwd -P)}"
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd -P)"
APPLICATION_ROOT="$PROJECT_ROOT/app"
KEYS_DIRECTORY="$PROJECT_ROOT/keys"
TLS_DIRECTORY="$KEYS_DIRECTORY/tls"
ENV_FILE="$KEYS_DIRECTORY/docker.env"
RUNTIME_KEYS_DIRECTORY="$KEYS_DIRECTORY/filterest_runtime"
RUNTIME_ENV_FILE="$RUNTIME_KEYS_DIRECTORY/runtime_environment.env"
LEGACY_ENV_FILE="$PROJECT_ROOT/.env"
ENV_TEMPLATE="$APPLICATION_ROOT/.env.example"
COMPOSE_FILE="$PROJECT_ROOT/compose.yml"
DRY_RUN=0
APP_PORT_OVERRIDE=""
DB_PORT_OVERRIDE=""
PROJECT_NAME_OVERRIDE="${COMPOSE_PROJECT_NAME:-}"
INSTANCE_NAME_OVERRIDE="${INSTANCE_NAME:-}"
PROJECT_NAME_SOURCE="the shell"
INSTANCE_NAME_SOURCE="the shell"
BASE_URL_OVERRIDE=""
FOR_UPDATE=0
DUMP_OUTPUT=""
DUMP_PARTIAL=""
EXPECTED_VERSION=""
READY_TIMEOUT_SECONDS=600
READY_POLL_SECONDS=3

usage() {
    cat <<'USAGE'
Usage: ./filterest docker <action> [--dry-run]

Actions:
  start       Prepare protected local settings, build, and start Filterest
  setup       Prepare protected local settings without starting containers
  stop        Stop Filterest while preserving its database and uploaded files
  status      Show application and database container status
  logs        Follow application and database logs

Actions used by ./filterest update:
  profile           Print the install profile recorded in keys/docker.env
  update-preflight  Check that the update can use keys/docker.env as written
  app-image-id      Print the image ID of the application container
  stop-app          Stop the application; the database keeps running
  dump-database     Write a verified database dump to --output PATH
  ready-check       Wait until /system/ready reports --expect-version VERSION

Options:
  --dry-run          Show the intended setup or Docker command without changing anything
  --app-port         Bind the browser application to a different localhost port
  --db-port          Bind PostgreSQL to a different localhost port
  --project-name     Set the Compose project identity without replacing an existing one
  --instance-name    Set the session/readiness identity without replacing an existing one
  --base-url         Set the public HTTP or HTTPS application URL
  --for-update       With start: return once the containers start; ready-check follows
  --output PATH      With dump-database: the new dump file
  --expect-version   With ready-check: the application version that must answer
  --timeout SECONDS  With ready-check: how long to wait (default 600)
  -h, --help         Show this help
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

# Reads the last canonical or export-prefixed assignment without a subprocess.
# Connects existing operator-authored env syntax with protected setup migration.
# Keeps secret values out of process arguments while sharing the setter grammar.
env_file_value() {
    local env_file="$1"
    local key="$2"
    local line=""
    local value=""
    local assignment_pattern="^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$"

    [[ -f "$env_file" ]] || return 0
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ $line =~ $assignment_pattern ]]; then
            value="${BASH_REMATCH[2]}"
        fi
    done < "$env_file"
    printf '%s' "$value"
}

env_value() {
    local key="$1"
    env_file_value "${DOCKER_SETTINGS_SOURCE:-$ENV_FILE}" "$key"
}

# Returns a keys/docker.env value as Compose reads it: leading blanks trimmed,
# then either the text inside the first pair of quotes, whatever follows them,
# or an unquoted value without its " #" comment and trailing blanks.
# Why: operators may quote values by hand, and an update must compare and use
# exactly the values Compose passes to the containers.
compose_env_value() {
    local value=""
    local quote=""
    local rest=""

    value="$(env_value "$1")"
    value="${value#"${value%%[![:space:]]*}"}"
    quote="${value:0:1}"
    if [[ "$quote" == '"' || "$quote" == "'" ]]; then
        rest="${value:1}"
        if [[ "$rest" == *"$quote"* ]]; then
            value="${rest%%"$quote"*}"
        fi
    else
        value="${value%%[[:space:]]#*}"
        value="${value%"${value##*[![:space:]]}"}"
    fi
    printf '%s' "$value"
}

# Replaces one protected setting through a same-directory mode-0600 file.
# Connects generated setup values with both Docker and runtime environment files.
# Avoids putting secret values in subprocess arguments and rejects duplicate owners.
set_env_file_value() {
    local env_file="$1"
    local key="$2"
    local value="$3"
    local temp_file=""
    local line=""
    local found=0
    local assignment_pattern="^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$"
    [[ ! -L "$env_file" ]] || die "Protected settings path must not be a symbolic link: $env_file"
    [[ -f "$env_file" ]] || die "Protected settings path is not a regular file: $env_file"
    temp_file="$(mktemp "${env_file}.tmp.XXXXXX")"
    {
        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ $line =~ $assignment_pattern ]]; then
                printf '%s=%s\n' "$key" "$value"
                found=$((found + 1))
                continue
            fi
            printf '%s\n' "$line"
        done < "$env_file"
        if [[ "$found" -eq 0 ]]; then
            printf '%s=%s\n' "$key" "$value"
        fi
    } > "$temp_file"
    if [[ "$found" -gt 1 ]]; then
        rm -f "$temp_file"
        die "Protected settings file contains duplicate $key declarations: $env_file"
    fi
    chmod 600 "$temp_file"
    mv "$temp_file" "$env_file"
}

set_env_value() {
    set_env_file_value "$ENV_FILE" "$1" "$2"
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
    # Bound significant digits before arithmetic so oversized inputs cannot wrap.
    local decimal="${value#"${value%%[!0]*}"}"
    decimal="${decimal:-0}"
    [[ "$value" =~ ^[0-9]+$ && "${#decimal}" -le 5 ]] && \
        (( 10#$decimal >= 1 && 10#$decimal <= 65535 )) || \
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
    prepare_directory "$RUNTIME_KEYS_DIRECTORY" 0700
    prepare_directory "$PROJECT_ROOT/projects" 0750
    prepare_directory "$PROJECT_ROOT/data" 0750
    prepare_directory "$PROJECT_ROOT/data/bootstrap" 0700
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

# Creates the mounted administrator-secret file with owner-only permissions.
# Connects host setup to the container's keys/filterest_runtime write boundary.
# Ensures API-managed secrets persist without making immutable app source writable.
prepare_runtime_environment() {
    local line=""
    local openai_key_declarations=0

    [[ ! -L "$RUNTIME_ENV_FILE" ]] || \
        die "Protected runtime settings path must not be a symbolic link: $RUNTIME_ENV_FILE"
    [[ ! -e "$RUNTIME_ENV_FILE" || -f "$RUNTIME_ENV_FILE" ]] || \
        die "Protected runtime settings path is not a regular file: $RUNTIME_ENV_FILE"
    if [[ ! -f "$RUNTIME_ENV_FILE" ]]; then
        (umask 077; printf '%s\n' \
            '# Administrator-managed runtime integration secrets.' \
            'OPENAI_API_KEY=' \
            > "$RUNTIME_ENV_FILE")
    fi
    chmod 0600 "$RUNTIME_ENV_FILE"
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?OPENAI_API_KEY[[:space:]]*= ]]; then
            openai_key_declarations=$((openai_key_declarations + 1))
        fi
    done < "$RUNTIME_ENV_FILE"
    if [[ "$openai_key_declarations" -gt 1 ]]; then
        die "Protected runtime settings file contains duplicate OPENAI_API_KEY declarations: $RUNTIME_ENV_FILE"
    fi
}

# Moves the one legacy Docker-stored OpenAI key into the administrator runtime profile.
# Connects existing keys/docker.env installations to the writable mounted secret file.
# Keeps upgrades persistent without retaining duplicate secrets or exposing either value.
migrate_docker_openai_api_key() {
    local docker_api_key=""
    local runtime_api_key=""

    docker_api_key="$(env_value OPENAI_API_KEY)"
    [[ -n "$docker_api_key" ]] || return 0
    runtime_api_key="$(env_file_value "$RUNTIME_ENV_FILE" OPENAI_API_KEY)"
    if [[ -n "$runtime_api_key" && "$runtime_api_key" != "$docker_api_key" ]]; then
        die "OpenAI API key differs between keys/docker.env and keys/filterest_runtime/runtime_environment.env; keep the intended value in the runtime file and clear the Docker copy"
    fi
    if [[ -z "$runtime_api_key" ]]; then
        set_env_file_value "$RUNTIME_ENV_FILE" OPENAI_API_KEY "$docker_api_key"
    fi
    set_env_value OPENAI_API_KEY ""
    printf '✓ Moved the OpenAI API key into protected runtime settings.\n'
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

# Checks the certificate/key pair before deployment settings can change.
# Between read-only setup planning and later creation of the local TLS identity.
# Refuses unsafe paths or incomplete pairs without altering protected state.
validate_tls_identity() {
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
    if [[ ! -f "$certificate_file" ]]; then
        command -v openssl >/dev/null 2>&1 || \
            die "OpenSSL is required once to create the local TLS identity"
    fi
}

prepare_tls_identity() {
    local certificate_file="$TLS_DIRECTORY/localhost.crt"
    local key_file="$TLS_DIRECTORY/localhost.key"

    validate_tls_identity
    if [[ -f "$certificate_file" ]]; then
        chmod 0644 "$certificate_file"
        chmod 0600 "$key_file"
        return
    fi

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

# Gives the database container read access to the two source folders it mounts.
# Between a checkout made under a restrictive umask and the PostgreSQL image,
# whose postgres user is neither the owner of these files nor in their group.
# Why: without it the image cannot list /docker-entrypoint-initdb.d, the first
# start loops on "Permission denied", and Compose reports only an unhealthy database.
ensure_database_mounts_readable() {
    local mount_source=""
    local opened=0

    for mount_source in \
        "$APPLICATION_ROOT/server_tools/db_init" \
        "$APPLICATION_ROOT/server_tools/public_bootstrap"
    do
        [[ -e "$mount_source" ]] || continue
        [[ ! -L "$mount_source" && -d "$mount_source" ]] || \
            die "Database bootstrap source must be a real directory: $mount_source"
        if [[ -n "$(find "$mount_source" \( -type d ! -perm -o=rx \) -o \( -type f ! -perm -o=r \) -print -quit)" ]]; then
            chmod -R o+rX "$mount_source"
            opened=1
        fi
    done
    if [[ "$opened" -eq 1 ]]; then
        printf '✓ Made the database bootstrap folders readable for the database container.\n'
    fi
}

prepare_environment() {
    local established=0
    local admin_password=""
    local key=""
    local value=""

    [[ -f "$ENV_TEMPLATE" ]] || die "Filterest environment template is missing: $ENV_TEMPLATE"
    [[ -f "$COMPOSE_FILE" ]] || die "Filterest Compose contract is missing: $COMPOSE_FILE"

    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] prepare protected directories, TLS, and %s\n' "$ENV_FILE"
        return
    fi

    # Read the eventual input without migrating/copying or rewriting it. All
    # deployment validation must finish before touching protected state or TLS.
    [[ ! -L "$ENV_FILE" ]] || die "Docker settings path must not be a symbolic link: $ENV_FILE"
    [[ ! -L "$LEGACY_ENV_FILE" ]] || die "Legacy Docker settings path must not be a symbolic link: $LEGACY_ENV_FILE"
    [[ ! -e "$ENV_FILE" || -f "$ENV_FILE" ]] || die "Docker settings must be a regular file"
    [[ ! -e "$LEGACY_ENV_FILE" || -f "$LEGACY_ENV_FILE" ]] || die "Legacy Docker settings must be a regular file"
    [[ ! -f "$ENV_FILE" || ! -f "$LEGACY_ENV_FILE" ]] || \
        die "Both legacy .env and keys/docker.env exist; keep one reviewed settings file before setup"
    DOCKER_SETTINGS_SOURCE="$ENV_TEMPLATE"
    if [[ -f "$ENV_FILE" ]]; then
        DOCKER_SETTINGS_SOURCE="$ENV_FILE"
    elif [[ -f "$LEGACY_ENV_FILE" ]]; then
        DOCKER_SETTINGS_SOURCE="$LEGACY_ENV_FILE"
    fi
    [[ "$(compose_env_value FILTEREST_INSTALL_PROFILE)" != docker ]] || established=1
    DOCKER_SETTING_KEYS=()
    DOCKER_SETTING_VALUES=()
    prepare_docker_identity "$established"
    prepare_docker_transport "$established"
    prepare_docker_compose_options
    require_docker_option_environment
    check_docker_network_collision
    unset DOCKER_SETTINGS_SOURCE

    prepare_directory "$KEYS_DIRECTORY" 0700
    migrate_legacy_environment
    [[ -f "$ENV_FILE" ]] || (umask 077; cp "$ENV_TEMPLATE" "$ENV_FILE")
    chmod 600 "$ENV_FILE"

    prepare_installation_directories
    ensure_database_mounts_readable
    prepare_runtime_environment
    migrate_docker_openai_api_key
    set_env_value FILTEREST_INSTALL_PROFILE docker
    set_env_value ENVIRONMENT_TYPE prod
    apply_docker_settings
    if [[ "$(docker_deployment_value FILTEREST_LOCAL_TLS)" == true ]]; then
        prepare_tls_identity
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
    local version=""
    local major=0
    local minor=0
    command -v docker >/dev/null 2>&1 || die "Docker is required; install Docker Engine or Docker Desktop first"
    version="$(docker compose version --short)" || die "Docker Compose 2.20.0 or newer is required"
    # include was introduced in 2.20.0; its documented recursive loading and
    # interpolated paths also cover the nested fragment contract. Accept v5 too.
    # Only the leading major.minor counts: distribution packages append their own
    # suffixes, such as Ubuntu's 2.40.3+ds1-0ubuntu1~24.04.1.
    [[ "$version" =~ ^v?([0-9]{1,4})\.([0-9]{1,4})(\.|$) ]] || \
        die "Could not determine the Docker Compose version; 2.20.0 or newer is required"
    major=$((10#${BASH_REMATCH[1]}))
    minor=$((10#${BASH_REMATCH[2]}))
    (( major > 2 || (major == 2 && minor >= 20) )) || \
        die "Docker Compose 2.20.0 or newer is required for the included deployment files (found $version)"
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
    compose_project="$(compose_env_value COMPOSE_PROJECT_NAME)"
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

# Lists each key keys/docker.env assigns, in the grammar env_file_value reads.
settings_keys() {
    local line=""
    local assignment_pattern='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*='

    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ $line =~ $assignment_pattern ]]; then
            printf '%s\n' "${BASH_REMATCH[2]}"
        fi
    done < "$ENV_FILE"
}

# Refuses inherited copies of keys/docker.env settings that Compose would read.
# Between the operator's shell and Compose, which prefers the shell over --env-file
# for its own COMPOSE_* settings and for every ${NAME} its files substitute.
# Why: an update must stop, back up and restart this installation as configured; a
# stray COMPOSE_PROJECT_NAME or DB_NAME would aim it at another stack or database.
# Even a copy that matches today is refused, because the update itself rewrites
# values such as FILTEREST_APP_VERSION, after which that copy would override them.
# The two migration switches are exempt because the update sets them itself, and
# --file and --env-file on every Compose call take precedence over their variables.
require_settings_not_overridden() {
    local substituted_names=""
    local key=""
    local inherited=""

    substituted_names=" $(
        { grep -ohE '\$\{?[A-Za-z_][A-Za-z0-9_]*' \
            "$COMPOSE_FILE" "$APPLICATION_ROOT"/docker/docker-compose*.yml || true; } |
            tr -d '${' | sort -u | tr '\n' ' '
    )"
    while IFS= read -r key; do
        case "$key" in
            ENABLE_SQL_MIGRATIONS|EASELECT_MIGRATION_FILE_ALLOWLIST) continue ;;
            COMPOSE_FILE|COMPOSE_ENV_FILES) continue ;;
            COMPOSE_*) ;;
            *) [[ "$substituted_names" == *" $key "* ]] || continue ;;
        esac
        printenv "$key" > /dev/null || continue
        inherited+="${inherited:+ }$key"
    done < <(settings_keys | sort -u)
    [[ -z "$inherited" ]] || \
        die "Inherited environment variables would override keys/docker.env in Docker Compose: $inherited; unset them, then run the update again"
    require_docker_option_environment
}

# Confirms, without changing the file, the Docker settings an update action uses.
require_update_settings() {
    [[ ! -L "$ENV_FILE" && -f "$ENV_FILE" ]] || \
        die "Docker settings must be a regular file for an update: $ENV_FILE"
    [[ -f "$COMPOSE_FILE" ]] || die "Filterest Compose contract is missing: $COMPOSE_FILE"
    [[ "$(compose_env_value FILTEREST_INSTALL_PROFILE)" == "docker" ]] || \
        die "keys/docker.env does not record FILTEREST_INSTALL_PROFILE=docker; run ./filterest docker setup once"
    require_settings_not_overridden
}

require_running_database() {
    local running_services=""

    running_services="$(compose ps --status running --services)"
    [[ $'\n'"$running_services"$'\n' == *$'\n'db$'\n'* ]] || \
        die "The database container is not running; start Filterest with ./filterest docker start, then run the update again"
}

# Writes one custom-format dump of the running database to a new owner-only file.
# Between the database container, which alone holds its superuser password, and backups/.
# Why: the dump is renamed into place only after pg_restore has read it back, so an
# interrupted or unreadable dump never looks like a finished backup.
dump_database() {
    local target="$DUMP_OUTPUT"
    local target_directory=""
    local status=0

    [[ -n "$target" ]] || die "dump-database requires --output PATH"
    target_directory="$(dirname "$target")"
    [[ -d "$target_directory" && ! -L "$target_directory" ]] || \
        die "Dump folder must be an existing real directory: $target_directory"
    [[ ! -e "$target" && ! -L "$target" ]] || die "Dump target already exists: $target"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        compose exec -T db pg_dump "${FILTEREST_DATABASE_DUMP_OPTIONS[@]}"
        return
    fi

    # Whatever ends this process early, an interrupt included, removes the partial file.
    trap '[[ -z "$DUMP_PARTIAL" ]] || rm -f -- "$DUMP_PARTIAL"' EXIT
    trap 'exit 130' INT TERM
    DUMP_PARTIAL="$(mktemp "${target}.partial.XXXXXX")"
    # The container expands its own POSTGRES_* values, so no credential passes
    # through this shell, its process arguments, or the dump folder. The shared
    # options arrive as separate arguments after the "sh" that fills $0.
    compose exec -T db sh -c \
        'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump "$@" --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
        sh "${FILTEREST_DATABASE_DUMP_OPTIONS[@]}" \
        > "$DUMP_PARTIAL" || status=$?
    if [[ "$status" -eq 0 && ! -s "$DUMP_PARTIAL" ]]; then
        status=1
    fi
    if [[ "$status" -eq 0 ]]; then
        compose exec -T db pg_restore --list < "$DUMP_PARTIAL" > /dev/null || status=$?
    fi
    if [[ "$status" -ne 0 ]]; then
        die "The database dump failed or could not be read back; nothing was written to $target"
    fi
    chmod 600 "$DUMP_PARTIAL"
    mv -- "$DUMP_PARTIAL" "$target"
    DUMP_PARTIAL=""
    printf '✓ Database dump written and read back: %s\n' "$target"
}

# Waits until this installation's /system/ready reports the expected version ready.
# Between the containers an update just started and ./filterest update's success message.
# Why: the container health check reads /health, which passes on an old schema, so only
# /system/ready shows that migrations finished for this installation and this version.
ready_check() {
    local port=""
    local scheme=""
    local expected_instance=""
    local work_directory=""
    local http_status=""
    local verdict="no check completed"
    local deadline=0
    local remaining=0
    local request_limit=0
    local connect_limit=0
    local -a tls_options=()

    [[ -n "$EXPECTED_VERSION" ]] || die "ready-check requires --expect-version VERSION"
    port="$(compose_env_value APP_PORT)"
    port="${port:-8100}"
    scheme="$(docker_edge_scheme)"
    if [[ "$scheme" == https ]]; then
        tls_options=(--cacert "$TLS_DIRECTORY/localhost.crt")
    fi
    expected_instance="$(compose_env_value INSTANCE_NAME)"
    expected_instance="${expected_instance:-filterest-local}"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] wait for %s://localhost:%s/system/ready to report %s ready\n' \
            "$scheme" "$port" "$EXPECTED_VERSION"
        return
    fi
    command -v curl >/dev/null 2>&1 || die "curl is required for the readiness check"
    command -v python3 >/dev/null 2>&1 || die "python3 is required for the readiness check"

    work_directory="$(mktemp -d)"
    deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
    printf 'Waiting up to %s seconds for Filterest %s to report ready...\n' \
        "$READY_TIMEOUT_SECONDS" "$EXPECTED_VERSION"
    while :; do
        # No request starts at or runs past the deadline, so no answer counts after it.
        remaining=$((deadline - SECONDS))
        if (( remaining <= 0 )); then
            rm -r -- "$work_directory"
            die "Filterest did not report ready within ${READY_TIMEOUT_SECONDS} seconds; last check: $verdict"
        fi
        request_limit=$(( remaining < 10 ? remaining : 10 ))
        connect_limit=$(( request_limit < 5 ? request_limit : 5 ))
        : > "$work_directory/response.json"
        if ! http_status="$(curl --silent --show-error \
            "${tls_options[@]}" \
            --connect-timeout "$connect_limit" --max-time "$request_limit" \
            --output "$work_directory/response.json" --write-out '%{http_code}' \
            "$scheme://localhost:${port}/system/ready" 2> "$work_directory/curl.err")"; then
            verdict="no response ($(tail -n 1 "$work_directory/curl.err"))"
        else
            verdict="$(python3 - "$work_directory/response.json" "$http_status" \
                "$EXPECTED_VERSION" "$expected_instance" <<'PY'
import json
import sys

response_path, http_status, expected_version, expected_instance = sys.argv[1:5]
try:
    with open(response_path, encoding="utf-8") as handle:
        state = json.load(handle)
except (OSError, ValueError):
    state = None
if not isinstance(state, dict):
    state = None
reasons = (state or {}).get("reasons")
reasons = ", ".join(map(str, reasons)) if isinstance(reasons, list) else ""
detail = f" ({reasons})" if reasons else ""
if http_status != "200":
    print(f"HTTP {http_status}{detail}")
elif state is None:
    print("HTTP 200 without a JSON readiness object")
elif state.get("ready") is not True or state.get("db_compatible") is not True:
    print(f"not ready{detail}")
elif state.get("app_version") != expected_version:
    print(f"version {state.get('app_version')!r} answered, expected {expected_version!r}")
elif state.get("instance_id") != expected_instance:
    print(f"installation {state.get('instance_id')!r} answered, expected {expected_instance!r}")
else:
    print("ready")
PY
            )"
        fi
        if [[ "$verdict" == "ready" ]]; then
            rm -r -- "$work_directory"
            printf '✓ Filterest %s is ready and its database schema is compatible.\n' \
                "$EXPECTED_VERSION"
            return
        fi
        remaining=$((deadline - SECONDS))
        if (( remaining > 0 )); then
            sleep $(( remaining < READY_POLL_SECONDS ? remaining : READY_POLL_SECONDS ))
        fi
    done
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
            --project-name)
                [[ "$ACTION" == setup || "$ACTION" == start ]] || die "--project-name applies only to setup or start"
                [[ "$#" -ge 2 && -n "$2" ]] || die "--project-name requires an identity"
                PROJECT_NAME_OVERRIDE="$2"
                PROJECT_NAME_SOURCE="--project-name"
                validate_docker_identity "$PROJECT_NAME_OVERRIDE" valid new
                shift
                ;;
            --instance-name)
                [[ "$ACTION" == setup || "$ACTION" == start ]] || die "--instance-name applies only to setup or start"
                [[ "$#" -ge 2 && -n "$2" ]] || die "--instance-name requires an identity"
                INSTANCE_NAME_OVERRIDE="$2"
                INSTANCE_NAME_SOURCE="--instance-name"
                validate_docker_identity valid "$INSTANCE_NAME_OVERRIDE" new
                shift
                ;;
            --base-url)
                [[ "$ACTION" == setup || "$ACTION" == start ]] || die "--base-url applies only to setup or start"
                [[ "$#" -ge 2 ]] || die "--base-url requires a URL"
                BASE_URL_OVERRIDE="$2"
                validate_docker_base_url "$BASE_URL_OVERRIDE"
                shift
                ;;
            --for-update)
                FOR_UPDATE=1
                ;;
            --output)
                [[ "$#" -ge 2 ]] || die "--output requires a file path"
                DUMP_OUTPUT="$2"
                shift
                ;;
            --expect-version)
                [[ "$#" -ge 2 ]] || die "--expect-version requires a version"
                EXPECTED_VERSION="$2"
                shift
                ;;
            --timeout)
                [[ "$#" -ge 2 && "$2" =~ ^[1-9][0-9]*$ ]] || \
                    die "--timeout requires a positive number of seconds"
                READY_TIMEOUT_SECONDS="$2"
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
    if [[ "$FOR_UPDATE" -eq 1 && "$ACTION" != "start" ]]; then
        die "--for-update applies only to start"
    fi
}

main() {
    local port="8100"
    local scheme=""
    local browser_url=""
    parse_arguments "$@"
    cd "$PROJECT_ROOT"

    case "$ACTION" in
        setup)
            prepare_environment
            ;;
        start)
            if [[ "$FOR_UPDATE" -eq 1 && "$DRY_RUN" -eq 0 && -f "$ENV_FILE" ]]; then
                # Refused before setup rewrites any value in keys/docker.env.
                require_settings_not_overridden
            fi
            prepare_environment
            if [[ "$FOR_UPDATE" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
                require_update_settings
            fi
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
                migrate_legacy_named_volumes
            fi
            if [[ "$FOR_UPDATE" -eq 1 ]]; then
                # No --wait: it waits for the /health check, which also passes on
                # an old schema. ./filterest update runs ready-check instead.
                compose up --build --detach
            else
                compose up --build --detach --wait
                if [[ "$DRY_RUN" -eq 0 ]]; then
                    port="$(compose_env_value APP_PORT)"
                    scheme="$(docker_edge_scheme)"
                    browser_url="$(compose_env_value BASE_URL)"
                    browser_url="${browser_url:-$scheme://localhost:${port:-8100}}"
                    printf 'Filterest is ready: %s/first-run\n' "${browser_url%/}"
                fi
            fi
            ;;
        stop)
            require_existing_environment
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
            fi
            # down removes the project's labelled resources by identity. It must
            # remain usable after subnet/gateway edits that start refuses, even
            # when the stored pinned fragment would require a now-empty value.
            FILTEREST_NETWORK_FILE=docker-compose.network-auto.yml compose down
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
        profile)
            # Reads only, so ./filterest update can choose its path before any change.
            if [[ -e "$ENV_FILE" || -L "$ENV_FILE" ]]; then
                [[ ! -L "$ENV_FILE" && -f "$ENV_FILE" ]] || \
                    die "Docker settings path must be a regular file: $ENV_FILE"
                printf '%s\n' "$(compose_env_value FILTEREST_INSTALL_PROFILE)"
            fi
            ;;
        update-preflight)
            require_update_settings
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
                require_running_database
                printf '✓ Docker Compose and the database container are ready for the update.\n'
            else
                printf '✓ The update will use keys/docker.env as written.\n'
            fi
            ;;
        app-image-id)
            require_update_settings
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
            fi
            compose images --quiet app
            ;;
        stop-app)
            require_update_settings
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
            fi
            compose stop app
            printf 'Filterest application stopped; its database keeps running.\n'
            ;;
        dump-database)
            require_update_settings
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
            fi
            dump_database
            ;;
        ready-check)
            require_update_settings
            ready_check
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
