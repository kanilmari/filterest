#!/usr/bin/env bash
# check_edge_tls_readiness.sh
# Runs non-mutating public TLS and edge-readiness checks for Easelect operators.
# Operates between a public HTTPS endpoint, optional host-edge commands, and terminal evidence.
# Exists so credential rotation stays separate from certificate ownership while
# still giving operators one nearby proof command for the host edge.

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"

DOMAIN="${EDGE_TLS_DOMAIN:-}"
URL="${EDGE_TLS_URL:-}"
CONNECT_TARGET="${EDGE_TLS_CONNECT:-}"
SERVER_NAME="${EDGE_TLS_SERVER_NAME:-}"
TIMEOUT_SECONDS="${EDGE_TLS_TIMEOUT_SECONDS:-10}"
WARN_DAYS="${EDGE_TLS_WARN_DAYS:-30}"

SKIP_NETWORK=false
RUN_NGINX_TEST=false
RUN_CERTBOT_DRY_RUN=false
PRINT_OPERATOR_COMMANDS=false
CHECKS_RUN=0
FAILURES=0
WARNINGS=0
TEMP_DIR=""

usage() {
    cat <<USAGE
Usage:
  ${SCRIPT_NAME} --domain example.com [options]
  ${SCRIPT_NAME} --url https://example.com [options]

Runs read-only checks. It never edits .env files, /etc/letsencrypt, proxy
configuration, or Easelect runtime data.

Options:
  --domain <domain>          Domain used for SNI, certificate host matching,
                             and the default HTTPS URL.
  --url <url>                HTTPS URL to smoke-test. Defaults to
                             https://<domain>/ when --domain is provided.
  --connect <host:port>      TLS endpoint for openssl. Defaults to
                             <domain>:443 or <url-host>:443.
  --server-name <name>       SNI and certificate hostname. Defaults to domain
                             or the host from --url.
  --timeout <seconds>        Network timeout. Default: ${TIMEOUT_SECONDS}.
  --warn-days <days>         Fail when the cert expires before this many days.
                             Default: ${WARN_DAYS}.
  --skip-network             Skip openssl/curl network checks.
  --nginx-test               Run: sudo -n nginx -t
  --certbot-dry-run          Run: sudo -n certbot renew --dry-run
                             --no-random-sleep-on-renew.
  --print-operator-commands  Print the manual host-edge checklist.
  -h, --help                 Show this help.

Environment defaults:
  EDGE_TLS_DOMAIN, EDGE_TLS_URL, EDGE_TLS_CONNECT, EDGE_TLS_SERVER_NAME,
  EDGE_TLS_TIMEOUT_SECONDS, EDGE_TLS_WARN_DAYS

Exit codes:
  0  all requested checks passed, or only checklist/warnings were printed
  1  at least one requested check failed
  2  usage error
USAGE
}

fail_usage() {
    printf 'error: %s\n\n' "$1" >&2
    usage >&2
    exit 2
}

cleanup() {
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

pass_check() {
    CHECKS_RUN=$((CHECKS_RUN + 1))
    printf '[PASS] %s\n' "$1"
}

fail_check() {
    CHECKS_RUN=$((CHECKS_RUN + 1))
    FAILURES=$((FAILURES + 1))
    printf '[FAIL] %s\n' "$1" >&2
}

warn_check() {
    WARNINGS=$((WARNINGS + 1))
    printf '[WARN] %s\n' "$1" >&2
}

info() {
    printf '[INFO] %s\n' "$1"
}

is_positive_integer() {
    local value="$1"
    [[ "$value" =~ ^[1-9][0-9]*$ ]]
}

url_host() {
    local input="$1"
    local without_scheme="${input#*://}"
    local host_port="${without_scheme%%/*}"
    printf '%s\n' "${host_port%%:*}"
}

require_command() {
    local command_name="$1"
    if command -v "$command_name" >/dev/null 2>&1; then
        return 0
    fi
    fail_check "required command not found: ${command_name}"
    return 1
}

run_with_optional_timeout() {
    local output_file="$1"
    local error_file="$2"
    shift 2

    if command -v timeout >/dev/null 2>&1; then
        timeout "$TIMEOUT_SECONDS" "$@" >"$output_file" 2>"$error_file"
        return $?
    fi

    "$@" >"$output_file" 2>"$error_file"
}

print_operator_commands() {
    cat <<COMMANDS

Manual host-edge checklist:
  python3 server_tools/rotate_credentials.py
  sudo certbot renew --dry-run
  sudo nginx -t
  sudo systemctl reload nginx
  ./server_tools/check_edge_tls_readiness.sh --domain ${SERVER_NAME:-example.com}

For Caddy or Traefik hosts, replace the nginx command with the matching
deployment-layer validation command. Keep certificate renewal in the edge
runbook; do not put public TLS material into Easelect .env files.
COMMANDS
}

run_certificate_probe() {
    local raw_file
    local error_file
    local cert_file
    local warn_seconds
    local s_client_args

    require_command openssl || return

    TEMP_DIR="$(mktemp -d)"
    raw_file="${TEMP_DIR}/s_client.out"
    error_file="${TEMP_DIR}/s_client.err"
    cert_file="${TEMP_DIR}/leaf.pem"
    warn_seconds=$((WARN_DAYS * 86400))
    s_client_args=(
        openssl s_client
        -servername "$SERVER_NAME"
        -connect "$CONNECT_TARGET"
        -verify_return_error
        -showcerts
    )

    info "probing TLS certificate at ${CONNECT_TARGET} with SNI ${SERVER_NAME}"
    if run_with_optional_timeout "$raw_file" "$error_file" "${s_client_args[@]}" </dev/null; then
        pass_check "TLS handshake and chain verification succeeded"
    else
        fail_check "TLS handshake or chain verification failed for ${CONNECT_TARGET}"
        sed 's/^/  /' "$error_file" >&2
        return
    fi

    awk '
        /-----BEGIN CERTIFICATE-----/ { capture = 1 }
        capture { print }
        /-----END CERTIFICATE-----/ { exit }
    ' "$raw_file" >"$cert_file"

    if [[ ! -s "$cert_file" ]]; then
        fail_check "no leaf certificate was returned by ${CONNECT_TARGET}"
        return
    fi

    if openssl x509 -in "$cert_file" -noout -checkhost "$SERVER_NAME" >/dev/null 2>&1; then
        pass_check "certificate matches ${SERVER_NAME}"
    else
        fail_check "certificate does not match ${SERVER_NAME}"
    fi

    if openssl x509 -in "$cert_file" -noout -checkend "$warn_seconds" >/dev/null 2>&1; then
        pass_check "certificate remains valid for at least ${WARN_DAYS} day(s)"
    else
        fail_check "certificate expires within ${WARN_DAYS} day(s)"
    fi

    openssl x509 -in "$cert_file" -noout -subject -issuer -dates
    openssl x509 -in "$cert_file" -noout -ext subjectAltName 2>/dev/null || true
}

run_https_smoke() {
    require_command curl || return

    info "smoke-testing ${URL}"
    if curl -fsS --max-time "$TIMEOUT_SECONDS" -o /dev/null "$URL"; then
        pass_check "HTTPS smoke test succeeded for ${URL}"
    else
        fail_check "HTTPS smoke test failed for ${URL}"
    fi
}

run_nginx_test() {
    require_command sudo || return

    info "running sudo -n nginx -t"
    if sudo -n nginx -t; then
        pass_check "nginx configuration test passed"
    else
        fail_check "nginx configuration test failed or sudo is unavailable"
    fi
}

run_certbot_dry_run() {
    require_command sudo || return

    info "running sudo -n certbot renew --dry-run --no-random-sleep-on-renew"
    if sudo -n certbot renew --dry-run --no-random-sleep-on-renew; then
        pass_check "certbot renewal dry run passed"
    else
        fail_check "certbot renewal dry run failed or sudo is unavailable"
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)
            [[ $# -ge 2 ]] || fail_usage "--domain requires a value"
            DOMAIN="$2"
            shift 2
            ;;
        --url)
            [[ $# -ge 2 ]] || fail_usage "--url requires a value"
            URL="$2"
            shift 2
            ;;
        --connect)
            [[ $# -ge 2 ]] || fail_usage "--connect requires a value"
            CONNECT_TARGET="$2"
            shift 2
            ;;
        --server-name)
            [[ $# -ge 2 ]] || fail_usage "--server-name requires a value"
            SERVER_NAME="$2"
            shift 2
            ;;
        --timeout)
            [[ $# -ge 2 ]] || fail_usage "--timeout requires a value"
            TIMEOUT_SECONDS="$2"
            shift 2
            ;;
        --warn-days)
            [[ $# -ge 2 ]] || fail_usage "--warn-days requires a value"
            WARN_DAYS="$2"
            shift 2
            ;;
        --skip-network)
            SKIP_NETWORK=true
            shift
            ;;
        --nginx-test)
            RUN_NGINX_TEST=true
            shift
            ;;
        --certbot-dry-run)
            RUN_CERTBOT_DRY_RUN=true
            shift
            ;;
        --print-operator-commands)
            PRINT_OPERATOR_COMMANDS=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail_usage "unknown option: $1"
            ;;
    esac
done

is_positive_integer "$TIMEOUT_SECONDS" || fail_usage "--timeout must be a positive integer"
is_positive_integer "$WARN_DAYS" || fail_usage "--warn-days must be a positive integer"

if [[ -z "$SERVER_NAME" && -n "$DOMAIN" ]]; then
    SERVER_NAME="$DOMAIN"
fi
if [[ -z "$SERVER_NAME" && -n "$URL" ]]; then
    SERVER_NAME="$(url_host "$URL")"
fi
if [[ -z "$URL" && -n "$SERVER_NAME" ]]; then
    URL="https://${SERVER_NAME}/"
fi
if [[ -z "$CONNECT_TARGET" && -n "$SERVER_NAME" ]]; then
    CONNECT_TARGET="${SERVER_NAME}:443"
fi

info "Easelect edge TLS readiness check is non-mutating."
info "Credential rotation remains in server_tools/rotate_credentials.py."

if [[ "$PRINT_OPERATOR_COMMANDS" == true ]]; then
    print_operator_commands
fi

if [[ "$SKIP_NETWORK" == false ]]; then
    if [[ -z "$SERVER_NAME" || -z "$CONNECT_TARGET" || -z "$URL" ]]; then
        warn_check "no --domain or --url provided; skipping public HTTPS checks"
    else
        run_certificate_probe
        run_https_smoke
    fi
else
    warn_check "network checks skipped by request"
fi

if [[ "$RUN_NGINX_TEST" == true ]]; then
    run_nginx_test
fi

if [[ "$RUN_CERTBOT_DRY_RUN" == true ]]; then
    run_certbot_dry_run
fi

if [[ "$CHECKS_RUN" -eq 0 ]]; then
    warn_check "no checks were run; pass --domain, --url, --nginx-test, or --certbot-dry-run"
fi

printf '\nSummary: %s check(s), %s warning(s), %s failure(s)\n' \
    "$CHECKS_RUN" "$WARNINGS" "$FAILURES"

if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
fi

exit 0
