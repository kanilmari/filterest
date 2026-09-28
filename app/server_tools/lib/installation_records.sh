#!/usr/bin/env bash
# installation_records.sh
# Reads, without changing anything, which kind of installation a folder records.
# Bridges the ./filterest launcher and the updater, which must agree on whether a
# folder is a native or a Docker installation before either one acts on it.
# Why one place: a folder that records both would be started, stopped or backed up
# the wrong way, so both commands refuse it with the same rule.

# Prints "docker" when keys/docker.env records the Docker install profile, read by
# the Docker runner, its only reader; prints nothing when there is no such record.
filterest_docker_install_profile() {
    local docker_runner="$1"
    local installation_root="$2"

    [[ -f "$docker_runner" ]] || return 0
    FILTEREST_PROJECT_ROOT_OVERRIDE="$installation_root" "$docker_runner" profile
}

# Prints each native setup record that exists, one path per line: the setup
# completion marker, even as a broken link, and each native settings file that
# names an install profile. A settings file alone is not a native record, because
# the Docker runner creates one for administrator-managed secrets too.
filterest_native_setup_records() {
    local completion_marker="$1"
    shift
    local settings_file=""

    if [[ -e "$completion_marker" || -L "$completion_marker" ]]; then
        printf '%s\n' "$completion_marker"
    fi
    for settings_file in "$@"; do
        [[ -n "$settings_file" && -f "$settings_file" ]] || continue
        if grep -Eq '^FILTEREST_INSTALL_PROFILE=.' "$settings_file"; then
            printf '%s\n' "$settings_file"
        fi
    done
}

# Refuses a folder that records a Docker installation and a native one at once,
# naming the records' paths and never their contents.
filterest_refuse_mixed_installation() {
    local docker_profile="$1"
    shift

    [[ "$docker_profile" == "docker" && "$#" -gt 0 ]] || return 0
    printf 'error: this installation records both a Docker installation (keys/docker.env) and a native one (%s); keep only the records of the way Filterest runs here\n' "$*" >&2
    return 1
}
