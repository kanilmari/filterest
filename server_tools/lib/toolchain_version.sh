#!/bin/bash
# toolchain_version.sh: Portable semantic-version checks for required developer toolchains.
# Bridges shell entry points and exact minimum versions without GNU sort dependencies.
# Exists so macOS Bash 3.2 and Linux setup paths reject unsupported Go versions consistently.

EASELECT_MIN_GO_VERSION="1.26.5"

# Compares stable numeric versions such as go1.26.5 and 1.26.5.
easelect_semver_at_least() {
    local actual="${1#go}"
    local required="${2#go}"
    local actual_major actual_minor actual_patch
    local required_major required_minor required_patch

    if [[ "$actual" =~ ^([0-9]+)\.([0-9]+)(\.([0-9]+))?$ ]]; then
        actual_major="${BASH_REMATCH[1]}"
        actual_minor="${BASH_REMATCH[2]}"
        actual_patch="${BASH_REMATCH[4]:-0}"
    else
        return 1
    fi
    if [[ "$required" =~ ^([0-9]+)\.([0-9]+)(\.([0-9]+))?$ ]]; then
        required_major="${BASH_REMATCH[1]}"
        required_minor="${BASH_REMATCH[2]}"
        required_patch="${BASH_REMATCH[4]:-0}"
    else
        return 1
    fi

    if (( 10#$actual_major != 10#$required_major )); then
        (( 10#$actual_major > 10#$required_major ))
        return
    fi
    if (( 10#$actual_minor != 10#$required_minor )); then
        (( 10#$actual_minor > 10#$required_minor ))
        return
    fi
    (( 10#$actual_patch >= 10#$required_patch ))
}

# Reads the version of the Go executable that the calling shell will actually use.
easelect_detect_go_version() {
    command -v go >/dev/null 2>&1 || return 1
    go version 2>/dev/null | awk 'NR == 1 { print $3 }'
}

easelect_go_meets_minimum() {
    local go_version="${1:-}"
    [[ -n "$go_version" ]] || go_version="$(easelect_detect_go_version)" || return 1
    easelect_semver_at_least "$go_version" "$EASELECT_MIN_GO_VERSION"
}
