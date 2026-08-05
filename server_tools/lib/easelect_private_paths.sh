#!/usr/bin/env bash
# easelect_private_paths.sh
# Resolves Easelect/Filterest env and TLS files from a dynamic protected key home.
# Bridges repo-local tooling with the shared path locator while keeping legacy runtimes local.
# Exists so Easelect does not need secret-bearing compatibility files or symlinks in repo root.

easelect_is_private_source_checkout() {
    local project_root="$1"
    [[ -e "$project_root/.git" && -f "$project_root/VERSION_EASELECT" ]]
}

_easelect_resolve_filterest_homes() {
    local project_root="$1"
    local resolver="$project_root/server_tools/lib/filterest_paths.py"
    local resolver_dir=""
    local output=""

    # A previous resolution exports the calculated defaults for downstream
    # consumers. Do not reinterpret those defaults as operator overrides when
    # the same process resolves paths again.
    if [[ "${FILTEREST_PROJECTS_HOME_CONFIGURED:-}" == "0" ]]; then
        unset FILTEREST_PROJECTS_HOME
    fi
    if [[ "${FILTEREST_KEYS_HOME_CONFIGURED:-}" == "0" ]]; then
        unset FILTEREST_KEYS_HOME
    fi

    if [[ ! -f "$resolver" ]]; then
        resolver_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
        resolver="$resolver_dir/filterest_paths.py"
    fi
    [[ -f "$resolver" ]] || {
        printf 'error: dynamic Filterest path resolver is missing: %s\n' "$resolver" >&2
        return 1
    }
    command -v python3 >/dev/null 2>&1 || {
        printf 'error: python3 is required to resolve dynamic Filterest homes\n' >&2
        return 1
    }
    output="$(python3 "$resolver" --project-root "$project_root" --format lines)" || return 1
    FILTEREST_PROJECTS_HOME="$(printf '%s\n' "$output" | sed -n '1p')"
    FILTEREST_KEYS_HOME="$(printf '%s\n' "$output" | sed -n '2p')"
    FILTEREST_PROJECTS_HOME_CONFIGURED="$(printf '%s\n' "$output" | sed -n '3p')"
    FILTEREST_KEYS_HOME_CONFIGURED="$(printf '%s\n' "$output" | sed -n '4p')"
}

# Audits tracked-file boundaries and keeps dynamic child homes ignored locally.
easelect_prepare_local_path_boundaries() {
    local project_root="$1"
    local resolver="$project_root/server_tools/lib/filterest_paths.py"

    [[ -f "$resolver" ]] || {
        printf 'error: dynamic Filterest path resolver is missing: %s\n' "$resolver" >&2
        return 1
    }
    python3 "$resolver" \
        --project-root "$project_root" \
        --audit \
        --render-git-exclude >/dev/null
}

# Adds Dockerfile-specific protection on top of the local Git boundary.
easelect_prepare_docker_context_boundaries() {
    local project_root="$1"
    local resolver="$project_root/server_tools/lib/filterest_paths.py"

    easelect_prepare_local_path_boundaries "$project_root" || return 1
    python3 "$resolver" \
        --project-root "$project_root" \
        --audit \
        --render-dockerignore >/dev/null
}

# Resolves the four derived private paths without reading secret-bearing files.
# Generated runtimes remain root-local until a dynamic keys_home is configured.
easelect_resolve_private_paths() {
    local project_root="$1"
    local development_root=""

    _easelect_resolve_filterest_homes "$project_root" || return 1
    if easelect_is_private_source_checkout "$project_root"; then
        development_root="$FILTEREST_KEYS_HOME/easelect_development"
        EASELECT_RUNTIME_ENV_FILE="$development_root/runtime_environment.env"
        EASELECT_DEV_ENV_FILE="$development_root/development_environment.env"
        EASELECT_TLS_CERT_FILE="$development_root/local_tls_certificate/localhost_certificate.crt"
        EASELECT_TLS_KEY_FILE="$development_root/local_tls_certificate/localhost_private_key.key"
    elif [[ "$FILTEREST_KEYS_HOME_CONFIGURED" == "1" ]]; then
        development_root="$FILTEREST_KEYS_HOME/filterest_runtime"
        EASELECT_RUNTIME_ENV_FILE="$development_root/runtime_environment.env"
        EASELECT_DEV_ENV_FILE="$development_root/development_environment.env"
        EASELECT_TLS_CERT_FILE="$development_root/local_tls_certificate/localhost_certificate.crt"
        EASELECT_TLS_KEY_FILE="$development_root/local_tls_certificate/localhost_private_key.key"
    else
        EASELECT_RUNTIME_ENV_FILE="$project_root/.env"
        EASELECT_DEV_ENV_FILE="$project_root/dev_env.txt"
        EASELECT_TLS_CERT_FILE="$project_root/dev-cert.crt"
        EASELECT_TLS_KEY_FILE="$project_root/dev-cert.key"
    fi

    export EASELECT_RUNTIME_ENV_FILE
    export EASELECT_DEV_ENV_FILE
    export EASELECT_TLS_CERT_FILE
    export EASELECT_TLS_KEY_FILE
    export FILTEREST_PROJECTS_HOME
    export FILTEREST_KEYS_HOME
    export FILTEREST_PROJECTS_HOME_CONFIGURED
    export FILTEREST_KEYS_HOME_CONFIGURED
}
