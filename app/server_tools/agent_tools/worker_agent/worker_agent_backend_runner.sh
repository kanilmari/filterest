# ==============================================================================
# worker_agent_backend_runner.sh — Execute worker prompts against CLI backends.
#
# Shared helpers between worker_agent_core.sh dispatch logic and the external
# Codex / Claude CLIs that actually run the worker prompt.
# Keeps backend execution, billing checks, summary recovery, and background
# launch details out of the main CLI parsing flow.
# ==============================================================================

find_claude_bin() {
    if command -v claude &>/dev/null; then
        echo "claude"
        return 0
    fi
    # The Claude Code extension bundles the CLI. Desktop VS Code keeps it under
    # ~/.vscode, while Remote/WSL and Insiders builds use their own extension
    # roots, so every known root is scanned before the backend is declared missing.
    local -a ext_roots=(
        "$HOME/.vscode/extensions"
        "$HOME/.vscode-server/extensions"
        "$HOME/.vscode-insiders/extensions"
        "$HOME/.vscode-server-insiders/extensions"
    )
    local -a ext_candidates=()
    local ext_root ext_candidate
    for ext_root in "${ext_roots[@]}"; do
        for ext_candidate in "$ext_root"/anthropic.claude-code-*/resources/native-binary/claude; do
            if [[ -x "$ext_candidate" ]]; then
                ext_candidates+=("$ext_candidate")
            fi
        done
    done
    if (( ${#ext_candidates[@]} > 0 )); then
        # Version sort selects the newest build; a plain sort ranks 2.1.9 above 2.1.270.
        printf '%s\n' "${ext_candidates[@]}" | sort -V | tail -1
        return 0
    fi
    return 1
}

cleanup_worker_server() {
    if [[ -n "${WORKER_PORT:-}" ]] && fuser "${WORKER_PORT}/tcp" > /dev/null 2>&1; then
        fuser -k "${WORKER_PORT}/tcp" > /dev/null 2>&1 || true
    fi
}

# describe_write_access names what a run may change, in the same words for the
# status file, the log header and the finished-run report. It reads every flag
# with a default: this line is written from more than one context, and a run's
# record must never be truncated because one variable was not exported.
describe_write_access() {
    if [[ "${RESEARCH_MODE:-false}" == true && "${BACKEND:-codex}" == claude ]]; then
        printf 'none (read-only tools; the final message is the summary)'
    elif [[ "${RESEARCH_MODE:-false}" == true ]]; then
        printf 'none (read-only sandbox; the final message is the summary)'
    elif [[ "${FULL_ACCESS:-false}" == true ]]; then
        printf 'full (workspace, database and network)'
    else
        printf 'workspace only (no database, no network)'
    fi
}

# describe_billing names who pays for a run, in the same words for the progress
# file, the log and the terminal. Like describe_write_access it reads every
# value with a default; a missing mode reads as the subscription, which is also
# what billing_env enforces when the mode is missing.
describe_billing() {
    local checked="${BILLING_ACCOUNT:-not checked yet}"
    if [[ "${BILLING_MODE:-subscription}" == api ]]; then
        printf 'api (explicit --api; environment kept; %s)' "$checked"
    else
        printf 'subscription (%s; API key variables removed)' "$checked"
    fi
}

# billing_env runs a backend command with the environment its billing allows
# (owner decision K174). A subscription run drops every variable through which
# the Codex or Claude CLI would bill an API account or a cloud provider instead
# of the signed-in subscription; an --api run keeps the caller's environment as
# it is. Only names are handled here: no value is read or printed.
billing_env() {
    if [[ "${BILLING_MODE:-subscription}" == api ]]; then
        "$@"
        return
    fi
    env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
        -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX \
        -u OPENAI_API_KEY -u CODEX_API_KEY "$@"
}

write_run_status() {
    local status="$1"
    local exit_code="${2:-}"
    local elapsed="${3:-}"

    {
        printf 'task_id=%s\n' "$TASK_ID"
        printf 'status=%s\n' "$status"
        printf 'backend=%s\n' "$BACKEND"
        printf 'research_mode=%s\n' "$RESEARCH_MODE"
        # What this run was allowed to change, so a later reader does not have
        # to reconstruct it from the flags someone typed.
        printf 'write_access=%s\n' "$(describe_write_access)"
        # Who pays for the run: the signed-in subscription or an API key.
        printf 'billing_mode=%s\n' "${BILLING_MODE:-subscription}"
        # A detached run's own process group, which --stop signals as a whole,
        # and its leader's start time, which identifies the group.
        if [[ -n "${WORKER_PROCESS_GROUP:-}" ]]; then
            printf 'process_group=%s\n' "$WORKER_PROCESS_GROUP"
            printf 'process_group_leader_start=%s\n' "${WORKER_PROCESS_GROUP_START:-}"
        fi
        if [[ -n "${CODEX_ACTUAL_VERSION:-}" ]]; then
            printf 'codex_executable=%s\n' "$CODEX_BIN"
            printf 'codex_version=%s\n' "$CODEX_ACTUAL_VERSION"
            printf 'codex_model_requested=%s\n' "${CODEX_MODEL:-Codex config default}"
            printf 'codex_reasoning_effort_requested=%s\n' "${CODEX_REASONING_EFFORT:-Codex config default}"
        fi
        if [[ -n "${TICKET_FILE:-}" ]]; then
            printf 'ticket_file=%s\n' "$TICKET_FILE"
        else
            printf 'ticket_file=n/a\n'
        fi
        if [[ -n "$exit_code" ]]; then
            printf 'exit_code=%s\n' "$exit_code"
        fi
        if [[ -n "$elapsed" ]]; then
            printf 'elapsed_seconds=%s\n' "$elapsed"
        fi
        printf 'summary_file=%s\n' "$(basename "$SUMMARY_FILE")"
        printf 'log_file=%s\n' "$(basename "$LOG_FILE")"
        printf 'progress_file=%s\n' "$(basename "$PROGRESS_FILE")"
    } > "$RUN_STATUS_FILE"
}

write_progress_snapshot() {
    local status="$1"
    local exit_code="${2:-}"
    local elapsed="${3:-}"

    {
        printf '# Worker Run Progress\n\n'
        printf -- '- Task ID: %s\n' "$TASK_ID"
        printf -- '- Status: %s\n' "$status"
        printf -- '- Backend: %s\n' "$BACKEND"
        printf -- '- Research mode: %s\n' "$RESEARCH_MODE"
        printf -- '- Write access: %s\n' "$(describe_write_access)"
        printf -- '- Billing: %s\n' "$(describe_billing)"
        if [[ -n "$exit_code" ]]; then
            printf -- '- Exit code: %s\n' "$exit_code"
        fi
        if [[ -n "$elapsed" ]]; then
            printf -- '- Elapsed seconds: %s\n' "$elapsed"
        fi
        printf -- '- Prompt file: %s\n' "$(basename "$PROMPT_SAVE_FILE")"
        printf -- '- Summary file: %s\n' "$(basename "$SUMMARY_FILE")"
        printf -- '- Log file: %s\n' "$(basename "$LOG_FILE")"
        printf -- '- Updated: %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    } > "$PROGRESS_FILE"
}

recover_summary_from_log() {
    [[ -f "$SUMMARY_FILE" ]] && return 0
    [[ -f "$LOG_FILE" ]] || return 1

    local temp_summary
    temp_summary=$(mktemp)
    local helper_script="$SCRIPT_DIR/extract_worker_summary.py"
    if python3 "$helper_script" "$LOG_FILE" > "$temp_summary"; then
        if [[ -s "$temp_summary" ]]; then
            mv "$temp_summary" "$SUMMARY_FILE"
            return 0
        fi
    fi
    rm -f "$temp_summary"
    return 1
}

write_sentinel() {
    local exit_code="$1"
    local elapsed="${2:-0}"
    [[ -f "$SUMMARY_FILE" ]] || recover_summary_from_log || true
    local summary_exists="no"
    [[ -f "$SUMMARY_FILE" ]] && summary_exists="yes"
    printf "%d\t%d\t%s\n" "$exit_code" "$elapsed" "$summary_exists" > "$DONE_FILE"
    if (( exit_code == 0 )); then
        write_progress_snapshot "succeeded" "$exit_code" "$elapsed"
        write_run_status "succeeded" "$exit_code" "$elapsed"
    else
        write_progress_snapshot "failed" "$exit_code" "$elapsed"
        write_run_status "failed" "$exit_code" "$elapsed"
    fi
    cleanup_worker_server
}

finalize_run() {
    if [[ "${FINALIZER_WRITE_SENTINEL:-true}" == "true" ]] \
        && [[ -n "${OUTPUT_DIR:-}" ]] \
        && [[ -n "${TASK_ID:-}" ]]; then
        local done_file="$OUTPUT_DIR/.worker_done_${TASK_ID}"
        if [[ ! -f "$done_file" ]]; then
            write_sentinel 1 0
        fi
    fi
    cleanup_worker_server
}

# Resolve once before dispatch so foreground and detached runs use the same
# installed tool. Never repair a missing installation by fetching a package.
prepare_codex_backend() {
    local executable version_output
    executable=$(type -P -- "$CODEX_BIN") || {
        err "Codex executable not found: $CODEX_BIN. Install @openai/codex@$CODEX_REQUIRED_VERSION and authenticate first."
        return 127
    }
    CODEX_BIN=$(realpath -e -- "$executable") || return 127
    if ! version_output=$("$CODEX_BIN" --version 2>&1); then
        err "Cannot read Codex version from $CODEX_BIN: $version_output"
        return 1
    fi
    if [[ "$version_output" != "codex-cli $CODEX_REQUIRED_VERSION" ]]; then
        err "Codex version mismatch: expected codex-cli $CODEX_REQUIRED_VERSION; got $version_output. No worker was started."
        return 1
    fi
    CODEX_ACTUAL_VERSION="$CODEX_REQUIRED_VERSION"
    write_run_status "running"
}

# A subscription run is checked under the same reduced environment it will run
# with, so the answer describes the account the run will really use. Both
# status commands are local account checks, never model requests.
verify_codex_subscription() {
    local login_output="" login_exit=0
    # `codex login status` answers on stderr; both streams are read, neither printed.
    login_output=$(billing_env timeout 20 "$CODEX_BIN" login status 2>&1 < /dev/null) || login_exit=$?
    if (( login_exit == 0 )) && grep -qxE 'Logged in using ChatGPT[[:space:]]*' <<< "$login_output"; then
        BILLING_ACCOUNT="Codex signed in using ChatGPT"
        return 0
    fi
    if (( login_exit == 124 )); then
        err "Codex did not report its sign-in within 20 s (codex login status)."
    elif grep -qi 'api key' <<< "$login_output"; then
        err "Codex is signed in with an API key, not with a ChatGPT subscription."
    else
        err "Codex is not signed in with a ChatGPT subscription."
    fi
    err "Sign in with 'codex login' (ChatGPT), or pass --api to bill an API key deliberately. No worker was started."
    return 1
}

verify_claude_subscription() {
    CLAUDE_BIN=$(find_claude_bin) || {
        err "Claude CLI not found on PATH or in a Claude Code VS Code extension. No worker was started."
        return 127
    }
    local status_json="" status_exit=0 sign_in=""
    status_json=$(billing_env env -u CLAUDECODE timeout 20 "$CLAUDE_BIN" auth status --json \
        2>/dev/null < /dev/null) || status_exit=$?
    # Only the sign-in method and provider are read; e-mail and organisation are not.
    sign_in=$(python3 -c '
import json, re, sys
try:
    status = json.loads(sys.stdin.read())
except ValueError:
    status = {}
if not isinstance(status, dict) or status.get("loggedIn") is not True:
    print("none")
    raise SystemExit
def name(value):
    return re.sub(r"[^A-Za-z0-9._-]", "", str(value))[:40] or "unknown"
method = name(status.get("authMethod") or "")
provider = name(status.get("apiProvider") or "firstParty")
print(method if provider == "firstParty" else method + " via " + provider)
' <<< "$status_json") || sign_in="unreadable"
    if (( status_exit == 0 )) && [[ "$sign_in" == "claude.ai" ]]; then
        BILLING_ACCOUNT="Claude signed in with claude.ai"
        return 0
    fi
    if (( status_exit == 124 )); then
        err "Claude CLI did not report its sign-in within 20 s ($CLAUDE_BIN auth status)."
    else
        err "Claude CLI is not signed in with a claude.ai subscription (sign-in: $sign_in)."
    fi
    err "Sign in with '$CLAUDE_BIN auth login --claudeai', or pass --api to bill an API key deliberately. No worker was started."
    return 1
}

# An --api run must find a key for its backend: without one the CLI would
# quietly bill its signed-in subscription while the run's record said API.
# Only variable names are checked and printed, never values.
verify_api_key_present() {
    local backend_name="$1"
    local -a key_variables=()
    case "$backend_name" in
        codex)  key_variables=(OPENAI_API_KEY CODEX_API_KEY) ;;
        claude) key_variables=(ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX) ;;
    esac
    local name="" expected="" present=""
    for name in "${key_variables[@]}"; do
        expected+="${expected:+, }$name"
        if [[ -n "${!name:-}" ]]; then
            present+="${present:+, }$name"
        fi
    done
    if [[ -z "$present" ]]; then
        err "--api needs one of $expected for $backend_name, and none is set. Set one, or leave out --api to bill the signed-in subscription. No worker was started."
        return 1
    fi
    BILLING_ACCOUNT="$present set"
}

# verify_billing refuses a run whose billing is not the one it asked for before
# anything is launched. Neither mode ever falls back to the other.
verify_billing() {
    local backend_name="$1"
    BILLING_ACCOUNT=""
    if [[ "${BILLING_MODE:-subscription}" == api ]]; then
        verify_api_key_present "$backend_name"
        return
    fi
    case "$backend_name" in
        codex)  verify_codex_subscription ;;
        claude) verify_claude_subscription ;;
    esac
}

run_codex_exec() {
    # Research mode runs in Codex's read-only sandbox, which refuses every
    # write, the worker's own summary file included (2026-09-20). Codex itself
    # therefore saves the worker's final message as the summary file.
    local sandbox_mode="workspace-write"
    local -a summary_args=()
    if [[ "$RESEARCH_MODE" == true ]]; then
        sandbox_mode="read-only"
        summary_args=(--last-message-file "$SUMMARY_FILE")
    elif [[ "$FULL_ACCESS" == true ]]; then
        sandbox_mode="danger-full-access"
    fi
    # The shared engine module owns the Codex argument list, as it does for the
    # chat's coding-agent runner; this launcher keeps only its own run features.
    local -a codex_args=()
    local engine_output
    # Model IDs and efforts are validated to single tokens, so one per line is exact.
    if ! engine_output="$(python3 "$CODEX_ENGINE_MODULE" worker-arguments --sandbox "$sandbox_mode" \
        --model "$CODEX_MODEL" --reasoning-effort "$CODEX_REASONING_EFFORT" "${summary_args[@]}" | tr '\0' '\n'
        exit "${PIPESTATUS[0]}")"; then
        printf 'Worker Codex arguments were refused by the engine module.\n' >> "$LOG_FILE"
        return 2
    fi
    mapfile -t codex_args <<< "$engine_output"
    {
        printf 'Worker Codex executable: %s\n' "$CODEX_BIN"
        printf 'Worker Codex version: %s\n' "$CODEX_ACTUAL_VERSION"
        printf 'Worker Codex model requested: %s\n' "${CODEX_MODEL:-Codex config default}"
        printf 'Worker Codex reasoning effort requested: %s\n' "${CODEX_REASONING_EFFORT:-Codex config default}"
        printf 'Worker billing: %s\n' "$(describe_billing)"
    } >> "$LOG_FILE"
    # stdin preserves multiline/large prompts and cannot turn prompt text into flags;
    # the engine's argument list already ends with "-".
    billing_env "$CODEX_BIN" "${codex_args[@]}" < "$PROMPT_SAVE_FILE" >> "$LOG_FILE" 2>&1
    local status=$?
    # An empty final message is no summary; recovery from the log may still find one.
    if [[ "$RESEARCH_MODE" == true && ! -s "$SUMMARY_FILE" ]]; then
        rm -f "$SUMMARY_FILE"
    fi
    return $status
}

run_claude_exec() {
    CLAUDE_BIN=$(find_claude_bin) || return 127
    printf 'Worker billing: %s\n' "$(describe_billing)" >> "$LOG_FILE"
    local -a claude_args=(--print --model "$CLAUDE_MODEL" --permission-mode bypassPermissions --no-session-persistence)
    # Ignore inherited CLAUDECODE overrides so worker_agent controls the binary path explicitly.
    if [[ "$RESEARCH_MODE" == true ]]; then
        # Research mode offers only tools that read. As with Codex, the final
        # message (printed on stdout) becomes the summary file, and the log keeps a copy.
        billing_env env -u CLAUDECODE "$CLAUDE_BIN" "${claude_args[@]}" --tools "Read,Grep,Glob" \
            < "$PROMPT_SAVE_FILE" > "$SUMMARY_FILE" 2>> "$LOG_FILE"
        local status=$?
        cat "$SUMMARY_FILE" >> "$LOG_FILE" 2>/dev/null
        [[ -s "$SUMMARY_FILE" ]] || rm -f "$SUMMARY_FILE"
        return $status
    fi
    billing_env env -u CLAUDECODE "$CLAUDE_BIN" "${claude_args[@]}" \
        < "$PROMPT_SAVE_FILE" >> "$LOG_FILE" 2>&1
    return $?
}

check_quota_error() {
    # The launcher's own "Worker billing:" line names billing in every log; only
    # the backend's output may count as a quota or billing failure.
    awk '/^Worker billing: / { next }
        tolower($0) ~ /quota exceeded|rate.limit|insufficient_quota|billing/ { found = 1; exit }
        END { exit !found }' "$LOG_FILE" 2>/dev/null
}

print_summary() {
    if [[ -f "$SUMMARY_FILE" ]]; then
        echo "" >&2
        printf "${BOLD}=== WORKER SUMMARY ($TASK_ID) ===${NC}\n" >&2
        cat "$SUMMARY_FILE" >&2
        printf "${BOLD}=== END SUMMARY ===${NC}\n" >&2
        echo "" >&2
        info "Full log: $LOG_FILE"
    else
        warn "Summary file not created. Attempting extraction from log..."
        if [[ -f "$LOG_FILE" ]]; then
            local extracted
            extracted=$(tail -80 "$LOG_FILE" | grep -A 999 '^```md\|^# \|^## ' | head -80)
            if [[ -n "$extracted" ]]; then
                echo "$extracted" > "$SUMMARY_FILE"
                printf "${BOLD}=== WORKER SUMMARY ($TASK_ID, extracted) ===${NC}\n" >&2
                cat "$SUMMARY_FILE" >&2
                printf "${BOLD}=== END SUMMARY ===${NC}\n" >&2
                info "Full log: $LOG_FILE"
            else
                err "Could not extract summary from log."
                echo "Last 30 lines of log:" >&2
                tail -30 "$LOG_FILE" 2>/dev/null >&2 || echo "(no log)" >&2
            fi
        fi
    fi
}

run_foreground() {
    local run_fn="$1"
    local backend_name="${2:-unknown}"
    "$run_fn" &
    local worker_pid=$!
    local seconds_elapsed=0
    local log_lines=0
    local minute_had_activity=0
    local previous_signature=""
    previous_signature=$(progress_artifact_signature "$LOG_FILE" "$SUMMARY_FILE" "$RUN_STATUS_FILE" "$PROGRESS_FILE" "$DONE_FILE")
    printf "Worker [%s] running\n" "$TASK_ID" >&2
    progress_print_minute_header 0 2
    while kill -0 "$worker_pid" 2>/dev/null; do
        sleep 5
        seconds_elapsed=$((seconds_elapsed + 5))
        local current_signature=""
        current_signature=$(progress_artifact_signature "$LOG_FILE" "$SUMMARY_FILE" "$RUN_STATUS_FILE" "$PROGRESS_FILE" "$DONE_FILE")
        local progress_marker=":"
        progress_marker=$(progress_poll_marker "$current_signature" "$previous_signature")
        if [[ "$current_signature" != "$previous_signature" ]]; then
            minute_had_activity=1
            previous_signature="$current_signature"
        fi
        printf "%s" "$progress_marker" >&2
        local idle_seconds=0
        if [[ -f "$LOG_FILE" ]]; then
            local log_mtime now
            log_mtime=$(stat -c %Y "$LOG_FILE" 2>/dev/null || echo 0)
            now=$(date +%s)
            idle_seconds=$(( now - log_mtime ))
            log_lines=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
        fi
        if (( PROGRESS_MARKER_SECONDS > 0 )) && (( seconds_elapsed % PROGRESS_MARKER_SECONDS == 0 )); then
            local progress_label
            progress_label=$(progress_elapsed_label "$seconds_elapsed")
            if (( idle_seconds > 60 )); then
                if [[ "$backend_name" == "claude" ]]; then
                    printf " (%s s, buffered) " "$progress_label" >&2
                else
                    printf " (%s s, %d lines, idle %ds⚠) " "$progress_label" "$log_lines" "$idle_seconds" >&2
                fi
            else
                printf " (%s s, %d lines) " "$progress_label" "$log_lines" >&2
            fi
        fi
        if progress_maybe_wrap_minute "$seconds_elapsed" "$minute_had_activity" 2; then
            minute_had_activity=0
        fi
    done
    wait "$worker_pid" && WORKER_EXIT=0 || WORKER_EXIT=$?
    [[ -f "$LOG_FILE" ]] && log_lines=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
    printf " done (%ds, %d lines, exit %d)\n" "$seconds_elapsed" "$log_lines" "$WORKER_EXIT" >&2
    write_sentinel "$WORKER_EXIT" "$seconds_elapsed"
    return "$WORKER_EXIT"
}

background_child_main() {
    local run_fn="$1"
    # A signal ends the run once its failure is recorded. Finalizing alone let
    # the script carry on, so a run stopped at the wrong moment could still
    # start its backend afterwards.
    trap 'finalize_run' EXIT
    trap 'finalize_run; exit 1' INT TERM HUP
    # The run must lead its own session and process group: that group is what
    # --stop signals as a whole, and its id is this pid. Fields after the
    # command name: 0 state, 1 parent, 2 group, 3 session, 19 start time.
    local own_pid="$BASHPID" own_stat=""
    local -a own_fields=()
    own_stat=$(cat "/proc/$own_pid/stat" 2>/dev/null) || own_stat=""
    read -r -a own_fields <<< "${own_stat##*) }"
    if [[ "${own_fields[2]:-}" != "$own_pid" || "${own_fields[3]:-}" != "$own_pid" || -z "${own_fields[19]:-}" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent run does not lead its own process group; the run did not start" >> "$LOG_FILE"
        exit 1
    fi
    # A run whose result is already recorded (a stale check or --stop gave up on
    # an unconfirmed launch) must not start its backend afterwards.
    if [[ -e "$DONE_FILE" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent run already has a recorded result; the run did not start" >> "$LOG_FILE"
        exit 1
    fi
    WORKER_PROCESS_GROUP="$own_pid"
    # --stop confirms the group by this start time before every signal.
    WORKER_PROCESS_GROUP_START="${own_fields[19]}"
    # Recorded before worker.pid appears, so --stop finds the group from the
    # moment the launch is confirmed.
    write_run_status "running"
    # The launcher confirms the start through worker.pid, so a run that cannot
    # publish it must not start at all.
    if ! { echo "$own_pid" > "$PID_FILE"; } 2>/dev/null; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent could not write worker.pid; the run did not start" >> "$LOG_FILE"
        exit 1
    fi

    local worker_exit=0
    "$run_fn" && worker_exit=0 || worker_exit=$?
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent finished (exit: $worker_exit)" >> "$LOG_FILE"
    write_sentinel "$worker_exit" "0"
}

# read_done_exit_code prints the run's recorded exit code once its done sentinel
# holds a complete line, and nothing before that.
read_done_exit_code() {
    local exit_code="" rest=""
    if [[ -f "$DONE_FILE" ]] && IFS=$'\t' read -r exit_code rest < "$DONE_FILE" 2>/dev/null \
        && [[ "$exit_code" =~ ^[0-9]+$ ]]; then
        printf '%s' "$exit_code"
    fi
    return 0
}

# wait_for_background_start confirms that a detached run really began before the
# launcher says so (WL33). A run's first act is to write worker.pid, so a start
# counts once that file names a live process, or once the run's done sentinel
# records a success. A recorded failure, or a run that died without a result,
# is a failed launch. With neither within the wait, the start is unconfirmed:
# the run may still start, so nothing is signalled and no result is recorded.
wait_for_background_start() {
    local wait_seconds="${LAUNCH_WAIT_SECONDS:-15}"
    [[ "$wait_seconds" =~ ^[0-9]+$ ]] || wait_seconds=15
    local polls_left=$(( wait_seconds * 5 ))
    local pid_state="" done_exit=""
    BACKGROUND_WORKER_PID=""
    BACKGROUND_START_PROBLEM=""
    BACKGROUND_START_EXIT=1
    BACKGROUND_ALREADY_SUCCEEDED=false
    BACKGROUND_START_UNCONFIRMED=false
    while true; do
        pid_state=$(status_pid_state "$PID_FILE")
        BACKGROUND_WORKER_PID=$(read_worker_pid_from_file "$PID_FILE" || true)
        # Read after the pid's state: the sentinel is written before the run's
        # process ends, so a finished run never looks as if it died silently.
        done_exit=$(read_done_exit_code)
        if [[ "$done_exit" == 0 ]]; then
            BACKGROUND_ALREADY_SUCCEEDED=true
            return 0
        elif [[ -n "$done_exit" ]]; then
            BACKGROUND_START_EXIT="$done_exit"
            BACKGROUND_START_PROBLEM="Worker run failed (exit $done_exit) before its launch was confirmed"
            return 1
        elif [[ "$pid_state" == alive ]]; then
            return 0
        elif [[ "$pid_state" == dead ]]; then
            BACKGROUND_START_PROBLEM="Worker did not start: worker process $BACKGROUND_WORKER_PID exited without recording a result"
            return 1
        elif (( polls_left == 0 )); then
            BACKGROUND_START_UNCONFIRMED=true
            BACKGROUND_START_PROBLEM="Start not confirmed within ${wait_seconds} s — the run may still start; check ./worker_agent --status $TASK_ID, stop it with ./worker_agent --stop $TASK_ID"
            return 1
        fi
        polls_left=$(( polls_left - 1 ))
        sleep 0.2
    done
}

run_background() {
    local run_fn="$1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent background launch — running: $run_fn" > "$LOG_FILE"

    export WORKSPACE_ROOT SCRIPT_DIR TASK_ID OUTPUT_DIR SUMMARY_FILE LOG_FILE DONE_FILE RUN_STATUS_FILE
    export PROGRESS_FILE PID_FILE PROMPT_SAVE_FILE FULL_ACCESS RESEARCH_MODE BACKEND TICKET_FILE
    export CLAUDE_MODEL FINALIZER_WRITE_SENTINEL BILLING_MODE BILLING_ACCOUNT
    export CODEX_BIN CODEX_ACTUAL_VERSION CODEX_MODEL CODEX_REASONING_EFFORT CODEX_ENGINE_MODULE
    export RUN_FN="$run_fn"
    export -f \
        describe_write_access \
        describe_billing \
        billing_env \
        find_claude_bin \
        run_codex_exec \
        run_claude_exec \
        recover_summary_from_log \
        write_run_status \
        write_progress_snapshot \
        cleanup_worker_server \
        write_sentinel \
        finalize_run \
        background_child_main

    # setsid makes the run the leader of its own session and process group (the
    # core refuses --background without it), which --stop signals as a whole.
    # Preserve the caller's resolved PATH. A login shell can replace it and
    # hide a selected local Codex/Claude executable after dispatch.
    nohup setsid bash -c 'background_child_main "$RUN_FN"' >/dev/null 2>&1 < /dev/null &

    FINALIZER_WRITE_SENTINEL=false
    disown || true
    if ! wait_for_background_start; then
        if [[ "$BACKGROUND_START_UNCONFIRMED" == true ]]; then
            # The run may still start, so nothing is signalled and no result is
            # recorded. The marker is appended, never rewritten: a run starting at
            # this moment may just have recorded its process group in this file.
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent launch_unconfirmed: $BACKGROUND_START_PROBLEM" >> "$LOG_FILE"
            echo "launch_unconfirmed=no worker.pid within ${LAUNCH_WAIT_SECONDS:-15} s" >> "$RUN_STATUS_FILE"
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent background launch failed: $BACKGROUND_START_PROBLEM" >> "$LOG_FILE"
            # A run that recorded no result of its own is recorded as failed here.
            FINALIZER_WRITE_SENTINEL=true
        fi
        err "$BACKGROUND_START_PROBLEM."
        err "Log file: $LOG_FILE"
        return "$BACKGROUND_START_EXIT"
    fi
    if [[ "$BACKGROUND_ALREADY_SUCCEEDED" == true ]]; then
        ok "Worker ran in background and has already finished successfully${BACKGROUND_WORKER_PID:+ (PID: $BACKGROUND_WORKER_PID)}"
    else
        ok "Worker launched in background (PID: $BACKGROUND_WORKER_PID)"
    fi
    ok "Log file: $LOG_FILE"
    info "Check status: ./worker_agent --status $TASK_ID"
    info "Wait for it:  ./worker_agent --wait $TASK_ID"
}

show_backend_info() {
    local backend_name="$1"

    case "$backend_name" in
        claude)
            CLAUDE_BIN=$(find_claude_bin 2>/dev/null) || CLAUDE_BIN="(will resolve at runtime)"
            local claude_label="$CLAUDE_MODEL"
            if [[ "$RESEARCH_MODE" == true ]]; then
                claude_label="${claude_label} — research mode, read-only tools"
            fi
            info "Backend: Claude CLI ($claude_label)"
            ;;
        codex)
            local access_label="workspace-write sandbox"
            if [[ "$FULL_ACCESS" == true ]]; then
                access_label="full-access sandbox"
            fi
            if [[ "$RESEARCH_MODE" == true ]]; then
                access_label="read-only sandbox — research mode"
            fi
            info "Backend: Codex CLI ($access_label)"
            info "Codex executable: $CODEX_BIN ($CODEX_ACTUAL_VERSION)"
            info "Codex model requested: ${CODEX_MODEL:-Codex config default}"
            info "Codex reasoning effort requested: ${CODEX_REASONING_EFFORT:-Codex config default}"
            ;;
    esac
    info "Billing: $(describe_billing)"
}

execute_with_backend() {
    local backend_name="$1"
    local run_fn=""

    case "$backend_name" in
        claude) run_fn="run_claude_exec" ;;
        codex)
            prepare_codex_backend || return $?
            run_fn="run_codex_exec"
            ;;
        *)
            err "Unknown backend: $backend_name"
            return 1
            ;;
    esac

    verify_billing "$backend_name" || return $?
    # The progress file now names the verified account instead of "not checked yet".
    write_progress_snapshot "running"
    show_backend_info "$backend_name"
    if [[ "$BACKGROUND" == true ]]; then
        run_background "$run_fn"
    else
        run_foreground "$run_fn" "$backend_name"
    fi
}

execute_auto_backend() {
    CLAUDE_BIN=$(find_claude_bin 2>/dev/null) || CLAUDE_BIN=""
    if [[ -n "$CLAUDE_BIN" ]]; then
        info "Auto mode: trying Claude first..."
        execute_with_backend claude
        if [[ "$BACKGROUND" == true ]]; then
            return 0
        fi
        if (( WORKER_EXIT != 0 )) && check_quota_error; then
            warn "Claude quota exceeded — falling back to Codex..."
            rm -f "$SUMMARY_FILE" "$LOG_FILE" "$DONE_FILE"
            execute_with_backend codex
            if (( WORKER_EXIT != 0 )) && check_quota_error; then
                err "Both Claude and Codex quota exceeded. No backend available."
                exit 1
            fi
        fi
        print_summary
        return 0
    fi

    info "Auto mode: Claude CLI not found, using Codex..."
    execute_with_backend codex
    if [[ "$BACKGROUND" != true ]]; then
        print_summary
    fi
}

run_selected_backend() {
    case "$BACKEND" in
        claude)
            execute_with_backend claude
            if [[ "$BACKGROUND" != true ]]; then
                print_summary
            fi
            ;;
        codex)
            execute_with_backend codex
            if [[ "$BACKGROUND" != true ]]; then
                print_summary
            fi
            ;;
        auto)
            execute_auto_backend
            ;;
        *)
            err "Unknown backend: $BACKEND"
            err "Supported: claude, codex, auto"
            err "Use family=claude|codex|auto or set WORKER_AGENT_BACKEND"
            exit 1
            ;;
    esac
}
