#!/usr/bin/env bash
# Downloads development-only source dependencies into installation-owned caches.
# Bridges immutable Go source with the mutable module and build cache roots.
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
