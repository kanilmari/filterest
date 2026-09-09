#!/usr/bin/env bash
# ctl
# Controls one standalone Filterest installation from its stable public root.
# Bridges root-level operator commands with immutable app source and mutable runtime data.
# Exists so standalone lifecycle actions cannot inherit Easelect-specific process boundaries.
set -euo pipefail
INSTALLATION_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APPLICATION_ROOT="$INSTALLATION_ROOT/app"

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

# The installation-root launcher is the standalone public boundary. Private
# embedding products call app/ctl directly after supplying these hooks, so a
# public one-folder install must never inherit them from the caller's shell.
unset FILTEREST_RESOLVE_ENV_LIB FILTEREST_PRIVATE_BOOTSTRAP_LIB
unset FILTEREST_LOCAL_DOCKER_COMPOSE_FILE FILTEREST_SHARED_DEV_STORAGE_HELPER FILTEREST_INSTANCE_DOCKER_ROOT FILTEREST_INSTANCE_TEMPLATE_PATH
unset FILTEREST_SYNC_CONFIG_FILE FILTEREST_GO_BUILD_TARGET
unset FILTEREST_GO_RUN_PROCESS_PATTERN FILTEREST_QUEEN_PYTHON_MODULE
unset FILTEREST_DB_TASK_PYTHON_MODULE
unset FILTEREST_SCAFFOLD_EXTENSION_ROOT FILTEREST_SCAFFOLD_EXTENSION_ENV_SOURCES FILTEREST_SCAFFOLD_EXTENSION_ENV_TEMPLATES FILTEREST_MACHINE_TRANSFER_COMMAND
unset FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN ALLOW_UNGUARDED_FILTEREST_PREVIEW_RECREATE ALLOW_INCOMPLETE_LOCAL_SETUP_RECREATE
unset PORT APP_PORT EASELECT_PORT VITE_DEV_PORT VITE_HMR_PORT
export GOWORK=off FILTEREST_STANDALONE_ROOT_CTL=1
export FILTEREST_STANDALONE_DEFAULT_PORT=8100
export FILTEREST_STANDALONE_DEFAULT_VITE_PORT=9100
export EASELECT_PORT=8100
if [[ "${1:-}" == "-p" || "${1:-}" == "--port" ]]; then export PORT="${2:?port value is required}" APP_PORT="$2" EASELECT_PORT="$2"; fi

export FILTEREST_ROOT="$INSTALLATION_ROOT"
export FILTEREST_PROJECT_ROOT_OVERRIDE="$INSTALLATION_ROOT"
export FILTEREST_BUILD_ROOT_OVERRIDE="$APPLICATION_ROOT"
export FILTEREST_RUNTIME_ROOT_OVERRIDE="$INSTALLATION_ROOT/data/runtime"
export FILTEREST_LOG_FILE_OVERRIDE="$INSTALLATION_ROOT/data/runtime/logs/server_output.log"
export PYTHONPYCACHEPREFIX="$INSTALLATION_ROOT/data/runtime/python-cache"
export FILTEREST_PROJECT_VENV_DIR="$INSTALLATION_ROOT/data/runtime/python/venv"
export PLAYWRIGHT_BROWSERS_PATH="$INSTALLATION_ROOT/data/runtime/playwright"
export FILTEREST_QUEEN_STATE_ROOT="$INSTALLATION_ROOT/data/runtime/queen"
export FILTEREST_NODE_MODULES_ROOT="$INSTALLATION_ROOT/data/runtime/node/node_modules" GOMODCACHE="$INSTALLATION_ROOT/data/runtime/go/module-cache" GOCACHE="$INSTALLATION_ROOT/data/runtime/go/build-cache"
export NODE_PATH="$FILTEREST_NODE_MODULES_ROOT"
export PATH="$FILTEREST_NODE_MODULES_ROOT/.bin:$PATH"

cd "$APPLICATION_ROOT" && exec "$APPLICATION_ROOT/ctl" "$@"
