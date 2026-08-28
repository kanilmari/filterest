#!/usr/bin/env bash
# filterest_port_preflight.sh
# Validates and safely retires occupied Filterest application-port listeners.
# Bridges installer/startup approval with captured process identity and ownership checks.
# Exists so stale or replaced processes cannot redirect shutdown signals to unrelated work.

filterest_configured_port() {
    local default_port="$1"
    shift
    local file=""
    local key=""
    local value=""

    for file in "$@"; do
        [[ -f "$file" ]] || continue
        for key in APP_PORT PORT EASELECT_PORT; do
            value="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d'=' -f2- || true)"
            if [[ -n "$value" ]]; then
                printf '%s' "$value"
                return 0
            fi
        done
    done
    printf '%s' "$default_port"
}

filterest_port_is_listening() {
    local port="$1"
    local listeners=""

    if command -v ss >/dev/null 2>&1; then
        if listeners="$(ss -H -ltn "sport = :${port}" 2>/dev/null)"; then
            [[ -n "$listeners" ]]
            return
        fi
    fi
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
        return
    fi
    if command -v fuser >/dev/null 2>&1; then
        fuser -n tcp "$port" >/dev/null 2>&1
        return
    fi

    printf 'error: cannot check Filterest port %s; install ss, lsof, or fuser\n' "$port" >&2
    return 2
}

filterest_port_listener_pids() {
    local port="$1"

    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | LC_ALL=C sort -nu
        return
    fi
    if command -v ss >/dev/null 2>&1; then
        ss -H -ltnp "sport = :${port}" 2>/dev/null \
            | grep -oE 'pid=[0-9]+' \
            | cut -d= -f2 \
            | LC_ALL=C sort -nu
        return
    fi
    if command -v fuser >/dev/null 2>&1; then
        fuser -n tcp "$port" 2>/dev/null \
            | tr ' ' '\n' \
            | grep -E '^[0-9]+$' \
            | LC_ALL=C sort -nu
        return
    fi
    return 2
}

filterest_print_listener_identity() {
    local pid="$1"
    local owner=""
    local command_name=""
    local executable=""

    owner="$(ps -o user= -p "$pid" 2>/dev/null | awk '{$1=$1; print}' || true)"
    command_name="$(ps -o comm= -p "$pid" 2>/dev/null | awk '{$1=$1; print}' || true)"
    executable="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
    printf '  PID %s | user %s | command %s' \
        "$pid" "${owner:-unknown}" "${command_name:-unknown}"
    if [[ -n "$executable" ]]; then
        printf ' | executable %s' "$executable"
    fi
    printf '\n'
}

filterest_listener_pids_are_owned_by_current_user() {
    local pids="$1"
    local current_uid=""
    local pid=""
    local process_uid=""
    current_uid="$(id -u)"

    for pid in $pids; do
        [[ "$pid" =~ ^[0-9]+$ ]] || continue
        process_uid="$(ps -o uid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
        if [[ -z "$process_uid" || "$process_uid" != "$current_uid" ]]; then
            return 1
        fi
    done
    return 0
}

# Prints the live process state and Linux start-time tick. The start-time tick
# stays stable for one process lifetime, so a reused PID cannot inherit an
# earlier listener's shutdown approval. A zombie is already operationally
# exited: it owns no descriptors and must never be signalled again.
filterest_process_identity() {
    local pid="$1"

    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    [[ -r "/proc/${pid}/stat" ]] || return 1
    sed 's/^.*) //' "/proc/${pid}/stat" 2>/dev/null \
        | awk '{ print $1 ":" $20 }'
}

filterest_process_identity_matches() {
    local pid="$1"
    local expected_start_time="$2"
    local current_identity=""

    current_identity="$(filterest_process_identity "$pid" || true)"
    [[ -n "$current_identity" ]] || return 1
    [[ "$current_identity" != Z:* ]] || return 1
    [[ "${current_identity#*:}" == "$expected_start_time" ]]
}

filterest_signal_captured_process() {
    local pid="$1"
    local signal_name="$2"
    local expected_start_time="$3"
    local expected_uid="$4"
    local expected_cwd="$5"
    local expected_executable="$6"
    local port="$7"
    local current_uid=""
    local current_cwd=""
    local current_executable=""

    # The captured process may have exited naturally. A changed start-time tick
    # means the PID was reused, and therefore must not be signalled.
    filterest_process_identity_matches "$pid" "$expected_start_time" || return 0

    current_uid="$(ps -o uid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
    current_cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    current_executable="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
    if [[ -z "$current_uid" || "$current_uid" != "$expected_uid" || \
          "$current_uid" != "$(id -u)" || -z "$current_cwd" || \
          "$current_cwd" != "$expected_cwd" || -z "$current_executable" || \
          "$current_executable" != "$expected_executable" ]]; then
        printf 'error: refusing to send %s to process %s on port %s because its owner, working directory, or executable changed after capture\n' \
            "$signal_name" "$pid" "$port" >&2
        return 1
    fi

    if ! kill "-${signal_name}" "$pid" 2>/dev/null; then
        filterest_process_identity_matches "$pid" "$expected_start_time" || return 0
        printf 'error: could not send %s to captured process %s on port %s\n' \
            "$signal_name" "$pid" "$port" >&2
        return 1
    fi
}

# The interactive port prompt must keep the exact pre-prompt process snapshot.
# Indexed globals are used deliberately because Bash 3.2 has no nameref support.
FILTEREST_PREFLIGHT_CAPTURED_PIDS=()
FILTEREST_PREFLIGHT_CAPTURED_START_TIMES=()
FILTEREST_PREFLIGHT_CAPTURED_UIDS=()
FILTEREST_PREFLIGHT_CAPTURED_CWDS=()
FILTEREST_PREFLIGHT_CAPTURED_EXECUTABLES=()

filterest_capture_interactive_listener_snapshot() {
    local port="$1"
    local pids="$2"
    local pid=""
    local identity=""
    local process_uid=""
    local process_cwd=""
    local process_executable=""
    local current_uid=""

    FILTEREST_PREFLIGHT_CAPTURED_PIDS=()
    FILTEREST_PREFLIGHT_CAPTURED_START_TIMES=()
    FILTEREST_PREFLIGHT_CAPTURED_UIDS=()
    FILTEREST_PREFLIGHT_CAPTURED_CWDS=()
    FILTEREST_PREFLIGHT_CAPTURED_EXECUTABLES=()
    current_uid="$(id -u)"

    for pid in $pids; do
        [[ "$pid" =~ ^[0-9]+$ ]] || continue
        identity="$(filterest_process_identity "$pid" || true)"
        process_uid="$(ps -o uid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
        process_cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
        process_executable="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
        if [[ -z "$identity" || "$identity" == Z:* || \
              -z "$process_uid" || "$process_uid" != "$current_uid" || \
              -z "$process_cwd" || -z "$process_executable" ]]; then
            printf 'error: refusing to offer shutdown for process %s on port %s because its identity could not be captured safely\n' \
                "$pid" "$port" >&2
            return 1
        fi
        FILTEREST_PREFLIGHT_CAPTURED_PIDS+=("$pid")
        FILTEREST_PREFLIGHT_CAPTURED_START_TIMES+=("${identity#*:}")
        FILTEREST_PREFLIGHT_CAPTURED_UIDS+=("$process_uid")
        FILTEREST_PREFLIGHT_CAPTURED_CWDS+=("$process_cwd")
        FILTEREST_PREFLIGHT_CAPTURED_EXECUTABLES+=("$process_executable")
    done
    [[ "${#FILTEREST_PREFLIGHT_CAPTURED_PIDS[@]}" -gt 0 ]]
}

filterest_stop_listener_pids() {
    local port="$1"
    local pids="$2"
    local continuation_message="${3:-Continuing Filterest startup.}"
    local expected_identities="${4:-}"
    local required_nested_cwd="${5:-}"
    local required_nested_executable="${6:-}"
    local required_legacy_executable="${7:-}"
    local required_legacy_cwd="${8:-$required_nested_cwd}"
    local use_interactive_snapshot="${9:-0}"
    local pid=""
    local pids_to_capture="$pids"
    local identity=""
    local identity_token=""
    local identity_payload=""
    local expected_start_time=""
    local expected_executable_kind=""
    local required_cwd=""
    local required_executable=""
    local process_uid=""
    local process_cwd=""
    local process_executable=""
    local current_uid=""
    local all_exited=0
    local index=0
    local attempt=0
    local listening_status=0
    local -a captured_pids=()
    local -a captured_start_times=()
    local -a captured_uids=()
    local -a captured_cwds=()
    local -a captured_executables=()

    current_uid="$(id -u)"
    if [[ "$use_interactive_snapshot" == "1" ]]; then
        captured_pids=("${FILTEREST_PREFLIGHT_CAPTURED_PIDS[@]}")
        captured_start_times=("${FILTEREST_PREFLIGHT_CAPTURED_START_TIMES[@]}")
        captured_uids=("${FILTEREST_PREFLIGHT_CAPTURED_UIDS[@]}")
        captured_cwds=("${FILTEREST_PREFLIGHT_CAPTURED_CWDS[@]}")
        captured_executables=("${FILTEREST_PREFLIGHT_CAPTURED_EXECUTABLES[@]}")
        pids_to_capture=""
    fi
    for pid in $pids_to_capture; do
        [[ "$pid" =~ ^[0-9]+$ ]] || continue
        identity="$(filterest_process_identity "$pid" || true)"
        [[ -n "$identity" && "$identity" != Z:* ]] || continue
        expected_start_time="${identity#*:}"
        expected_executable_kind=""
        if [[ -n "$expected_identities" ]]; then
            expected_start_time=""
            for identity_token in $expected_identities; do
                if [[ "${identity_token%%:*}" == "$pid" ]]; then
                    identity_payload="${identity_token#*:}"
                    expected_start_time="${identity_payload%%:*}"
                    if [[ "$identity_payload" == *:* ]]; then
                        expected_executable_kind="${identity_payload#*:}"
                    fi
                    break
                fi
            done
            if [[ -z "$expected_start_time" || \
                  "${identity#*:}" != "$expected_start_time" ]]; then
                printf 'error: refusing to stop port %s because captured process %s changed identity before shutdown\n' \
                    "$port" "$pid" >&2
                return 1
            fi
        fi

        process_uid="$(ps -o uid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
        process_cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
        process_executable="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
        required_cwd="$required_nested_cwd"
        required_executable="$required_nested_executable"
        if [[ "$expected_executable_kind" == "legacy" ]]; then
            required_cwd="$required_legacy_cwd"
            required_executable="$required_legacy_executable"
        elif [[ -n "$expected_executable_kind" && \
                "$expected_executable_kind" != "nested" ]]; then
            printf 'error: refusing to stop process %s on port %s because its captured executable class is invalid\n' \
                "$pid" "$port" >&2
            return 1
        fi
        if [[ -z "$process_uid" || "$process_uid" != "$current_uid" || \
              -z "$process_cwd" || -z "$process_executable" ]]; then
            printf 'error: refusing to stop process %s on port %s because its identity could not be captured safely\n' \
                "$pid" "$port" >&2
            return 1
        fi
        if [[ -n "$required_cwd" && "$process_cwd" != "$required_cwd" ]]; then
            printf 'error: refusing to stop stale process %s because its working directory is not %s\n' \
                "$pid" "$required_cwd" >&2
            return 1
        fi
        if [[ -n "$required_executable" && \
              "$process_executable" != "$required_executable" ]]; then
            printf 'error: refusing to stop stale process %s because its executable identity changed\n' \
                "$pid" >&2
            return 1
        fi

        captured_pids+=("$pid")
        captured_start_times+=("$expected_start_time")
        captured_uids+=("$process_uid")
        captured_cwds+=("$process_cwd")
        captured_executables+=("$process_executable")
    done

    for index in "${!captured_pids[@]}"; do
        filterest_signal_captured_process \
            "${captured_pids[$index]}" TERM \
            "${captured_start_times[$index]}" "${captured_uids[$index]}" \
            "${captured_cwds[$index]}" "${captured_executables[$index]}" \
            "$port" || return 1
    done

    while (( attempt < 100 )); do
        all_exited=1
        for index in "${!captured_pids[@]}"; do
            if filterest_process_identity_matches \
                "${captured_pids[$index]}" "${captured_start_times[$index]}"; then
                all_exited=0
                break
            fi
        done
        [[ "$all_exited" -eq 1 ]] && break
        sleep 0.1
        attempt=$((attempt + 1))
    done

    if [[ "$all_exited" -ne 1 ]]; then
        printf 'Process on port %s did not exit after SIGTERM; escalating only the captured process identity.\n' \
            "$port" >&2
        for index in "${!captured_pids[@]}"; do
            filterest_signal_captured_process \
                "${captured_pids[$index]}" KILL \
                "${captured_start_times[$index]}" "${captured_uids[$index]}" \
                "${captured_cwds[$index]}" "${captured_executables[$index]}" \
                "$port" || return 1
        done
        attempt=0
        while (( attempt < 50 )); do
            all_exited=1
            for index in "${!captured_pids[@]}"; do
                if filterest_process_identity_matches \
                    "${captured_pids[$index]}" "${captured_start_times[$index]}"; then
                    all_exited=0
                    break
                fi
            done
            [[ "$all_exited" -eq 1 ]] && break
            sleep 0.1
            attempt=$((attempt + 1))
        done
    fi

    if [[ "$all_exited" -ne 1 ]]; then
        printf 'error: captured process on port %s did not exit\n' "$port" >&2
        return 1
    fi

    listening_status=0
    filterest_port_is_listening "$port" || listening_status=$?
    case "$listening_status" in
        1)
            printf 'Port %s is free and the captured process exited. %s\n' \
                "$port" "$continuation_message"
            return 0
            ;;
        0)
            printf 'error: port %s acquired another listener while the captured process was stopping\n' \
                "$port" >&2
            return 1
            ;;
        *) return 1 ;;
    esac
}

# Retires only an owner-matching Filterest server whose executable was deleted
# from this checkout during replacement. This bridges refresh/install and the
# normal port preflight so an obsolete process cannot keep serving an old DB.
filterest_preflight_stale_checkout_listener() {
    local port="$1"
    local project_root="$2"
    local assume_yes="${3:-0}"
    local nested_cwd=""
    local legacy_cwd=""
    local nested_executable=""
    local legacy_executable=""
    local listener_pids=""
    local stale_pids=""
    local stale_identities=""
    local pid=""
    local executable=""
    local executable_kind=""
    local identity=""
    local expected_cwd=""
    local process_cwd=""
    local answer=""
    local listening_status=0

    filterest_port_is_listening "$port" || listening_status=$?
    case "$listening_status" in
        0) ;;
        1) return 0 ;;
        *) return 1 ;;
    esac

    if [[ -d "$project_root" ]]; then
        project_root="$(cd "$project_root" && pwd -P)"
    fi
    nested_cwd="${project_root%/}/app"
    legacy_cwd="$project_root"
    nested_executable="${project_root%/}/data/runtime/bin/filterest-server (deleted)"
    legacy_executable="${project_root%/}/runtime/bin/filterest-server (deleted)"
    listener_pids="$(filterest_port_listener_pids "$port" || true)"
    for pid in $listener_pids; do
        [[ "$pid" =~ ^[0-9]+$ ]] || continue
        executable="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
        executable_kind=""
        expected_cwd=""
        if [[ "$executable" == "$nested_executable" ]]; then
            executable_kind="nested"
            expected_cwd="$nested_cwd"
        elif [[ "$executable" == "$legacy_executable" ]]; then
            executable_kind="legacy"
            expected_cwd="$legacy_cwd"
        fi
        if [[ -n "$executable_kind" ]]; then
            identity="$(filterest_process_identity "$pid" || true)"
            [[ -n "$identity" && "$identity" != Z:* ]] || continue
            process_cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
            if [[ "$process_cwd" != "$expected_cwd" ]]; then
                printf 'error: refusing to stop obsolete process %s because its working directory does not match its Filterest executable layout\n' \
                    "$pid" >&2
                return 1
            fi
            stale_pids+="${stale_pids:+ }${pid}"
            stale_identities+="${stale_identities:+ }${pid}:${identity#*:}:${executable_kind}"
        fi
    done
    [[ -n "$stale_pids" ]] || return 0

    printf '\nFilterest found an obsolete server from this checkout on port %s.\n' "$port"
    for pid in $stale_pids; do
        filterest_print_listener_identity "$pid"
    done
    if ! filterest_listener_pids_are_owned_by_current_user "$stale_pids"; then
        printf 'error: Filterest will not stop a stale process owned by another user\n' >&2
        return 1
    fi

    if [[ "$assume_yes" != "1" ]]; then
        if [[ ! -t 0 ]]; then
            printf 'error: rerun setup with --yes or in an interactive terminal to replace the obsolete server\n' >&2
            return 1
        fi
        printf 'Stop the obsolete server before installation? [y/N] '
        read -r answer || answer=""
        case "$answer" in
            y|Y|yes|YES) ;;
            *)
                printf 'Filterest installation cancelled; the obsolete server was left unchanged.\n' >&2
                return 1
                ;;
        esac
    fi

    filterest_stop_listener_pids \
        "$port" "$stale_pids" "Continuing Filterest installation." \
        "$stale_identities" "$nested_cwd" \
        "$nested_executable" "$legacy_executable" "$legacy_cwd"
}

filterest_preflight_port() {
    local port="$1"
    local pids=""
    local index=0
    local answer=""
    local listening_status=0

    if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
        printf 'error: invalid Filterest application port: %s\n' "$port" >&2
        return 1
    fi
    filterest_port_is_listening "$port" || listening_status=$?
    case "$listening_status" in
        0) ;;
        1) return 0 ;;
        *) return 1 ;;
    esac

    pids="$(filterest_port_listener_pids "$port" || true)"
    if [[ -z "$pids" ]]; then
        printf 'error: the listening process could not be identified safely; stop it manually or choose another port\n' >&2
        return 1
    fi
    if ! filterest_capture_interactive_listener_snapshot "$port" "$pids"; then
        return 1
    fi
    printf '\nFilterest cannot start because application port %s is already in use.\n' "$port"
    for index in "${!FILTEREST_PREFLIGHT_CAPTURED_PIDS[@]}"; do
        printf '  PID %s | uid %s | cwd %s | executable %s\n' \
            "${FILTEREST_PREFLIGHT_CAPTURED_PIDS[$index]}" \
            "${FILTEREST_PREFLIGHT_CAPTURED_UIDS[$index]}" \
            "${FILTEREST_PREFLIGHT_CAPTURED_CWDS[$index]}" \
            "${FILTEREST_PREFLIGHT_CAPTURED_EXECUTABLES[$index]}"
    done

    if [[ ! -t 0 ]]; then
        printf 'error: run ./filterest start in an interactive terminal to approve freeing port %s\n' "$port" >&2
        return 1
    fi

    printf 'Stop the process(es) above and free port %s? [y/N] ' "$port"
    read -r answer || answer=""
    case "$answer" in
        y|Y|yes|YES)
            filterest_stop_listener_pids \
                "$port" "$pids" "Continuing Filterest startup." \
                "" "" "" "" "" 1
            ;;
        *)
            printf 'Filterest startup cancelled; port %s was left unchanged.\n' "$port" >&2
            return 1
            ;;
    esac
}
