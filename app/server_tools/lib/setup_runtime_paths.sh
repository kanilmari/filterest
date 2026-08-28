#!/usr/bin/env bash
# Resolves mutable setup outputs for nested, embedded, and legacy installations.
# Bridges immutable application source with administrator-owned bootstrap files.
# Exists so preview credential handoffs cannot be written below standalone app/.

# Prints the initial-admin handoff path used by the Go bootstrap command.
# Nested standalone paths are absolute installation-owned paths; embedded
# Easelect and legacy flat layouts preserve their established caller contract.
filterest_resolve_initial_admin_handoff_file() {
    local source_root="${1:?source root is required}"
    local installation_root="${2:?installation root is required}"
    local configured_path="${3:-}"
    local candidate_path="${configured_path:-data/bootstrap/initial_admin_credentials.txt}"
    local normalized_source_root=""

    source_root="$(cd "$source_root" && pwd -P)"
    installation_root="$(cd "$installation_root" && pwd -P)"
    if [[ "$source_root" != "$installation_root/app" ]]; then
        printf '%s' "$candidate_path"
        return 0
    fi

    if [[ "$candidate_path" != /* ]]; then
        candidate_path="$installation_root/$candidate_path"
    fi
    candidate_path="$(realpath -m -- "$candidate_path")"
    normalized_source_root="$(realpath -m -- "$source_root")"
    case "$candidate_path" in
        "$normalized_source_root"|"$normalized_source_root"/*)
            printf 'error: initial-admin handoff must resolve outside immutable app/: %s\n' \
                "$candidate_path" >&2
            return 1
            ;;
    esac

    printf '%s' "$candidate_path"
}
