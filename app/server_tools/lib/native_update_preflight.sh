#!/usr/bin/env bash
# native_update_preflight.sh
# Checks installed native setup inputs without rewriting settings or host state.
# Connects the updater to the installer's existing validation and readers.
# Keeps static refusals before shutdown; actual setup retains every recheck.

# Values setup always rewrites are projected in memory for the same validator.
# Retained values still come from the actual protected file, without evaluation.
native_update_planned_value() {
    local file="$1" key="$2" value=""
    case "$key" in
        FILTEREST_INSTALL_PROFILE) printf '%s' "$PROFILE" ;;
        ENVIRONMENT_TYPE) printf prod ;;
        FILTEREST_LOCAL_TLS) printf true ;;
        BASE_URL) printf 'https://localhost:%s' "$preflight_port" ;;
        SESSION_COOKIE_MODE) printf isolated ;;
        SESSION_COOKIE_NAME) ;;
        DB_ADMIN_PASSWORD|DB_PASSWORD|DB_READONLY_PASSWORD|DB_CONFIDENTIAL_PASSWORD|DB_BASIC_PASSWORD|DB_GUEST_PASSWORD|SESSION_SECRET_KEY|SESSION_KEY)
            value="$(env_value "$file" "$key")"
            if is_placeholder_secret "$value"; then
                printf '%048d' 0
            else
                printf '%s' "$value"
            fi
            ;;
        DB_NAME|DB_ADMIN_USER|DB_USER|DB_READONLY_USER|DB_CONFIDENTIAL_USER|DB_BASIC_USER|DB_GUEST_USER)
            value="$(env_value "$file" "$key")"
            printf '%s' "${value:-filterest}"
            ;;
        *) env_value "$file" "$key" ;;
    esac
}

preflight_native_update() {
    [[ "$PROFILE" == admin ]] || die "native update preflight requires the admin profile"
    [[ "$(uname -s)" == Linux ]] || die "automatic host setup currently supports Linux"
    command -v apt-get >/dev/null 2>&1 || die "automatic host setup currently supports Debian and Ubuntu based systems"
    require_admin_binary_glibc
    architecture_name >/dev/null
    resolve_installation_private_paths
    local preflight_port="" file="" line="" key="" value=""
    local marker="$RUNTIME_ROOT/filterest-installation-id"
    preflight_port="$(installation_native_port)" || return
    if [[ -f "$marker" ]]; then
        value="$(tr -d '[:space:]' < "$marker")"
        [[ "$value" == legacy || "$value" =~ ^[a-f0-9]{8}$ ]] || die "invalid Filterest installation identity marker"
    fi
    for file in "$EASELECT_RUNTIME_ENV_FILE" "$EASELECT_DEV_ENV_FILE"; do
        # Missing scaffolds are created from the installed inert template.
        [[ -f "$file" ]] || file="$SOURCE_ROOT/.env.example"
        [[ -f "$file" ]] || die "Filterest environment template is missing"
        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
                key="${BASH_REMATCH[1]}"
                _installation_recovery_settings_content "$file" "$key" "" >/dev/null || return 1
            fi
        done < "$file"
        value="$(env_value "$file" FILTEREST_INSTALL_PROFILE)"
        [[ -z "$value" || "$value" == "$PROFILE" ]] || die "configured profile conflicts with the native update"
        validate_filterest_core_environment_file "$file" "native update settings" prod true \
            "https://localhost:$preflight_port" native_update_planned_value || return 1
        value="$(env_value "$file" DB_ADMIN_USER)"
        [[ -z "$value" || "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "unsafe PostgreSQL administrator role name"
    done
    local certificate="${TLS_CERT_FILE:-$EASELECT_TLS_CERT_FILE}" private_key="${TLS_KEY_FILE:-$EASELECT_TLS_KEY_FILE}"
    filterest_recovery_content_names "$INSTALLATION_ROOT" "$certificate" "$private_key" || return 1
    [[ -f "$certificate" && -r "$certificate" && ! -L "$certificate" && \
       -f "$private_key" && -r "$private_key" && ! -L "$private_key" ]] || die "Native update requires its existing readable TLS certificate and key"
    local certificate_public="" key_public=""
    certificate_public="$(filterest_recovery_utility "$INSTALLATION_ROOT" openssl x509 -in "$certificate" -pubkey -noout)" || return 1
    key_public="$(filterest_recovery_utility "$INSTALLATION_ROOT" openssl pkey -in "$private_key" -passin pass: -pubout)" || return 1
    [[ -n "$certificate_public" && "$certificate_public" == "$key_public" ]] || die "Native TLS certificate and key do not match"
    # Binary assets, generated secrets/TLS and database/bootstrap results do not
    # exist yet; their content and runtime verifiers remain in the real setup.
}
