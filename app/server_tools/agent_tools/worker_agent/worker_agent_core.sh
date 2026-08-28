#!/usr/bin/env bash
# ==============================================================================
# worker_agent_core.sh — Delegate tasks to a background AI worker agent.
#
# Model-agnostic task runner. Supports Codex CLI and Claude Code CLI as backends.
# Solves the bash-escaping problem by always passing prompts via file, never
# as shell arguments. Supports multiple input modes and auto-generates
# timestamped output folders.
#
# Usage (via root wrapper ./worker_agent):
#   ./worker_agent "do something"                       # inline prompt
#   ./worker_agent --prompt-file path/to/prompt.md      # prompt from file
#   ./worker_agent --ticket agent_tasks/_db_dump/<id-slug>/ticket.md
#   echo "do something" | ./worker_agent -              # stdin
#   ./worker_agent --help                               # show usage
#   ./worker_agent --list                               # list recent runs
#   ./worker_agent --status <task_id>                   # check run status
#   ./worker_agent --stop <task_id>                     # stop a running run
#
# Environment:
#   WORKER_AGENT_BACKEND    Override backend selection (see worker_agent_defaults.sh).
#   WORKER_AGENT_DRY_RUN    If "1", print the prompt and exit without running.
#   WORKER_CLAUDE_MODEL     Claude model alias/ID (see worker_agent_defaults.sh).
#
# Output:
#   agent_tasks/_artifacts/worker_runs/YYYY-MM-DD--HH-MM--<task_id>/
#     prompt_<task_id>.md          — the prompt sent to the worker
#     progress_<task_id>.md        — lightweight worker progress snapshot
#     worker_summary_<task_id>.md  — worker's summary (read this)
#     worker_log_<task_id>.txt     — full verbose log
#     .worker_done_<task_id>       — sentinel file
#     run_status.txt               — human-readable run state
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILTEREST_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WORKSPACE_ROOT="${FILTEREST_WORKSPACE_ROOT:-$FILTEREST_ROOT}"

# Load defaults from the single source of truth before sourcing helper modules.
source "$FILTEREST_ROOT/server_tools/agent_tools/worker_agent_defaults.sh"

# Priority: family= CLI arg > WORKER_AGENT_BACKEND env > DEFAULT_BACKEND
REQUESTED_BACKEND=""
BACKEND="${WORKER_AGENT_BACKEND:-$DEFAULT_BACKEND}"
DRY_RUN="${WORKER_AGENT_DRY_RUN:-0}"
CLAUDE_MODEL="${WORKER_CLAUDE_MODEL:-$DEFAULT_CLAUDE_MODEL}"
DEFAULT_OUTPUT_DIR_REL="${FILTEREST_WORKER_OUTPUT_DIR_REL:-agent_tasks/_artifacts/worker_runs}"
LEGACY_OUTPUT_DIR_REL="${FILTEREST_WORKER_LEGACY_OUTPUT_DIR_REL:-agent_tasks/20_in_progress}"
WORKER_DEV_PORT="${FILTEREST_WORKER_DEV_PORT:-8100}"
WORKER_DB_PORT="${FILTEREST_WORKER_DB_PORT:-5432}"
PROGRESS_MARKER_SECONDS="${WORKER_AGENT_PROGRESS_MARKER_SECONDS:-20}"
PROGRESS_MINUTE_SECONDS="${WORKER_AGENT_PROGRESS_MINUTE_SECONDS:-60}"
STATUS_QUIET_SECONDS="${WORKER_AGENT_STATUS_QUIET_SECONDS:-60}"
STATUS_STUCK_SECONDS="${WORKER_AGENT_STATUS_STUCK_SECONDS:-180}"
STOP_GRACE_SECONDS="${WORKER_AGENT_STOP_GRACE_SECONDS:-5}"

# ---------------------------------------------------------------------------- #
# Colors & helpers
# ---------------------------------------------------------------------------- #
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$*" >&2; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*" >&2; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$*" >&2; }
err()   { printf "${RED}✗${NC} %s\n" "$*" >&2; }

progress_elapsed_label() {
    local elapsed="$1"
    local minute_seconds="${PROGRESS_MINUTE_SECONDS:-60}"
    if (( minute_seconds > 0 )); then
        local relative=$(( elapsed % minute_seconds ))
        if (( relative == 0 )); then
            relative=$minute_seconds
        fi
        printf "%d" "$relative"
    else
        printf "%d" "$elapsed"
    fi
}

progress_print_minute_header() {
    local elapsed="$1"
    local fd="${2:-1}"
    local minute_seconds="${PROGRESS_MINUTE_SECONDS:-60}"
    local minute=0
    if (( minute_seconds > 0 )); then
        minute=$(( elapsed / minute_seconds ))
    fi
    printf "%d min " "$minute" >&"$fd"
}

progress_artifact_signature() {
    local artifact_path=""
    for artifact_path in "$@"; do
        [[ -e "$artifact_path" ]] || continue
        stat -c '%n:%Y:%s' "$artifact_path" 2>/dev/null || true
    done
}

progress_run_artifact_signature() {
    local run_dir="$1"
    local task_id="$2"
    progress_artifact_signature \
        "$run_dir/worker_log_${task_id}.txt" \
        "$run_dir/worker_summary_${task_id}.md" \
        "$run_dir/run_status.txt" \
        "$run_dir/progress_${task_id}.md" \
        "$run_dir/.worker_done_${task_id}"
}

progress_poll_marker() {
    local current_signature="${1:-}"
    local previous_signature="${2:-}"
    if [[ "$current_signature" != "$previous_signature" ]]; then
        printf ":"
    else
        printf "."
    fi
}

progress_maybe_wrap_minute() {
    local elapsed="$1"
    local minute_had_activity="${2:-0}"
    local fd="${3:-1}"
    local minute_seconds="${PROGRESS_MINUTE_SECONDS:-60}"
    if (( minute_seconds > 0 )) && (( elapsed > 0 )) && (( elapsed % minute_seconds == 0 )); then
        printf "\n" >&"$fd"
        if [[ "$minute_had_activity" != "1" ]]; then
            printf "(thinking or idling)\n" >&"$fd"
        fi
        progress_print_minute_header "$elapsed" "$fd"
        return 0
    fi
    return 1
}

status_artifact_latest_mtime() {
    local latest_mtime=0
    local artifact_path=""
    for artifact_path in "$@"; do
        [[ -e "$artifact_path" ]] || continue
        local artifact_mtime=0
        artifact_mtime=$(stat -c %Y "$artifact_path" 2>/dev/null || echo 0)
        if (( artifact_mtime > latest_mtime )); then
            latest_mtime=$artifact_mtime
        fi
    done
    printf "%s" "$latest_mtime"
}

status_age_seconds() {
    local latest_mtime="${1:-0}"
    if [[ -z "$latest_mtime" || "$latest_mtime" == "0" ]]; then
        printf "%s" "-1"
        return 0
    fi
    local now
    now=$(date +%s)
    printf "%s" "$(( now - latest_mtime ))"
}

status_age_label() {
    local age_seconds="${1:- -1}"
    if [[ "$age_seconds" == "-1" ]]; then
        printf "%s" "unknown"
    else
        printf "%ss ago" "$age_seconds"
    fi
}

status_pid_state() {
    local pid_file="${1:-}"
    if [[ -z "$pid_file" || ! -f "$pid_file" ]]; then
        printf "%s" "missing"
        return 0
    fi

    local worker_pid=""
    worker_pid=$(cat "$pid_file" 2>/dev/null || true)
    if [[ -z "$worker_pid" ]]; then
        printf "%s" "empty"
        return 0
    fi

    if kill -0 "$worker_pid" 2>/dev/null; then
        printf "%s" "alive"
    else
        printf "%s" "dead"
    fi
}

status_yes_no() {
    local flag="${1:-0}"
    if [[ "$flag" == "1" ]]; then
        printf "%s" "yes"
    else
        printf "%s" "no"
    fi
}

status_classification() {
    local done_present="${1:-0}"
    local exit_code="${2:-1}"
    local summary_present="${3:-0}"
    local pid_state="${4:-missing}"
    local last_change_age="${5:- -1}"

    if [[ "$done_present" == "1" ]]; then
        if (( exit_code == 0 )); then
            printf "%s" "done"
        else
            printf "%s" "failed"
        fi
        return 0
    fi

    if [[ "$summary_present" == "1" ]]; then
        printf "%s" "finalizing"
        return 0
    fi

    if [[ "$pid_state" != "alive" ]]; then
        printf "%s" "likely stuck"
        return 0
    fi

    if [[ "$last_change_age" == "-1" ]]; then
        printf "%s" "quiet"
        return 0
    fi

    if (( last_change_age > STATUS_STUCK_SECONDS )); then
        printf "%s" "likely stuck"
    elif (( last_change_age > STATUS_QUIET_SECONDS )); then
        printf "%s" "quiet"
    else
        printf "%s" "active"
    fi
}

status_detail_label() {
    local classification="${1:-unknown}"
    local elapsed_s="${2:-0}"
    local last_change_age="${3:- -1}"

    case "$classification" in
        done|failed)
            printf "%ss" "$elapsed_s"
            ;;
        *)
            printf "%s" "$(status_age_label "$last_change_age")"
            ;;
    esac
}

# ---------------------------------------------------------------------------- #
# Sourced helper modules
# ---------------------------------------------------------------------------- #
source "$SCRIPT_DIR/worker_agent_run_state.sh"
source "$SCRIPT_DIR/worker_agent_prompt_builder.sh"
source "$SCRIPT_DIR/worker_agent_backend_runner.sh"

# ---------------------------------------------------------------------------- #
# Usage
# ---------------------------------------------------------------------------- #
usage() {
    cat <<'EOF'
worker_agent — Delegate tasks to a background AI worker.

USAGE:
  ./worker_agent "<prompt>"                         Inline prompt
  ./worker_agent --prompt-file <path>               Read prompt from file
  ./worker_agent --ticket <ticket.md>               Extract tasks from a DB dump or legacy ticket
  echo "prompt" | ./worker_agent -                  Read prompt from stdin
  ./worker_agent --list                             List recent runs
  ./worker_agent --status <task_id>                 Check task status
  ./worker_agent --stop <task_id>                   Stop a running task
  ./worker_agent --wait [task_id]                   Block until task completes, print summary
  ./worker_agent --help                             Show this help

BACKEND SELECTION (family=):
  ./worker_agent family=claude "..."                Force Claude backend
  ./worker_agent family=codex "..."                 Force Codex backend
  ./worker_agent "..."                              Uses default from worker_agent_defaults.sh
  ./worker_agent family=auto "..."                  Claude first, Codex fallback

  The family= parameter can appear anywhere in the arguments.
  Default is set in worker_agent_defaults.sh.
  Use family=auto for the Claude → Codex fallback chain.
  Env var WORKER_AGENT_BACKEND overrides the default; family= overrides both.

OPTIONS:
  --task-id <id>            Override auto-generated task ID
  --background              Run in background (default: foreground with progress)
  --research                Read-only mode for research tasks (no file modifications)
  --full-access             Full system access for Codex (danger-full-access sandbox). ON by default.
  --no-full-access          Restrict Codex to workspace-write sandbox (no DB, no network).
  --dry-run                 Print prompt and exit without running worker
  --no-summary-instr        Don't append summary instruction (advanced)
  --claude-model <model>    Claude model alias or full ID.
                            Examples: sonnet, opus, claude-sonnet-4-6, claude-opus-4-6
  --output-dir <path>       Override output directory (default: agent_tasks/_artifacts/worker_runs/).
                            Relative paths resolve from project root.

ENVIRONMENT:
  WORKER_AGENT_BACKEND    Override: codex, claude, or auto (default in worker_agent_defaults.sh)
  WORKER_AGENT_DRY_RUN    Set to "1" for dry-run mode
  WORKER_CLAUDE_MODEL     Claude model override (default in worker_agent_defaults.sh)

EXAMPLES:
  ./worker_agent "Audit all foreign keys in the SQL dump"
  ./worker_agent family=claude "Refactor the payment handler"
  ./worker_agent family=codex --full-access "Analyze orphan lang keys from DB"
  ./worker_agent --background "Long running task" && ./worker_agent --wait
  ./worker_agent --stop long_running_task
  ./worker_agent --prompt-file prompts/fk_audit.md
  ./db_task dump 123 && ./worker_agent --ticket agent_tasks/_db_dump/0123-some-ticket/ticket.md
  ./worker_agent --research "Which files import extractLangValue?"
  WORKER_AGENT_BACKEND=claude ./worker_agent --research "Trace all callers of processPayment"

OUTPUT:
  Results are written to agent_tasks/_artifacts/worker_runs/YYYY-MM-DD--HH-MM--<id>/
  The summary file is the primary output — full log is for debugging.
EOF
    exit 0
}

# ---------------------------------------------------------------------------- #
# Main: parse arguments
# ---------------------------------------------------------------------------- #
PROMPT=""
PROMPT_FILE=""
TICKET_FILE=""
TASK_ID=""
CUSTOM_OUTPUT_DIR=""
BACKGROUND=false
RESEARCH_MODE=false
NO_SUMMARY_INSTR=false
STDIN_MODE=false
FULL_ACCESS=true
FINALIZER_WRITE_SENTINEL=true
WAIT_AFTER=false
WAIT_TASK_ID_ARG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            usage
            ;;
        --list|-l)
            list_runs
            ;;
        --status|-s)
            shift
            check_status "${1:?--status requires a task_id}"
            ;;
        --stop)
            shift
            stop_task "${1:?--stop requires a task_id}"
            ;;
        --wait|-w)
            WAIT_AFTER=true
            if [[ $# -gt 1 && "${2:0:1}" != "-" ]]; then
                shift
                WAIT_TASK_ID_ARG="$1"
            fi
            ;;
        family=*)
            REQUESTED_BACKEND="${1#family=}"
            ;;
        --prompt-file|-f)
            shift
            PROMPT_FILE="${1:?--prompt-file requires a path}"
            ;;
        --ticket|-t)
            shift
            TICKET_FILE="${1:?--ticket requires a path}"
            ;;
        --task-id|-i)
            shift
            TASK_ID="${1:?--task-id requires an identifier}"
            ;;
        --background|-b)
            BACKGROUND=true
            ;;
        --research|-r)
            RESEARCH_MODE=true
            ;;
        --dry-run|-d)
            DRY_RUN=1
            ;;
        --no-summary-instr)
            NO_SUMMARY_INSTR=true
            ;;
        --full-access)
            FULL_ACCESS=true
            ;;
        --no-full-access)
            FULL_ACCESS=false
            ;;
        --claude-model)
            shift
            CLAUDE_MODEL="${1:?--claude-model requires a model name (e.g. sonnet, opus, claude-sonnet-4-6)}"
            ;;
        --output-dir|-o)
            shift
            CUSTOM_OUTPUT_DIR="${1:?--output-dir requires a path}"
            ;;
        -)
            STDIN_MODE=true
            ;;
        -*)
            err "Unknown option: $1"
            echo "Use --help for usage."
            exit 1
            ;;
        *)
            if [[ -z "$PROMPT" ]]; then
                PROMPT="$1"
            else
                err "Multiple positional arguments. Use quotes around your prompt."
                exit 1
            fi
            ;;
    esac
    shift
done

if [[ "$BACKGROUND" == true && "$WAIT_AFTER" == true ]]; then
    err "Error: --background and --wait cannot be used together. Use --background first, then --wait <task_id>."
    exit 1
fi

# ---------------------------------------------------------------------------- #
# Resolve backend from family= parameter
# ---------------------------------------------------------------------------- #
if [[ -n "$REQUESTED_BACKEND" ]]; then
    case "$REQUESTED_BACKEND" in
        claude) BACKEND="claude" ;;
        codex)  BACKEND="codex" ;;
        auto)   BACKEND="auto" ;;
        *)
            err "Unknown family: $REQUESTED_BACKEND (expected: claude, codex, or auto)"
            exit 1
            ;;
    esac
fi

# ---------------------------------------------------------------------------- #
# Resolve prompt from the chosen input mode
# ---------------------------------------------------------------------------- #
INPUT_MODES=0
[[ -n "$PROMPT" ]] && INPUT_MODES=$((INPUT_MODES + 1))
[[ -n "$PROMPT_FILE" ]] && INPUT_MODES=$((INPUT_MODES + 1))
[[ -n "$TICKET_FILE" ]] && INPUT_MODES=$((INPUT_MODES + 1))
[[ "$STDIN_MODE" == true ]] && INPUT_MODES=$((INPUT_MODES + 1))

if (( INPUT_MODES == 0 )); then
    if [[ "$WAIT_AFTER" == true ]]; then
        wait_for_task "$WAIT_TASK_ID_ARG"
    fi
    err "No prompt provided. Use one of: inline string, --prompt-file, --ticket, or stdin (-)."
    echo "Use --help for usage."
    exit 1
fi

if (( INPUT_MODES > 1 )); then
    err "Multiple input modes specified. Use only one."
    exit 1
fi

if [[ -n "$PROMPT_FILE" ]]; then
    if [[ ! -f "$PROMPT_FILE" ]]; then
        err "Prompt file not found: $PROMPT_FILE"
        exit 1
    fi
    PROMPT=$(cat "$PROMPT_FILE")
    info "Prompt loaded from file: $PROMPT_FILE"
elif [[ -n "$TICKET_FILE" ]]; then
    PROMPT=$(extract_ticket_prompt "$TICKET_FILE")
    if [[ -z "$TASK_ID" ]]; then
        TASK_ID=$(basename "$TICKET_FILE" .md \
            | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-\(req\|bug\|inc\|epic\)-//' \
            | tr '[:upper:]' '[:lower:]' \
            | tr -cs '[:alnum:]' '-' \
            | sed 's/^-//;s/-$//' \
            | cut -c1-50)
    fi
    info "Prompt extracted from ticket: $TICKET_FILE"
elif [[ "$STDIN_MODE" == true ]]; then
    PROMPT=$(cat)
    info "Prompt read from stdin"
fi

if [[ -z "$PROMPT" ]]; then
    err "Prompt is empty."
    exit 1
fi

# ---------------------------------------------------------------------------- #
# Generate task_id if not provided
# ---------------------------------------------------------------------------- #
generate_task_id() {
    local prompt_text="$1"
    local words
    words=$(echo "$prompt_text" \
        | tr '[:upper:]' '[:lower:]' \
        | tr -cs '[:alnum:]' ' ' \
        | tr -s ' ' \
        | sed 's/^ //;s/ $//' \
        | awk '{for(i=1;i<=NF && i<=4;i++) printf "%s_", $i}' \
        | sed 's/_$//')
    echo "${words:0:40}"
}

if [[ -z "$TASK_ID" ]]; then
    TASK_ID=$(generate_task_id "$PROMPT")
    if [[ -z "$TASK_ID" ]]; then
        TASK_ID="task"
    fi
fi
info "Task ID: $TASK_ID"

# ---------------------------------------------------------------------------- #
# Create timestamped output folder
# ---------------------------------------------------------------------------- #
TIMESTAMP=$(date +"%Y-%m-%d--%H-%M")
OUTPUT_DIR_NAME="${TIMESTAMP}--${TASK_ID}"
if [[ -n "$CUSTOM_OUTPUT_DIR" ]]; then
    if [[ "$CUSTOM_OUTPUT_DIR" == /* ]]; then
        OUTPUT_DIR="$CUSTOM_OUTPUT_DIR/$OUTPUT_DIR_NAME"
    else
        OUTPUT_DIR="$WORKSPACE_ROOT/$CUSTOM_OUTPUT_DIR/$OUTPUT_DIR_NAME"
    fi
else
    OUTPUT_DIR="$(default_output_dir_abs)/$OUTPUT_DIR_NAME"
fi
mkdir -p "$OUTPUT_DIR"
info "Output folder: $OUTPUT_DIR_NAME/"

SUMMARY_FILE="$OUTPUT_DIR/worker_summary_${TASK_ID}.md"
LOG_FILE="$OUTPUT_DIR/worker_log_${TASK_ID}.txt"
DONE_FILE="$OUTPUT_DIR/.worker_done_${TASK_ID}"
RUN_STATUS_FILE="$OUTPUT_DIR/run_status.txt"
PROGRESS_FILE="$OUTPUT_DIR/progress_${TASK_ID}.md"
PID_FILE="$OUTPUT_DIR/worker.pid"

# ---------------------------------------------------------------------------- #
# Write prompt to file and append worker-specific instructions
# ---------------------------------------------------------------------------- #
PROMPT_SAVE_FILE="$OUTPUT_DIR/prompt_${TASK_ID}.md"
echo "$PROMPT" > "$PROMPT_SAVE_FILE"
ok "Prompt saved to: $PROMPT_SAVE_FILE"
write_progress_snapshot "running"
write_run_status "running"
append_worker_prompt_instructions "$PROMPT_SAVE_FILE" "$OUTPUT_DIR_NAME" "$TASK_ID"

# ---------------------------------------------------------------------------- #
# Dry run — print and exit
# ---------------------------------------------------------------------------- #
if [[ "$DRY_RUN" == "1" ]]; then
    echo ""
    printf "${BOLD}=== DRY RUN — Prompt that would be sent ===${NC}\n"
    cat "$PROMPT_SAVE_FILE"
    printf "${BOLD}=== END DRY RUN ===${NC}\n"
    echo ""
    info "Task ID: $TASK_ID"
    info "Output dir: $OUTPUT_DIR_NAME/"
    info "Backend: $BACKEND"
    exit 0
fi

rm -f "$SUMMARY_FILE" "$DONE_FILE" "$PID_FILE"
trap 'finalize_run' EXIT INT TERM HUP

cd "$WORKSPACE_ROOT"
run_selected_backend

if [[ "$WAIT_AFTER" == true && -n "$TASK_ID" ]]; then
    wait_for_task "$TASK_ID"
fi
