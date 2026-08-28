#!/bin/sh
# Validates the protected runtime identity prepared outside the application image.
# Connects Compose TLS settings to read-only key files under the installation root.
# Fails closed when local TLS is enabled but setup did not create a complete pair.
# Leaves all application startup behavior to the command passed by the image.
set -eu

is_true() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
    esac
}

if is_true "${FILTEREST_LOCAL_TLS:-}"; then
    certificate_file="${TLS_CERT_FILE:-/filterest/keys/tls/localhost.crt}"
    key_file="${TLS_KEY_FILE:-/filterest/keys/tls/localhost.key}"

    if [ -L "$certificate_file" ] || [ -L "$key_file" ]; then
        printf 'error: TLS certificate and key must not be symbolic links\n' >&2
        exit 1
    fi
    if [ -e "$certificate_file" ] && [ ! -f "$certificate_file" ]; then
        printf 'error: TLS certificate path is not a regular file: %s\n' "$certificate_file" >&2
        exit 1
    fi
    if [ -e "$key_file" ] && [ ! -f "$key_file" ]; then
        printf 'error: TLS key path is not a regular file: %s\n' "$key_file" >&2
        exit 1
    fi
    if [ ! -f "$certificate_file" ] || [ ! -f "$key_file" ]; then
        printf 'error: local TLS identity is incomplete; run Filterest Docker setup first\n' >&2
        exit 1
    fi
fi

exec "$@"
