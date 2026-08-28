#!/usr/bin/env bash
# project_python_venv.sh
# What: Prepares and activates the layout-aware Python virtual environment.
# Between what: Connects Python tools with mutable product runtime state.
# Why: Keeps generated dependencies outside the standalone immutable app/ folder.

_FILTEREST_APPLICATION_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
_FILTEREST_INSTALLATION_ROOT="$_FILTEREST_APPLICATION_ROOT"
_FILTEREST_EMBEDDED_EASELECT_ROOT=""

if [[ "$(basename "$_FILTEREST_APPLICATION_ROOT")" == "app" ]] && \
    [[ -f "$_FILTEREST_APPLICATION_ROOT/go.mod" ]] && \
    [[ -f "$_FILTEREST_APPLICATION_ROOT/VERSION_APP" ]]; then
    _FILTEREST_INSTALLATION_ROOT="$(cd "$_FILTEREST_APPLICATION_ROOT/.." && pwd -P)"
    _FILTEREST_OUTER_ROOT="$(cd "$_FILTEREST_INSTALLATION_ROOT/.." && pwd -P)"
    if [[ -e "$_FILTEREST_OUTER_ROOT/.git" ]] && \
        [[ -f "$_FILTEREST_OUTER_ROOT/VERSION_EASELECT" ]]; then
        _FILTEREST_EMBEDDED_EASELECT_ROOT="$_FILTEREST_OUTER_ROOT"
    fi
fi

if [[ -n "$_FILTEREST_EMBEDDED_EASELECT_ROOT" ]]; then
    _FILTEREST_DEFAULT_VENV_DIR="$_FILTEREST_EMBEDDED_EASELECT_ROOT/.venv"
elif [[ "$_FILTEREST_INSTALLATION_ROOT" != "$_FILTEREST_APPLICATION_ROOT" ]]; then
    _FILTEREST_DEFAULT_VENV_DIR="$_FILTEREST_INSTALLATION_ROOT/data/runtime/python/venv"
else
    _FILTEREST_DEFAULT_VENV_DIR="$_FILTEREST_APPLICATION_ROOT/.venv"
fi

if [[ -z "${PROJECT_ROOT:-}" ]]; then
    if [[ -n "$_FILTEREST_EMBEDDED_EASELECT_ROOT" ]]; then
        PROJECT_ROOT="$_FILTEREST_EMBEDDED_EASELECT_ROOT"
    else
        PROJECT_ROOT="$_FILTEREST_INSTALLATION_ROOT"
    fi
fi

if [[ -z "${FILTEREST_PROJECT_VENV_DIR:-}" ]]; then
    FILTEREST_PROJECT_VENV_DIR="${EASELECT_PROJECT_VENV_DIR:-$_FILTEREST_DEFAULT_VENV_DIR}"
fi
EASELECT_PROJECT_VENV_DIR="$FILTEREST_PROJECT_VENV_DIR"
FILTEREST_PROJECT_PYTHON="$FILTEREST_PROJECT_VENV_DIR/bin/python3"
EASELECT_PROJECT_PYTHON="$FILTEREST_PROJECT_PYTHON"

unset _FILTEREST_APPLICATION_ROOT _FILTEREST_INSTALLATION_ROOT
unset _FILTEREST_EMBEDDED_EASELECT_ROOT _FILTEREST_OUTER_ROOT
unset _FILTEREST_DEFAULT_VENV_DIR

# Creates the selected virtual environment and activates it for the caller.
# Connects an optional requirements file with the shared Python interpreter.
# Exists so each tool does not invent its own dependency or runtime location.
ensure_easelect_project_venv() {
    local requirements_file="${1:-}"

    if [[ ! -f "$EASELECT_PROJECT_VENV_DIR/bin/activate" ]]; then
        echo "Creating Filterest Python virtual environment in $EASELECT_PROJECT_VENV_DIR ..."
        python3 -m venv "$EASELECT_PROJECT_VENV_DIR"
    fi

    # shellcheck source=/dev/null
    source "$EASELECT_PROJECT_VENV_DIR/bin/activate"
    EASELECT_PROJECT_PYTHON="$EASELECT_PROJECT_VENV_DIR/bin/python3"
    FILTEREST_PROJECT_PYTHON="$EASELECT_PROJECT_PYTHON"

    if [[ -n "$requirements_file" ]]; then
        if [[ ! -f "$requirements_file" ]]; then
            echo "error: requirements file not found: $requirements_file" >&2
            return 1
        fi
        "$EASELECT_PROJECT_PYTHON" -m pip install -q -r "$requirements_file"
    fi
}
