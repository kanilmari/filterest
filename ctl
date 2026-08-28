#!/usr/bin/env bash
# Compatibility control entrypoint for a one-folder Filterest installation.
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

export FILTEREST_ROOT="$INSTALLATION_ROOT"
export FILTEREST_PROJECT_ROOT_OVERRIDE="$INSTALLATION_ROOT"
export FILTEREST_BUILD_ROOT_OVERRIDE="$APPLICATION_ROOT"
export FILTEREST_RUNTIME_ROOT_OVERRIDE="$INSTALLATION_ROOT/data/runtime"
export FILTEREST_LOG_FILE_OVERRIDE="$INSTALLATION_ROOT/data/runtime/logs/server_output.log"

cd "$APPLICATION_ROOT"
exec "$APPLICATION_ROOT/ctl" "$@"
