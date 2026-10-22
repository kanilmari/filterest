#!/bin/sh
# build_stamp_ldflags.sh
# Produces validated source metadata and linker flags with a UTC build time.
# Connects the exact public app directory to native, release and image compilers.
# Prevents Gitless copies from borrowing an enclosing repository's identity.
set -eu

stamp_package=easelect/backend/core_components/build_stamp

# Print a source pair only for the repository directly containing APP_DIR.
# Git errors (including unsafe ownership) leave the source unknown.
stamp_source() (
    [ -n "$1" ] || exit 0
    app_dir=$(cd "$1" 2>/dev/null && pwd -P) || exit 0
    source_root=$(cd "$app_dir/.." && pwd -P) || exit 0
    git_root=$(git -C "$app_dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
    [ "$git_root" = "$source_root" ] || exit 0
    commit=$(git -C "$app_dir" rev-parse HEAD 2>/dev/null) || exit 0
    case "$commit" in ''|*[!0-9a-f]*) exit 0 ;; esac
    [ "${#commit}" -eq 40 ] || exit 0
    status=$(git -C "$source_root" status --porcelain 2>/dev/null) || exit 0
    dirty=false
    [ -z "$status" ] || dirty=true
    printf '%s %s\n' "$commit" "$dirty"
)

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || { printf 'Usage: %s source|ldflags APP_DIR [--require-clean]\n' "$0" >&2; exit 1; }
command=$1
app_dir=$2
case "$command:${3:-}" in
    source:|ldflags:|ldflags:--require-clean) ;;
    *) printf 'Invalid build stamp command or option\n' >&2; exit 1 ;;
esac
source_pair=$(stamp_source "$app_dir")
if [ "$command" = source ]; then
    [ -z "$source_pair" ] || printf '%s\n' "$source_pair"
    exit 0
fi
if [ "${3:-}" = --require-clean ]; then
    case "$source_pair" in
        *' false') ;;
        *) printf 'Build stamp requires a known commit and clean source tree\n' >&2; exit 1 ;;
    esac
fi
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -n "$source_pair" ]; then
    printf '%s ' "-X $stamp_package.gitCommit=${source_pair% *} -X $stamp_package.sourceDirty=${source_pair#* }"
fi
printf '%s\n' "-X $stamp_package.builtAt=$built"
