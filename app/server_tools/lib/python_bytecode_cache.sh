#!/usr/bin/env bash
# Resolves Python bytecode cache state outside the immutable application source.
# Bridges standalone, embedded Easelect, and legacy flat command launchers.
# Exists so ordinary Python-backed commands never generate app/**/__pycache__ entries.

# Configures one canonical bytecode cache before a launcher starts Python.
# An explicit absolute bytecode prefix wins; otherwise ctl's runtime-root
# override or the recognized source layout selects the mutable boundary.
filterest_configure_python_bytecode_cache() {
    local application_root="${1:?application root is required}"
    local installation_root=""
    local outer_root=""
    local runtime_root=""
    local cache_root=""
    local nested_application=0

    application_root="$(cd "$application_root" && pwd -P)"
    if [[ "$(basename "$application_root")" == "app" ]] && \
        [[ -f "$application_root/go.mod" ]] && \
        [[ -f "$application_root/VERSION_APP" ]]; then
        nested_application=1
        installation_root="$(cd "$application_root/.." && pwd -P)"
        outer_root="$(cd "$installation_root/.." && pwd -P)"
    else
        installation_root="$application_root"
    fi

    if [[ -n "${PYTHONPYCACHEPREFIX:-}" ]]; then
        cache_root="$PYTHONPYCACHEPREFIX"
        if [[ "$cache_root" != /* ]]; then
            printf 'error: PYTHONPYCACHEPREFIX must be an absolute path: %s\n' \
                "$cache_root" >&2
            return 1
        fi
    elif [[ -n "${FILTEREST_RUNTIME_ROOT_OVERRIDE:-}" ]]; then
        runtime_root="$FILTEREST_RUNTIME_ROOT_OVERRIDE"
    elif [[ "$nested_application" -eq 1 ]] && \
        [[ -e "$outer_root/.git" ]] && \
        [[ -f "$outer_root/VERSION_EASELECT" ]]; then
        runtime_root="$outer_root/runtime"
    elif [[ "$nested_application" -eq 1 ]]; then
        runtime_root="$installation_root/data/runtime"
    else
        runtime_root="$application_root/runtime"
    fi

    if [[ "$runtime_root" != /* ]]; then
        runtime_root="$installation_root/$runtime_root"
    fi
    runtime_root="${runtime_root%/}"
    if [[ -z "$cache_root" ]]; then
        cache_root="$runtime_root/python-cache"
    fi

    if [[ "$nested_application" -eq 1 ]]; then
        case "$cache_root" in
            "$application_root"|"$application_root"/*)
                printf 'error: Python runtime cache must resolve outside immutable app/: %s\n' \
                    "$cache_root" >&2
                return 1
                ;;
        esac
    fi

    export PYTHONPYCACHEPREFIX="$cache_root"
}
