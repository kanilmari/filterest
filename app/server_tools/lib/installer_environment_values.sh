#!/usr/bin/env bash
# installer_environment_values.sh
# Recognizes placeholder values in native installation settings.
# Connects installer initialization and validation, including update preflight.
# Keeps session encryption's normalization separate from other settings' exact matches.

# The setting name selects session encryption's prefix rule without changing other secrets.
is_placeholder_secret() {
    local value="$1"
    if [[ "${2:-}" == SESSION_SECRET_KEY ]]; then
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
            value="${value:1:${#value}-2}"
            value="${value#"${value%%[![:space:]]*}"}"
            value="${value%"${value##*[![:space:]]}"}"
        fi
        [[ -z "$value" || "$value" == replace-me* ]]
        return
    fi
    case "$value" in
        ""|replace-me|replace-me-with-32-plus-random-characters|readonly_pass|limited_pass|basic_pass|guest_pass) return 0 ;;
        *) return 1 ;;
    esac
}
