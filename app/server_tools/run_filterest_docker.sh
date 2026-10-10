#!/usr/bin/env bash
# run_filterest_docker.sh
# Manages the complete portable Filterest Docker stack from one source folder.
# Connects the root command, protected local settings, Compose, and readiness output.
# Makes a copied folder installable without manual secret generation or private tools.
# Stop preserves the installation folder; this command provides no destructive reset.

set -euo pipefail

# A sourced library retains its caller's mode (defaulting to recovery). Public
# commands decide independently; no inherited value can disable a recovery route.
if [[ "${FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY:-0}" == 1 && "${BASH_SOURCE[0]}" != "$0" ]]; then
    : "${FILTEREST_RECOVERY_OUTPUT:=1}"
else
    FILTEREST_RECOVERY_OUTPUT=0
    case "${1:-start}" in
        profile|dump-database|restore-database|update-preflight|app-image-id|stop-app|ready-check) FILTEREST_RECOVERY_OUTPUT=1 ;;
        start)
            for argument in "$@"; do
                case "$argument" in --for-update|--backup|--restore|--restore-db) FILTEREST_RECOVERY_OUTPUT=1 ;; esac
            done
            ;;
    esac
fi
export FILTEREST_RECOVERY_OUTPUT
# A sourced settings/helper file cannot turn off an active recovery boundary.
if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then readonly FILTEREST_RECOVERY_OUTPUT; fi

if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then
    SCRIPT_SOURCE_DIRECTORY="$(dirname -- "${BASH_SOURCE[0]}" 2>/dev/null)" || { printf 'Recovery launcher location unavailable; sensitive details withheld.\n' >&2; exit 1; }
    SCRIPT_APPLICATION_ROOT="$(cd -- "$SCRIPT_SOURCE_DIRECTORY/.." 2>/dev/null && pwd -P 2>/dev/null)" 2>/dev/null || { printf 'Recovery launcher location unavailable; sensitive details withheld.\n' >&2; exit 1; }
else
    SCRIPT_APPLICATION_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
fi
# Capture implicit shell/interpreter diagnostics as well as explicit output.
if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 && "${BASH_SOURCE[0]}" == "$0" ]]; then
    source "$SCRIPT_APPLICATION_ROOT/server_tools/lib/recovery_process_boundary.sh" >/dev/null 2>&1 || { printf 'Recovery process boundary unavailable; sensitive details withheld.\n' >&2; exit 1; }
    filterest_recovery_process_entry "${BASH_SOURCE[0]}" "$SCRIPT_APPLICATION_ROOT" "$@"
fi

if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then
    # No root launcher is required: bootstrap refusals have fixed text until
    # the scanner is loaded, then every sourced helper has its own boundary.
    PROJECT_ROOT="${FILTEREST_PROJECT_ROOT_OVERRIDE:-$(cd -- "$SCRIPT_APPLICATION_ROOT/.." 2>/dev/null && pwd -P 2>/dev/null)}"
    PROJECT_ROOT="$(cd -- "$PROJECT_ROOT" 2>/dev/null && pwd -P 2>/dev/null)" 2>/dev/null || { printf 'Recovery installation root unavailable; sensitive details withheld.\n' >&2; exit 1; }
    source "$SCRIPT_APPLICATION_ROOT/server_tools/lib/installation_records.sh" 2>/dev/null || { printf 'Recovery diagnostic library unavailable; sensitive details withheld.\n' >&2; exit 1; }
    filterest_recovery_source "$PROJECT_ROOT" "$SCRIPT_APPLICATION_ROOT/server_tools/lib/database_dump_options.sh"
    filterest_recovery_source "$PROJECT_ROOT" "$SCRIPT_APPLICATION_ROOT/server_tools/lib/docker_deployment_settings.sh"
else
    # shellcheck source=server_tools/lib/database_dump_options.sh
    source "$SCRIPT_APPLICATION_ROOT/server_tools/lib/database_dump_options.sh"
    # shellcheck source=server_tools/lib/installation_records.sh
    source "$SCRIPT_APPLICATION_ROOT/server_tools/lib/installation_records.sh"
    # shellcheck source=server_tools/lib/docker_deployment_settings.sh
    source "$SCRIPT_APPLICATION_ROOT/server_tools/lib/docker_deployment_settings.sh"
    PROJECT_ROOT="${FILTEREST_PROJECT_ROOT_OVERRIDE:-$(cd "$SCRIPT_APPLICATION_ROOT/.." && pwd -P 2>/dev/null)}"
    PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd -P)"
fi
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
RESTORE_BACKUP=""
RESTORE_YES=0
RESTORE_LEGACY=0
RESTORE_UNAUTHENTICATED=0
EXPECTED_VERSION=""
READY_TIMEOUT_SECONDS=600
READY_POLL_SECONDS=3

usage() {
    if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 0 ]]; then
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
        return
    fi
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
  dump-database     Write a verified database + roles packet to --output PATH
  restore-database  Replace the database from --backup FOLDER (requires --yes)
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
  --backup FOLDER    With restore-database: the backup folder
  --yes              With restore-database: authorize database replacement
  --legacy           With restore-database: permit an unauthenticated old packet
  --allow-unauthenticated-restore  DANGER: skip packet authentication without the separate key
  --expect-version   With ready-check: the application version that must answer
  --timeout SECONDS  With ready-check: how long to wait (default 600)
  -h, --help         Show this help
USAGE
}

die() {
    filterest_recovery_diagnostic "$PROJECT_ROOT" 'error: %s\n' "$*" >&2
    exit 1
}

shell_join() {
    local rendered=""
    local argument=""
    for argument in "$@"; do
        # Scan raw arguments before shell quoting can disguise key bytes.
        argument="$(filterest_recovery_diagnostic "$PROJECT_ROOT" '%s' "$argument")"
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
    # The explicit live log viewer must stream indefinitely. Finite lifecycle
    # and recovery commands pass their operator-facing output through the scan.
    if [[ "${1:-}" == docker && "${2:-}" == compose && "${9:-}" == logs ]]; then
        "$@"
    else
        filterest_recovery_output "$PROJECT_ROOT" "$@"
    fi
}

# Reads the last canonical or export-prefixed assignment without a subprocess.
# Connects existing operator-authored env syntax with protected setup migration.
# Keeps secret values out of process arguments while sharing the setter grammar.
env_file_value() {
    local env_file="$1"
    local key="$2"
    local line=""
    local value=""
    local settings_descriptor=""
    local assignment_pattern="^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$"

    [[ -f "$env_file" ]] || return 0
    { exec {settings_descriptor}< "$env_file"; } 2>/dev/null || die "Could not read protected settings: $env_file"
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ $line =~ $assignment_pattern ]]; then
            value="${BASH_REMATCH[2]}"
        fi
    done <&"$settings_descriptor"
    exec {settings_descriptor}<&-
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
    local settings_descriptor=""
    local assignment_pattern="^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$"
    [[ ! -L "$env_file" ]] || die "Protected settings path must not be a symbolic link: $env_file"
    [[ -f "$env_file" ]] || die "Protected settings path is not a regular file: $env_file"
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-0}" == 1 ]]; then
        filterest_recovery_content_to_file "$PROJECT_ROOT" "$env_file" \
            _docker_recovery_settings_content "$env_file" "$key" "$value" || return
        return
    fi
    temp_file="$(filterest_recovery_utility "$PROJECT_ROOT" mktemp -- "${env_file}.tmp.XXXXXX")" || return
    { exec {settings_descriptor}< "$env_file"; } 2>/dev/null || die "Could not read protected settings: $env_file"
    if ! { {
        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ $line =~ $assignment_pattern ]]; then
                printf '%s=%s\n' "$key" "$value"
                found=$((found + 1))
                continue
            fi
            printf '%s\n' "$line"
        done <&"$settings_descriptor"
        if [[ "$found" -eq 0 ]]; then
            printf '%s=%s\n' "$key" "$value"
        fi
    } > "$temp_file"; } 2>/dev/null; then
        die "Could not write protected settings replacement for: $env_file"
    fi
    exec {settings_descriptor}<&-
    if [[ "$found" -gt 1 ]]; then
        filterest_recovery_output "$PROJECT_ROOT" rm -f -- "$temp_file" || return
        die "Protected settings file contains duplicate $key declarations: $env_file"
    fi
    filterest_recovery_output "$PROJECT_ROOT" chmod 600 -- "$temp_file" || return
    filterest_recovery_output "$PROJECT_ROOT" mv -- "$temp_file" "$env_file" || return
}

_docker_recovery_settings_content() {
    local env_file="$1" key="$2" value="$3" line="" found=0
    local assignment_pattern="^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$"
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ $line =~ $assignment_pattern ]]; then
            printf '%s=%s\n' "$key" "$value"
            found=$((found + 1))
        else
            printf '%s\n' "$line"
        fi
    done < "$env_file"
    [[ "$found" -ne 0 ]] || printf '%s=%s\n' "$key" "$value"
    [[ "$found" -le 1 ]] || { printf 'Duplicate protected setting refused.\n' >&2; return 1; }
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

check_directory_destination() {
    local path="$1"
    [[ ! -L "$path" ]] || die "Installation directory must not be a symbolic link: $path"
    [[ ! -e "$path" || -d "$path" ]] || die "Installation path is not a directory: $path"
}

prepare_directory() {
    local path="$1"
    local mode="$2"
    local tighten_existing="${3:-true}"

    if [[ "${FILTEREST_RECOVERY_OUTPUT:-0}" == 1 ]]; then
        filterest_recovery_content_names "$PROJECT_ROOT" "$path" || return 1
    fi

    check_directory_destination "$path"
    if [[ ! -d "$path" ]]; then
        (if [[ "${FILTEREST_RECOVERY_OUTPUT:-0}" == 1 ]]; then umask 077; fi
         filterest_recovery_output "$PROJECT_ROOT" mkdir -m "$mode" -- "$path") || die "Could not create installation directory: $path"
    elif [[ "$tighten_existing" == "true" ]]; then
        filterest_recovery_output "$PROJECT_ROOT" chmod "$mode" -- "$path" || die "Could not protect installation directory: $path"
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
        filterest_recovery_to_file "$PROJECT_ROOT" "$RUNTIME_ENV_FILE" printf '%s\n' \
            '# Administrator-managed runtime integration secrets.' \
            'OPENAI_API_KEY=' || return
    fi
    filterest_recovery_output "$PROJECT_ROOT" chmod 0600 -- "$RUNTIME_ENV_FILE" || return
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
        if [[ "${FILTEREST_RECOVERY_OUTPUT:-0}" == 1 ]]; then
            filterest_recovery_content_to_file "$PROJECT_ROOT" "$ENV_FILE" cat -- "$LEGACY_ENV_FILE" || return
            filterest_recovery_output "$PROJECT_ROOT" rm -f -- "$LEGACY_ENV_FILE" || return
        else
            filterest_recovery_output "$PROJECT_ROOT" mv -- "$LEGACY_ENV_FILE" "$ENV_FILE" || return
        fi
        filterest_recovery_output "$PROJECT_ROOT" chmod 0600 -- "$ENV_FILE" || return
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
        filterest_recovery_output "$PROJECT_ROOT" chmod 0644 -- "$certificate_file" || return
        filterest_recovery_output "$PROJECT_ROOT" chmod 0600 -- "$key_file" || return
        return
    fi

    if [[ "${FILTEREST_RECOVERY_OUTPUT:-0}" == 1 ]]; then
        filterest_recovery_tls_identity "$PROJECT_ROOT" "$certificate_file" "$key_file" \
            -x509 -newkey rsa:2048 -sha256 -nodes -days 365 -subj "/CN=localhost" \
            -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" || return
        filterest_recovery_output "$PROJECT_ROOT" chmod 0644 -- "$certificate_file" || return
        printf '✓ Created the protected local TLS identity.\n'
        return
    fi

    umask 077
    filterest_recovery_output "$PROJECT_ROOT" openssl req \
        -x509 \
        -newkey rsa:2048 \
        -sha256 \
        -nodes \
        -days 365 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
        -keyout "$key_file" \
        -out "$certificate_file" >/dev/null || return
    filterest_recovery_output "$PROJECT_ROOT" chmod 0600 -- "$key_file" || return
    filterest_recovery_output "$PROJECT_ROOT" chmod 0644 -- "$certificate_file" || return
    printf '✓ Created the protected local TLS identity.\n'
}

# Gives the database container read access to the two source folders it mounts.
# Between a checkout made under a restrictive umask and the PostgreSQL image,
# whose postgres user is neither the owner of these files nor in their group.
# Why: without it the image cannot list /docker-entrypoint-initdb.d, the first
# start loops on "Permission denied", and Compose reports only an unhealthy database.
ensure_database_mounts_readable() {
    local mount_source=""
    local opened=0 unreadable=""

    for mount_source in \
        "$APPLICATION_ROOT/server_tools/db_init" \
        "$APPLICATION_ROOT/server_tools/public_bootstrap"
    do
        [[ -e "$mount_source" ]] || continue
        [[ ! -L "$mount_source" && -d "$mount_source" ]] || \
            die "Database bootstrap source must be a real directory: $mount_source"
        unreadable="$(filterest_recovery_utility "$PROJECT_ROOT" find -- "$mount_source" \( -type d ! -perm -o=rx \) -o \( -type f ! -perm -o=r \) -print -quit)" || return
        if [[ -n "$unreadable" ]]; then
            filterest_recovery_output "$PROJECT_ROOT" chmod -R o+rX -- "$mount_source" || return
            opened=1
        fi
    done
    if [[ "$opened" -eq 1 ]]; then
        printf '✓ Made the database bootstrap folders readable for the database container.\n'
    fi
}

# Shared read-only deployment planning; preflight runs the same validators as start.
plan_environment() {
    local established=0
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

}

preflight_update_environment() {
    local ACTION=start path="" file="" line="" key="" docker_api_key="" runtime_api_key=""
    [[ -f "$ENV_TEMPLATE" ]] || die "Filterest environment template is missing: $ENV_TEMPLATE"
    plan_environment
    validate_port APP_PORT "$(compose_env_value APP_PORT)"
    if [[ "$(docker_deployment_value FILTEREST_PUBLISH_DB_PORT)" != false ]]; then
        validate_port DB_PORT "$(compose_env_value DB_PORT)"
    fi
    [[ "$(id -u)" -ge 1 && "$(id -g)" -ge 1 ]] || die "Filterest Docker setup requires a non-root administrator and group"
    for path in config keys keys/tls keys/filterest_runtime projects data data/bootstrap data/storage data/storage_deleted data/runtime data/postgres backups; do
        check_directory_destination "$PROJECT_ROOT/$path"
        [[ ! -e "$PROJECT_ROOT/$path" || "$path" == data/postgres || -O "$PROJECT_ROOT/$path" ]] || die "Installation directory owner refused"
    done
    for file in "$ENV_FILE" "$RUNTIME_ENV_FILE"; do
        [[ ! -e "$file" || -f "$file" ]] || die "Protected runtime settings path is not a regular file"
        [[ ! -L "$file" ]] || die "Protected runtime settings path must not be a symbolic link"
        [[ -f "$file" ]] || continue
        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
                key="${BASH_REMATCH[2]}"
                _docker_recovery_settings_content "$file" "$key" "" >/dev/null || return 1
            fi
        done < "$file"
    done
    docker_api_key="$(env_value OPENAI_API_KEY)"
    runtime_api_key="$(env_file_value "$RUNTIME_ENV_FILE" OPENAI_API_KEY)"
    [[ -z "$docker_api_key" || -z "$runtime_api_key" || "$docker_api_key" == "$runtime_api_key" ]] || \
        die "OpenAI API key differs between Docker and runtime settings; review both before update"
    if [[ "$(docker_deployment_value FILTEREST_LOCAL_TLS)" == true ]]; then
        validate_tls_identity
        for file in "$TLS_DIRECTORY/localhost.crt" "$TLS_DIRECTORY/localhost.key"; do
            [[ ! -e "$file" || -O "$file" ]] || die "TLS identity owner refused before update"
        done
    fi
    for path in "$APPLICATION_ROOT/server_tools/db_init" "$APPLICATION_ROOT/server_tools/public_bootstrap"; do
        [[ ! -e "$path" || ( ! -L "$path" && -d "$path" ) ]] || die "Database bootstrap source must be a real directory"
    done
}

prepare_environment() {
    filterest_recovery_scan "$PROJECT_ROOT" stderr _prepare_environment "$@"
}

_prepare_environment() {
    local established=0
    local admin_password=""
    local key=""
    local value=""

    [[ -f "$ENV_TEMPLATE" ]] || die "Filterest environment template is missing: $ENV_TEMPLATE"
    [[ -f "$COMPOSE_FILE" ]] || die "Filterest Compose contract is missing: $COMPOSE_FILE"

    if [[ "$DRY_RUN" -eq 1 ]]; then
        filterest_recovery_diagnostic "$PROJECT_ROOT" '  [dry-run] prepare protected directories, TLS, and %s\n' "$ENV_FILE"
        return
    fi

    plan_environment

    prepare_directory "$KEYS_DIRECTORY" 0700
    migrate_legacy_environment
    if [[ ! -f "$ENV_FILE" ]]; then
        if [[ "${FILTEREST_RECOVERY_OUTPUT:-0}" == 1 ]]; then
            filterest_recovery_content_to_file "$PROJECT_ROOT" "$ENV_FILE" cat -- "$ENV_TEMPLATE" || return
        else
            (umask 077; filterest_recovery_output "$PROJECT_ROOT" cp -- "$ENV_TEMPLATE" "$ENV_FILE") || return
        fi
    fi
    filterest_recovery_output "$PROJECT_ROOT" chmod 600 -- "$ENV_FILE" || return

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
        set_env_value FILTEREST_APP_VERSION "$(filterest_recovery_version "$PROJECT_ROOT" "$APPLICATION_ROOT/VERSION_APP")"
    fi
    if [[ -f "$APPLICATION_ROOT/VERSION_DB" ]]; then
        set_env_value FILTEREST_DB_VERSION "$(filterest_recovery_version "$PROJECT_ROOT" "$APPLICATION_ROOT/VERSION_DB")"
    fi

    filterest_recovery_python "$PROJECT_ROOT" python3 "$SCRIPT_APPLICATION_ROOT/server_tools/lib/database_recovery.py" setup-key \
        --root "$PROJECT_ROOT" --profile docker

    filterest_recovery_diagnostic "$PROJECT_ROOT" '✓ Protected Docker settings are ready: %s\n' "$ENV_FILE"
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
    filterest_recovery_scan "$PROJECT_ROOT" stderr _migrate_legacy_named_volumes "$@"
}

# One mapping for ordinary migration and the read-only update prerequisite.
legacy_named_volume_mappings() {
    printf '%s\0' \
        "filterest_storage|$PROJECT_ROOT/data/storage|runtime" \
        "filterest_storage_deleted|$PROJECT_ROOT/data/storage_deleted|runtime" \
        "filterest_db_backups|$PROJECT_ROOT/backups|runtime" \
        "filterest_runtime|$PROJECT_ROOT/data/runtime|runtime" \
        "filterest_postgres_data|$PROJECT_ROOT/data/postgres|database"
}

# No environment preparation, copies or marker writes: the installed updater
# calls this before taking its lock or stopping the application container.
require_migrated_legacy_named_volumes() {
    [[ ! -e "$PROJECT_ROOT/config/docker-named-volume-migration-complete" ]] || return 0
    local compose_project="" mapping="" volume_suffix=""
    compose_project="$(compose_env_value COMPOSE_PROJECT_NAME)"
    [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "Docker project identity is invalid: $compose_project"
    while IFS= read -r -d '' mapping; do
        volume_suffix="${mapping%%|*}"
        if docker volume inspect "${compose_project}_${volume_suffix}" >/dev/null 2>&1; then
            die "Recovery startup refuses legacy volume copying; migrate with ordinary Docker start first"
        fi
    done < <(legacy_named_volume_mappings)
}

_migrate_legacy_named_volumes() {
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
    local -a mappings=()
    while IFS= read -r -d '' mapping; do mappings+=("$mapping"); done < <(legacy_named_volume_mappings)

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

    if [[ "${FILTEREST_RECOVERY_OUTPUT:-0}" == 1 ]]; then
        die "Recovery startup refuses legacy volume copying; migrate with ordinary Docker start first"
    fi

    running_containers="$(filterest_recovery_utility "$PROJECT_ROOT" docker ps \
        --quiet \
        --filter "label=com.docker.compose.project=$compose_project")"
    [[ -z "$running_containers" ]] || \
        die "Legacy Docker volumes require a stopped stack; run ./filterest docker stop, then start again"

    for mapping in "${mappings[@]}"; do
        volume_suffix="${mapping%%|*}"
        volume_name="${compose_project}_${volume_suffix}"
        docker volume inspect "$volume_name" >/dev/null 2>&1 || continue
        attached_container="$(filterest_recovery_utility "$PROJECT_ROOT" docker ps --quiet --filter "volume=$volume_name")"
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

        filterest_recovery_diagnostic "$PROJECT_ROOT" 'Migrating retained Docker volume %s into %s.\n' "$volume_name" "$destination"
        if [[ "$ownership_mode" == "runtime" ]]; then
            filterest_recovery_output "$PROJECT_ROOT" docker run --rm \
                --volume "$volume_name:/legacy:ro" \
                --volume "$destination:/installation" \
                alpine:3.24 \
                sh -eu -c \
                'cp -a /legacy/. /installation/; chown -R "$1:$2" /installation' \
                sh "$runtime_uid" "$runtime_gid"
        else
            filterest_recovery_output "$PROJECT_ROOT" docker run --rm \
                --volume "$volume_name:/legacy:ro" \
                --volume "$destination:/installation" \
                alpine:3.24 \
                sh -eu -c 'cp -a /legacy/. /installation/'
        fi
    done

    temporary_marker="${migration_marker}.tmp.$$"
    printf 'migrated_from_project=%s\n' "$compose_project" > "$temporary_marker"
    filterest_recovery_output "$PROJECT_ROOT" chmod 0600 -- "$temporary_marker" || return
    filterest_recovery_output "$PROJECT_ROOT" mv -- "$temporary_marker" "$migration_marker" || return
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
    local settings_descriptor=""
    local assignment_pattern='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*='

    { exec {settings_descriptor}< "$ENV_FILE"; } 2>/dev/null || die "Could not read protected settings: $ENV_FILE"
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ $line =~ $assignment_pattern ]]; then
            printf '%s\n' "${BASH_REMATCH[2]}"
        fi
    done <&"$settings_descriptor"
    exec {settings_descriptor}<&-
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
            -- "$COMPOSE_FILE" "$APPLICATION_ROOT"/docker/docker-compose*.yml 2>/dev/null || true; } |
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

# Creates a verified, settings-bound recovery packet through the database container.
# The shared helper owns exclusive private files, roles, checksums and completion.
# Keeping the transport here preserves the update settings/override preflight.
dump_database() {
    local target_directory="" recovery_pid="" recovery_status=0
    [[ -n "$DUMP_OUTPUT" ]] || die "dump-database requires --output PATH"
    target_directory="$(dirname -- "$DUMP_OUTPUT" 2>/dev/null)" || die "Could not resolve dump folder for: $DUMP_OUTPUT"
    [[ -d "$target_directory" && ! -L "$target_directory" ]] || \
        die "Dump folder must be an existing real directory for: $DUMP_OUTPUT"
    [[ ! -e "$DUMP_OUTPUT" && ! -L "$DUMP_OUTPUT" ]] || die "Dump target already exists: $DUMP_OUTPUT"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        filterest_recovery_diagnostic "$PROJECT_ROOT" '  [dry-run] back up database, roles and protected settings to %s\n' "$DUMP_OUTPUT"
        return
    fi
    # Keep the runner alive until the helper has removed its staging tree, also
    # when a process-group signal reaches both the runner and helper together.
    trap '[[ -z "$recovery_pid" ]] || { kill -TERM "$recovery_pid" 2>/dev/null || true; wait "$recovery_pid" || true; }; exit 130' INT TERM
    filterest_recovery_python "$PROJECT_ROOT" python3 "$SCRIPT_APPLICATION_ROOT/server_tools/lib/database_recovery.py" backup \
        --root "$PROJECT_ROOT" --profile docker --output "$DUMP_OUTPUT" \
        --dump-options "${FILTEREST_DATABASE_DUMP_OPTIONS[@]}" &
    recovery_pid=$!
    wait "$recovery_pid" || recovery_status=$?
    trap - INT TERM
    [[ "$recovery_status" -eq 0 ]] || die "The database recovery backup failed; nothing was written as a complete backup"
}

# Checks this packet/settings before stopping the app or importing role verifiers.
restore_database() {
    [[ -n "$RESTORE_BACKUP" ]] || die "restore-database requires --backup FOLDER"
    [[ "$RESTORE_YES" -eq 1 ]] || die "restore-database requires --yes to replace the database"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        filterest_recovery_diagnostic "$PROJECT_ROOT" '  [dry-run] verify %s and protected settings, stop app, import roles, then replace database\n' "$RESTORE_BACKUP"
        return
    fi
    local legacy_options=()
    [[ "$RESTORE_LEGACY" -eq 0 ]] || legacy_options=(--legacy)
    [[ "$RESTORE_UNAUTHENTICATED" -eq 0 ]] || legacy_options+=(--allow-unauthenticated-restore)
    filterest_recovery_python "$PROJECT_ROOT" python3 "$SCRIPT_APPLICATION_ROOT/server_tools/lib/database_recovery.py" restore \
        --root "$PROJECT_ROOT" --profile docker --backup "$RESTORE_BACKUP" --yes ${legacy_options[@]+"${legacy_options[@]}"}
}

# Waits until this installation's /system/ready reports the expected version ready.
# Between the containers an update just started and ./filterest update's success message.
# Why: the container health check reads /health, which passes on an old schema, so only
# /system/ready shows that migrations finished for this installation and this version.
ready_check() {
    local port=""
    local scheme=""
    local expected_instance=""
    local response=""
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
        filterest_recovery_diagnostic "$PROJECT_ROOT" '  [dry-run] wait for %s://localhost:%s/system/ready to report %s ready\n' \
            "$scheme" "$port" "$EXPECTED_VERSION"
        return
    fi
    command -v curl >/dev/null 2>&1 || die "curl is required for the readiness check"
    command -v python3 >/dev/null 2>&1 || die "python3 is required for the readiness check"

    filterest_recovery_diagnostic "$PROJECT_ROOT" 'Waiting up to %s seconds for Filterest %s to report ready...\n' \
        "$READY_TIMEOUT_SECONDS" "$EXPECTED_VERSION"
    deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
    while :; do
        # No request starts at or runs past the deadline, so no answer counts after it.
        remaining=$((deadline - SECONDS))
        if (( remaining <= 0 )); then
            die "Filterest did not report ready within ${READY_TIMEOUT_SECONDS} seconds; last check: $verdict"
        fi
        request_limit=$(( remaining < 10 ? remaining : 10 ))
        connect_limit=$(( request_limit < 5 ? request_limit : 5 ))
        if ! response="$(filterest_recovery_utility "$PROJECT_ROOT" curl --silent --show-error \
            "${tls_options[@]}" \
            --connect-timeout "$connect_limit" --max-time "$request_limit" \
            --write-out '\n%{http_code}' \
            -- "$scheme://localhost:${port}/system/ready")"; then
            verdict="no response from the readiness endpoint"
        else
            http_status="${response##*$'\n'}"
            response="${response%$'\n'*}"
            verdict="$(filterest_recovery_utility "$PROJECT_ROOT" python3 - "$http_status" \
                "$EXPECTED_VERSION" "$expected_instance" 3< <(printf '%s' "$response") <<'PY'
import json
import os
import sys

http_status, expected_version, expected_instance = sys.argv[1:4]
try:
    with os.fdopen(3, encoding="utf-8") as handle:
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
    print(f"version {state.get('app_version')} answered, expected {expected_version}")
elif state.get("instance_id") != expected_instance:
    print(f"installation {state.get('instance_id')} answered, expected {expected_instance}")
else:
    print("ready")
PY
            )"
        fi
        if [[ "$verdict" == "ready" ]]; then
            filterest_recovery_diagnostic "$PROJECT_ROOT" '✓ Filterest %s is ready and its database schema is compatible.\n' \
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
                [[ "$#" -ge 2 && -n "${2:-}" && "${2:0:1}" != - ]] || die "--app-port requires a port"
                APP_PORT_OVERRIDE="$2"
                validate_port "--app-port" "$APP_PORT_OVERRIDE"
                shift
                ;;
            --db-port)
                [[ "$#" -ge 2 && -n "${2:-}" && "${2:0:1}" != - ]] || die "--db-port requires a port"
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
                [[ "$#" -ge 2 && -n "${2:-}" && "${2:0:1}" != - ]] || die "--base-url requires a URL"
                BASE_URL_OVERRIDE="$2"
                validate_docker_base_url "$BASE_URL_OVERRIDE"
                shift
                ;;
            --for-update)
                FOR_UPDATE=1
                ;;
            --output)
                [[ "$#" -ge 2 && -n "${2:-}" && "${2:0:1}" != - ]] || die "--output requires a file path"
                DUMP_OUTPUT="$2"
                shift
                ;;
            --backup)
                [[ "$ACTION" == restore-database ]] || die "--backup applies only to restore-database"
                [[ "$#" -ge 2 && -n "${2:-}" && "${2:0:1}" != - ]] || die "--backup requires a folder path"
                RESTORE_BACKUP="$2"
                shift
                ;;
            --yes)
                [[ "$ACTION" == restore-database ]] || die "--yes applies only to restore-database"
                RESTORE_YES=1
                ;;
            --legacy)
                [[ "$ACTION" == restore-database ]] || die "--legacy applies only to restore-database"
                RESTORE_LEGACY=1
                ;;
            --allow-unauthenticated-restore)
                [[ "$ACTION" == restore-database ]] || die "--allow-unauthenticated-restore applies only to restore-database"
                RESTORE_UNAUTHENTICATED=1
                ;;
            --expect-version)
                [[ "$#" -ge 2 && -n "${2:-}" && "${2:0:1}" != - ]] || die "--expect-version requires a version"
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
    if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then
        cd -- "$PROJECT_ROOT" 2>/dev/null || die "Could not enter recovery installation: $PROJECT_ROOT"
    else
        cd "$PROJECT_ROOT"
    fi

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
                    filterest_recovery_diagnostic "$PROJECT_ROOT" 'Filterest is ready: %s/first-run\n' "${browser_url%/}"
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
            filterest_recovery_diagnostic "$PROJECT_ROOT" 'Raw PostgreSQL data may be copied only while the stack is stopped; keep portable database dumps under %s.\n' "$PROJECT_ROOT/backups"
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
                filterest_recovery_diagnostic "$PROJECT_ROOT" '%s\n' "$(compose_env_value FILTEREST_INSTALL_PROFILE)"
            fi
            ;;
        update-preflight)
            require_update_settings
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
                require_migrated_legacy_named_volumes
                preflight_update_environment
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
        restore-database)
            require_update_settings
            if [[ "$DRY_RUN" -eq 0 ]]; then
                require_docker_compose
            fi
            restore_database
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
