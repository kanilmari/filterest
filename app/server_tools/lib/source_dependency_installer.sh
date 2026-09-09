#!/usr/bin/env bash
# Downloads development-only source dependencies into installation-owned caches.
# Bridges tracked dependency manifests with installation-owned package and tool caches.
# Exists so setup cannot report success after a failed dependency download.

# Downloads Go modules and preserves only the final diagnostic lines on failure.
# A non-zero Go exit is returned to the setup caller without being hidden by tail.
filterest_download_go_modules() {
    local source_root="${1:?source root is required}"
    local runtime_root="${2:?runtime root is required}"

    mkdir -p "$runtime_root/go/module-cache" "$runtime_root/go/build-cache"
    if (
        set -o pipefail
        (
            cd "$source_root"
            GOMODCACHE="$runtime_root/go/module-cache" \
                GOCACHE="$runtime_root/go/build-cache" \
                GOFLAGS=-mod=readonly \
                go mod download
        ) 2>&1 | tail -3
    ); then
        return 0
    fi

    printf 'error: Go module download failed; setup is incomplete\n' >&2
    return 1
}

# Installs the lockfile-selected Node tree and invalidates the completion receipt
# before any attempt so a failed reinstall cannot later look successful.
# source_root owns the manifests; embedding callers pass their own build root.
filterest_install_node_dependencies() {
    local source_root="${1:?source root is required}"
    local runtime_root="${2:?runtime root is required}"
    local dependency_root="${3:-$runtime_root/node}"
    local marker="$runtime_root/node/.filterest-source-manifests.sha256"
    local signature=""

    [[ ! -L "$dependency_root" && ! -L "$dependency_root/node_modules" ]] || {
        printf 'error: dependency directories must not be symbolic links\n' >&2
        return 1
    }
    signature="$(cd "$source_root" && sha256sum package.json package-lock.json)" || return 1
    if [[ -d "$dependency_root/node_modules" && -f "$marker" ]] && \
        [[ "$(cat "$marker")" == "$signature" ]]; then
        printf 'Node dependencies match the tracked manifests.\n'
        return 0
    fi
    mkdir -p "$dependency_root" "$runtime_root/node/npm-cache" || return 1
    rm -f -- "$marker"
    if [[ "$dependency_root" != "$source_root" ]]; then
        cp "$source_root/package.json" "$source_root/package-lock.json" "$dependency_root/" || return 1
    fi
    if ! (
        set -o pipefail
        npm_config_cache="$runtime_root/node/npm-cache" \
            npm --prefix "$dependency_root" ci --no-audit --no-fund 2>&1 | tail -20
    ); then
        printf 'error: Node dependency installation failed; setup is incomplete\n' >&2
        return 1
    fi
    printf '%s\n' "$signature" > "$marker"
}

# Completes the public development tools independently of database provisioning.
# The caller supplies toolchains; full setup may also install browser OS libraries.
filterest_install_development_dependencies() (
    set -euo pipefail
    local source_root="${1:?source root is required}"
    local runtime_root="${2:?runtime root is required}"
    local browser_host_dependencies="${3:-0}"
    local completion_marker="$runtime_root/development-dependencies-complete"
    local browser_arguments=(install chromium)

    mkdir -p "$runtime_root"
    rm -f -- "$completion_marker"
    filterest_install_node_dependencies "$source_root" "$runtime_root"
    filterest_download_go_modules "$source_root" "$runtime_root"
    export FILTEREST_PROJECT_VENV_DIR="$runtime_root/python/venv"
    export PIP_CACHE_DIR="$runtime_root/python/pip-cache"
    source "$source_root/server_tools/lib/project_python_venv.sh"
    ensure_easelect_project_venv "$source_root/testing/python/requirements.txt"
    export PLAYWRIGHT_BROWSERS_PATH="$runtime_root/playwright"
    [[ "$browser_host_dependencies" != "1" ]] || browser_arguments+=(--with-deps)
    "$runtime_root/node/node_modules/.bin/playwright" "${browser_arguments[@]}"
    printf 'profile=development\n' > "$completion_marker"
)
