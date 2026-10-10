#!/usr/bin/env bash
# ctl
# Controls one standalone Filterest installation from its stable public root.
# Bridges root-level operator commands with immutable app source and mutable runtime data.
# Exists so standalone lifecycle actions cannot inherit Easelect-specific process boundaries.
set -euo pipefail
# Backup/restore diagnostics need protection before environment helpers run.
FILTEREST_RECOVERY_OUTPUT=0
for argument in "$@"; do
    case "$argument" in
        --backup|--restore|--restore-db|backup-all) FILTEREST_RECOVERY_OUTPUT=1 ;;
    esac
done
export FILTEREST_RECOVERY_OUTPUT
# A sourced settings/helper file cannot turn off an active recovery boundary.
if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then readonly FILTEREST_RECOVERY_OUTPUT; fi
if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then
    SCRIPT_SOURCE_DIRECTORY="$(dirname -- "${BASH_SOURCE[0]}" 2>/dev/null)" || { printf 'Recovery launcher location unavailable; sensitive details withheld.\n' >&2; exit 1; }
    INSTALLATION_ROOT="$(cd -- "$SCRIPT_SOURCE_DIRECTORY" 2>/dev/null && pwd -P 2>/dev/null)" 2>/dev/null || { printf 'Recovery launcher location unavailable; sensitive details withheld.\n' >&2; exit 1; }
else
    INSTALLATION_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
fi
APPLICATION_ROOT="$INSTALLATION_ROOT/app"

# Capture implicit shell/interpreter diagnostics as well as explicit output.
if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 && "${BASH_SOURCE[0]}" == "$0" ]]; then
    source "$APPLICATION_ROOT/server_tools/lib/recovery_process_boundary.sh" >/dev/null 2>&1 || { printf 'Recovery process boundary unavailable; sensitive details withheld.\n' >&2; exit 1; }
    filterest_recovery_process_entry "${BASH_SOURCE[0]}" "$APPLICATION_ROOT" "$@"
fi


if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then
    if [[ ! -x "$APPLICATION_ROOT/ctl" ]]; then
        printf 'error: Filterest control launcher (app/ctl) is missing or not executable\n' >&2
        exit 1
    fi
    for required_file in go.mod VERSION_APP; do
        if [[ ! -f "$APPLICATION_ROOT/$required_file" ]]; then
            printf 'error: a required Filterest application marker (app/go.mod or app/VERSION_APP) is missing\n' >&2
            exit 1
        fi
    done
else
    if [[ ! -x "$APPLICATION_ROOT/ctl" ]]; then
        printf 'error: Filterest control launcher is missing or not executable: %s\n' \
            "$APPLICATION_ROOT/ctl" >&2
        exit 1
    fi
    for required_file in go.mod VERSION_APP; do
        if [[ ! -f "$APPLICATION_ROOT/$required_file" ]]; then
            printf 'error: Filterest application marker is missing: %s\n' \
                "$APPLICATION_ROOT/$required_file" >&2
            exit 1
        fi
    done
fi

# The installation-root launcher is the standalone public boundary. Private
# embedding products call app/ctl directly after supplying these hooks, so a
# public one-folder install must never inherit them from the caller's shell.
unset FILTEREST_RESOLVE_ENV_LIB FILTEREST_PRIVATE_BOOTSTRAP_LIB
unset FILTEREST_LOCAL_DOCKER_COMPOSE_FILE FILTEREST_SHARED_DEV_STORAGE_HELPER FILTEREST_INSTANCE_DOCKER_ROOT FILTEREST_INSTANCE_TEMPLATE_PATH
unset FILTEREST_SYNC_CONFIG_FILE FILTEREST_GO_BUILD_TARGET
unset FILTEREST_GO_RUN_PROCESS_PATTERN
unset FILTEREST_DB_TASK_PYTHON_MODULE
unset FILTEREST_SCAFFOLD_EXTENSION_ROOT FILTEREST_SCAFFOLD_EXTENSION_ENV_SOURCES FILTEREST_SCAFFOLD_EXTENSION_ENV_TEMPLATES FILTEREST_MACHINE_TRANSFER_COMMAND
unset FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN ALLOW_UNGUARDED_FILTEREST_PREVIEW_RECREATE ALLOW_INCOMPLETE_LOCAL_SETUP_RECREATE
unset PORT APP_PORT EASELECT_PORT VITE_DEV_PORT VITE_HMR_PORT
export GOWORK=off FILTEREST_STANDALONE_ROOT_CTL=1
if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then
    source "$APPLICATION_ROOT/server_tools/lib/installation_records.sh" 2>/dev/null || { printf 'Recovery diagnostic library unavailable; sensitive details withheld.\n' >&2; exit 1; }
    # shellcheck source=app/server_tools/lib/filterest_port_preflight.sh
    filterest_recovery_source "$INSTALLATION_ROOT" "$APPLICATION_ROOT/server_tools/lib/filterest_port_preflight.sh"
    FILTEREST_STANDALONE_DEFAULT_PORT="$(filterest_recovery_utility "$INSTALLATION_ROOT" filterest_native_default_port "$INSTALLATION_ROOT")"
else
    # shellcheck source=app/server_tools/lib/filterest_port_preflight.sh
    source "$APPLICATION_ROOT/server_tools/lib/filterest_port_preflight.sh"
    FILTEREST_STANDALONE_DEFAULT_PORT="$(filterest_native_default_port "$INSTALLATION_ROOT")"
fi
export FILTEREST_STANDALONE_DEFAULT_PORT
export FILTEREST_STANDALONE_DEFAULT_VITE_PORT=9100
export EASELECT_PORT="$FILTEREST_STANDALONE_DEFAULT_PORT"
if [[ "${1:-}" == "-p" || "${1:-}" == "--port" ]]; then
    [[ "$#" -ge 2 && -n "${2:-}" && "${2:0:1}" != - ]] || { printf 'error: port option requires a value\n' >&2; exit 1; }
    export PORT="$2" APP_PORT="$2" EASELECT_PORT="$2"
fi

export FILTEREST_ROOT="$INSTALLATION_ROOT"
export FILTEREST_PROJECT_ROOT_OVERRIDE="$INSTALLATION_ROOT"
export FILTEREST_BUILD_ROOT_OVERRIDE="$APPLICATION_ROOT"
export FILTEREST_RUNTIME_ROOT_OVERRIDE="$INSTALLATION_ROOT/data/runtime"
export FILTEREST_LOG_FILE_OVERRIDE="$INSTALLATION_ROOT/data/runtime/logs/server_output.log"
export PYTHONPYCACHEPREFIX="$INSTALLATION_ROOT/data/runtime/python-cache"
export FILTEREST_PROJECT_VENV_DIR="$INSTALLATION_ROOT/data/runtime/python/venv"
export PLAYWRIGHT_BROWSERS_PATH="$INSTALLATION_ROOT/data/runtime/playwright"
export FILTEREST_NODE_MODULES_ROOT="$INSTALLATION_ROOT/data/runtime/node/node_modules" GOMODCACHE="$INSTALLATION_ROOT/data/runtime/go/module-cache" GOCACHE="$INSTALLATION_ROOT/data/runtime/go/build-cache"
export NODE_PATH="$FILTEREST_NODE_MODULES_ROOT"
export PATH="$FILTEREST_NODE_MODULES_ROOT/.bin:$PATH"

if [[ "$FILTEREST_RECOVERY_OUTPUT" -eq 1 ]]; then
    # A fixed interactive restore prompt must remain visible while finite
    # stderr diagnostics wait for their scan. Only that prompt uses descriptor 8.
    if [[ "${FILTEREST_RECOVERY_PROMPT_FD:-}" != 8 ]] || ! { true >&8; } 2>/dev/null; then
        exec 8>&2
    fi
    export FILTEREST_RECOVERY_PROMPT_FD=8
    filterest_recovery_launch() { cd "$APPLICATION_ROOT" && filterest_recovery_child "$APPLICATION_ROOT/ctl" "$@"; }
    filterest_recovery_scan "$INSTALLATION_ROOT" stderr filterest_recovery_launch "$@"
    exit $?
else
    cd "$APPLICATION_ROOT" && exec "$APPLICATION_ROOT/ctl" "$@"
fi
