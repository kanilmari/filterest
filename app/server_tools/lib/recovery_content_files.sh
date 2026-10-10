#!/usr/bin/env bash
# recovery_content_files.sh
# Streams content through the shared packet scanner into private staging files.
# Connects shell dump/settings/metadata writers with exclusive, owned cleanup.
# Producer or scanner failures preserve pre-existing destinations and their status.

filterest_recovery_content_stream() {
    local installation_root="$1" mode="${2:-plain}"
    local library_directory="${BASH_SOURCE[0]%/*}"
    shift 2
    python3 -I -B -c '
import os, sys
try:
    root, library, mode, *names = os.fdopen(3, "rb").read().split(b"\0")[:-1]
    sys.path.insert(0, os.fsdecode(library))
    from recovery_content_stream import main
    status = main(os.fsdecode(root), os.fsdecode(mode), list(map(os.fsdecode, names)))
except BaseException:
    sys.stderr.write("Recovery content scanner unavailable; file withheld.\n")
    status = 1
sys.exit(status)
' 3< <(printf '%s\0' "$installation_root" "$library_directory" "$mode" "$@")
}

filterest_recovery_content_names() {
    filterest_recovery_content_stream "$1" names "${@:2}" < /dev/null
}

filterest_recovery_extract_zip() {
    filterest_recovery_content_stream "$1" zip "${@:2}" < /dev/null
}

# The finite controller reports scanner refusal before readiness; its daemon
# closes all inherited descriptors and keeps scanning until the server stops.
filterest_recovery_native_start() {
    local library_directory="${BASH_SOURCE[0]%/*}"
    python3 -I -B -c '
import os, sys
try:
    library, *arguments = os.fdopen(3, "rb").read().split(b"\0")[:-1]
    sys.path.insert(0, os.fsdecode(library))
    from recovery_native_runtime import start
    status = start(*map(os.fsdecode, arguments))
except BaseException:
    sys.stderr.write("Recovery native startup unavailable; start failed.\n")
    status = 1
sys.exit(status)
' 3< <(printf '%s\0' "$library_directory" "$@")
}

# The generator stays in Bash so functions and descriptors remain usable.
# Append scans old and new bytes as one stream, including their joining boundary.
filterest_recovery_content_to_file() {
    filterest_recovery_scan "$1" stderr _filterest_recovery_content_to_file "$@"
}

_filterest_recovery_content_to_file() (
    # Privacy starts at allocation, including the first empty redirection.
    # The subshell keeps the caller's mask (and ordinary commands) unchanged.
    umask 077
    local installation_root="$1" destination="$2" stage="" owned=0 status=0 mode=plain append=0 exclusive=0
    shift 2
    while [[ "${1:-}" == --gzip || "${1:-}" == --append || "${1:-}" == --exclusive ]]; do
        case "$1" in --gzip) mode=gzip ;; --append) append=1 ;; --exclusive) exclusive=1 ;; esac
        shift
    done
    filterest_recovery_content_names "$installation_root" "$destination" || return 1
    [[ ! -L "$destination" && ( ! -e "$destination" || -f "$destination" ) ]] || {
        printf 'Recovery content destination refused.\n' >&2; return 1;
    }
    stage="$(filterest_recovery_content_stream "$installation_root" temporary-name -- "${destination}.partial.XXXXXX")" || return
    trap '[[ "$owned" -eq 0 ]] || filterest_recovery_output "$installation_root" rm -f -- "$stage"' EXIT
    local FILTEREST_RECOVERY_EXIT_OWNER="${BASHPID:-$$}"
    trap 'exit 130' INT TERM HUP
    # Redirection must succeed before the builtin records ownership; a bare
    # variable assignment runs even on failed redirection and would claim an
    # old file. Bash defers signal traps until this builtin has finished.
    set -C
    builtin printf -v owned '%s' 1 > "$stage" || return
    set +C
    set -o pipefail
    if [[ "$mode" == gzip ]]; then
        local stream_status=() index=0
        # Check decoded compressor output too; an unexpected compressor stream
        # must not bypass the archive-content promise. Capture all statuses in a
        # conditional group so a decode failure cannot hide a real tool failure.
        if {
            filterest_recovery_utility "$installation_root" "$@" |
                filterest_recovery_content_stream "$installation_root" plain |
                gzip -9 | filterest_recovery_content_stream "$installation_root" gzip > "$stage"
            stream_status=("${PIPESTATUS[@]}")
        }; then :; fi
        for index in 0 1 2 3; do
            [[ "${stream_status[$index]}" -eq 0 ]] || status="${stream_status[$index]}"
        done
        for index in 2 1 0; do
            if [[ "${stream_status[$index]}" -gt 0 && "${stream_status[$index]}" -lt 128 ]]; then
                status="${stream_status[$index]}"; break
            fi
        done
    else
        {
            if [[ "$append" -eq 1 ]]; then
                filterest_recovery_utility "$installation_root" cat -- "$destination" || exit "$?"
            fi
            filterest_recovery_utility "$installation_root" "$@"
        } | filterest_recovery_content_stream "$installation_root" plain > "$stage" || status=$?
    fi
    [[ "$status" -eq 0 ]] || return "$status"
    filterest_recovery_output "$installation_root" chmod 600 -- "$stage" || return
    if [[ "$exclusive" -eq 1 ]]; then
        filterest_recovery_content_stream "$installation_root" publish "$stage" "$destination" < /dev/null
    else
        filterest_recovery_output "$installation_root" mv -f -- "$stage" "$destination"
    fi
)

# Directories/empty files carry names too. Ordinary callers keep their old path.
filterest_recovery_mktemp() (
    umask 077
    local installation_root="$1"
    shift
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" != 0 || -n "${FILTEREST_RECOVERY_CONTENT_ROOT:-}" ]]; then
        filterest_recovery_content_stream "$installation_root" temporary "$@" < /dev/null
    else
        filterest_recovery_utility "$installation_root" mktemp "$@"
    fi
)

# OpenSSL's two output descriptors are scanned independently and drained before
# either private TLS artifact is published. No generated key lands in raw staging.
filterest_recovery_tls_identity() (
    umask 077
    local installation_root="$1" certificate="$2" private_key="$3" certificate_stage="" key_stage=""
    local certificate_fd="" key_fd="" certificate_pid="" key_pid="" status=0 certificate_owned=0 key_owned=0
    shift 3
    filterest_recovery_content_names "$installation_root" "$certificate" "$private_key" || return 1
    [[ ! -e "$certificate" && ! -L "$certificate" && ! -e "$private_key" && ! -L "$private_key" ]] || return 1
    certificate_stage="$(filterest_recovery_content_stream "$installation_root" temporary-name -- "${certificate}.partial.XXXXXX")" || return
    trap '[[ "$certificate_owned" -eq 0 ]] || filterest_recovery_output "$installation_root" rm -f -- "$certificate_stage"; [[ "$key_owned" -eq 0 ]] || filterest_recovery_output "$installation_root" rm -f -- "$key_stage"' EXIT
    local FILTEREST_RECOVERY_EXIT_OWNER="${BASHPID:-$$}"
    trap 'exit 130' INT TERM HUP
    set -C
    builtin printf -v certificate_owned '%s' 1 > "$certificate_stage" || return
    set +C
    key_stage="$(filterest_recovery_content_stream "$installation_root" temporary-name -- "${private_key}.partial.XXXXXX")" || return
    set -C
    builtin printf -v key_owned '%s' 1 > "$key_stage" || return
    set +C
    exec {certificate_fd}> >(filterest_recovery_content_stream "$installation_root" plain > "$certificate_stage")
    certificate_pid=$!
    exec {key_fd}> >(exec {certificate_fd}>&-; filterest_recovery_content_stream "$installation_root" plain > "$key_stage")
    key_pid=$!
    filterest_recovery_utility "$installation_root" openssl req "$@" \
        -out "/dev/fd/$certificate_fd" -keyout "/dev/fd/$key_fd" || status=$?
    exec {certificate_fd}>&-
    exec {key_fd}>&-
    wait "$certificate_pid" || status=$?
    wait "$key_pid" || status=$?
    [[ "$status" -eq 0 ]] || return "$status"
    # Exclusive links never overwrite a file another run created meanwhile.
    filterest_recovery_output "$installation_root" ln -- "$certificate_stage" "$certificate" || return
    if ! filterest_recovery_output "$installation_root" ln -- "$key_stage" "$private_key"; then
        filterest_recovery_output "$installation_root" rm -f -- "$certificate"
        return 1
    fi
)
