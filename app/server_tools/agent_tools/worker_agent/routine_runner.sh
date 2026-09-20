#!/usr/bin/env bash
# ==============================================================================
# routine_runner.sh — Multi-step routine orchestrator for worker_agent.
#
# Reads a JSON routine definition and executes each step sequentially,
# passing previous step output as context to the next step.
# Each step delegates to worker_agent_core.sh with the appropriate backend.
#
# Usage (via root wrapper):
#   ./worker_agent --routine file_name_convention_checker  # run a routine
#   ./worker_agent --routine --list                     # list available routines
#   ./worker_agent --routine file_name_convention_checker --dry-run  # preview
#
# Product routine definitions live beside this runner in routines/*.json.
# FILTEREST_WORKER_ROUTINES_DIR may add installation-specific overrides.
#
# JSON schema for routine definitions:
#   {
#     "name": "example_routine",
#     "description": "Run a reusable multi-step workflow",
#     "steps": [
#       {
#         "name": "scan_for_issues",
#         "description": "Scan documentation for errors and gaps",
#         "backend": "codex",
#         "fallback_backend": "claude",
#         "prompt_template": "..."
#       },
#       ...
#     ]
#   }
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILTEREST_APPLICATION_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WORKSPACE_ROOT="${FILTEREST_WORKSPACE_ROOT:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
PUBLIC_ROUTINES_DIR="$SCRIPT_DIR/routines"
ROUTINE_OVERRIDE_DIR="${FILTEREST_WORKER_ROUTINES_DIR:-}"
WORKER_CORE="$SCRIPT_DIR/worker_agent_core.sh"
RUNS_DIR="$WORKSPACE_ROOT/${FILTEREST_WORKER_OUTPUT_DIR_REL:-agent_tasks/_artifacts/worker_runs}"
LEGACY_RUNS_DIR="$WORKSPACE_ROOT/${FILTEREST_WORKER_LEGACY_OUTPUT_DIR_REL:-agent_tasks/20_in_progress}"

# ---------------------------------------------------------------------------- #
# Colors & helpers
# ---------------------------------------------------------------------------- #
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$*" >&2; }
err()   { printf "${RED}✗${NC} %s\n" "$*" >&2; }
header(){ printf "\n${BOLD}═══ %s ═══${NC}\n\n" "$*"; }

routine_search_dirs() {
    if [[ -n "$ROUTINE_OVERRIDE_DIR" && "$ROUTINE_OVERRIDE_DIR" != "$PUBLIC_ROUTINES_DIR" ]]; then
        printf '%s\n' "$ROUTINE_OVERRIDE_DIR"
    fi
    printf '%s\n' "$PUBLIC_ROUTINES_DIR"
}

json_file_value() {
    local json_file="$1"
    local field_name="$2"
    local default_value="${3:-}"
    python3 -c '
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    value = json.load(source).get(sys.argv[2], sys.argv[3])
if isinstance(value, bool):
    print(str(value).lower())
elif value is None:
    print("")
else:
    print(value)
' "$json_file" "$field_name" "$default_value"
}

json_text_value() {
    local json_text="$1"
    local field_name="$2"
    local default_value="${3:-}"
    python3 -c '
import json
import sys

value = json.loads(sys.argv[1]).get(sys.argv[2], sys.argv[3])
if isinstance(value, bool):
    print(str(value).lower())
elif value is None:
    print("")
else:
    print(value)
' "$json_text" "$field_name" "$default_value"
}

json_step_count() {
    python3 -c 'import json, sys; print(len(json.load(open(sys.argv[1], encoding="utf-8")).get("steps", [])))' "$1"
}

json_step_at() {
    python3 -c '
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    step = json.load(source).get("steps", [])[int(sys.argv[2])]
print(json.dumps(step, ensure_ascii=False, separators=(",", ":")))
' "$1" "$2"
}

json_step_names() {
    python3 -c '
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    steps = json.load(source).get("steps", [])
for step in steps:
    print(step.get("name") or step.get("id") or "step")
' "$1"
}

find_latest_worker_dir() {
    local task_id="$1"
    local dir found="" found_name=""
    for dir in "$RUNS_DIR"/*"--${task_id}" "$RUNS_DIR"/*"--${task_id}"/ "$LEGACY_RUNS_DIR"/*"--${task_id}" "$LEGACY_RUNS_DIR"/*"--${task_id}"/; do
        [[ -d "$dir" ]] || continue
        local folder_name
        folder_name=$(basename "$dir")
        if [[ -z "$found_name" || "$folder_name" > "$found_name" ]]; then
            found="$dir"
            found_name="$folder_name"
        fi
    done
    [[ -n "$found" ]] && printf '%s\n' "$found"
}

write_routine_status() {
    local routine_dir="$1"
    local status="$2"
    {
        printf 'routine=%s\n' "$ROUTINE_NAME"
        printf 'status=%s\n' "$status"
        printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    } > "$routine_dir/run_status.txt"
}

# ---------------------------------------------------------------------------- #
# Check dependencies
# ---------------------------------------------------------------------------- #
check_deps() {
    if ! command -v python3 &>/dev/null; then
        err "python3 is required for routine execution."
        exit 1
    fi
}

# ---------------------------------------------------------------------------- #
# --list: show available routines
# ---------------------------------------------------------------------------- #
list_routines() {
    header "Available routines"
    local count=0
    local routine_dir routine_file name desc steps
    declare -A seen_names=()
    while IFS= read -r routine_dir; do
        for routine_file in "$routine_dir"/*.json; do
            [[ -f "$routine_file" ]] || continue
            name=$(json_file_value "$routine_file" name unnamed)
            [[ -n "${seen_names[$name]:-}" ]] && continue
            seen_names["$name"]=1
            desc=$(json_file_value "$routine_file" description "no description")
            steps=$(json_step_count "$routine_file")
            printf "  ${BOLD}%-30s${NC} %s ${DIM}(%d steps)${NC}\n" "$name" "$desc" "$steps"
            count=$((count + 1))
        done
    done < <(routine_search_dirs)
    if (( count == 0 )); then
        warn "No routines found in the product or override routine directories."
    else
        echo ""
        info "Run with: ./worker_agent --routine <name>"
    fi
    exit 0
}

# ---------------------------------------------------------------------------- #
# Find routine JSON file by name (exact → prefix → substring)
# ---------------------------------------------------------------------------- #
find_routine() {
    local name="$1"
    local routine_dir routine_file routine_name

    # 1. Exact match
    while IFS= read -r routine_dir; do
        routine_file="$routine_dir/${name}.json"
        if [[ -f "$routine_file" ]]; then
            echo "$routine_file"
            return 0
        fi
    done < <(routine_search_dirs)

    # 2. Prefix match (e.g. "doc" → "documentation_audit")
    local prefix_matches=()
    declare -A prefix_seen_names=()
    while IFS= read -r routine_dir; do
        for routine_file in "$routine_dir"/*.json; do
            [[ -f "$routine_file" ]] || continue
            routine_name=$(json_file_value "$routine_file" name "")
            [[ -n "${prefix_seen_names[$routine_name]:-}" ]] && continue
            prefix_seen_names["$routine_name"]=1
            if [[ "$routine_name" == "$name"* ]]; then
                prefix_matches+=("$routine_file")
            fi
        done
    done < <(routine_search_dirs)
    if (( ${#prefix_matches[@]} == 1 )); then
        echo "${prefix_matches[0]}"
        return 0
    elif (( ${#prefix_matches[@]} > 1 )); then
        err "Ambiguous prefix '$name'. Matches:"
        for routine_file in "${prefix_matches[@]}"; do
            err "  $(json_file_value "$routine_file" name unnamed)"
        done
        return 1
    fi

    # 3. Substring match (e.g. "audit" → "documentation_audit")
    local sub_matches=()
    declare -A sub_seen_names=()
    while IFS= read -r routine_dir; do
        for routine_file in "$routine_dir"/*.json; do
            [[ -f "$routine_file" ]] || continue
            routine_name=$(json_file_value "$routine_file" name "")
            [[ -n "${sub_seen_names[$routine_name]:-}" ]] && continue
            sub_seen_names["$routine_name"]=1
            if [[ "$routine_name" == *"$name"* ]]; then
                sub_matches+=("$routine_file")
            fi
        done
    done < <(routine_search_dirs)
    if (( ${#sub_matches[@]} == 1 )); then
        echo "${sub_matches[0]}"
        return 0
    elif (( ${#sub_matches[@]} > 1 )); then
        err "Ambiguous name '$name'. Matches:"
        for routine_file in "${sub_matches[@]}"; do
            err "  $(json_file_value "$routine_file" name unnamed)"
        done
        return 1
    fi

    err "Routine not found: $name"
    local available_names=()
    declare -A available_seen_names=()
    while IFS= read -r routine_dir; do
        for routine_file in "$routine_dir"/*.json; do
            [[ -f "$routine_file" ]] || continue
            routine_name=$(json_file_value "$routine_file" name "")
            [[ -n "${available_seen_names[$routine_name]:-}" ]] && continue
            available_seen_names["$routine_name"]=1
            available_names+=("$routine_name")
        done
    done < <(routine_search_dirs)
    err "Available routines: ${available_names[*]:-none}"
    return 1
}

# ---------------------------------------------------------------------------- #
# Substitute template variables in a prompt
# ---------------------------------------------------------------------------- #
render_prompt() {
    local template="$1"
    local prev_summary_file="${2:-}"
    local routine_output_dir="$3"
    local step_index="$4"

    # Quicktest: prepend scope-limiting instruction
    if [[ "$QUICKTEST" == "true" ]]; then
        local quicktest_prefix
        quicktest_prefix=$'\u26a1 QUICKTEST MODE: This is a quick validation run. Limit your work to a maximum of 5 findings/items. Do NOT do an exhaustive scan \u2014 check only a small representative sample (3-5 files per category). Finish as fast as possible.\n\n---\n\n'
        template="${quicktest_prefix}${template}"
    fi

    # Replace {{WORKSPACE_ROOT}}
    local rendered="${template//\{\{WORKSPACE_ROOT\}\}/$WORKSPACE_ROOT}"

    # Replace {{FILTEREST_APPLICATION_ROOT}} with the maintained app source root.
    rendered="${rendered//\{\{FILTEREST_APPLICATION_ROOT\}\}/$FILTEREST_APPLICATION_ROOT}"

    # Replace {{DATE}} with current date
    local today
    today=$(date +"%Y-%m-%d")
    rendered="${rendered//\{\{DATE\}\}/$today}"

    # Replace {{DATETIME}} with current datetime
    local now
    now=$(date +"%Y-%m-%d--%H-%M")
    rendered="${rendered//\{\{DATETIME\}\}/$now}"

    # Replace {{PREVIOUS_OUTPUT}} with content of previous step's summary
    if [[ -n "$prev_summary_file" && -f "$prev_summary_file" ]]; then
        local prev_content
        prev_content=$(cat "$prev_summary_file")
        # Use awk for safe multi-line substitution
        rendered=$(echo "$rendered" | awk -v r="$prev_content" '{gsub(/\{\{PREVIOUS_OUTPUT\}\}/, r); print}')
    else
        rendered="${rendered//\{\{PREVIOUS_OUTPUT\}\}/[No previous output — this is the first step]}"
    fi

    echo "$rendered"
}

# ---------------------------------------------------------------------------- #
# Execute a single step via worker_agent_core.sh
# ---------------------------------------------------------------------------- #
run_step() {
    local step_json="$1"
    local step_index="$2"
    local total_steps="$3"
    local routine_output_dir="$4"
    local prev_summary_file="${5:-}"
    local dry_run="$6"

    local step_name step_desc backend fallback_backend prompt_template research_mode full_access
    step_name=$(json_text_value "$step_json" name step)
    step_desc=$(json_text_value "$step_json" description "")
    backend=$(json_text_value "$step_json" backend auto)
    fallback_backend=$(json_text_value "$step_json" fallback_backend "")
    prompt_template=$(json_text_value "$step_json" prompt_template "")
    research_mode=$(json_text_value "$step_json" research false)
    full_access=$(json_text_value "$step_json" full_access false)

    header "Step $((step_index + 1))/$total_steps: $step_name" >&2
    [[ -n "$step_desc" ]] && info "$step_desc" >&2
    info "Backend: $backend$([ -n "$fallback_backend" ] && echo " (fallback: $fallback_backend)")" >&2

    # Render prompt with template variables
    local rendered_prompt
    rendered_prompt=$(render_prompt "$prompt_template" "$prev_summary_file" "$routine_output_dir" "$step_index")

    # Build task_id for this step
    local task_id="routine-${step_name}"

    # Write the rendered prompt to a temp file
    local prompt_file="$routine_output_dir/step_${step_index}_prompt_${step_name}.md"
    echo "$rendered_prompt" > "$prompt_file"
    ok "Step prompt written to: $(basename "$prompt_file")" >&2

    if [[ "$dry_run" == "true" ]]; then
        echo "" >&2
        printf "${BOLD}--- Step $((step_index + 1)) prompt preview ---${NC}\n" >&2
        cat "$prompt_file" >&2
        printf "${BOLD}--- end preview ---${NC}\n" >&2
        return 0
    fi

    # Build worker_agent_core.sh arguments
    local args=()
    args+=(--prompt-file "$prompt_file")
    args+=(--task-id "$task_id")
    args+=("family=$backend")
    [[ "$research_mode" == "true" ]] && args+=(--research)
    [[ "$full_access" == "true" ]] && args+=(--full-access)
    [[ -n "$CLAUDE_MODEL" ]] && args+=(--claude-model "$CLAUDE_MODEL")

    # Run the step
    info "Launching worker for step $((step_index + 1))..." >&2
    local step_exit=0
    bash "$WORKER_CORE" "${args[@]}" || step_exit=$?

    # Find the summary file that worker_agent_core.sh created
    local step_summary=""
    local latest_dir
    latest_dir=$(find_latest_worker_dir "$task_id")
    if [[ -n "$latest_dir" && -d "$latest_dir" ]]; then
        step_summary=$(find "$latest_dir" -name "worker_summary_*.md" 2>/dev/null | head -1)
        if [[ -n "$step_summary" && -f "$step_summary" ]]; then
            # Copy summary into routine output dir for easy access
            cp "$step_summary" "$routine_output_dir/step_${step_index}_summary_${step_name}.md"
            ok "Step summary: step_${step_index}_summary_${step_name}.md" >&2
        fi
    fi

    if (( step_exit != 0 )); then
        warn "Step $((step_index + 1)) ($step_name) exited with code $step_exit"

        # Try fallback backend if configured
        if [[ -n "$fallback_backend" && "$fallback_backend" != "$backend" ]]; then
            warn "Trying fallback backend: $fallback_backend" >&2
            args=()
            args+=(--prompt-file "$prompt_file")
            args+=(--task-id "${task_id}-fallback")
            args+=("family=$fallback_backend")
            [[ "$research_mode" == "true" ]] && args+=(--research)
            [[ "$full_access" == "true" ]] && args+=(--full-access)
            [[ -n "$CLAUDE_MODEL" ]] && args+=(--claude-model "$CLAUDE_MODEL")

            step_exit=0
            bash "$WORKER_CORE" "${args[@]}" || step_exit=$?

            latest_dir=$(find_latest_worker_dir "${task_id}-fallback")
            if [[ -n "$latest_dir" && -d "$latest_dir" ]]; then
                step_summary=$(find "$latest_dir" -name "worker_summary_*.md" 2>/dev/null | head -1)
                if [[ -n "$step_summary" && -f "$step_summary" ]]; then
                    cp "$step_summary" "$routine_output_dir/step_${step_index}_summary_${step_name}.md"
                    ok "Fallback summary: step_${step_index}_summary_${step_name}.md" >&2
                fi
            fi

            if (( step_exit != 0 )); then
                err "Step $((step_index + 1)) failed on both backends. Aborting routine."
                return 1
            fi
        else
            err "Step $((step_index + 1)) failed. Aborting routine."
            return 1
        fi
    fi

    # Return the path to the summary for the next step
    echo "$routine_output_dir/step_${step_index}_summary_${step_name}.md"
    return 0
}

# ---------------------------------------------------------------------------- #
# Main
# ---------------------------------------------------------------------------- #
check_deps

DRY_RUN=false
ROUTINE_NAME=""
QUICKTEST=false
CLAUDE_MODEL=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --list|-l)
            list_routines
            ;;
        --dry-run|-d)
            DRY_RUN=true
            ;;
        --quicktest|-q)
            QUICKTEST=true
            ;;
        --claude-model)
            shift
            CLAUDE_MODEL="${1:?--claude-model requires a model name (e.g. sonnet, opus, claude-sonnet-4-6)}"
            ;;
        --help|-h)
            cat <<'EOF'
routine_runner — Run multi-step AI routines.

USAGE:
  ./worker_agent --routine <name>               Run a routine
  ./worker_agent --routine --list               List available routines
  ./worker_agent --routine <name> --dry-run     Preview prompts without running
  ./worker_agent --routine <name> --quicktest   Run with reduced scope (5 items max)
  ./worker_agent --routine <name> --claude-model opus  Use specific Claude model

Product routines are JSON files beside this runner in routines/. An optional
FILTEREST_WORKER_ROUTINES_DIR adds installation-specific routines and overrides
same-named product routines.
Steps run sequentially; each step's output is passed as context to the next.
If a step fails and has a fallback_backend, the fallback is tried automatically.

ROUTINE JSON SCHEMA:
  {
    "name": "routine_name",
    "description": "What this routine does",
    "steps": [
      {
        "name": "step_name",
        "description": "What this step does",
        "backend": "codex|claude|auto",
        "fallback_backend": "claude|codex",
        "research": true|false,
        "full_access": true|false,
        "prompt_template": "Prompt text with {{PREVIOUS_OUTPUT}} placeholder"
      }
    ]
  }

TEMPLATE VARIABLES:
  {{PREVIOUS_OUTPUT}}    Output from the previous step
  {{WORKSPACE_ROOT}}     Absolute path to project root
  {{FILTEREST_APPLICATION_ROOT}}  Absolute path to maintained Filterest app source
  {{DATE}}               Current date (YYYY-MM-DD)
  {{DATETIME}}           Current datetime (YYYY-MM-DD--HH-MM)
EOF
            exit 0
            ;;
        # TODO(bug #2 / 2026-03-07): add --background flag here to allow
        # janitor_cron.sh to call `./worker_agent --routine <name> --background`.
        # When set, the routine should fork itself (e.g. `nohup ... &`) and
        # return immediately so cron does not block. Until then, the cron wrapper
        # fails with "Unknown option: --background" every 30 min.
        -*)
            err "Unknown option: $1"
            exit 1
            ;;
        *)
            if [[ -z "$ROUTINE_NAME" ]]; then
                ROUTINE_NAME="$1"
            else
                err "Unexpected argument: $1"
                exit 1
            fi
            ;;
    esac
    shift
done

if [[ -z "$ROUTINE_NAME" ]]; then
    err "No routine name provided."
    echo "Usage: ./worker_agent --routine <name>"
    echo "       ./worker_agent --routine --list"
    exit 1
fi

# Find and validate the routine definition
ROUTINE_FILE=$(find_routine "$ROUTINE_NAME") || exit 1
info "Routine: $(json_file_value "$ROUTINE_FILE" name unnamed)"
info "Description: $(json_file_value "$ROUTINE_FILE" description none)"

TOTAL_STEPS=$(json_step_count "$ROUTINE_FILE")
info "Steps: $TOTAL_STEPS"
[[ "$QUICKTEST" == "true" ]] && warn "QUICKTEST mode: reduced scope (max 5 findings per step)"

if (( TOTAL_STEPS == 0 )); then
    err "Routine has no steps defined."
    exit 1
fi

# Create routine output directory
TIMESTAMP=$(date +"%Y-%m-%d--%H-%M")
ROUTINE_OUTPUT_DIR="$RUNS_DIR/${TIMESTAMP}--routine-${ROUTINE_NAME}"
mkdir -p "$ROUTINE_OUTPUT_DIR"
write_routine_status "$ROUTINE_OUTPUT_DIR" "running"

# Copy routine definition for reference
cp "$ROUTINE_FILE" "$ROUTINE_OUTPUT_DIR/routine_definition.json"

header "Starting routine: $(json_file_value "$ROUTINE_FILE" name unnamed)"

# Execute steps sequentially
PREV_SUMMARY=""
FAILED=false
STEP_WORKER_DIRS=()  # Track per-step worker folders for cleanup

for ((i = 0; i < TOTAL_STEPS; i++)); do
    STEP_JSON=$(json_step_at "$ROUTINE_FILE" "$i")

    # Capture the summary file path from run_step's stdout
    STEP_OUTPUT=$(run_step "$STEP_JSON" "$i" "$TOTAL_STEPS" "$ROUTINE_OUTPUT_DIR" "$PREV_SUMMARY" "$DRY_RUN") || {
        FAILED=true
        break
    }

    # The last line of STEP_OUTPUT is the summary file path
    PREV_SUMMARY=$(echo "$STEP_OUTPUT" | tail -1)
done

# Helper: move all per-step worker folders from this routine into the routine's output dir
# Uses step names from the routine JSON to find matching folders via task_id pattern.
# Step folders are nested inside the routine folder, not placed alongside it.
move_step_worker_dirs() {
    local routine_dir="$1"
    local step_names
    step_names=$(json_step_names "$ROUTINE_FILE")
    for sname in $step_names; do
        for f in "$RUNS_DIR/"*"--routine-${sname}"* "$LEGACY_RUNS_DIR/"*"--routine-${sname}"*; do
            [[ -d "$f" ]] || continue
            mv "$f" "$routine_dir/$(basename "$f")" 2>/dev/null || true
        done
    done
}

# Helper: clean a finished routine dir — keep only step summaries and FAILED marker
cleanup_routine_dir() {
    local dir="$1"
    local f name
    for f in "$dir"/* "$dir"/.[!.]*; do
        [[ -e "$f" ]] || continue
        name=$(basename "$f")
        [[ "$name" == step_*_summary_*.md ]] && continue
        [[ "$name" == "FAILED" ]] && continue
        [[ "$name" == "run_status.txt" ]] && continue
        rm -rf "$f"
    done
}

echo ""
if [[ "$DRY_RUN" == "true" ]]; then
    header "Dry run complete"
    info "No workers were launched. Review the prompts above."
elif [[ "$FAILED" == "true" ]]; then
    header "Routine FAILED"
    err "Not all steps completed successfully."
    info "Partial results in: $(basename "$ROUTINE_OUTPUT_DIR")/"

    write_routine_status "$ROUTINE_OUTPUT_DIR" "failed"

    # Keep failed routine output in worker_runs with a failure marker.
    FAIL_MARKER="$ROUTINE_OUTPUT_DIR/FAILED"
    echo "Routine failed at step $((i + 1))/$TOTAL_STEPS on $(date '+%Y-%m-%d %H:%M:%S')" > "$FAIL_MARKER"
    warn "Failed routine kept at: agent_tasks/_artifacts/worker_runs/$(basename "$ROUTINE_OUTPUT_DIR")/"

    # Move per-step worker folders inside the routine folder
    move_step_worker_dirs "$ROUTINE_OUTPUT_DIR"
    cleanup_routine_dir "$ROUTINE_OUTPUT_DIR"

    exit 1
else
    header "Routine complete"
    ok "All $TOTAL_STEPS steps finished successfully."
    info "Results in: $(basename "$ROUTINE_OUTPUT_DIR")/"
    write_routine_status "$ROUTINE_OUTPUT_DIR" "succeeded"

    # Move per-step worker folders inside the routine folder (before cleanup)
    move_step_worker_dirs "$ROUTINE_OUTPUT_DIR"
    cleanup_routine_dir "$ROUTINE_OUTPUT_DIR"

    # List step summaries
    echo ""
    info "Step summaries:"
    for f in "$ROUTINE_OUTPUT_DIR"/step_*_summary_*.md; do
        [[ -f "$f" ]] || continue
        printf "  ${GREEN}✓${NC} %s\n" "$(basename "$f")"
    done
fi
