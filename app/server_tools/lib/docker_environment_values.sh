#!/usr/bin/env bash
# docker_environment_values.sh
# Recognizes placeholder settings for the portable Docker runner.
# Connects Docker setup callers to their setting-specific initialization rules.
# Keeps Docker's whitespace-only rule separate from the installer's quote handling.

# The setting name selects session encryption's prefix rule without changing other secrets.
is_placeholder_secret() {
    local value="$1"
    if [[ "${2:-}" == SESSION_SECRET_KEY ]]; then
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        [[ -z "$value" || "$value" == replace-me* ]]
        return
    fi
    case "$value" in
        ""|replace-me|replace-me-with-32-plus-random-characters|readonly_pass|limited_pass|basic_pass|guest_pass) return 0 ;;
        *) return 1 ;;
    esac
}
