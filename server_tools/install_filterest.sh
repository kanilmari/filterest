#!/usr/bin/env bash
# install_filterest.sh
# Installs a generated Filterest checkout for browser administration or development.
# Bridges host packages, protected local configuration, database bootstrap, and runtime startup.
# Exists so a new administrator can reach the first-run form through one resumable command.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PROFILE=""
ASSUME_YES=0
DRY_RUN=0
NO_START=0
BINARY_SOURCE="${FILTEREST_BINARY_SOURCE:-}"
RELEASE_REPOSITORY="${FILTEREST_RELEASE_REPOSITORY:-kanilmari/filterest}"
POSTGRESQL_MAJOR="${FILTEREST_POSTGRESQL_MAJOR:-16}"
LOCAL_BIN_DIR="$HOME/.local/bin"
LOCAL_TOOLCHAIN_ROOT="$HOME/.local/share/filterest/toolchains"

usage() {
    cat <<'USAGE'
Usage: ./filterest setup [options]

Installation profiles:
  --profile admin        Browser administration with a prebuilt Filterest binary.
                         Installs PostgreSQL, PostGIS, and pgvector, but not Go or Node.js.
  --profile development  Administration plus source builds, frontend development, and tests.
                         Also installs Go, Node.js, npm dependencies, and Playwright Chromium.

Options:
  --yes                  Accept the displayed installation plan without another confirmation.
  --dry-run              Show the plan without changing the machine, database, or files.
  --no-start             Complete installation without starting Filterest.
  --binary-source PATH   Use a reviewed local Filterest binary instead of a GitHub Release asset.
  -h, --help             Show this help.

With no --profile, an interactive terminal asks which profile to install.
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

parse_arguments() {
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --profile)
                [[ "$#" -ge 2 ]] || die "--profile requires admin or development"
                PROFILE="$2"
                shift 2
                ;;
            --yes)
                ASSUME_YES=1
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            --no-start)
                NO_START=1
                shift
                ;;
            --binary-source)
                [[ "$#" -ge 2 ]] || die "--binary-source requires a file path"
                BINARY_SOURCE="$2"
                shift 2
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                die "unknown setup option: $1"
                ;;
        esac
    done
}

choose_profile() {
    if [[ -n "$PROFILE" ]]; then
        case "$PROFILE" in
            admin|development) return ;;
            *) die "installation profile must be admin or development" ;;
        esac
    fi

    [[ -t 0 ]] || die "non-interactive setup requires --profile admin or --profile development"
    printf '\nChoose how this Filterest installation will be used:\n'
    printf '  1) Browser administration (recommended; no Go or Node.js)\n'
    printf '  2) Development and browser administration\n'
    printf 'Selection [1]: '
    read -r selection
    case "${selection:-1}" in
        1) PROFILE="admin" ;;
        2) PROFILE="development" ;;
        *) die "selection must be 1 or 2" ;;
    esac
}

show_plan() {
    printf '\nFilterest installation plan\n'
    printf '  Profile: %s\n' "$PROFILE"
    printf '  Common runtime: PostgreSQL %s, PostGIS, pgvector, local configuration, demo database\n' "$POSTGRESQL_MAJOR"
    if [[ "$PROFILE" == "admin" ]]; then
        printf '  Application: verified prebuilt Filterest binary\n'
        printf '  Development tools: Go and Node.js will not be installed\n'
        printf '  Browser address: https://localhost:8100/first-run\n'
    else
        printf '  Application: built locally from source\n'
        printf '  Development tools: Go, Node.js, npm packages, and Playwright Chromium\n'
        printf '  Browser address: https://localhost:8100/first-run\n'
    fi
    printf '  Administrator account: created in the guarded browser form\n'
    printf '  Privileges: sudo is used only when host packages or the initial PostgreSQL role are missing\n\n'
}

confirm_plan() {
    if [[ "$ASSUME_YES" -eq 1 || "$DRY_RUN" -eq 1 ]]; then
        return
    fi
    [[ -t 0 ]] || die "non-interactive installation requires --yes"
    printf 'Continue with this plan? [Y/n] '
    read -r answer
    case "${answer:-y}" in
        y|Y|yes|YES) ;;
        *) die "installation cancelled" ;;
    esac
}

is_generated_filterest_checkout() {
    [[ -f "$PROJECT_ROOT/VERSION_APP" && ! -f "$PROJECT_ROOT/VERSION_EASELECT" ]]
}

package_is_installed() {
    dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q '^install ok installed$'
}

apt_has_package() {
    apt-cache show "$1" >/dev/null 2>&1
}

install_host_packages() {
    local common_packages=(ca-certificates curl openssl python3-minimal python3-psycopg2 postgresql-common)
    local database_packages=(
        "postgresql-${POSTGRESQL_MAJOR}"
        "postgresql-client-${POSTGRESQL_MAJOR}"
        "postgresql-${POSTGRESQL_MAJOR}-postgis-3"
        "postgresql-${POSTGRESQL_MAJOR}-postgis-3-scripts"
        "postgresql-${POSTGRESQL_MAJOR}-pgvector"
    )
    local development_packages=(build-essential git xz-utils)
    local required_packages=("${common_packages[@]}" "${database_packages[@]}")
    local missing_packages=()
    local package=""

    [[ "$(uname -s)" == "Linux" ]] || die "automatic host setup currently supports Linux"
    command -v apt-get >/dev/null 2>&1 || die "automatic host setup currently supports Debian and Ubuntu based systems"
    if [[ "$PROFILE" == "development" ]]; then
        required_packages+=("${development_packages[@]}")
    fi

    for package in "${required_packages[@]}"; do
        package_is_installed "$package" || missing_packages+=("$package")
    done
    if [[ "${#missing_packages[@]}" -eq 0 ]]; then
        printf '✓ Required host packages are already installed.\n'
        return
    fi

    printf 'Installing missing host packages: %s\n' "${missing_packages[*]}"
    run sudo -v
    run sudo apt-get update

    for package in "${database_packages[@]}"; do
        if ! apt_has_package "$package"; then
            printf 'Adding the official PostgreSQL package repository for PostgreSQL %s extensions.\n' "$POSTGRESQL_MAJOR"
            run sudo apt-get install -y ca-certificates curl postgresql-common
            run sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
            run sudo apt-get update
            break
        fi
    done
    run sudo apt-get install -y "${required_packages[@]}"
}

architecture_name() {
    case "$(uname -m)" in
        x86_64|amd64) printf 'amd64' ;;
        aarch64|arm64) printf 'arm64' ;;
        *) die "unsupported CPU architecture: $(uname -m)" ;;
    esac
}

install_go_toolchain_if_needed() {
    local required_version=""
    local current_version=""
    local arch=""
    local temp_dir=""
    local archive=""
    local target=""

    required_version="$(awk '$1 == "go" {print $2; exit}' "$PROJECT_ROOT/go.mod")"
    current_version="$(go version 2>/dev/null | awk '{sub(/^go/, "", $3); print $3}' || true)"
    if [[ "$current_version" == "$required_version" ]]; then
        printf '✓ Go %s is already available.\n' "$required_version"
        return
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] install verified Go %s under %s\n' "$required_version" "$LOCAL_TOOLCHAIN_ROOT"
        return
    fi

    arch="$(architecture_name)"
    temp_dir="$(mktemp -d)"
    archive="go${required_version}.linux-${arch}.tar.gz"
    target="$LOCAL_TOOLCHAIN_ROOT/go-${required_version}"
    curl --fail --location --retry 3 -o "$temp_dir/$archive" "https://go.dev/dl/$archive"
    curl --fail --location --retry 3 -o "$temp_dir/$archive.sha256" "https://go.dev/dl/$archive.sha256"
    printf '%s  %s\n' "$(tr -d '[:space:]' < "$temp_dir/$archive.sha256")" "$temp_dir/$archive" | sha256sum -c -
    mkdir -p "$LOCAL_TOOLCHAIN_ROOT" "$LOCAL_BIN_DIR"
    tar -xzf "$temp_dir/$archive" -C "$temp_dir"
    rm -rf "$target"
    mv "$temp_dir/go" "$target"
    ln -sfn "$target/bin/go" "$LOCAL_BIN_DIR/go"
    export PATH="$LOCAL_BIN_DIR:$PATH"
    rm -rf "$temp_dir"
    printf '✓ Installed verified Go %s.\n' "$required_version"
}

install_node_toolchain_if_needed() {
    local node_major="24"
    local current_major=""
    local arch=""
    local node_arch=""
    local temp_dir=""
    local checksums=""
    local archive=""
    local extracted_dir=""
    local target=""
    local executable=""

    current_major="$(node --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\).*/\1/p' || true)"
    if [[ "$current_major" == "$node_major" ]]; then
        printf '✓ Node.js %s is already available.\n' "$(node --version)"
        return
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] install the latest verified Node.js %s release under %s\n' "$node_major" "$LOCAL_TOOLCHAIN_ROOT"
        return
    fi

    arch="$(architecture_name)"
    case "$arch" in
        amd64) node_arch="x64" ;;
        arm64) node_arch="arm64" ;;
    esac
    temp_dir="$(mktemp -d)"
    checksums="$temp_dir/SHASUMS256.txt"
    curl --fail --location --retry 3 -o "$checksums" "https://nodejs.org/dist/latest-v${node_major}.x/SHASUMS256.txt"
    archive="$(awk -v suffix="linux-${node_arch}.tar.xz" '$2 ~ suffix "$" {print $2; exit}' "$checksums")"
    [[ -n "$archive" ]] || die "Node.js archive was not listed for linux-${node_arch}"
    curl --fail --location --retry 3 -o "$temp_dir/$archive" "https://nodejs.org/dist/latest-v${node_major}.x/$archive"
    (cd "$temp_dir" && grep "  ${archive}$" SHASUMS256.txt | sha256sum -c -)
    extracted_dir="${archive%.tar.xz}"
    target="$LOCAL_TOOLCHAIN_ROOT/$extracted_dir"
    mkdir -p "$LOCAL_TOOLCHAIN_ROOT" "$LOCAL_BIN_DIR"
    tar -xJf "$temp_dir/$archive" -C "$temp_dir"
    rm -rf "$target"
    mv "$temp_dir/$extracted_dir" "$target"
    for executable in node npm npx corepack; do
        ln -sfn "$target/bin/$executable" "$LOCAL_BIN_DIR/$executable"
    done
    export PATH="$LOCAL_BIN_DIR:$PATH"
    rm -rf "$temp_dir"
    printf '✓ Installed verified Node.js %s.\n' "$(node --version)"
}

env_value() {
    local file="$1"
    local key="$2"
    grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d'=' -f2- || true
}

set_env_value() {
    local file="$1"
    local key="$2"
    local value="$3"
    local temp_file=""
    temp_file="$(mktemp "${file}.tmp.XXXXXX")"
    awk -v wanted_key="$key" -v wanted_value="$value" '
        BEGIN { found = 0 }
        index($0, wanted_key "=") == 1 { print wanted_key "=" wanted_value; found = 1; next }
        { print }
        END { if (!found) print wanted_key "=" wanted_value }
    ' "$file" > "$temp_file"
    chmod --reference="$file" "$temp_file" 2>/dev/null || chmod 600 "$temp_file"
    mv "$temp_file" "$file"
}

is_placeholder_secret() {
    case "$1" in
        ""|replace-me|replace-me-with-32-plus-random-characters|readonly_pass|limited_pass|basic_pass|guest_pass) return 0 ;;
        *) return 1 ;;
    esac
}

# Validates only the local values required to start and bootstrap Filterest.
# Optional provider, email, payment, and service-integration values may stay blank.
# Error output names invalid keys but never prints their values.
validate_filterest_core_environment_file() {
    local file="$1"
    local label="$2"
    local expected_environment_type="$3"
    local expected_local_tls="$4"
    local expected_base_url="$5"
    local key=""
    local value=""
    local missing_keys=()
    local placeholder_keys=()
    local invalid_keys=()
    local required_keys=(
        SITE_NAME SITE_SLUG FILTEREST_INSTALL_PROFILE ENVIRONMENT_TYPE BASE_URL
        PORT EASELECT_PORT APP_PORT TLS_CERT_FILE TLS_KEY_FILE
        DB_HOST DB_PORT DB_SSLMODE DB_ADMIN_USER DB_USER DB_NAME
        DB_READONLY_USER DB_CONFIDENTIAL_USER DB_BASIC_USER DB_GUEST_USER
        INSTANCE_NAME SESSION_COOKIE_MODE
    )
    local secret_keys=(
        DB_ADMIN_PASSWORD DB_PASSWORD DB_READONLY_PASSWORD DB_CONFIDENTIAL_PASSWORD
        DB_BASIC_PASSWORD DB_GUEST_PASSWORD SESSION_SECRET_KEY SESSION_KEY
    )
    local numeric_keys=(PORT EASELECT_PORT APP_PORT DB_PORT)

    if [[ ! -f "$file" ]]; then
        printf 'error: required Filterest configuration file missing: %s\n' "$label" >&2
        return 1
    fi

    for key in "${required_keys[@]}"; do
        [[ -n "$(env_value "$file" "$key")" ]] || missing_keys+=("$key")
    done
    for key in "${secret_keys[@]}"; do
        value="$(env_value "$file" "$key")"
        if is_placeholder_secret "$value"; then
            placeholder_keys+=("$key")
        fi
    done
    for key in "${numeric_keys[@]}"; do
        value="$(env_value "$file" "$key")"
        if [[ -n "$value" && ! "$value" =~ ^[1-9][0-9]{0,4}$ ]]; then
            invalid_keys+=("$key")
        fi
    done

    [[ "$(env_value "$file" FILTEREST_INSTALL_PROFILE)" == "$PROFILE" ]] || invalid_keys+=("FILTEREST_INSTALL_PROFILE")
    [[ "$(env_value "$file" ENVIRONMENT_TYPE)" == "$expected_environment_type" ]] || invalid_keys+=("ENVIRONMENT_TYPE")
    [[ "$(env_value "$file" FILTEREST_LOCAL_TLS)" == "$expected_local_tls" ]] || invalid_keys+=("FILTEREST_LOCAL_TLS")
    [[ "$(env_value "$file" BASE_URL)" == "$expected_base_url" ]] || invalid_keys+=("BASE_URL")
    [[ "$(env_value "$file" PORT)" == "$(env_value "$file" EASELECT_PORT)" ]] || invalid_keys+=("EASELECT_PORT")
    [[ "$(env_value "$file" PORT)" == "$(env_value "$file" APP_PORT)" ]] || invalid_keys+=("APP_PORT")
    [[ "$(env_value "$file" SESSION_COOKIE_MODE)" == "isolated" ]] || invalid_keys+=("SESSION_COOKIE_MODE")
    [[ -z "$(env_value "$file" SESSION_COOKIE_NAME)" ]] || invalid_keys+=("SESSION_COOKIE_NAME")

    for key in SESSION_SECRET_KEY SESSION_KEY; do
        value="$(env_value "$file" "$key")"
        if [[ -n "$value" && ${#value} -lt 32 ]]; then
            invalid_keys+=("$key")
        fi
    done

    if [[ ${#missing_keys[@]} -eq 0 && ${#placeholder_keys[@]} -eq 0 && ${#invalid_keys[@]} -eq 0 ]]; then
        return 0
    fi

    printf 'error: Filterest core configuration validation failed for %s.\n' "$label" >&2
    if [[ ${#missing_keys[@]} -gt 0 ]]; then
        printf '  Missing required keys:' >&2
        printf ' %s' "${missing_keys[@]}" >&2
        printf '\n' >&2
    fi
    if [[ ${#placeholder_keys[@]} -gt 0 ]]; then
        printf '  Empty or placeholder secrets:' >&2
        printf ' %s' "${placeholder_keys[@]}" >&2
        printf '\n' >&2
    fi
    if [[ ${#invalid_keys[@]} -gt 0 ]]; then
        printf '  Invalid or inconsistent keys:' >&2
        printf ' %s' "${invalid_keys[@]}" >&2
        printf '\n' >&2
    fi
    return 1
}

configure_environment_files() {
    local runtime_file=""
    local development_file=""
    local key=""
    local value=""
    local file=""
    local environment_type="dev"
    local base_url="https://localhost:8100"
    local local_tls=""
    local secret_keys=(
        DB_ADMIN_PASSWORD DB_PASSWORD DB_READONLY_PASSWORD DB_CONFIDENTIAL_PASSWORD
        DB_BASIC_PASSWORD DB_GUEST_PASSWORD SESSION_SECRET_KEY SESSION_KEY
    )

    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] create an isolated installation identity, protected runtime configuration, and random local secrets\n'
        return
    fi
    "$PROJECT_ROOT/server_tools/scaffold.sh" setup
    # shellcheck source=server_tools/lib/easelect_private_paths.sh
    source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
    easelect_resolve_private_paths "$PROJECT_ROOT"
    runtime_file="$EASELECT_RUNTIME_ENV_FILE"
    development_file="$EASELECT_DEV_ENV_FILE"
    [[ -f "$runtime_file" && -f "$development_file" ]] || die "Filterest environment scaffolds were not created"

    for file in "$runtime_file" "$development_file"; do
        value="$(env_value "$file" FILTEREST_INSTALL_PROFILE)"
        if [[ -n "$value" && "$value" != "$PROFILE" ]]; then
            die "this checkout is already configured for the ${value} profile; profile changes require a reviewed migration"
        fi
    done

    if [[ "$PROFILE" == "admin" ]]; then
        environment_type="prod"
        local_tls="true"
    fi
    for file in "$runtime_file" "$development_file"; do
        set_env_value "$file" FILTEREST_INSTALL_PROFILE "$PROFILE"
        set_env_value "$file" ENVIRONMENT_TYPE "$environment_type"
        set_env_value "$file" FILTEREST_LOCAL_TLS "$local_tls"
        set_env_value "$file" BASE_URL "$base_url"
        set_env_value "$file" SESSION_COOKIE_MODE "isolated"
        set_env_value "$file" SESSION_COOKIE_NAME ""
    done

    for key in "${secret_keys[@]}"; do
        value="$(env_value "$runtime_file" "$key")"
        if is_placeholder_secret "$value"; then
            value="$(openssl rand -hex 24)"
        fi
        for file in "$runtime_file" "$development_file"; do
            if is_placeholder_secret "$(env_value "$file" "$key")"; then
                set_env_value "$file" "$key" "$value"
            fi
        done
    done
    configure_installation_database_identity "$runtime_file" "$development_file"
    chmod 600 "$runtime_file" "$development_file"
    validate_filterest_core_environment_file \
        "$runtime_file" "runtime environment" "$environment_type" "$local_tls" "$base_url" \
        || die "required Filterest runtime configuration is incomplete"
    validate_filterest_core_environment_file \
        "$development_file" "development environment" "$environment_type" "$local_tls" "$base_url" \
        || die "required Filterest development configuration is incomplete"
    printf '✓ Required Filterest core configuration is valid. Optional integrations may remain blank.\n'
}

# Stops only a server from this checkout whose on-disk binary was replaced.
# Bridges generated-checkout refreshes and the shared port helper before DB
# bootstrap so repeated installations cannot keep serving an obsolete DB.
stop_stale_checkout_server_before_install() {
    local port=""

    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] retire an obsolete same-checkout Filterest server before installation\n'
        return
    fi
    # shellcheck source=server_tools/lib/easelect_private_paths.sh
    source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
    # shellcheck source=server_tools/lib/filterest_port_preflight.sh
    source "$PROJECT_ROOT/server_tools/lib/filterest_port_preflight.sh"
    easelect_resolve_private_paths "$PROJECT_ROOT"
    port="$(filterest_configured_port 8100 "$EASELECT_DEV_ENV_FILE" "$EASELECT_RUNTIME_ENV_FILE")"
    filterest_preflight_stale_checkout_listener "$port" "$PROJECT_ROOT" "$ASSUME_YES"
}

# Preserve a verified pre-8.28.10 installation, but never infer ownership from
# shared default names alone. This read-only probe exists solely to avoid moving
# a legitimate earlier installation away from its initialized database.
verified_legacy_database_identity() {
    local runtime_file="$1"
    local completion_marker="$PROJECT_ROOT/runtime/filterest-setup-complete"
    local host=""
    local port=""
    local role=""
    local password=""
    local database=""
    local required_version=""
    local actual_version=""

    [[ -f "$completion_marker" ]] || return 1
    [[ "$(env_value "$runtime_file" DB_NAME)" == "filterest" ]] || return 1
    [[ "$(env_value "$runtime_file" DB_ADMIN_USER)" == "filterest_admin" ]] || return 1
    command -v psql >/dev/null 2>&1 || return 1

    host="$(env_value "$runtime_file" DB_HOST)"
    port="$(env_value "$runtime_file" DB_PORT)"
    role="$(env_value "$runtime_file" DB_ADMIN_USER)"
    password="$(env_value "$runtime_file" DB_ADMIN_PASSWORD)"
    database="$(env_value "$runtime_file" DB_NAME)"
    required_version="$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_DB")"
    [[ -n "$password" && -n "$required_version" ]] || return 1

    actual_version="$(PGPASSWORD="$password" psql \
        -h "${host:-localhost}" -p "${port:-5433}" -U "$role" -d "$database" -qAt \
        -c "SELECT version FROM system_db_version ORDER BY applied_at DESC NULLS LAST, id DESC LIMIT 1;" \
        2>/dev/null | tr -d '[:space:]' || true)"
    [[ "$actual_version" == "$required_version" ]]
}

set_standard_database_identity_value() {
    local file="$1"
    local key="$2"
    local standard_value="$3"
    local isolated_value="$4"
    local current_value=""

    current_value="$(env_value "$file" "$key")"
    if [[ -z "$current_value" || "$current_value" == "$standard_value" ]]; then
        set_env_value "$file" "$key" "$isolated_value"
    fi
}

# Give every new checkout its own stable PostgreSQL namespace. The ignored
# installation marker follows the checkout across reruns, while explicit
# operator-supplied database and role names remain untouched.
configure_installation_database_identity() {
    local runtime_file="$1"
    local development_file="$2"
    local marker="$PROJECT_ROOT/runtime/filterest-installation-id"
    local installation_id=""
    local file=""

    if [[ -f "$marker" ]]; then
        installation_id="$(tr -d '[:space:]' < "$marker")"
    elif verified_legacy_database_identity "$runtime_file"; then
        installation_id="legacy"
        mkdir -p "$(dirname "$marker")"
        (umask 077 && printf '%s\n' "$installation_id" > "$marker")
    else
        installation_id="$(openssl rand -hex 4)"
        mkdir -p "$(dirname "$marker")"
        (umask 077 && printf '%s\n' "$installation_id" > "$marker")
    fi

    if [[ "$installation_id" == "legacy" ]]; then
        printf '✓ Verified and preserved the existing Filterest database identity.\n'
        return
    fi
    [[ "$installation_id" =~ ^[a-f0-9]{8}$ ]] || die "invalid Filterest installation identity marker"

    for file in "$runtime_file" "$development_file"; do
        set_standard_database_identity_value "$file" DB_NAME filterest "filterest_${installation_id}"
        set_standard_database_identity_value "$file" DB_ADMIN_USER filterest_admin "filterest_admin_${installation_id}"
        set_standard_database_identity_value "$file" DB_USER filterest_admin "filterest_admin_${installation_id}"
        set_standard_database_identity_value "$file" DB_READONLY_USER filterest_readonly "filterest_readonly_${installation_id}"
        set_standard_database_identity_value "$file" DB_CONFIDENTIAL_USER filterest_confidential "filterest_confidential_${installation_id}"
        set_standard_database_identity_value "$file" DB_BASIC_USER filterest_basic "filterest_basic_${installation_id}"
        set_standard_database_identity_value "$file" DB_GUEST_USER filterest_guest "filterest_guest_${installation_id}"
    done
    printf '✓ Isolated database identity %s is ready for this installation.\n' "$installation_id"
}

ensure_admin_binary() {
    local target="$PROJECT_ROOT/runtime/bin/filterest-server"
    local version_marker="$PROJECT_ROOT/runtime/filterest-binary-version"
    local version=""
    local arch=""
    local asset=""
    local download_base=""
    local temp_dir=""
    local expected=""
    local actual=""

    if [[ "$PROFILE" != "admin" ]]; then
        return 0
    fi
    if [[ -f "$PROJECT_ROOT/VERSION_APP" ]]; then
        version="$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_APP")"
    else
        version="$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_EASELECT")"
    fi
    if [[ -x "$target" && -z "$BINARY_SOURCE" && -f "$version_marker" ]] && \
        [[ "$(tr -d '[:space:]' < "$version_marker")" == "$version" ]]; then
        printf '✓ Prebuilt Filterest %s is already installed.\n' "$version"
        return
    fi
    if [[ -n "$BINARY_SOURCE" ]]; then
        [[ "$DRY_RUN" -eq 1 || -f "$BINARY_SOURCE" ]] || die "binary source does not exist: $BINARY_SOURCE"
        run mkdir -p "$(dirname "$target")"
        run cp -p "$BINARY_SOURCE" "$target"
        run chmod 755 "$target"
        if [[ "$DRY_RUN" -eq 0 ]]; then
            printf '%s\n' "$version" > "$version_marker"
        fi
        printf '✓ Installed the reviewed local Filterest binary.\n'
        return
    fi

    arch="$(architecture_name)"
    asset="filterest-linux-${arch}"
    download_base="https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] download %s/%s and verify its SHA-256 checksum\n' "$download_base" "$asset"
        return
    fi
    temp_dir="$(mktemp -d)"
    curl --fail --location --retry 3 -o "$temp_dir/$asset" "$download_base/$asset"
    curl --fail --location --retry 3 -o "$temp_dir/$asset.sha256" "$download_base/$asset.sha256"
    expected="$(awk '{print $1; exit}' "$temp_dir/$asset.sha256")"
    actual="$(sha256sum "$temp_dir/$asset" | awk '{print $1}')"
    [[ -n "$expected" && "$actual" == "$expected" ]] || die "downloaded Filterest binary checksum does not match"
    mkdir -p "$(dirname "$target")"
    install -m 755 "$temp_dir/$asset" "$target"
    printf '%s\n' "$version" > "$version_marker"
    rm -rf "$temp_dir"
    printf '✓ Downloaded and verified Filterest %s.\n' "$version"
}

postgresql_cluster_port() {
    pg_lsclusters -h 2>/dev/null | awk -v major="$POSTGRESQL_MAJOR" '$1 == major && $4 == "online" {print $3; exit}'
}

prepare_database_superuser() {
    local port=""
    local runtime_file=""
    local role=""
    local password=""

    [[ "$DRY_RUN" -eq 0 ]] || {
        printf '  [dry-run] start PostgreSQL and create the password-protected Filterest database administrator if missing\n'
        return
    }
    # shellcheck source=server_tools/lib/easelect_private_paths.sh
    source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
    easelect_resolve_private_paths "$PROJECT_ROOT"
    runtime_file="$EASELECT_RUNTIME_ENV_FILE"
    role="$(env_value "$runtime_file" DB_ADMIN_USER)"
    password="$(env_value "$runtime_file" DB_ADMIN_PASSWORD)"
    [[ "$role" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "unsafe PostgreSQL administrator role name"
    [[ -n "$password" ]] || die "PostgreSQL administrator password is missing"

    port="$(postgresql_cluster_port)"
    if [[ -z "$port" ]]; then
        sudo pg_ctlcluster "$POSTGRESQL_MAJOR" main start
        port="$(postgresql_cluster_port)"
    fi
    [[ -n "$port" ]] || die "PostgreSQL ${POSTGRESQL_MAJOR} cluster did not start"

    if [[ "$(PGPASSWORD="$password" psql -h localhost -p "$port" -U "$role" -d postgres -qAt -c 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user;' 2>/dev/null | tr -d '[:space:]' || true)" == "t" ]]; then
        printf '✓ Password-protected PostgreSQL administrator is already ready.\n'
        return
    fi

    printf 'Creating the one-time Filterest PostgreSQL administrator role.\n'
    sudo -u postgres psql -p "$port" -d postgres -v ON_ERROR_STOP=1 \
        --set=role_name="$role" --set=role_password="$password" <<'SQL'
SELECT format('CREATE ROLE %I WITH LOGIN SUPERUSER PASSWORD %L', :'role_name', :'role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name');
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN SUPERUSER PASSWORD %L', :'role_name', :'role_password');
\gexec
SQL
    printf '✓ PostgreSQL administrator role is ready; normal app use no longer needs sudo.\n'
}

bootstrap_database_and_dependencies() {
    local setup_args=(--profile "$PROFILE")
    local runtime_file=""
    local port=""
    local role=""
    local password=""
    local database=""
    local relation_count="0"
    local core_ready="f"
    local completion_marker="$PROJECT_ROOT/runtime/filterest-setup-complete"
    local completed_profile=""
    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] ./server_tools/setup_local_dev_environment.sh --profile %s\n' "$PROFILE"
        return
    fi

    # The installer uses read-only probes to distinguish a complete database,
    # a resumable bootstrap, and a disposable partial import.
    # shellcheck source=server_tools/lib/easelect_private_paths.sh
    source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
    easelect_resolve_private_paths "$PROJECT_ROOT"
    runtime_file="$EASELECT_RUNTIME_ENV_FILE"
    port="$(postgresql_cluster_port)"
    role="$(env_value "$runtime_file" DB_ADMIN_USER)"
    password="$(env_value "$runtime_file" DB_ADMIN_PASSWORD)"
    database="$(env_value "$runtime_file" DB_NAME)"
    database="${database:-filterest}"
    completed_profile="$(sed -n 's/^profile=//p' "$completion_marker" 2>/dev/null | head -1 || true)"
    relation_count="$(PGPASSWORD="$password" psql -h localhost -p "$port" -U "$role" -d "$database" -qAt \
        -c "SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f');" \
        2>/dev/null | tr -d '[:space:]' || true)"
    relation_count="${relation_count:-0}"
    core_ready="$(PGPASSWORD="$password" psql -h localhost -p "$port" -U "$role" -d "$database" -qAt \
        -c "SELECT to_regclass('public.system_config') IS NOT NULL AND to_regclass('public.system_db_tables') IS NOT NULL;" \
        2>/dev/null | tr -d '[:space:]' || true)"

    if [[ "$completed_profile" == "$PROFILE" && "$core_ready" == "t" ]]; then
        printf '✓ Database bootstrap and %s dependencies are already complete.\n' "$PROFILE"
        return
    fi
    if [[ "$core_ready" == "t" ]]; then
        setup_args+=(--resume-existing)
    elif [[ "$relation_count" =~ ^[0-9]+$ && "$relation_count" -gt 0 ]]; then
        setup_args+=(--force)
        export ALLOW_INCOMPLETE_LOCAL_SETUP_RECREATE=1
    fi
    "$PROJECT_ROOT/server_tools/setup_local_dev_environment.sh" "${setup_args[@]}"
    if [[ "$PROFILE" == "development" ]]; then
        printf 'Installing the Chromium browser used by automated UI tests...\n'
        npx playwright install --with-deps chromium
    fi
    mkdir -p "$(dirname "$completion_marker")"
    printf 'profile=%s\napp_version=%s\ndb_version=%s\n' \
        "$PROFILE" \
        "$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_APP")" \
        "$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION_DB")" \
        > "$completion_marker"
}

start_installed_filterest() {
    local port=""
    [[ "$NO_START" -eq 0 ]] || return 0
    if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  [dry-run] start Filterest and verify the first-run browser address\n'
        return
    fi
    if [[ "$PROFILE" == "admin" ]]; then
        "$PROJECT_ROOT/server_tools/run_filterest_admin.sh"
    else
        # The installer reaches ctl directly after a first development setup,
        # so it owns the same early port preflight as later ./filterest starts.
        # shellcheck source=server_tools/lib/easelect_private_paths.sh
        source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
        # shellcheck source=server_tools/lib/filterest_port_preflight.sh
        source "$PROJECT_ROOT/server_tools/lib/filterest_port_preflight.sh"
        easelect_resolve_private_paths "$PROJECT_ROOT"
        port="$(filterest_configured_port 8100 "$EASELECT_DEV_ENV_FILE" "$EASELECT_RUNTIME_ENV_FILE")"
        filterest_preflight_port "$port"
        "$PROJECT_ROOT/ctl" -p "$port"
    fi
}

main() {
    parse_arguments "$@"
    choose_profile
    show_plan
    confirm_plan
    if [[ "$DRY_RUN" -eq 0 ]]; then
        is_generated_filterest_checkout || die "full installation must run from a generated Filterest checkout containing VERSION_APP"
    fi

    install_host_packages
    if [[ "$PROFILE" == "development" ]]; then
        install_go_toolchain_if_needed
        install_node_toolchain_if_needed
    fi
    configure_environment_files
    stop_stale_checkout_server_before_install
    ensure_admin_binary
    prepare_database_superuser
    bootstrap_database_and_dependencies
    start_installed_filterest

    printf '\nFilterest installation completed.\n'
    if [[ "$PROFILE" == "admin" ]]; then
        printf 'Open: https://localhost:8100/first-run\n'
    else
        printf 'Open: https://localhost:8100/first-run\n'
    fi
}

if [[ "${FILTEREST_INSTALLER_LIBRARY_ONLY:-0}" != "1" ]]; then
    main "$@"
fi
