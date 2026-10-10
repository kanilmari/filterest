#!/usr/bin/env bash
# docker_deployment_settings.sh
# Validates opt-in Docker identity, host-proxy, port and network settings.
# Connects the public runner's protected settings to its Compose fragments.
# Keeps ordinary setup unchanged and refuses unsafe or conflicting operator inputs.

docker_edge_scheme() {
    case "$(compose_env_value FILTEREST_EDGE)" in
        ""|local-tls) printf 'https' ;;
        host-proxy) printf 'http' ;;
        *) die "FILTEREST_EDGE must be local-tls or host-proxy" ;;
    esac
}

# Plans values in memory so a refusal cannot partially reconfigure an installation.
# Between setup validation and the later protected-file/certificate writes.
# Existing stored values remain available through compose_env_value while planning.
DOCKER_SETTING_KEYS=()
DOCKER_SETTING_VALUES=()

plan_docker_setting() {
    DOCKER_SETTING_KEYS+=("$1")
    DOCKER_SETTING_VALUES+=("$2")
}

docker_deployment_value() {
    local index=0
    for ((index=${#DOCKER_SETTING_KEYS[@]}-1; index>=0; index--)); do
        if [[ "${DOCKER_SETTING_KEYS[index]}" == "$1" ]]; then
            printf '%s' "${DOCKER_SETTING_VALUES[index]}"
            return
        fi
    done
    compose_env_value "$1"
}

apply_docker_settings() {
    local index=0
    for ((index=0; index<${#DOCKER_SETTING_KEYS[@]}; index++)); do
        [[ "$(compose_env_value "${DOCKER_SETTING_KEYS[index]}")" == "${DOCKER_SETTING_VALUES[index]}" ]] || \
            set_env_value "${DOCKER_SETTING_KEYS[index]}" "${DOCKER_SETTING_VALUES[index]}"
    done
}

validate_docker_identity() {
    [[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || \
        die "COMPOSE_PROJECT_NAME must start with a lowercase letter or digit and contain only lowercase letters, digits, underscores or hyphens"
    # The old runner accepted arbitrary stored instance names. They scope cookies
    # and keys, so applying new character rules during an update would sign out users.
    if [[ "$3" != stored ]]; then
        [[ "$2" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || \
            die "INSTANCE_NAME must start with a letter or digit and contain only letters, digits, dots, underscores or hyphens"
    fi
}

# Only an installation marker establishes an identity, even in a pre-created file.
# Between flags/shell, operator settings and generated fresh identities.
# Preserves established cookie identities, including Compose's empty fallback.
prepare_docker_identity() {
    local established="$1"
    local compose_project=""
    local instance_name=""
    local installation_id=""
    local instance_source=new
    compose_project="$(compose_env_value COMPOSE_PROJECT_NAME)"
    instance_name="$(compose_env_value INSTANCE_NAME)"

    if [[ "$established" -eq 0 ]]; then
        [[ "$compose_project" != filterest-local ]] || compose_project=""
        [[ "$instance_name" != filterest-local ]] || instance_name=""
    else
        instance_name="${instance_name:-filterest-local}"
        instance_source=stored
    fi
    if [[ -n "$PROJECT_NAME_OVERRIDE" ]]; then
        [[ -z "$compose_project" || "$compose_project" == "$PROJECT_NAME_OVERRIDE" ]] || \
            die "COMPOSE_PROJECT_NAME from $PROJECT_NAME_SOURCE conflicts with the stored identity; setup will not replace it"
        compose_project="$PROJECT_NAME_OVERRIDE"
    fi
    if [[ -n "$INSTANCE_NAME_OVERRIDE" ]]; then
        [[ -z "$instance_name" || "$instance_name" == "$INSTANCE_NAME_OVERRIDE" ]] || \
            die "INSTANCE_NAME from $INSTANCE_NAME_SOURCE conflicts with the stored identity; setup will not replace it"
        instance_name="$INSTANCE_NAME_OVERRIDE"
        instance_source=new
    fi
    if [[ -z "$compose_project" ]]; then
        installation_id="$(random_hex)"
        compose_project="filterest-${installation_id:0:8}"
    fi
    instance_name="${instance_name:-$compose_project}"
    validate_docker_identity "$compose_project" "$instance_name" "$instance_source"
    plan_docker_setting COMPOSE_PROJECT_NAME "$compose_project"
    plan_docker_setting INSTANCE_NAME "$instance_name"
}

validate_docker_base_url() {
    local pattern='^https?://[^/[:space:]?#@$]+(/[^[:space:]?#$]*)?$'
    [[ "$1" =~ $pattern ]] || \
        die "BASE_URL must be an absolute HTTP or HTTPS URL without credentials, whitespace, a query, a fragment or a dollar sign"
}

prepare_docker_transport() {
    local established="$1"
    local scheme=""
    local old_port=""
    local db_port=""
    local port=""
    local base_url=""
    local url_source=stored
    local old_scheme=https

    old_port="$(compose_env_value APP_PORT)"
    db_port="$(compose_env_value DB_PORT)"
    base_url="$(compose_env_value BASE_URL)"
    scheme="$(docker_edge_scheme)"
    [[ "$(compose_env_value FILTEREST_LOCAL_TLS)" != false ]] || old_scheme=http
    old_port="${old_port:-8100}"
    port="${APP_PORT_OVERRIDE:-$old_port}"
    if [[ "$established" -eq 0 || -n "$APP_PORT_OVERRIDE" || -z "$(compose_env_value APP_PORT)" ]]; then
        validate_port APP_PORT "$port"
    fi
    if [[ "$established" -eq 0 || -n "$DB_PORT_OVERRIDE" || -z "$db_port" ]]; then
        validate_port DB_PORT "${DB_PORT_OVERRIDE:-${db_port:-5433}}"
    fi
    if [[ "$scheme" == http ]]; then
        [[ "${APP_BIND_HOST:-$(compose_env_value APP_BIND_HOST)}" == "" || \
           "${APP_BIND_HOST:-$(compose_env_value APP_BIND_HOST)}" == 127.0.0.1 ]] || \
            die "Host-proxy mode requires APP_BIND_HOST=127.0.0.1 (loopback)"
        plan_docker_setting FILTEREST_LOCAL_TLS false
    else
        validate_tls_identity
        plan_docker_setting FILTEREST_LOCAL_TLS true
    fi
    [[ -z "$APP_PORT_OVERRIDE" ]] || plan_docker_setting APP_PORT "$port"
    [[ -z "$DB_PORT_OVERRIDE" ]] || plan_docker_setting DB_PORT "$DB_PORT_OVERRIDE"
    if [[ -n "$BASE_URL_OVERRIDE" ]]; then
        base_url="$BASE_URL_OVERRIDE"
        url_source=new
    elif [[ "$established" -eq 0 || -n "$APP_PORT_OVERRIDE" || "$scheme" != "$old_scheme" ]] && \
         [[ -z "$base_url" || "$base_url" == "https://localhost:8100" || \
            "$base_url" == "https://localhost:$old_port" || "$base_url" == "http://localhost:$old_port" ]]; then
        # Only a first setup, a requested port or a changed edge moves the derived local address; an
        # established installation otherwise keeps its stored URL, as the earlier runner did.
        base_url="$scheme://localhost:$port"
        url_source=new
    fi
    if [[ "$established" -eq 0 || "$url_source" == new ]] || printenv BASE_URL >/dev/null; then
        validate_docker_base_url "$base_url"
    fi
    if [[ "$url_source" == new || -n "$base_url" ]]; then
        plan_docker_setting BASE_URL "$base_url"
    fi
    if [[ "$scheme" == http ]]; then
        warn_docker_proxy_url "$base_url"
    fi
}

# Warns without rejecting stored URLs that the legacy runner accepted.
# Between the public browser URL and production's always-Secure session cookies.
# IP parsing recognizes alternate IPv6 spellings and mapped loopback addresses.
warn_docker_proxy_url() {
    command -v python3 >/dev/null 2>&1 || die "python3 is required to check the host-proxy public URL"
    python3 - "$1" <<'PYTHON'
import ipaddress
import sys
from urllib.parse import urlsplit

url = sys.argv[1]
if url.partition(":")[0].lower() != "https":
    print("warning: Host-proxy BASE_URL must use public HTTPS; production session cookies are always Secure.", file=sys.stderr)
try:
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
except ValueError:
    host = ""  # Malformed old stored URLs remain accepted, as before this change.
loopback = host == "localhost" or host.endswith(".localhost")
try:
    address = ipaddress.ip_address(host)
    loopback = loopback or address.is_loopback
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        loopback = loopback or address.ipv4_mapped.is_loopback
except ValueError:
    pass
if loopback:
    print("warning: Host-proxy BASE_URL is a loopback address; configure the public HTTPS browser URL.", file=sys.stderr)
PYTHON
}

# Selects maintained Compose fragments only for explicitly configured options.
# Between operator settings and Compose's include/extends configuration.
# Empty/default settings add no keys, so generated defaults remain stable.
prepare_docker_compose_options() {
    local publish_db=""
    local ports_file=docker-compose.db-published.yml
    local network_file=docker-compose.network-auto.yml
    local subnet=""
    local gateway=""
    publish_db="$(compose_env_value FILTEREST_PUBLISH_DB_PORT)"
    subnet="$(compose_env_value FILTEREST_NETWORK_SUBNET)"
    gateway="$(compose_env_value FILTEREST_NETWORK_GATEWAY)"

    case "$publish_db" in
        ""|true) ;;
        false) ports_file=docker-compose.db-private.yml ;;
        *) die "FILTEREST_PUBLISH_DB_PORT must be true or false" ;;
    esac
    if [[ -n "$publish_db" || -n "$(compose_env_value FILTEREST_DB_PORTS_FILE)" ]]; then
        plan_docker_setting FILTEREST_DB_PORTS_FILE "$ports_file"
    fi
    if [[ -n "$subnet" ]]; then
        command -v python3 >/dev/null 2>&1 || die "python3 is required to validate a pinned Docker network"
        gateway="$(filterest_recovery_python "$PROJECT_ROOT" python3 "$SCRIPT_APPLICATION_ROOT/server_tools/lib/docker_network_validator.py" \
            --recovery-root "$PROJECT_ROOT" --subnet "$subnet" --gateway "$gateway")"
        plan_docker_setting FILTEREST_NETWORK_GATEWAY "$gateway"
        network_file=docker-compose.network-pinned.yml
    elif [[ -n "$gateway" ]]; then
        die "FILTEREST_NETWORK_GATEWAY requires FILTEREST_NETWORK_SUBNET"
    fi
    if [[ -n "$subnet" || -n "$(compose_env_value FILTEREST_NETWORK_FILE)" ]]; then
        plan_docker_setting FILTEREST_NETWORK_FILE "$network_file"
    fi
}

# Compose prefers exported shell values even when the protected file omits a key.
# Compare every selector and transport/identity input against the planned file or
# Compose defaults, including default installations without opt-in settings.
require_docker_option_environment() {
    local key=""
    local expected=""
    for key in COMPOSE_PROJECT_NAME INSTANCE_NAME APP_PORT DB_PORT BASE_URL \
        APP_BIND_HOST DB_BIND_HOST FILTEREST_EDGE FILTEREST_PUBLISH_DB_PORT \
        FILTEREST_LOCAL_TLS FILTEREST_DB_PORTS_FILE FILTEREST_NETWORK_FILE \
        FILTEREST_NETWORK_SUBNET FILTEREST_NETWORK_GATEWAY
    do
        printenv "$key" >/dev/null || continue
        expected="$(docker_deployment_value "$key")"
        case "$key" in
            APP_BIND_HOST|DB_BIND_HOST) expected="${expected:-127.0.0.1}" ;;
            APP_PORT) expected="${expected:-8100}" ;;
            DB_PORT) expected="${expected:-5433}" ;;
            INSTANCE_NAME) expected="${expected:-filterest-local}" ;;
            BASE_URL) expected="${expected:-https://localhost:8100}" ;;
            FILTEREST_EDGE) expected="${expected:-local-tls}" ;;
            FILTEREST_PUBLISH_DB_PORT|FILTEREST_LOCAL_TLS) expected="${expected:-true}" ;;
            FILTEREST_DB_PORTS_FILE) expected="${expected:-docker-compose.db-published.yml}" ;;
            FILTEREST_NETWORK_FILE) expected="${expected:-docker-compose.network-auto.yml}" ;;
        esac
        [[ "${!key}" == "$expected" ]] || \
            die "Inherited $key from the shell would override the Docker deployment settings; unset it and retry"
    done
}

# Checks project ownership on every real start, and network drift during opt-in setup.
# Between Docker's read-only inventories and the folder Compose would mount next.
# A failed/incomplete inspection refuses before settings writes or container changes.
check_docker_network_collision() {
    local subnet=""
    local previous_selection=""
    local inventory_directory=""
    local status=0
    local resource=""
    local resource_ids=""
    local resource_id=""
    local container_count=0
    local network_count=0
    local -a ids=()
    subnet="$(compose_env_value FILTEREST_NETWORK_SUBNET)"
    previous_selection="$(compose_env_value FILTEREST_NETWORK_FILE)"

    [[ "${ACTION:-}" == start || -n "$subnet$previous_selection" ]] || return 0
    require_docker_compose
    command -v python3 >/dev/null 2>&1 || die "python3 is required to inspect Docker project ownership and networks"
    inventory_directory="$(filterest_recovery_mktemp "$PROJECT_ROOT" -d -- "${TMPDIR:-/tmp}/filterest-docker-inventory.XXXXXX")" || return
    for resource in network container; do
        ids=()
        if [[ "$resource" == network ]]; then
            resource_ids="$(filterest_recovery_utility "$PROJECT_ROOT" docker network ls --quiet)" || status=$?
        else
            resource_ids="$(filterest_recovery_utility "$PROJECT_ROOT" docker ps --all --quiet --filter "label=com.docker.compose.project=$(docker_deployment_value COMPOSE_PROJECT_NAME)")" || status=$?
        fi
        [[ "$status" -eq 0 ]] || break
        while IFS= read -r resource_id; do
            [[ -z "$resource_id" ]] || ids+=("$resource_id")
        done <<< "$resource_ids"
        if [[ "$resource" == network ]]; then network_count="${#ids[@]}"; else container_count="${#ids[@]}"; fi
        if [[ "${#ids[@]}" -gt 0 ]]; then
            filterest_recovery_to_file "$PROJECT_ROOT" "$inventory_directory/$resource.json" docker "$resource" inspect "${ids[@]}" || status=$?
        else
            printf '[]\n' > "$inventory_directory/$resource.json"
        fi
        [[ "$status" -eq 0 ]] || break
    done
    if [[ "$status" -eq 0 ]]; then
        filterest_recovery_python "$PROJECT_ROOT" python3 "$SCRIPT_APPLICATION_ROOT/server_tools/lib/docker_network_validator.py" \
            --recovery-root "$PROJECT_ROOT" --subnet "$subnet" --gateway "$(docker_deployment_value FILTEREST_NETWORK_GATEWAY)" \
            --project "$(docker_deployment_value COMPOSE_PROJECT_NAME)" --working-directory "$PROJECT_ROOT" \
            --previous-selection "${previous_selection:-docker-compose.network-auto.yml}" \
            --networks "$inventory_directory/network.json" --expected-networks "$network_count" \
            --containers "$inventory_directory/container.json" --expected-containers "$container_count" \
            > /dev/null || status=$?
    fi
    filterest_recovery_output "$PROJECT_ROOT" rm -rf -- "$inventory_directory" || return
    [[ "$status" -eq 0 ]] || die "Docker project ownership or network inspection was refused; no settings were written or containers started"
}
