# Golden Sample: Script Outcome Reporting

This file is the reference implementation of
[truthful outcome reporting](../instructions_and_documentation/DEV_GUIDE.md#truthful-outcome-reporting)
for Bash scripts. It is stored as a `.md` file to prevent execution, but the
code block below is valid Bash.

The contract is the same in every language; a new language gets its own sample,
written from these four points, before its first production script:

1. Name every step and number it (`2/3`) as it starts.
2. Record each step's result instead of assuming it.
3. Stop at the first failure when later steps depend on it. Let independent
   checks continue, and record their failures too.
4. Decide the ending from the recorded results. When every step succeeded, print
   one success message and exit with status 0. Otherwise print a different
   message naming what failed or did not run, and exit with a non-zero status.

```bash
#!/usr/bin/env bash
# golden_sample_script_outcome.sh
# Checks the local development services in numbered steps and reports the true outcome.
# Between the operator's terminal and the database, application and storage it checks.
# Exists as the template for every script that tells the person whether it succeeded.
set -uo pipefail

STEPS=("Database answers" "Application answers" "Storage folder is writable")
succeeded=0
failed=()

check_database() { pg_isready -q -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5433}"; }
check_application() { curl -skf -o /dev/null --max-time 10 "${APP_URL:-https://localhost:8082/}"; }
check_storage_writable() {
    local probe
    probe=$(mktemp "${STORAGE_ROOT:-/tmp}/outcome-probe.XXXXXX") && rm -f "$probe"
}

# Runs one numbered step and records its result; never decides the ending itself.
run_step() {
    local number=$1 name=$2
    shift 2
    printf '%s/%s %s ... ' "$number" "${#STEPS[@]}" "$name"
    if "$@"; then
        echo "ok"
        succeeded=$((succeeded + 1))
    else
        echo "FAILED"
        failed+=("$name")
    fi
}

run_step 1 "${STEPS[0]}" check_database
# The application cannot answer without its database, so a database failure
# stops this step instead of adding a second, dependent failure.
if [ "${#failed[@]}" -eq 0 ]; then
    run_step 2 "${STEPS[1]}" check_application
fi
# Storage does not depend on the other checks, so it always runs.
run_step 3 "${STEPS[2]}" check_storage_writable

if [ "${#failed[@]}" -eq 0 ] && [ "$succeeded" -eq "${#STEPS[@]}" ]; then
    echo "Completed: ${succeeded}/${#STEPS[@]} steps succeeded."
    exit 0
fi

failed_names=$(printf '%s, ' "${failed[@]}")
not_run=$(( ${#STEPS[@]} - succeeded - ${#failed[@]} ))
summary="NOT completed: ${succeeded}/${#STEPS[@]} steps succeeded; failed: ${failed_names%, }"
if [ "$not_run" -gt 0 ]; then
    summary+="; not run: ${not_run}"
fi
echo "$summary" >&2
exit 1
```
