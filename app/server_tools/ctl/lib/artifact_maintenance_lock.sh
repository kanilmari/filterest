#!/usr/bin/env bash
# artifact_maintenance_lock.sh
# Serializes repository maintenance that temporarily moves ignored artifacts.
# Bridges GitNexus safe analysis with Filterest candidate generation.
# Exists so neither workflow can expose or overwrite the other's transient state.

acquire_artifact_maintenance_lock() {
    local lock_file
    local lock_path
    local repo_root

    [[ "${EASELECT_ARTIFACT_MAINTENANCE_LOCK_HELD:-0}" != "1" ]] || return 0

    repo_root="$(git rev-parse --show-toplevel)"
    lock_file="$(git rev-parse --git-path easelect-artifact-maintenance.lock)"
    case "$lock_file" in
        /*) ;;
        *) lock_file="$repo_root/$lock_file" ;;
    esac
    lock_path="${lock_file}.lockdir"
    mkdir -p "$(dirname "$lock_file")"

    if command -v flock >/dev/null 2>&1; then
        # File descriptor 7 is reserved for this repository-wide lock.
        exec 7>"$lock_file"
        if ! flock -n 7; then
            printf 'Waiting for repository artifact-maintenance lock: %s\n' "$lock_file" >&2
            flock 7
        fi
        EASELECT_ARTIFACT_MAINTENANCE_LOCK_MODE="flock"
    else
        while ! mkdir "$lock_path" 2>/dev/null; do
            printf 'Waiting for repository artifact-maintenance lock: %s\n' "$lock_path" >&2
            sleep 1
        done
        EASELECT_ARTIFACT_MAINTENANCE_LOCK_MODE="directory"
        EASELECT_ARTIFACT_MAINTENANCE_LOCK_PATH="$lock_path"
    fi

    EASELECT_ARTIFACT_MAINTENANCE_LOCK_FILE="$lock_file"
    EASELECT_ARTIFACT_MAINTENANCE_LOCK_HELD=1
    EASELECT_ARTIFACT_MAINTENANCE_LOCK_OWNER_PID="$$"
    export EASELECT_ARTIFACT_MAINTENANCE_LOCK_FILE
    export EASELECT_ARTIFACT_MAINTENANCE_LOCK_HELD
    export EASELECT_ARTIFACT_MAINTENANCE_LOCK_MODE
    export EASELECT_ARTIFACT_MAINTENANCE_LOCK_OWNER_PID
    if [[ -n "${EASELECT_ARTIFACT_MAINTENANCE_LOCK_PATH:-}" ]]; then
        export EASELECT_ARTIFACT_MAINTENANCE_LOCK_PATH
    fi
}

release_artifact_maintenance_lock() {
    [[ "${EASELECT_ARTIFACT_MAINTENANCE_LOCK_HELD:-0}" == "1" ]] || return 0
    [[ "${EASELECT_ARTIFACT_MAINTENANCE_LOCK_OWNER_PID:-}" == "$$" ]] || return 0

    if [[ "${EASELECT_ARTIFACT_MAINTENANCE_LOCK_MODE:-}" == "directory" ]] \
            && [[ -n "${EASELECT_ARTIFACT_MAINTENANCE_LOCK_PATH:-}" ]]; then
        rmdir "$EASELECT_ARTIFACT_MAINTENANCE_LOCK_PATH" 2>/dev/null || true
    fi

    EASELECT_ARTIFACT_MAINTENANCE_LOCK_HELD=0
    unset EASELECT_ARTIFACT_MAINTENANCE_LOCK_FILE
    unset EASELECT_ARTIFACT_MAINTENANCE_LOCK_MODE
    unset EASELECT_ARTIFACT_MAINTENANCE_LOCK_OWNER_PID
    unset EASELECT_ARTIFACT_MAINTENANCE_LOCK_PATH
}
