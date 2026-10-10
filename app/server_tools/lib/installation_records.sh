#!/usr/bin/env bash
# installation_records.sh
# Reads, without changing anything, which kind of installation a folder records.
# Bridges the ./filterest launcher and the updater, which must agree on whether a
# folder is a native or a Docker installation before either one acts on it.
# Why one place: a folder that records both would be started, stopped or backed up
# the wrong way, so both commands refuse it with the same rule.

# Bash shows inherited EXIT traps in command substitutions even though they are
# inactive there. Remember this shell, so installing/draining a scanner never
# activates an ancestor's updater cleanup in a substitution.
FILTEREST_RECOVERY_EXIT_OWNER="${BASHPID:-$$}"

# Ordinary, minimal launcher fixtures may omit the recovery-only content helper.
# Every actual content writer requires it and refuses before writing if absent.
if [[ -r "${BASH_SOURCE[0]%/*}/recovery_content_files.sh" ]]; then
    source "${BASH_SOURCE[0]%/*}/recovery_content_files.sh"
fi

# A direct recovery command needs the same signing-key home as the root launcher.
# Explicit composition wins; otherwise recognize the existing app/ layout and
# its optional embedded root. Before key loading, location errors stay fixed.
filterest_recovery_installation_root() {
    local application_root="$1" installation_root="$1" outer_root=""
    if [[ -n "${FILTEREST_PROJECT_ROOT_OVERRIDE:-}" ]]; then
        installation_root="$FILTEREST_PROJECT_ROOT_OVERRIDE"
    elif [[ -n "${FILTEREST_ROOT:-}" ]]; then
        installation_root="$FILTEREST_ROOT"
    elif [[ "${application_root##*/}" == app && -f "$application_root/go.mod" && -f "$application_root/VERSION_APP" ]]; then
        installation_root="$(cd -- "$application_root/.." 2>/dev/null && pwd -P 2>/dev/null)" || { printf 'Recovery installation root unavailable; sensitive details withheld.\n' >&2; return 1; }
        outer_root="$(cd -- "$installation_root/.." 2>/dev/null && pwd -P 2>/dev/null)" || { printf 'Recovery outer root unavailable; sensitive details withheld.\n' >&2; return 1; }
        if [[ -e "$outer_root/.git" && -f "$outer_root/VERSION_EASELECT" ]]; then
            installation_root="$outer_root"
        fi
    fi
    printf '%s' "$installation_root"
}

# Scan shell diagnostics with the same key representations as Python recovery.
# Stdin keeps operator paths out of command arguments; failure withholds the text.
# This reads a safe available key only, never authenticates a packet or writes files.
filterest_redact_recovery_diagnostics() {
    local installation_root="$1"
    local library_directory="${BASH_SOURCE[0]%/*}"
    local diagnostic_prefix="" diagnostic_has_null=0
    # Ordinary commands keep their original streams and never start the scanner.
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
        cat
        return
    fi
    # read -d preserves the prefix before the first NUL. Reinsert that delimiter
    # and stream the remainder, so empty input needs no Python and no bytes vanish.
    IFS= read -r -d '' diagnostic_prefix && diagnostic_has_null=1
    [[ -n "$diagnostic_prefix" || "$diagnostic_has_null" -eq 1 ]] || return 0
    # exec -c removes ALL inherited values, including roots, PATH, Python cache
    # locations and unrelated operator exports. Descriptor 3 carries paths;
    # stdin remains exclusively the diagnostic bytes. -I ignores user imports.
    if ! { printf '%s' "$diagnostic_prefix"
        if [[ "$diagnostic_has_null" -eq 1 ]]; then printf '\0'; cat; fi
    } | (exec -c python3 -I -B -c '
import os, sys
installation_root, library_directory = os.fdopen(3, "rb").read().split(b"\0")[:2]
sys.path.insert(0, os.fsdecode(library_directory))
from database_recovery_packet_io import prime_diagnostic_key, safe_diagnostic
prime_diagnostic_key(os.fsdecode(installation_root))
message = sys.stdin.buffer.read().decode("utf-8", errors="surrogateescape")
sys.stdout.buffer.write(safe_diagnostic(message, utility_escapes=True).encode("utf-8", errors="surrogateescape"))
' 3< <(printf '%s\0%s\0' "$installation_root" "$library_directory")) 2>/dev/null; then
        printf 'Recovery diagnostic unavailable; sensitive details withheld.\n' >&2
    fi
}

# One finite transport for stderr or source diagnostics. Keep the command in
# this shell (settings, arrays and updater state must survive), retain errexit,
# and drain on both normal return and EXIT, including a command that calls exit.
# Nested scans emit to the original destination rather than buffering an already
# scanned explanation again until a launcher exits. Explicit caller redirections
# still win; neither ordinary commands nor empty input starts scanner Python.
filterest_recovery_scan() {
    local installation_root="$1" streams="$2" status=0
    local scanner_descriptor="" scanner_pid="" saved_stderr="" saved_stdout=""
    local previous_exit="" previous_exit_action="" quoted_exit_action="" destination=2
    shift 2
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
        "$@"
        return
    fi
    if filterest_recovery_scan_matches 2; then
        destination="$FILTEREST_RECOVERY_STDERR_DESTINATION"
    fi
    exec {saved_stderr}>&2
    if [[ "$destination" == 2 ]]; then destination="$saved_stderr"; fi
    local -x FILTEREST_RECOVERY_STDERR_DESTINATION="$destination"
    exec {scanner_descriptor}> >(filterest_redact_recovery_diagnostics "$installation_root" >&"$destination" 2>&"$destination")
    scanner_pid=$!
    local -x FILTEREST_RECOVERY_STDERR_PIPE="$scanner_descriptor"
    if [[ "$streams" == both ]]; then exec {saved_stdout}>&1; fi
    if [[ "${FILTEREST_RECOVERY_EXIT_OWNER:-}" == "${BASHPID:-$$}" ]]; then
        previous_exit="$(trap -p EXIT)"
    fi
    local FILTEREST_RECOVERY_EXIT_OWNER="${BASHPID:-$$}"
    if [[ -n "$previous_exit" ]]; then
        previous_exit_action="${previous_exit#trap -- }"
        previous_exit_action="eval -- ${previous_exit_action% EXIT}"
    fi
    printf -v quoted_exit_action '%q' "$previous_exit_action"
    trap "filterest_recovery_scan_exit \"\$?\" $scanner_descriptor $saved_stderr $scanner_pid '${saved_stdout}' $quoted_exit_action" EXIT
    exec 2>&"$scanner_descriptor"
    if [[ "$streams" == both ]]; then exec 1>&"$scanner_descriptor"; fi
    # Do not put this invocation in an ||/if: that would disable the caller's
    # errexit throughout a stateful backup/update implementation.
    "$@"
    status=$?
    filterest_recovery_scan_finish "$scanner_descriptor" "$saved_stderr" "$scanner_pid" "$saved_stdout"
    if [[ -n "$previous_exit" ]]; then eval "$previous_exit"; else trap - EXIT; fi
    return "$status"
}

# Recovery launchers keep a shell so they can drain their scanner. Forward a
# runner-only cancellation to the child and wait for its cleanup before exiting;
# stdin remains live for restore confirmations. Ordinary launchers still exec.
filterest_recovery_child() {
    local child="" status=0 previous_int="$(trap -p INT)" previous_term="$(trap -p TERM)"
    trap 'trap "" INT TERM; [[ -z "$child" ]] || { kill -TERM "$child" 2>/dev/null || true; wait "$child" || true; }; exit 130' INT TERM
    "$@" <&0 &
    child=$!
    wait "$child" || status=$?
    if [[ -n "$previous_int" ]]; then eval "$previous_int"; else trap - INT; fi
    if [[ -n "$previous_term" ]]; then eval "$previous_term"; else trap - TERM; fi
    return "$status"
}

# Descriptor hints cross launcher processes, but inherited environment text must
# never become a Bash redirection diagnostic. Validate both numeric, open FDs and
# the active pipe identity; a caller's file or /dev/null redirection gets its own
# destination. Only scanned text can bypass an enclosing scanner.
filterest_recovery_scan_matches() {
    [[ "${FILTEREST_RECOVERY_STDERR_PIPE:-}" =~ ^[0-9]+$ &&
       "${FILTEREST_RECOVERY_STDERR_DESTINATION:-}" =~ ^[0-9]+$ ]] &&
        [[ -p /dev/fd/$FILTEREST_RECOVERY_STDERR_PIPE &&
           /dev/fd/$1 -ef /dev/fd/$FILTEREST_RECOVERY_STDERR_PIPE ]] &&
        { true >&"$FILTEREST_RECOVERY_STDERR_DESTINATION"; } 2>/dev/null
}

# Restore streams before closing the last writer and waiting. This also works
# in an EXIT trap: there is no Bash temporary function redirection keeping the
# scanner pipe open while the trap waits. Inner EXIT frames drain before outer.
filterest_recovery_scan_finish() {
    local scanner_descriptor="$1" saved_stderr="$2" scanner_pid="$3" saved_stdout="$4"
    exec 2>&"$saved_stderr"
    exec {saved_stderr}>&-
    if [[ -n "$saved_stdout" ]]; then exec 1>&"$saved_stdout"; exec {saved_stdout}>&-; fi
    exec {scanner_descriptor}>&-
    wait "$scanner_pid" || true
}

# Preserve the failed command's status for an existing EXIT handler (the updater
# records recovery instructions there). A conditional status relay keeps errexit
# from skipping that handler when the original status is nonzero.
filterest_recovery_scan_exit() {
    local status="$1" previous_exit_action="$6"
    filterest_recovery_scan_finish "$2" "$3" "$4" "$5"
    if filterest_recovery_scan_status "$status"; then
        eval "$previous_exit_action"
    else
        eval "$previous_exit_action"
    fi
    return "$status"
}

filterest_recovery_scan_status() { return "$1"; }

# Internal data stdout (SQL, paths, inventories) must reach its consumer intact.
# Scan stderr, including utility filename escapes, and wait for it before return.
# Operator-facing stdout uses filterest_recovery_output instead. Callers supply
# the utility's option terminator where it supports one.
filterest_recovery_utility() {
    local installation_root="$1" status=0
    shift
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
        "$@"
        return
    fi
    filterest_recovery_scan "$installation_root" stderr "$@" || status=$?
    if [[ "$status" -ne 0 ]]; then
        filterest_recovery_diagnostic "$installation_root" 'Recovery command failed: %s\n' "$*" >&2
    fi
    return "$status"
}

# grep's status 1 is a normal absent record; status 2 must refuse profile
# discovery. Its filename diagnostics still use the unescaped original input.
filterest_recovery_grep() {
    local installation_root="$1" status=0
    shift
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
        grep "$@"
        return
    fi
    filterest_recovery_scan "$installation_root" stderr grep "$@" || status=$?
    if [[ "$status" -gt 1 ]]; then
        filterest_recovery_diagnostic "$installation_root" 'Recovery record could not be read: %s\n' "$*" >&2
    fi
    return "$status"
}

# Read through a utility argument instead of a caller-side stdin redirection,
# which could echo a vanished/unreadable version file before any wrapper runs.
filterest_recovery_version() {
    local installation_root="$1" filename="$2" content=""
    content="$(filterest_recovery_utility "$installation_root" cat -- "$filename")" || return
    printf '%s' "$content" | tr -d '[:space:]'
}

# Finite commands scan each output stream separately, retaining useful causes,
# stdout/stderr destinations and the original command's exit code.
filterest_recovery_output() {
    local installation_root="$1" status=0
    shift
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
        "$@"
        return
    fi
    filterest_recovery_utility "$installation_root" "$@" |
        filterest_redact_recovery_diagnostics "$installation_root"
    status=${PIPESTATUS[0]}
    return "$status"
}

# Sourcing settings/resolvers must keep their assignments in the caller's shell.
# Treat both streams as diagnostics on stderr, without a pipeline subshell,
# then wait before continuing. Ordinary source calls keep their original streams.
filterest_recovery_source() {
    local installation_root="$1"
    shift
    filterest_recovery_scan "$installation_root" both filterest_recovery_utility "$installation_root" source "$@"
}

# Put the redirection inside the scanned boundary: Bash otherwise prints a
# failed destination before the command wrapper can run. Scan text stdout before
# it becomes a diagnostic/settings file, and preserve command failure status.
filterest_recovery_to_file() {
    local installation_root="$1" destination="$2" status=0 append=0
    shift 2
    if [[ "${1:-}" == --append ]]; then append=1; shift; fi
    filterest_recovery_require_safe_names "$installation_root" "$destination" || return 1
    filterest_recovery_scan "$installation_root" stderr _filterest_recovery_write_file "$installation_root" "$destination" "$append" "$@" || status=$?
    if [[ "$status" -ne 0 ]]; then
        filterest_recovery_diagnostic "$installation_root" 'Recovery file command failed: %s; %s\n' "$destination" "$*" >&2
    fi
    return "$status"
}

_filterest_recovery_write_file() (
    umask 077
    local installation_root="$1" destination="$2" append="$3"
    shift 3
    if [[ "$append" -eq 1 ]]; then
        filterest_recovery_output "$installation_root" "$@" >> "$destination"
    else
        filterest_recovery_output "$installation_root" "$@" > "$destination"
    fi
)

# Legacy instance restore also records operator paths. Refuse a changed/withheld
# scan before creating evidence or printing an invocation containing those paths.
filterest_recovery_require_safe_names() {
    local installation_root="$1" original="" checked=""
    shift
    for original in "$installation_root" "$@"; do
        checked="$(filterest_recovery_diagnostic "$installation_root" '%s' "$original")"
        if [[ "$checked" != "$original" ]]; then
            printf 'Recovery path refused; sensitive details withheld.\n' >&2
            return 1
        fi
    done
}

# Launch a recovery entrypoint without Python's path-bearing startup traceback.
# Keep stdin (including manifest bytes) available; only the trusted script path
# travels on descriptor 3. The entrypoint owns its already-scanned diagnostics.
filterest_recovery_python() {
    filterest_recovery_scan "$1" stderr _filterest_recovery_python "$@"
}

_filterest_recovery_python() {
    local installation_root="$1" interpreter="$2" script="$3" child="" status=0
    local previous_int="$(trap -p INT)" previous_term="$(trap -p TERM)" diagnostic_destination=2
    shift 3
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" != 0 ]] && filterest_recovery_scan_matches 2; then
        diagnostic_destination="$FILTEREST_RECOVERY_STDERR_DESTINATION"
    fi
    # A runner-only signal must reach Python and wait for its bounded cleanup.
    # Restore caller traps after normal completion; an extra function subshell
    # would put another shell between the runner's PID and these forwarding traps.
    trap 'trap "" INT TERM; [[ -z "$child" ]] || { kill -TERM "$child" 2>/dev/null || true; wait "$child" || true; }; exit 130' INT TERM
    "$interpreter" -I -B -c '
import os, runpy, sys
script = os.fsdecode(os.fdopen(3, "rb").read())
sys.path.insert(0, os.path.dirname(script))
sys.argv[0] = "Filterest recovery"
try:
    from database_recovery_packet_io import set_diagnostic_stderr
    set_diagnostic_stderr(os.fdopen(4, "w", encoding="utf-8", errors="surrogateescape", buffering=1))
    runpy.run_path(script, run_name="__main__")
except SystemExit:
    raise
except BaseException:
    sys.stderr.write("Recovery entrypoint unavailable; sensitive details withheld.\n")
    sys.exit(1)
' "$@" <&0 3< <(printf '%s' "$script") 4>&"$diagnostic_destination" &
    child=$!
    wait "$child" || status=$?
    if [[ -n "$previous_int" ]]; then eval "$previous_int"; else trap - INT; fi
    if [[ -n "$previous_term" ]]; then eval "$previous_term"; else trap - TERM; fi
    return "$status"
}

filterest_recovery_diagnostic() {
    local installation_root="$1"
    shift
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
        printf "$@"
        return
    fi
    if filterest_recovery_scan_matches 1; then
        printf "$@" | filterest_redact_recovery_diagnostics "$installation_root" >&"$FILTEREST_RECOVERY_STDERR_DESTINATION" 2>&"$FILTEREST_RECOVERY_STDERR_DESTINATION"
    else
        printf "$@" | filterest_redact_recovery_diagnostics "$installation_root"
    fi
}

# Prints "docker" when keys/docker.env records the Docker install profile, read by
# the Docker runner, its only reader; prints nothing when there is no such record.
filterest_docker_install_profile() {
    local docker_runner="$1"
    local installation_root="$2"

    [[ -f "$docker_runner" ]] || return 0
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
        # Reuse the runner's own profile reader in an isolated shell, without
        # adding a public environment switch that could disable its recovery scan.
        (
            export FILTEREST_PROJECT_ROOT_OVERRIDE="$installation_root"
            FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY=1 source "$docker_runner"
            main profile
        )
    else
        FILTEREST_PROJECT_ROOT_OVERRIDE="$installation_root" filterest_recovery_utility "$installation_root" "$docker_runner" profile
    fi
}

# Prints each native setup record that exists, one path per line: the setup
# completion marker, even as a broken link, and each native settings file that
# names an install profile. A settings file alone is not a native record, because
# the Docker runner creates one for administrator-managed secrets too.
filterest_native_setup_records() {
    local completion_marker="$1"
    shift
    local settings_file="" status=0

    if [[ -e "$completion_marker" || -L "$completion_marker" ]]; then
        printf '%s\n' "$completion_marker"
    fi
    for settings_file in "$@"; do
        [[ -n "$settings_file" && -f "$settings_file" ]] || continue
        if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
            if grep -Eq '^FILTEREST_INSTALL_PROFILE=.' "$settings_file"; then
                printf '%s\n' "$settings_file"
            fi
            continue
        fi
        status=0
        filterest_recovery_grep "${PROJECT_ROOT:-${FILTEREST_ROOT:-.}}" -Eq '^FILTEREST_INSTALL_PROFILE=.' -- "$settings_file" || status=$?
        if [[ "$status" -eq 0 ]]; then
            printf '%s\n' "$settings_file"
        elif [[ "$status" -gt 1 ]]; then
            return "$status"
        fi
    done
}

# Refuses a folder that records a Docker installation and a native one at once.
# Omit operator paths here, before authenticated recovery has begun.
filterest_refuse_mixed_installation() {
    local docker_profile="$1"
    shift

    [[ "$docker_profile" == "docker" && "$#" -gt 0 ]] || return 0
    if [[ "${FILTEREST_RECOVERY_OUTPUT:-1}" == 0 ]]; then
        printf 'error: this installation records both a Docker installation (keys/docker.env) and a native one (%s); keep only the records of the way Filterest runs here\n' "$*" >&2
    else
        # Profile refusal precedes packet verification; do not echo operator paths.
        printf 'error: this installation records both a Docker installation (keys/docker.env) and a native one; keep only the records of the way Filterest runs here\n' >&2
    fi
    return 1
}
