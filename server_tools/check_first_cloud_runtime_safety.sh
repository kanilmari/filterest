#!/usr/bin/env bash
# check_first_cloud_runtime_safety.sh
# Checks first-cloud-mode runtime safety without mutating env files, databases, or services.
# Operates between instance env files, optional live system endpoints, and terminal evidence.
# Exists so #839 B5 can collect repeatable proof for isolated-domain and replica-pool
# contracts before human/operator acceptance.

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"

MODE="${FIRST_CLOUD_RUNTIME_MODE:-isolated}"
TIMEOUT_SECONDS="${FIRST_CLOUD_RUNTIME_TIMEOUT_SECONDS:-10}"
REQUIRE_BACKGROUND_WORKER_ROLE="${FIRST_CLOUD_RUNTIME_REQUIRE_BACKGROUND_WORKER_ROLE:-false}"
SSH_TARGET="${FIRST_CLOUD_RUNTIME_SSH_TARGET:-}"
SSH_KEY="${FIRST_CLOUD_RUNTIME_SSH_KEY:-}"

ENV_FILES=()
BASE_URLS=()
REMOTE_BASE_URLS=()
SSH_ARGS=()
CHECKS_RUN=0
FAILURES=0
WARNINGS=0

usage() {
    cat <<USAGE
Usage:
  ${SCRIPT_NAME} --env-file instances/example/.env [--env-file ...] [options]
  ${SCRIPT_NAME} --base-url https://localhost:8082 [--base-url ...] [options]

Runs non-mutating first-cloud runtime-safety checks. It never prints secret
values and never writes env files, databases, storage, or service state.

Options:
  --env-file <path>       Instance env file to inspect. May be repeated.
  --base-url <url>        Live Easelect base URL to inspect through
                          /system/ready and /system/instance-status. May be
                          repeated.
  --remote-base-url <url> Live Easelect base URL to inspect over --ssh-target,
                          for example http://localhost:8082. May be repeated.
  --ssh-target <user@host>
                          Inspect --remote-base-url over SSH read-only.
  --ssh-key <path>        SSH private key for --ssh-target.
  --mode <mode>           Contract mode: isolated or replica-pool.
                          Default: ${MODE}.
  --timeout <seconds>     curl timeout for live endpoint checks.
                          Default: ${TIMEOUT_SECONDS}.
  --require-background-worker-role
                          Fail when an env file or live status leaves
                          background_worker_role unspecified.
  -h, --help              Show this help.

Mode meanings:
  isolated      One isolated database per production domain. Separate
                app/domain instances should not accidentally share DBs,
                migrations, sessions, or worker ownership.
  replica-pool  Multiple replicas for the same application behind one load
                balancer. Replicas must share DB identity, SESSION_KEY,
                SESSION_SECRET_KEY, and an explicit SESSION_COOKIE_NAME.

Environment defaults:
  FIRST_CLOUD_RUNTIME_MODE, FIRST_CLOUD_RUNTIME_TIMEOUT_SECONDS,
  FIRST_CLOUD_RUNTIME_REQUIRE_BACKGROUND_WORKER_ROLE,
  FIRST_CLOUD_RUNTIME_SSH_TARGET, FIRST_CLOUD_RUNTIME_SSH_KEY

Exit codes:
  0  no blocking failures were found
  1  at least one blocking failure was found
  2  usage error
USAGE
}

fail_usage() {
    printf 'error: %s\n\n' "$1" >&2
    usage >&2
    exit 2
}

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

path_missing_result() {
    local required="$1"
    local message="$2"

    if [[ "$required" == "true" ]]; then
        fail_check "$message"
    else
        warn_check "$message"
    fi
}

info() {
    printf '[INFO] %s\n' "$1"
}

build_ssh_args() {
    SSH_ARGS=(
        -o BatchMode=yes
        -o IdentitiesOnly=yes
        -o StrictHostKeyChecking=accept-new
        -o ConnectTimeout="${TIMEOUT_SECONDS}"
    )
    if [[ -n "$SSH_KEY" ]]; then
        SSH_ARGS=(-i "$SSH_KEY" "${SSH_ARGS[@]}")
    fi
}

is_positive_integer() {
    local value="$1"
    [[ "$value" =~ ^[1-9][0-9]*$ ]]
}

normalize_bool() {
    local value
    value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
    case "$value" in
        1|true|yes|on) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

env_value() {
    local env_file="$1"
    local key="$2"

    awk -v key="$key" '
        BEGIN { prefix = key "=" }
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        index($0, prefix) == 1 {
            value = substr($0, length(prefix) + 1)
            sub(/\r$/, "", value)
            if ((value ~ /^".*"$/) || (value ~ /^\047.*\047$/)) {
                value = substr(value, 2, length(value) - 2)
            }
            print value
        }
    ' "$env_file" | tail -n 1
}

redacted_presence() {
    local value="$1"
    if [[ -z "$value" ]]; then
        printf 'missing'
        return
    fi
    printf 'set'
}

is_placeholder_secret() {
    local value
    value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
    [[ -z "$value" ]] && return 0
    [[ "$value" == *change_me* ]] && return 0
    [[ "$value" == *changeme* ]] && return 0
    [[ "$value" == *replace_me* ]] && return 0
    [[ "$value" == *placeholder* ]] && return 0
    [[ "$value" == *example* ]] && return 0
    return 1
}

instance_label() {
    local env_file="$1"
    local instance
    local domain
    instance="$(env_value "$env_file" INSTANCE)"
    domain="$(env_value "$env_file" DOMAIN)"
    if [[ -n "$instance" ]]; then
        printf '%s' "$instance"
    elif [[ -n "$domain" ]]; then
        printf '%s' "$domain"
    else
        printf '%s' "$(basename "$env_file")"
    fi
}

db_identity() {
    local env_file="$1"
    local instance
    local db_host
    local db_port
    local db_name

    instance="$(env_value "$env_file" INSTANCE)"
    db_host="$(env_value "$env_file" DB_HOST)"
    db_port="$(env_value "$env_file" DB_PORT)"
    db_name="$(env_value "$env_file" DB_NAME)"

    if [[ -z "$db_host" ]]; then
        db_host="compose:easelect-${instance:-default}-db"
    fi
    if [[ -z "$db_port" || "$db_port" == "0" ]]; then
        db_port="5432"
    fi
    if [[ -z "$db_name" ]]; then
        db_name="easelect"
    fi

    printf '%s|%s|%s' "$db_host" "$db_port" "$db_name"
}

worker_role() {
    local env_file="$1"
    local role

    role="$(env_value "$env_file" EASELECT_BACKGROUND_WORKER_ROLE)"
    if [[ -z "$role" ]]; then
        role="$(env_value "$env_file" BACKGROUND_WORKER_ROLE)"
    fi
    printf '%s' "$role"
}

role_is_owner() {
    local role
    role="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
    [[ -n "$role" && "$role" != "none" && "$role" != "off" && "$role" != "disabled" && "$role" != "unspecified" ]]
}

check_env_file_basics() {
    local env_file="$1"
    local label
    local session_key
    local session_secret
    local cookie_name
    local migrations_enabled
    local role

    if [[ ! -r "$env_file" ]]; then
        fail_check "env file is not readable: ${env_file}"
        return
    fi

    label="$(instance_label "$env_file")"
    session_key="$(env_value "$env_file" SESSION_KEY)"
    session_secret="$(env_value "$env_file" SESSION_SECRET_KEY)"
    cookie_name="$(env_value "$env_file" SESSION_COOKIE_NAME)"
    migrations_enabled="$(normalize_bool "$(env_value "$env_file" ENABLE_SQL_MIGRATIONS)")"
    role="$(worker_role "$env_file")"

    info "checking env file ${env_file} (${label})"
    info "session_key=$(redacted_presence "$session_key") session_secret=$(redacted_presence "$session_secret") session_cookie_name=$(redacted_presence "$cookie_name")"

    if is_placeholder_secret "$session_key"; then
        fail_check "${label}: SESSION_KEY is missing or still placeholder-like"
    else
        pass_check "${label}: SESSION_KEY is present without printing its value"
    fi

    if is_placeholder_secret "$session_secret"; then
        fail_check "${label}: SESSION_SECRET_KEY is missing or still placeholder-like"
    else
        pass_check "${label}: SESSION_SECRET_KEY is present without printing its value"
    fi

    if [[ "$migrations_enabled" == "true" ]]; then
        warn_check "${label}: ENABLE_SQL_MIGRATIONS=true; ensure this runtime is the single migration owner for its DB during rollout"
    else
        pass_check "${label}: ENABLE_SQL_MIGRATIONS is not enabled in this env file"
    fi

    if [[ -z "$role" ]]; then
        path_missing_result "$REQUIRE_BACKGROUND_WORKER_ROLE" "${label}: background worker role is not explicit; set EASELECT_BACKGROUND_WORKER_ROLE or BACKGROUND_WORKER_ROLE for B5 acceptance"
    else
        pass_check "${label}: background worker role is explicit (${role})"
    fi
}

check_pairwise_contracts() {
    local mode="$1"
    local i
    local j
    local left
    local right
    local left_label
    local right_label
    local left_db
    local right_db
    local left_cookie
    local right_cookie
    local left_migrations
    local right_migrations
    local left_role
    local right_role

    if [[ "${#ENV_FILES[@]}" -lt 2 ]]; then
        return
    fi

    for ((i = 0; i < ${#ENV_FILES[@]}; i++)); do
        left="${ENV_FILES[$i]}"
        [[ -r "$left" ]] || continue
        left_label="$(instance_label "$left")"
        left_db="$(db_identity "$left")"
        left_cookie="$(env_value "$left" SESSION_COOKIE_NAME)"
        left_migrations="$(normalize_bool "$(env_value "$left" ENABLE_SQL_MIGRATIONS)")"
        left_role="$(worker_role "$left")"

        for ((j = i + 1; j < ${#ENV_FILES[@]}; j++)); do
            right="${ENV_FILES[$j]}"
            [[ -r "$right" ]] || continue
            right_label="$(instance_label "$right")"
            right_db="$(db_identity "$right")"
            right_cookie="$(env_value "$right" SESSION_COOKIE_NAME)"
            right_migrations="$(normalize_bool "$(env_value "$right" ENABLE_SQL_MIGRATIONS)")"
            right_role="$(worker_role "$right")"

            if [[ "$left_db" == "$right_db" && "$left_migrations" == "true" && "$right_migrations" == "true" ]]; then
                fail_check "${left_label}/${right_label}: both runtimes target the same DB identity with ENABLE_SQL_MIGRATIONS=true"
            fi

            if [[ "$left_db" == "$right_db" ]] && role_is_owner "$left_role" && role_is_owner "$right_role"; then
                fail_check "${left_label}/${right_label}: both runtimes appear to own background work for the same DB identity"
            fi

            if [[ "$mode" == "isolated" ]]; then
                if [[ "$left_db" == "$right_db" ]]; then
                    warn_check "${left_label}/${right_label}: same DB identity seen in isolated mode; use --mode replica-pool if these are same-app replicas"
                fi
                if [[ -n "$left_cookie" && "$left_cookie" == "$right_cookie" && "$left_db" != "$right_db" ]]; then
                    warn_check "${left_label}/${right_label}: same explicit SESSION_COOKIE_NAME across different DB identities"
                fi
            fi
        done
    done
}

check_replica_pool_contract() {
    local first_file
    local first_db
    local first_session_key
    local first_session_secret
    local first_cookie
    local env_file
    local label

    if [[ "${#ENV_FILES[@]}" -lt 2 ]]; then
        fail_check "replica-pool mode needs at least two --env-file inputs"
        return
    fi

    first_file="${ENV_FILES[0]}"
    first_db="$(db_identity "$first_file")"
    first_session_key="$(env_value "$first_file" SESSION_KEY)"
    first_session_secret="$(env_value "$first_file" SESSION_SECRET_KEY)"
    first_cookie="$(env_value "$first_file" SESSION_COOKIE_NAME)"

    if [[ -z "$first_cookie" ]]; then
        fail_check "replica-pool mode requires explicit SESSION_COOKIE_NAME shared by all replicas"
    fi

    for env_file in "${ENV_FILES[@]}"; do
        [[ -r "$env_file" ]] || continue
        label="$(instance_label "$env_file")"
        if [[ "$(db_identity "$env_file")" != "$first_db" ]]; then
            fail_check "${label}: replica pool DB identity differs from the first env file"
        fi
        if [[ "$(env_value "$env_file" SESSION_KEY)" != "$first_session_key" ]]; then
            fail_check "${label}: replica pool SESSION_KEY does not match the first env file"
        fi
        if [[ "$(env_value "$env_file" SESSION_SECRET_KEY)" != "$first_session_secret" ]]; then
            fail_check "${label}: replica pool SESSION_SECRET_KEY does not match the first env file"
        fi
        if [[ "$(env_value "$env_file" SESSION_COOKIE_NAME)" != "$first_cookie" ]]; then
            fail_check "${label}: replica pool SESSION_COOKIE_NAME does not match the first env file"
        fi
    done

    if [[ "$FAILURES" -eq 0 ]]; then
        pass_check "replica-pool env files share DB identity and session cookie contract"
    fi
}

json_field_report() {
    local json_file="$1"
    local payload_kind="$2"
    python3 - "$json_file" "$payload_kind" "$REQUIRE_BACKGROUND_WORKER_ROLE" <<'PY'
import json
import sys

path, payload_kind, require_background_worker_role = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception as exc:
    print(f"FAIL\t{payload_kind}: response was not valid JSON: {exc}")
    raise SystemExit(0)

def truthy(value):
    return value is True or str(value).lower() == "true"

if payload_kind == "ready":
    if truthy(data.get("ready")):
        print("PASS\t/system/ready reports ready=true")
    else:
        print(f"FAIL\t/system/ready reports ready={data.get('ready')} reasons={data.get('reasons', [])}")

    if truthy(data.get("db_compatible")):
        print("PASS\t/system/ready reports db_compatible=true")
    else:
        print(f"FAIL\t/system/ready reports db_compatible={data.get('db_compatible')}")

    if truthy(data.get("accepting_new_work")):
        print("PASS\t/system/ready reports accepting_new_work=true")
    else:
        print(f"WARN\t/system/ready reports accepting_new_work={data.get('accepting_new_work')}")

elif payload_kind == "instance-status":
    role = str(data.get("background_worker_role") or "").strip()
    storage_root = str(data.get("storage_root") or "").strip()
    drain_state = str(data.get("drain_state") or "").strip()
    database_pools = data.get("database_pools")
    database_pool_headroom = data.get("database_pool_headroom") or {}

    if role and role != "unspecified":
        print(f"PASS\t/system/instance-status reports explicit background_worker_role={role}")
    elif require_background_worker_role == "true":
        print("FAIL\t/system/instance-status reports background_worker_role as unspecified")
    else:
        print("WARN\t/system/instance-status reports background_worker_role as unspecified")

    if storage_root:
        print(f"PASS\t/system/instance-status reports storage_root={storage_root}")
    else:
        print("WARN\t/system/instance-status did not report storage_root")

    if drain_state:
        print(f"PASS\t/system/instance-status reports drain_state={drain_state}")
    else:
        print("WARN\t/system/instance-status did not report drain_state")

    if isinstance(database_pools, list) and database_pools:
        total_max_open = sum(int(pool.get("max_open_connections") or 0) for pool in database_pools)
        total_wait_count = sum(int(pool.get("wait_count") or 0) for pool in database_pools)
        pool_roles = ", ".join(str(pool.get("role") or "unknown") for pool in database_pools)
        print(
            "PASS\t/system/instance-status reports "
            f"{len(database_pools)} database pool snapshots ({pool_roles}), "
            f"total_max_open={total_max_open}, total_wait_count={total_wait_count}"
        )
        waiting_roles = [
            str(pool.get("role") or "unknown")
            for pool in database_pools
            if int(pool.get("wait_count") or 0) > 0
        ]
        if waiting_roles:
            print(
                "WARN\t/system/instance-status database pool wait_count is non-zero "
                f"for roles: {', '.join(waiting_roles)}"
            )
    else:
        print("WARN\t/system/instance-status did not report database_pools snapshots")

    if isinstance(database_pool_headroom, dict) and database_pool_headroom.get("available") is True:
        remaining = int(database_pool_headroom.get("remaining_headroom") or 0)
        reserve = int(database_pool_headroom.get("recommended_reserve") or 0)
        postgres_max = int(database_pool_headroom.get("postgres_max_connections") or 0)
        configured = int(database_pool_headroom.get("configured_total_max_open") or 0)
        if database_pool_headroom.get("is_at_or_above_capacity"):
            print(
                "FAIL\t/system/instance-status database pool budget meets or exceeds "
                f"postgres capacity configured_total_max_open={configured} "
                f"postgres_max_connections={postgres_max}"
            )
        elif database_pool_headroom.get("is_tight"):
            print(
                "WARN\t/system/instance-status database pool headroom is tight "
                f"remaining_headroom={remaining} recommended_reserve={reserve} "
                f"postgres_max_connections={postgres_max}"
            )
        else:
            print(
                "PASS\t/system/instance-status database pool headroom is available "
                f"remaining_headroom={remaining} recommended_reserve={reserve} "
                f"postgres_max_connections={postgres_max}"
            )
    else:
        error = ""
        if isinstance(database_pool_headroom, dict):
            error = str(database_pool_headroom.get("error") or "").strip()
        suffix = f": {error}" if error else ""
        print(f"WARN\t/system/instance-status did not report available database_pool_headroom{suffix}")
PY
}

record_report_line() {
    local level="$1"
    local message="$2"

    case "$level" in
        PASS) pass_check "$message" ;;
        WARN) warn_check "$message" ;;
        FAIL) fail_check "$message" ;;
        *) info "$message" ;;
    esac
}

check_live_base_url() {
    local base_url="$1"
    local endpoint
    local url
    local tmp_file
    local http_code
    local line
    local level
    local message

    if ! command -v curl >/dev/null 2>&1; then
        fail_check "curl is required for --base-url checks"
        return
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        fail_check "python3 is required to parse live JSON endpoint checks"
        return
    fi

    info "checking live runtime ${base_url}"
    for endpoint in ready instance-status; do
        url="${base_url%/}/system/${endpoint}"
        tmp_file="$(mktemp)"
        if ! http_code="$(curl -skS --max-time "$TIMEOUT_SECONDS" -o "$tmp_file" -w '%{http_code}' "$url" 2>/dev/null)"; then
            http_code="000"
        fi
        if [[ "$http_code" != "200" ]]; then
            fail_check "${url} returned HTTP ${http_code}"
            rm -f "$tmp_file"
            continue
        fi

        while IFS=$'\t' read -r level message; do
            [[ -z "${level:-}" ]] && continue
            record_report_line "$level" "$message"
        done < <(json_field_report "$tmp_file" "$endpoint")
        rm -f "$tmp_file"
    done
}

check_remote_live_base_url() {
    local base_url="$1"
    local endpoint
    local url
    local output_file
    local error_file
    local body_file
    local http_code
    local redirect_location
    local content_type
    local failure_detail
    local level
    local message

    if ! command -v python3 >/dev/null 2>&1; then
        fail_check "python3 is required to parse remote live JSON endpoint checks"
        return
    fi

    info "checking remote live runtime ${base_url} over SSH ${SSH_TARGET}"
    for endpoint in ready instance-status; do
        url="${base_url%/}/system/${endpoint}"
        output_file="$(mktemp)"
        error_file="$(mktemp)"
        body_file="$(mktemp)"

        if ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" -- \
            "$url" "$TIMEOUT_SECONDS" >"$output_file" 2>"$error_file" <<'REMOTE'
url="$1"
timeout_seconds="$2"
if ! command -v curl >/dev/null 2>&1; then
    printf 'curl command not found on remote host\n' >&2
    exit 127
fi
headers_file="$(mktemp)"
body_file="$(mktemp)"
trap 'rm -f "$headers_file" "$body_file"' EXIT
http_code="$(curl -skS --max-time "$timeout_seconds" -D "$headers_file" -o "$body_file" -w '%{http_code}' "$url")"
cat "$body_file"
printf '\n__HTTP_CODE__%s\n' "$http_code"
awk 'BEGIN { IGNORECASE=1 } /^Location:/ { sub(/\r$/, ""); sub(/^Location:[[:space:]]*/, ""); print "__LOCATION__"$0; exit }' "$headers_file"
awk 'BEGIN { IGNORECASE=1 } /^Content-Type:/ { sub(/\r$/, ""); sub(/^Content-Type:[[:space:]]*/, ""); print "__CONTENT_TYPE__"$0; exit }' "$headers_file"
REMOTE
        then
            http_code="$(awk -F'__HTTP_CODE__' '/^__HTTP_CODE__/ { code=$2 } END { print code }' "$output_file")"
            redirect_location="$(awk -F'__LOCATION__' '/^__LOCATION__/ { value=$2 } END { print value }' "$output_file")"
            content_type="$(awk -F'__CONTENT_TYPE__' '/^__CONTENT_TYPE__/ { value=$2 } END { print value }' "$output_file")"
            sed \
                -e '/^__HTTP_CODE__/d' \
                -e '/^__LOCATION__/d' \
                -e '/^__CONTENT_TYPE__/d' \
                "$output_file" >"$body_file"
            if [[ "$http_code" != "200" ]]; then
                failure_detail="ssh ${SSH_TARGET}: ${url} returned HTTP ${http_code:-unknown}"
                if [[ -n "$redirect_location" ]]; then
                    failure_detail="${failure_detail} location=${redirect_location}"
                fi
                if [[ -n "$content_type" ]]; then
                    failure_detail="${failure_detail} content_type=${content_type}"
                fi
                fail_check "$failure_detail"
            else
                while IFS=$'\t' read -r level message; do
                    [[ -z "${level:-}" ]] && continue
                    record_report_line "$level" "ssh ${SSH_TARGET}: ${message}"
                done < <(json_field_report "$body_file" "$endpoint")
            fi
        else
            fail_check "ssh ${SSH_TARGET}: remote curl failed for ${url}"
            sed 's/^/  /' "$error_file" >&2
        fi

        rm -f "$output_file" "$error_file" "$body_file"
    done
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env-file)
            [[ $# -ge 2 ]] || fail_usage "--env-file requires a path"
            ENV_FILES+=("$2")
            shift 2
            ;;
        --base-url)
            [[ $# -ge 2 ]] || fail_usage "--base-url requires a URL"
            BASE_URLS+=("$2")
            shift 2
            ;;
        --remote-base-url)
            [[ $# -ge 2 ]] || fail_usage "--remote-base-url requires a URL"
            REMOTE_BASE_URLS+=("$2")
            shift 2
            ;;
        --ssh-target)
            [[ $# -ge 2 ]] || fail_usage "--ssh-target requires user@host"
            SSH_TARGET="$2"
            shift 2
            ;;
        --ssh-key)
            [[ $# -ge 2 ]] || fail_usage "--ssh-key requires a path"
            SSH_KEY="$2"
            shift 2
            ;;
        --mode)
            [[ $# -ge 2 ]] || fail_usage "--mode requires isolated or replica-pool"
            MODE="$2"
            shift 2
            ;;
        --timeout)
            [[ $# -ge 2 ]] || fail_usage "--timeout requires seconds"
            TIMEOUT_SECONDS="$2"
            shift 2
            ;;
        --require-background-worker-role)
            REQUIRE_BACKGROUND_WORKER_ROLE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail_usage "unknown argument: $1"
            ;;
    esac
done

case "$MODE" in
    isolated|replica-pool) ;;
    *) fail_usage "--mode must be isolated or replica-pool" ;;
esac

REQUIRE_BACKGROUND_WORKER_ROLE="$(normalize_bool "$REQUIRE_BACKGROUND_WORKER_ROLE")"
is_positive_integer "$TIMEOUT_SECONDS" || fail_usage "--timeout must be a positive integer"

if [[ "${#REMOTE_BASE_URLS[@]}" -gt 0 && -z "$SSH_TARGET" ]]; then
    fail_usage "--remote-base-url requires --ssh-target"
fi
if [[ -n "$SSH_KEY" && -z "$SSH_TARGET" ]]; then
    fail_usage "--ssh-key requires --ssh-target"
fi
if [[ "${#ENV_FILES[@]}" -eq 0 && "${#BASE_URLS[@]}" -eq 0 && "${#REMOTE_BASE_URLS[@]}" -eq 0 ]]; then
    fail_usage "provide at least one --env-file, --base-url, or --remote-base-url"
fi

if [[ "${#REMOTE_BASE_URLS[@]}" -gt 0 ]]; then
    build_ssh_args
fi

info "first-cloud runtime safety mode: ${MODE}"

for env_file in "${ENV_FILES[@]}"; do
    check_env_file_basics "$env_file"
done

check_pairwise_contracts "$MODE"
if [[ "$MODE" == "replica-pool" ]]; then
    check_replica_pool_contract
fi

for base_url in "${BASE_URLS[@]}"; do
    check_live_base_url "$base_url"
done

for base_url in "${REMOTE_BASE_URLS[@]}"; do
    check_remote_live_base_url "$base_url"
done

printf '\nSummary: checks=%d warnings=%d failures=%d\n' "$CHECKS_RUN" "$WARNINGS" "$FAILURES"
if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
fi
exit 0
