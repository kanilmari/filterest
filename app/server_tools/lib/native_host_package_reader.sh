#!/usr/bin/env bash
# native_host_package_reader.sh
# Reads the native package contract without evaluating release-owned text.
# Shared by setup and the installed updater's verified-target preflight.
# Keeps future package additions and PostgreSQL defaults visible before downtime.

filterest_native_host_packages() {
    local list="$1" profile="$2" major_override="${3:-}" selection="${4:-required}"
    local group="" package="" extra="" major="" entry="" database_count=0
    local entries=() packages=()
    [[ "$profile" == admin || "$profile" == development ]] || return 1
    [[ "$selection" == required || "$selection" == database || "$selection" == major ]] || return 1
    # A release list is data, never shell source; reject the entire list before
    # returning any package names or accepting a caller's PostgreSQL override.
    while read -r group package extra || [[ -n "$group$package$extra" ]]; do
        [[ -n "$group" && "$group" != \#* ]] || continue
        [[ -z "$extra" ]] || return 1
        case "$group" in
            postgresql-major)
                [[ -z "$major" && "$package" =~ ^[1-9][0-9]*$ ]] || return 1
                major="$package"
                ;;
            common|database|development) entries+=("$group $package") ;;
            *) return 1 ;;
        esac
    done < "$list"
    [[ -n "$major" && "${#entries[@]}" -gt 0 ]] || return 1
    major="${major_override:-$major}"
    [[ "$major" =~ ^[1-9][0-9]*$ ]] || return 1
    for entry in "${entries[@]}"; do
        group="${entry%% *}" package="${entry#* }"
        package="${package//@POSTGRESQL_MAJOR@/$major}"
        [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]+$ ]] || return 1
        if [[ "$group" == database ]]; then database_count=$((database_count + 1)); fi
        if [[ "$selection" == database ]]; then
            [[ "$group" == database ]] || continue
        elif [[ "$profile" != development && "$group" == development ]]; then
            continue
        fi
        packages+=("$package")
    done
    [[ "${#packages[@]}" -gt 0 && "$database_count" -gt 0 ]] || return 1
    if [[ "$selection" == major ]]; then printf '%s\n' "$major"
    else printf '%s\n' "${packages[@]}"; fi
}
