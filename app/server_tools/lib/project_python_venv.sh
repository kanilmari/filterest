#!/usr/bin/env bash
# project_python_venv.sh
# Prepares and activates the repository-level Python virtual environment.
# Between local Python app launchers and project-root .venv it centralizes
# dependency installation so small tools do not each create their own .venv.

if [[ -z "${PROJECT_ROOT:-}" ]]; then
    _CANONICAL_FILTEREST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    _EMBEDDED_EASELECT_ROOT="$(cd "$_CANONICAL_FILTEREST_ROOT/.." && pwd)"
    if [[ -e "$_EMBEDDED_EASELECT_ROOT/.git" && -f "$_EMBEDDED_EASELECT_ROOT/VERSION_EASELECT" ]]; then
        PROJECT_ROOT="$_EMBEDDED_EASELECT_ROOT"
    else
        PROJECT_ROOT="$_CANONICAL_FILTEREST_ROOT"
    fi
    unset _CANONICAL_FILTEREST_ROOT _EMBEDDED_EASELECT_ROOT
fi

EASELECT_PROJECT_VENV_DIR="${EASELECT_PROJECT_VENV_DIR:-$PROJECT_ROOT/.venv}"
EASELECT_PROJECT_PYTHON="$EASELECT_PROJECT_VENV_DIR/bin/python3"

ensure_easelect_project_venv() {
    local requirements_file="${1:-}"

    if [[ ! -f "$EASELECT_PROJECT_VENV_DIR/bin/activate" ]]; then
        echo "Creating repository Python virtual environment in $EASELECT_PROJECT_VENV_DIR ..."
        python3 -m venv "$EASELECT_PROJECT_VENV_DIR"
    fi

    # shellcheck source=/dev/null
    source "$EASELECT_PROJECT_VENV_DIR/bin/activate"
    EASELECT_PROJECT_PYTHON="$EASELECT_PROJECT_VENV_DIR/bin/python3"

    if [[ -n "$requirements_file" ]]; then
        if [[ ! -f "$requirements_file" ]]; then
            echo "error: requirements file not found: $requirements_file" >&2
            return 1
        fi
        "$EASELECT_PROJECT_PYTHON" -m pip install -q -r "$requirements_file"
    fi
}
