# ==============================================================================
# worker_agent_backend_runner.sh — Execute worker prompts against CLI backends.
#
# Shared helpers between worker_agent_core.sh dispatch logic and the external
# Codex / Claude CLIs that actually run the worker prompt.
# Keeps backend execution, summary recovery, and background launch details out
# of the main CLI parsing flow.
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
    if [[ "${RESEARCH_MODE:-false}" == true ]]; then
        printf 'forbidden by instruction; sandbox still permits workspace writes'
    elif [[ "${FULL_ACCESS:-false}" == true ]]; then
        printf 'full (workspace, database and network)'
    else
        printf 'workspace only (no database, no network)'
    fi
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

run_codex_exec() {
    # Research mode forbids writing through the prompt and keeps the worker out
    # of the database and network through the sandbox. It is not yet a hard
    # restriction, and the record says so rather than implying otherwise.
    #
    # Codex does have a read-only sandbox, and it works: a run under it was
    # refused with "Read-only file system" on 2026-09-20. It was also refused
    # when writing its own summary, which is the only way a worker returns
    # anything, and --add-dir does not open a hole in it. Turning it on
    # therefore needs the summary to arrive another way first. Recorded as a
    # maintenance finding rather than decided here.
    local sandbox_mode="workspace-write"
    if [[ "$FULL_ACCESS" == true && "$RESEARCH_MODE" != true ]]; then
        sandbox_mode="danger-full-access"
    fi
    # The shared engine module owns the Codex argument list, as it does for the
    # chat's coding-agent runner; this launcher keeps only its own run features.
    local -a codex_args=()
    local engine_output
    # Model IDs and efforts are validated to single tokens, so one per line is exact.
    if ! engine_output="$(python3 "$CODEX_ENGINE_MODULE" worker-arguments --sandbox "$sandbox_mode" \
        --model "$CODEX_MODEL" --reasoning-effort "$CODEX_REASONING_EFFORT" | tr '\0' '\n'
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
    } >> "$LOG_FILE"
    # stdin preserves multiline/large prompts and cannot turn prompt text into flags;
    # the engine's argument list already ends with "-".
    "$CODEX_BIN" "${codex_args[@]}" < "$PROMPT_SAVE_FILE" >> "$LOG_FILE" 2>&1
    return $?
}

run_claude_exec() {
    CLAUDE_BIN=$(find_claude_bin) || return 127
    # Ignore inherited CLAUDECODE overrides so worker_agent controls the binary path explicitly.
    env -u CLAUDECODE "$CLAUDE_BIN" \
        --print \
        --model "$CLAUDE_MODEL" \
        --permission-mode bypassPermissions \
        --no-session-persistence \
        < "$PROMPT_SAVE_FILE" >> "$LOG_FILE" 2>&1
    return $?
}

check_quota_error() {
    grep -qiE "quota exceeded|rate.limit|insufficient_quota|billing" "$LOG_FILE" 2>/dev/null
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
    trap 'finalize_run' EXIT INT TERM HUP
    echo "$BASHPID" > "$PID_FILE"

    local worker_exit=0
    "$run_fn" && worker_exit=0 || worker_exit=$?
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent finished (exit: $worker_exit)" >> "$LOG_FILE"
    write_sentinel "$worker_exit" "0"
}

run_background() {
    local run_fn="$1"
    local launcher_pid=""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] worker_agent background launch — running: $run_fn" > "$LOG_FILE"

    export WORKSPACE_ROOT SCRIPT_DIR TASK_ID OUTPUT_DIR SUMMARY_FILE LOG_FILE DONE_FILE RUN_STATUS_FILE
    export PROGRESS_FILE PID_FILE PROMPT_SAVE_FILE FULL_ACCESS RESEARCH_MODE BACKEND
    export CLAUDE_MODEL FINALIZER_WRITE_SENTINEL
    export CODEX_BIN CODEX_ACTUAL_VERSION CODEX_MODEL CODEX_REASONING_EFFORT CODEX_ENGINE_MODULE
    export RUN_FN="$run_fn"
    export -f \
        describe_write_access \
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

    if command -v setsid >/dev/null 2>&1; then
        # Preserve the caller's resolved PATH. A login shell can replace it and
        # hide a selected local Codex/Claude executable after dispatch.
        nohup setsid bash -c 'background_child_main "$RUN_FN"' >/dev/null 2>&1 < /dev/null &
        launcher_pid=$!
    else
        (
            background_child_main "$run_fn"
        ) </dev/null &>/dev/null &
        launcher_pid=$!
    fi

    FINALIZER_WRITE_SENTINEL=false
    disown || true
    ok "Worker launched in background (PID: $launcher_pid)"
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
                claude_label="${claude_label} — research mode"
            fi
            info "Backend: Claude CLI ($claude_label)"
            ;;
        codex)
            local access_label="workspace-write sandbox"
            if [[ "$FULL_ACCESS" == true ]]; then
                access_label="full-access sandbox"
            fi
            if [[ "$RESEARCH_MODE" == true ]]; then
                access_label="${access_label% sandbox} — research mode"
            fi
            info "Backend: Codex CLI ($access_label)"
            info "Codex executable: $CODEX_BIN ($CODEX_ACTUAL_VERSION)"
            info "Codex model requested: ${CODEX_MODEL:-Codex config default}"
            info "Codex reasoning effort requested: ${CODEX_REASONING_EFFORT:-Codex config default}"
            ;;
    esac
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
