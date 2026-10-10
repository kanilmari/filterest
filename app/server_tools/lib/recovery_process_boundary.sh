#!/usr/bin/env bash
# recovery_process_boundary.sh
# Encloses each named recovery command before its application body runs.
# Connects fixed bootstrap refusals with the shared process output scanner.
# Reentry requires interpreter-owned state, never an inherited environment flag.

filterest_recovery_process_entry() {
    local script="$1" application_root="$2"
    shift 2
    # The supervisor creates a nonexported readonly value in this exact -c
    # interpreter, with the source frame at line 1 of its own -c command. An
    # environment value or a BASH_ENV-created readonly variable in a directly
    # executed script cannot forge that interpreter-owned call frame.
    if [[ "${FUNCNAME[1]:-}" == source && "${BASH_LINENO[1]:-0}" == 1 &&
          "${BASH_EXECUTION_STRING:-}" == 'unset FILTEREST_RECOVERY_PROCESS_PID; readonly FILTEREST_RECOVERY_PROCESS_PID="$BASHPID"; source "$0" "$@"' &&
          "$(declare -p FILTEREST_RECOVERY_PROCESS_PID 2>/dev/null)" == "declare -r FILTEREST_RECOVERY_PROCESS_PID=\"${BASHPID}\"" ]]; then
        return 0
    fi
    # Paths and the original environment are private data, not interpreter argv.
    # Empty environment / isolated Python also protect interpreter startup.
    command -v python3 >/dev/null 2>&1 || { printf 'Recovery interpreter unavailable; sensitive details withheld.\n' >&2; exit 1; }
    exec -c python3 -B -I -c '
import os, sys
try:
    script, application, environment = os.fdopen(3, "rb").read().split(b"\0", 2)
    completion = b"\0Filterest recovery environment complete\0"
    if not environment.endswith(completion):
        raise RuntimeError("Recovery environment unavailable")
    environment = environment[:-len(completion)]
    sys.path.insert(0, os.fsdecode(application) + "/server_tools/lib")
    from recovery_process_boundary import shell_entrypoint
    sys.stderr = os.fdopen(4, "w", buffering=1)
    status = shell_entrypoint(os.fsdecode(script), os.fsdecode(application), sys.argv[1:], environment)
except BaseException:
    os.write(4, b"Recovery process boundary unavailable; sensitive details withheld.\n")
    status = 1
sys.exit(status)
' "$@" 3< <(printf '%s\0%s\0' "$script" "$application_root"; command env -0 2>/dev/null && printf '\0Filterest recovery environment complete\0') 4>&2 2>/dev/null
}
