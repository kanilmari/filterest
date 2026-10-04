# ==============================================================================
# worker_agent_run_state.sh — Inspect and control worker run state for the CLI.
#
# Shared helpers between worker_agent_core.sh status commands and the timestamped
# run folders / sentinel files written by background workers.
# Keeps list/status/wait/stop logic separate from prompt building and backend
# execution so the main CLI flow stays easier to read.
# ==============================================================================

reset_run_snapshot() {
    RUN_SNAPSHOT_TASK_ID=""
    RUN_SNAPSHOT_RUN_DIR=""
    RUN_SNAPSHOT_DONE_FILE=""
    RUN_SNAPSHOT_SUMMARY_FILE=""
    RUN_SNAPSHOT_LOG_FILE=""
    RUN_SNAPSHOT_RUN_STATUS_FILE=""
    RUN_SNAPSHOT_PROGRESS_FILE=""
    RUN_SNAPSHOT_PID_FILE=""
    RUN_SNAPSHOT_DONE_PRESENT=0
    RUN_SNAPSHOT_SUMMARY_PRESENT=0
    RUN_SNAPSHOT_EXIT_CODE=1
    RUN_SNAPSHOT_ELAPSED_S=0
    RUN_SNAPSHOT_SUMMARY_EXISTS="no"
    RUN_SNAPSHOT_PID_STATE="missing"
    RUN_SNAPSHOT_LATEST_ARTIFACT_MTIME=0
    RUN_SNAPSHOT_LAST_CHANGE_AGE="-1"
    RUN_SNAPSHOT_RUN_STATE="unknown"
    RUN_SNAPSHOT_CLASSIFICATION="unknown"
}

assign_run_snapshot_paths() {
    local task_id="$1"
    local run_dir="${2:-}"

    if [[ -n "$run_dir" ]]; then
        RUN_SNAPSHOT_DONE_FILE="$run_dir/.worker_done_${task_id}"
        RUN_SNAPSHOT_SUMMARY_FILE="$run_dir/worker_summary_${task_id}.md"
        RUN_SNAPSHOT_LOG_FILE="$run_dir/worker_log_${task_id}.txt"
        RUN_SNAPSHOT_RUN_STATUS_FILE="$run_dir/run_status.txt"
        RUN_SNAPSHOT_PROGRESS_FILE="$run_dir/progress_${task_id}.md"
        RUN_SNAPSHOT_PID_FILE=$(run_pid_file_for_dir "$run_dir")
        return 0
    fi

    RUN_SNAPSHOT_DONE_FILE="$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL/.worker_done_${task_id}"
    RUN_SNAPSHOT_SUMMARY_FILE="$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL/worker_summary_${task_id}.md"
    RUN_SNAPSHOT_LOG_FILE="$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL/worker_log_${task_id}.txt"
    RUN_SNAPSHOT_RUN_STATUS_FILE="$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL/run_status.txt"
    RUN_SNAPSHOT_PROGRESS_FILE="$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL/progress_${task_id}.md"
}

populate_status_snapshot() {
    local task_id="$1"
    local run_dir="${2:-}"

    reset_run_snapshot
    RUN_SNAPSHOT_TASK_ID="$task_id"
    RUN_SNAPSHOT_RUN_DIR="$run_dir"
    assign_run_snapshot_paths "$task_id" "$run_dir"

    [[ -f "$RUN_SNAPSHOT_DONE_FILE" ]] && RUN_SNAPSHOT_DONE_PRESENT=1
    [[ -f "$RUN_SNAPSHOT_SUMMARY_FILE" ]] && RUN_SNAPSHOT_SUMMARY_PRESENT=1

    if [[ "$RUN_SNAPSHOT_DONE_PRESENT" == "1" ]]; then
        # Sentinel format: exit_code<TAB>elapsed_seconds<TAB>summary_exists.
        IFS=$'\t' read -r RUN_SNAPSHOT_EXIT_CODE RUN_SNAPSHOT_ELAPSED_S RUN_SNAPSHOT_SUMMARY_EXISTS < "$RUN_SNAPSHOT_DONE_FILE"
    fi

    RUN_SNAPSHOT_PID_STATE=$(status_pid_state "$RUN_SNAPSHOT_PID_FILE")
    RUN_SNAPSHOT_LATEST_ARTIFACT_MTIME=$(status_artifact_latest_mtime \
        "$RUN_SNAPSHOT_LOG_FILE" \
        "$RUN_SNAPSHOT_SUMMARY_FILE" \
        "$RUN_SNAPSHOT_RUN_STATUS_FILE" \
        "$RUN_SNAPSHOT_PROGRESS_FILE" \
        "$RUN_SNAPSHOT_DONE_FILE")
    RUN_SNAPSHOT_LAST_CHANGE_AGE=$(status_age_seconds "$RUN_SNAPSHOT_LATEST_ARTIFACT_MTIME")

    if [[ -f "$RUN_SNAPSHOT_RUN_STATUS_FILE" ]]; then
        RUN_SNAPSHOT_RUN_STATE=$(awk -F= '/^status=/{print $2; exit}' "$RUN_SNAPSHOT_RUN_STATUS_FILE" 2>/dev/null || true)
        [[ -z "$RUN_SNAPSHOT_RUN_STATE" ]] && RUN_SNAPSHOT_RUN_STATE="unknown"
    fi

    RUN_SNAPSHOT_CLASSIFICATION=$(status_classification \
        "$RUN_SNAPSHOT_DONE_PRESENT" \
        "$RUN_SNAPSHOT_EXIT_CODE" \
        "$RUN_SNAPSHOT_SUMMARY_PRESENT" \
        "$RUN_SNAPSHOT_PID_STATE" \
        "$RUN_SNAPSHOT_LAST_CHANGE_AGE")
}

default_output_dir_abs() {
    echo "$WORKSPACE_ROOT/$DEFAULT_OUTPUT_DIR_REL"
}

list_worker_run_roots() {
    printf '%s\n' \
        "$WORKSPACE_ROOT/$DEFAULT_OUTPUT_DIR_REL" \
        "$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL"
}

each_worker_run_dir() {
    local root dir
    while IFS= read -r root; do
        [[ -d "$root" ]] || continue
        for dir in "$root"/20*--*/; do
            [[ -d "$dir" ]] || continue
            printf '%s\n' "$dir"
        done
    done < <(list_worker_run_roots)
}

find_latest_worker_run_dir() {
    local task_id="$1"
    local root dir found="" found_name=""
    while IFS= read -r root; do
        [[ -d "$root" ]] || continue
        for dir in "$root"/20*--*"${task_id}"/; do
            [[ -d "$dir" ]] || continue
            local folder_name
            folder_name=$(basename "$dir")
            if [[ -z "$found_name" || "$folder_name" > "$found_name" ]]; then
                found="$dir"
                found_name="$folder_name"
            fi
        done
    done < <(list_worker_run_roots)

    if [[ -n "$found" ]]; then
        printf '%s\n' "$found"
    fi
    return 0
}

list_runs() {
    local summaries_dir
    summaries_dir=$(default_output_dir_abs)
    if [[ ! -d "$summaries_dir" && ! -d "$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL" ]]; then
        info "No runs found."
        exit 0
    fi

    printf "${BOLD}%-36s  %-14s  %-12s  %s${NC}\n" "TASK ID" "STATE" "DETAIL" "FOLDER"
    printf "%-36s  %-14s  %-12s  %s\n" "------------------------------------" "--------------" "------------" "------"

    # Look for timestamped folders in both the current and legacy locations.
    while IFS= read -r dir; do
        local folder_name
        folder_name=$(basename "$dir")
        local task_id
        task_id=$(echo "$folder_name" | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}--[0-9]\{2\}-[0-9]\{2\}--//')
        populate_status_snapshot "$task_id" "$dir"
        local detail_label=""
        detail_label=$(status_detail_label "$RUN_SNAPSHOT_CLASSIFICATION" "$RUN_SNAPSHOT_ELAPSED_S" "$RUN_SNAPSHOT_LAST_CHANGE_AGE")
        printf "%-36s  %-14s  %-12s  %s\n" "$task_id" "$RUN_SNAPSHOT_CLASSIFICATION" "$detail_label" "$folder_name/"
    done < <(each_worker_run_dir)

    for done_file in "$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL"/.worker_done_*; do
        [[ -f "$done_file" ]] || continue
        local task_id
        task_id=$(basename "$done_file" | sed 's/^\.worker_done_//')
        if [[ -n "$(find_latest_worker_run_dir "$task_id")" ]]; then
            continue
        fi
        populate_status_snapshot "$task_id" ""
        local detail_label=""
        detail_label=$(status_detail_label "$RUN_SNAPSHOT_CLASSIFICATION" "$RUN_SNAPSHOT_ELAPSED_S" "$RUN_SNAPSHOT_LAST_CHANGE_AGE")
        printf "%-36s  %-14s  %-12s  %s\n" "$task_id" "$RUN_SNAPSHOT_CLASSIFICATION" "$detail_label" "(flat)"
    done

    exit 0
}

check_status() {
    local task_id="$1"

    local found_dir=""
    found_dir=$(find_latest_worker_run_dir "$task_id")

    local summary_file=""
    if [[ -n "$found_dir" ]]; then
        summary_file="$found_dir/worker_summary_${task_id}.md"
        info "Output folder: $found_dir"
    else
        summary_file="$WORKSPACE_ROOT/$LEGACY_OUTPUT_DIR_REL/worker_summary_${task_id}.md"
    fi

    populate_status_snapshot "$task_id" "$found_dir"

    if [[ "$RUN_SNAPSHOT_CLASSIFICATION" == "done" ]]; then
        if (( RUN_SNAPSHOT_EXIT_CODE == 0 )); then
            ok "Task [$task_id] completed successfully (${RUN_SNAPSHOT_ELAPSED_S}s)"
        fi
    elif [[ "$RUN_SNAPSHOT_CLASSIFICATION" == "failed" ]]; then
        err "Task [$task_id] failed with exit code $RUN_SNAPSHOT_EXIT_CODE (${RUN_SNAPSHOT_ELAPSED_S}s)"
    elif [[ "$RUN_SNAPSHOT_CLASSIFICATION" == "finalizing" ]]; then
        info "Task [$task_id] is finalizing."
    elif [[ "$RUN_SNAPSHOT_CLASSIFICATION" == "active" ]]; then
        info "Task [$task_id] is active."
    elif [[ "$RUN_SNAPSHOT_CLASSIFICATION" == "quiet" ]]; then
        warn "Task [$task_id] is quiet."
    elif [[ "$RUN_SNAPSHOT_CLASSIFICATION" == "likely stuck" ]]; then
        warn "Task [$task_id] is likely stuck."
    else
        warn "Task [$task_id] is still running or not found."
    fi

    if [[ -n "$found_dir" ]]; then
        printf "  Output folder: %s\n" "$found_dir"
    fi
    printf "  Last artifact change: %s\n" "$(status_age_label "$RUN_SNAPSHOT_LAST_CHANGE_AGE")"
    printf "  Summary present: %s\n" "$(status_yes_no "$RUN_SNAPSHOT_SUMMARY_PRESENT")"
    printf "  Done sentinel: %s\n" "$(status_yes_no "$RUN_SNAPSHOT_DONE_PRESENT")"
    printf "  PID: %s\n" "$RUN_SNAPSHOT_PID_STATE"
    printf "  Run state: %s\n" "$RUN_SNAPSHOT_RUN_STATE"
    local recorded_billing=""
    recorded_billing=$(read_run_status_value "$RUN_SNAPSHOT_RUN_STATUS_FILE" "billing_mode")
    printf "  Billing: %s\n" "${recorded_billing:-not recorded}"

    if [[ "$RUN_SNAPSHOT_DONE_PRESENT" == "1" ]]; then
        if [[ -f "$summary_file" ]]; then
            echo ""
            cat "$summary_file"
        else
            warn "No summary file found."
        fi
    elif [[ "$RUN_SNAPSHOT_SUMMARY_PRESENT" == "1" ]]; then
        echo ""
        cat "$summary_file"
    fi
    exit 0
}

# The process group this command itself runs in, which is never a target.
own_process_group() {
    local own_stat="" state="" parent_pid="" process_group=""
    own_stat=$(cat "/proc/$$/stat" 2>/dev/null) || own_stat=""
    read -r state parent_pid process_group _ <<< "${own_stat##*) }"
    printf '%s' "$process_group"
}

# process_start_time prints a process's start time (clock ticks after boot,
# field 22 of /proc/<pid>/stat), or nothing when no process has that pid.
process_start_time() {
    local stat=""
    local -a fields=()
    stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 0
    read -r -a fields <<< "${stat##*) }"
    printf '%s' "${fields[19]:-}"
}

# group_still_ours decides, before each signal, whether a recorded process group
# may still be signalled. A process whose pid is the group's id must be the
# leader recorded at launch, with the same start time. If no process has that
# pid, the number cannot have been handed out again while the group still has
# members, so the group's survivors are still the run's. Without /proc nothing
# can be confirmed, and nothing is signalled.
group_still_ours() {
    local process_group="$1"
    local recorded_start="$2"
    local current_start=""
    [[ -r /proc/self/stat ]] || return 1
    current_start=$(process_start_time "$process_group")
    [[ -z "$current_start" || "$current_start" == "$recorded_start" ]]
}

# stop_process_group ends a run's process group as a whole: one TERM reaches
# every member at once, KILL follows after the grace, and the group is then
# re-checked until it is gone (a bounded wait, since a member that has died but
# is not yet reaped still counts). The group's identity is confirmed again
# before every signal and every re-check, so a group number handed out anew is
# never signalled. A process that left the group by starting its own session is
# outside this guarantee. Returns 0 once the group is gone, 1 if it is still
# there after KILL, and 2 when it can no longer be confirmed as the run's (and
# nothing more is sent).
stop_process_group() {
    local process_group="$1"
    local recorded_start="$2"
    local grace_polls="${3:-10}"
    local polls=0
    if [[ ! "$process_group" =~ ^[0-9]+$ ]] || (( process_group <= 1 )) \
        || [[ "$process_group" == "$(own_process_group)" ]]; then
        return 2
    fi
    group_still_ours "$process_group" "$recorded_start" || return 2
    kill -0 -- "-$process_group" 2>/dev/null || return 0
    group_still_ours "$process_group" "$recorded_start" || return 2
    kill -TERM -- "-$process_group" 2>/dev/null || true
    for (( polls = 0; polls < grace_polls; polls++ )); do
        sleep 0.2
        group_still_ours "$process_group" "$recorded_start" || return 2
        kill -0 -- "-$process_group" 2>/dev/null || return 0
    done
    group_still_ours "$process_group" "$recorded_start" || return 2
    kill -KILL -- "-$process_group" 2>/dev/null || true
    for (( polls = 0; polls < 10; polls++ )); do
        sleep 0.2
        group_still_ours "$process_group" "$recorded_start" || return 2
        kill -0 -- "-$process_group" 2>/dev/null || return 0
    done
    return 1
}

# Runs launched with process-group tracking are stopped as a whole group: one
# signal reaches the wrapper and the backend alike, so the backend does not keep
# working (or billing) after the wrapper has gone.
stop_task_process_group() {
    local task_id="$1"
    local found_dir="$2"
    local process_group="$3"
    local recorded_start="$4"
    local done_file="$found_dir/.worker_done_${task_id}"
    local mismatch="Process group $process_group can no longer be confirmed as this run's: a process with its leader's pid has another start time than the one recorded at launch. Nothing was signalled."

    if ! group_still_ours "$process_group" "$recorded_start"; then
        err "$mismatch"
        exit 1
    fi
    if ! kill -0 -- "-$process_group" 2>/dev/null; then
        warn "Task [$task_id] has no live process group $process_group; marking run as failed."
        mark_interrupted_run_failed "$task_id" "$found_dir" "stop requested after process group $process_group had already ended"
        check_status "$task_id"
    fi

    info "Stopping task [$task_id] (process group $process_group)..."
    local stop_result=0
    stop_process_group "$process_group" "$recorded_start" $(( STOP_GRACE_SECONDS * 5 )) || stop_result=$?
    if (( stop_result == 2 )); then
        err "${mismatch/Nothing was signalled/No further signal was sent}"
        exit 1
    elif (( stop_result == 1 )); then
        warn "Process group $process_group still has members after KILL."
    fi
    if [[ ! -f "$done_file" ]]; then
        mark_interrupted_run_failed "$task_id" "$found_dir" "stop requested by operator"
    fi
    check_status "$task_id"
}

stop_task() {
    local task_id="$1"
    local found_dir=""
    found_dir=$(find_latest_worker_run_dir "$task_id")

    if [[ -z "$found_dir" ]]; then
        err "Task [$task_id] not found."
        exit 1
    fi

    populate_status_snapshot "$task_id" "$found_dir"

    if [[ "$RUN_SNAPSHOT_DONE_PRESENT" == "1" ]]; then
        info "Task [$task_id] is already ${RUN_SNAPSHOT_CLASSIFICATION}; nothing to stop."
        check_status "$task_id"
    fi

    local process_group="" recorded_start=""
    process_group=$(read_run_status_value "$RUN_SNAPSHOT_RUN_STATUS_FILE" "process_group")
    recorded_start=$(read_run_status_value "$RUN_SNAPSHOT_RUN_STATUS_FILE" "process_group_leader_start")
    if [[ "$process_group" =~ ^[0-9]+$ && "$recorded_start" =~ ^[0-9]+$ ]]; then
        stop_task_process_group "$task_id" "$found_dir" "$process_group" "$recorded_start"
    fi
    warn "Task [$task_id] was started before process-group tracking: only its recorded pid is signalled, so a backend it started may keep running."

    local done_file="$found_dir/.worker_done_${task_id}"
    local worker_pid=""
    worker_pid=$(read_worker_pid_from_file "$RUN_SNAPSHOT_PID_FILE" || true)

    if [[ -z "$worker_pid" ]]; then
        warn "Task [$task_id] has no tracked live pid; marking run as failed."
        mark_interrupted_run_failed "$task_id" "$found_dir" "stop requested but worker pid file was missing or empty"
        check_status "$task_id"
    fi

    if ! kill -0 "$worker_pid" 2>/dev/null; then
        warn "Task [$task_id] pid $worker_pid is no longer running; marking run as failed."
        mark_interrupted_run_failed "$task_id" "$found_dir" "stop requested after worker pid $worker_pid had already exited"
        check_status "$task_id"
    fi

    info "Stopping task [$task_id] (pid $worker_pid)..."
    kill "$worker_pid" 2>/dev/null || true

    local waited=0
    while kill -0 "$worker_pid" 2>/dev/null && (( waited < STOP_GRACE_SECONDS )); do
        sleep 1
        waited=$((waited + 1))
    done

    if kill -0 "$worker_pid" 2>/dev/null; then
        warn "Task [$task_id] did not stop after ${STOP_GRACE_SECONDS}s; sending SIGKILL."
        kill -KILL "$worker_pid" 2>/dev/null || true
    fi

    local sentinel_wait=0
    while [[ ! -f "$done_file" && $sentinel_wait -lt 5 ]]; do
        sleep 1
        sentinel_wait=$((sentinel_wait + 1))
    done

    if [[ ! -f "$done_file" ]]; then
        mark_interrupted_run_failed "$task_id" "$found_dir" "stop requested by operator"
    fi

    check_status "$task_id"
}

wait_for_task() {
    local task_id="$1"

    if [[ -z "$task_id" ]]; then
        local latest_dir=""
        while IFS= read -r dir; do
            local tid
            tid=$(basename "$dir" | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}--[0-9]\{2\}-[0-9]\{2\}--//')
            local done_file="$dir/.worker_done_${tid}"
            if [[ ! -f "$done_file" ]]; then
                latest_dir="$dir"
                task_id="$tid"
            fi
        done < <(each_worker_run_dir)
        if [[ -z "$task_id" ]]; then
            while IFS= read -r dir; do
                latest_dir="$dir"
                task_id=$(basename "$dir" | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}--[0-9]\{2\}-[0-9]\{2\}--//')
            done < <(each_worker_run_dir)
            if [[ -n "$task_id" ]]; then
                info "No running tasks. Showing most recent: $task_id"
                check_status "$task_id"
            fi
            err "No tasks found to wait for."
            exit 1
        fi
        info "Waiting for most recent running task: $task_id"
    fi

    local done_file=""
    local summary_file=""
    local found_dir=""
    found_dir=$(find_latest_worker_run_dir "$task_id")
    if [[ -n "$found_dir" ]]; then
        done_file="$found_dir/.worker_done_${task_id}"
        summary_file="$found_dir/worker_summary_${task_id}.md"
    else
        err "Task [$task_id] not found."
        exit 1
    fi

    local elapsed=0
    local finishing_announced=0
    local minute_had_activity=0
    local previous_signature=""
    previous_signature=$(progress_run_artifact_signature "$found_dir" "$task_id")
    printf "Waiting for [%s]\n" "$task_id"
    progress_print_minute_header 0 1
    while [[ ! -f "$done_file" ]]; do
        local stale_reason=""
        stale_reason=$(detect_stale_run "$task_id" "$found_dir" 2>/dev/null || true)
        if [[ -n "$stale_reason" ]]; then
            mark_stale_run_failed "$task_id" "$found_dir" "$stale_reason"
            break
        fi
        if [[ "$finishing_announced" == "0" && -f "$summary_file" ]]; then
            printf " [summary ready, finalizing] "
            finishing_announced=1
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        local current_signature=""
        current_signature=$(progress_run_artifact_signature "$found_dir" "$task_id")
        local progress_marker=":"
        progress_marker=$(progress_poll_marker "$current_signature" "$previous_signature")
        if [[ "$current_signature" != "$previous_signature" ]]; then
            minute_had_activity=1
            previous_signature="$current_signature"
        fi
        printf "%s" "$progress_marker"
        if (( PROGRESS_MARKER_SECONDS > 0 )) && (( elapsed % PROGRESS_MARKER_SECONDS == 0 )); then
            printf " (%s s) " "$(progress_elapsed_label "$elapsed")"
        fi
        if progress_maybe_wrap_minute "$elapsed" "$minute_had_activity" 1; then
            minute_had_activity=0
        fi
    done
    printf " done (%ds)\n" "$elapsed"

    IFS=$'\t' read -r exit_code elapsed_s summary_exists < "$done_file"
    if (( exit_code == 0 )); then
        ok "Task [$task_id] completed successfully (${elapsed_s}s)"
    else
        err "Task [$task_id] failed with exit code $exit_code (${elapsed_s}s)"
    fi

    if [[ -f "$summary_file" ]]; then
        echo ""
        printf "${BOLD}=== WORKER SUMMARY ($task_id) ===${NC}\n"
        cat "$summary_file"
        printf "${BOLD}=== END SUMMARY ===${NC}\n"
    else
        warn "No summary file created."
    fi
    exit "$exit_code"
}

run_pid_file_for_dir() {
    local run_dir="$1"
    echo "$run_dir/worker.pid"
}

read_worker_pid_from_file() {
    local pid_file="$1"
    [[ -f "$pid_file" ]] || return 1

    local worker_pid=""
    worker_pid=$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)
    [[ -n "$worker_pid" ]] || return 1
    printf '%s\n' "$worker_pid"
}

read_run_status_value() {
    local run_status_file="$1"
    local key="$2"
    [[ -f "$run_status_file" ]] || return 0
    awk -F= -v wanted="$key" '$1 == wanted { print $2; exit }' "$run_status_file" 2>/dev/null || true
}

detect_stale_run() {
    local task_id="$1"
    local run_dir="$2"
    [[ -n "$run_dir" ]] || return 1

    local done_file="$run_dir/.worker_done_${task_id}"
    [[ -f "$done_file" ]] && return 1

    local pid_file
    pid_file=$(run_pid_file_for_dir "$run_dir")
    if [[ -f "$pid_file" ]]; then
        local worker_pid=""
        worker_pid=$(cat "$pid_file" 2>/dev/null || true)
        if [[ -z "$worker_pid" ]]; then
            echo "worker pid file is empty"
            return 0
        fi
        if ! kill -0 "$worker_pid" 2>/dev/null; then
            echo "worker pid $worker_pid is no longer running"
            return 0
        fi
        return 1
    fi

    local run_status_file="$run_dir/run_status.txt"
    local log_file="$run_dir/worker_log_${task_id}.txt"
    if [[ -f "$run_status_file" && -f "$log_file" ]]; then
        local status=""
        status=$(awk -F= '/^status=/{print $2}' "$run_status_file" 2>/dev/null || true)
        if [[ "$status" == "running" ]]; then
            local log_lines=0
            log_lines=$(wc -l < "$log_file" 2>/dev/null || echo 0)
            local log_mtime=0
            log_mtime=$(stat -c %Y "$log_file" 2>/dev/null || echo 0)
            local now
            now=$(date +%s)
            local idle_seconds=$(( now - log_mtime ))
            # An unconfirmed launch adds its own line to the launch log.
            local launch_lines=1
            if [[ -n "$(read_run_status_value "$run_status_file" "launch_unconfirmed")" ]]; then
                launch_lines=2
            fi
            if (( log_lines <= launch_lines )) && (( idle_seconds >= 60 )); then
                echo "run has no worker pid file and log has been stalled at launch for ${idle_seconds}s"
                return 0
            fi
        fi
    fi

    return 1
}

mark_stale_run_failed() {
    local task_id="$1"
    local run_dir="$2"
    local reason="$3"
    [[ -n "$run_dir" ]] || return 1

    local done_file="$run_dir/.worker_done_${task_id}"
    [[ -f "$done_file" ]] && return 0
    record_failed_run_state \
        "$task_id" \
        "$run_dir" \
        "1" \
        "stale background run detected" \
        "$reason" \
        "worker_agent detected stale run" \
        "false"
}

mark_interrupted_run_failed() {
    local task_id="$1"
    local run_dir="$2"
    local reason="$3"
    [[ -n "$run_dir" ]] || return 1

    local done_file="$run_dir/.worker_done_${task_id}"
    [[ -f "$done_file" ]] && return 0
    record_failed_run_state \
        "$task_id" \
        "$run_dir" \
        "130" \
        "stop requested by operator" \
        "$reason" \
        "worker_agent stopped run" \
        "true"
}

record_failed_run_state() {
    local task_id="$1"
    local run_dir="$2"
    local exit_code="$3"
    local failure_mode="$4"
    local reason="$5"
    local log_prefix="$6"
    local remove_pid_file="${7:-false}"

    local summary_file="$run_dir/worker_summary_${task_id}.md"
    local log_file="$run_dir/worker_log_${task_id}.txt"
    local run_status_file="$run_dir/run_status.txt"
    local progress_file="$run_dir/progress_${task_id}.md"
    local pid_file="$run_dir/worker.pid"
    local done_file="$run_dir/.worker_done_${task_id}"
    local recorded_backend="${BACKEND:-unknown}"
    local recorded_research="${RESEARCH_MODE:-unknown}"

    local existing_backend=""
    local existing_research=""
    existing_backend=$(read_run_status_value "$run_status_file" "backend")
    existing_research=$(read_run_status_value "$run_status_file" "research_mode")
    [[ -n "$existing_backend" ]] && recorded_backend="$existing_backend"
    [[ -n "$existing_research" ]] && recorded_research="$existing_research"
    # Only the run's own record knows its billing and process group; this
    # command's defaults do not.
    local recorded_billing="" recorded_group="" recorded_group_start=""
    recorded_billing=$(read_run_status_value "$run_status_file" "billing_mode")
    recorded_group=$(read_run_status_value "$run_status_file" "process_group")
    recorded_group_start=$(read_run_status_value "$run_status_file" "process_group_leader_start")

    if [[ -f "$log_file" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${log_prefix}: $reason" >> "$log_file"
    fi

    if [[ "$remove_pid_file" == "true" ]]; then
        rm -f "$pid_file"
    fi

    local summary_exists="no"
    [[ -f "$summary_file" ]] && summary_exists="yes"
    printf "%s\t0\t%s\n" "$exit_code" "$summary_exists" > "$done_file"

    {
        printf 'task_id=%s\n' "$task_id"
        printf 'status=failed\n'
        printf 'backend=%s\n' "$recorded_backend"
        printf 'research_mode=%s\n' "$recorded_research"
        printf 'billing_mode=%s\n' "${recorded_billing:-unknown}"
        if [[ -n "$recorded_group" ]]; then
            printf 'process_group=%s\n' "$recorded_group"
            printf 'process_group_leader_start=%s\n' "$recorded_group_start"
        fi
        printf 'exit_code=%s\n' "$exit_code"
        printf 'elapsed_seconds=0\n'
        printf 'summary_file=%s\n' "$(basename "$summary_file")"
        printf 'log_file=%s\n' "$(basename "$log_file")"
        printf 'progress_file=%s\n' "$(basename "$progress_file")"
    } > "$run_status_file"

    {
        printf '# Worker Run Progress\n\n'
        printf -- '- Task ID: %s\n' "$task_id"
        printf -- '- Status: failed\n'
        printf -- '- Exit code: %s\n' "$exit_code"
        printf -- '- Failure mode: %s\n' "$failure_mode"
        printf -- '- Reason: %s\n' "$reason"
        printf -- '- Summary file: %s\n' "$(basename "$summary_file")"
        printf -- '- Log file: %s\n' "$(basename "$log_file")"
        printf -- '- Updated: %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    } > "$progress_file"
}
