#!/bin/bash
# ==============================================================================
# env_permissions.sh: Shared secret-env permission helpers for operator tooling.
#
# Detects sensitive local env/config files that should use chmod 600.
# Provides warning-only and fix helpers for ctl, setup, and migration scripts.
# ==============================================================================

_env_perm_warn_line() {
    local message="$1"
    if [[ -n "${YELLOW:-}" && -n "${NC:-}" ]]; then
        echo -e "${YELLOW}${message}${NC}"
    else
        echo "$message"
    fi
}

_secret_env_requires_strict_permissions() {
    local file_path="$1"
    local file_name
    file_name="$(basename "$file_path")"

    case "$file_name" in
        .env|dev_env.txt|runtime_environment.env|development_environment.env|revolut.env|environment_type.env)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

_secret_env_file_mode() {
    local file_path="$1"

    if stat -c '%a' "$file_path" > /dev/null 2>&1; then
        stat -c '%a' "$file_path"
        return 0
    fi

    if stat -f '%Lp' "$file_path" > /dev/null 2>&1; then
        stat -f '%Lp' "$file_path"
        return 0
    fi

    return 1
}

warn_secret_env_file_permissions() {
    local file_path="$1"
    local context="${2:-runtime check}"

    if [[ ! -e "$file_path" || -L "$file_path" ]]; then
        return 0
    fi
    if ! _secret_env_requires_strict_permissions "$file_path"; then
        return 0
    fi

    local mode
    mode="$(_secret_env_file_mode "$file_path" 2>/dev/null || true)"
    if [[ -z "$mode" || "$mode" == "600" ]]; then
        return 0
    fi

    _env_perm_warn_line "⚠️  ${file_path} permissions are ${mode}; expected 600 for secret-bearing env files (${context})."
}

set_secret_env_file_permissions() {
    local file_path="$1"

    if [[ ! -e "$file_path" || -L "$file_path" ]]; then
        return 0
    fi
    if ! _secret_env_requires_strict_permissions "$file_path"; then
        return 0
    fi

    chmod 600 "$file_path"
}
