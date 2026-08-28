# ==============================================================================
# worker_agent_prompt_builder.sh — Build worker prompts from ticket/input state.
#
# Shared helpers between worker_agent_core.sh input parsing and the final prompt
# file written into each worker run directory.
# Keeps ticket extraction and prompt augmentation separate from CLI dispatch so
# the main worker flow reads top-down.
# ==============================================================================

extract_ticket_prompt() {
    local ticket_file="$1"
    local database_command_display="${FILTEREST_DATABASE_DISPLAY_COMMAND:-./filterest database}"
    if [[ ! -f "$ticket_file" ]]; then
        err "Ticket file not found: $ticket_file"
        exit 1
    fi

    local ticket_content
    ticket_content=$(cat "$ticket_file")

    cat <<TICKET_PROMPT
## Task: Execute tasks from ticket

### Ticket file
$ticket_file

### Ticket content
$ticket_content

### Instructions
Read the ticket above carefully. Execute all tasks marked with [todo].
For each task:
1. Research the relevant files mentioned in the ticket.
2. Implement the required changes.
3. Follow existing code patterns and naming conventions.

### Constraints
- Only modify files relevant to the ticket's tasks.
- Do not modify repository governance, version, changelog, or feature-list files unless the ticket explicitly requires it.
- Developer-tool-only changes must not change the shipped application version or release notes unless the repository's governing instructions require that.
- Never run modifying SQL (INSERT, UPDATE, DELETE, ALTER, DROP, CREATE). Use \`${database_command_display} "SELECT ..."\` or \`${database_command_display} --local "SELECT ..."\` for read-only inspection.
TICKET_PROMPT
}

find_worker_port() {
    local port
    for port in $(seq 9500 5 9550); do
        if ! fuser "${port}/tcp" > /dev/null 2>&1; then
            echo "$port"
            return 0
        fi
    done
    echo "9500"
}

resolve_summary_relpath() {
    local output_dir_name="$1"
    local task_id="$2"
    local summary_file_name="worker_summary_${task_id}.md"

    if [[ -n "$CUSTOM_OUTPUT_DIR" ]]; then
        printf '%s/%s/%s\n' "$CUSTOM_OUTPUT_DIR" "$output_dir_name" "$summary_file_name"
    else
        printf '%s/%s/%s\n' "$DEFAULT_OUTPUT_DIR_REL" "$output_dir_name" "$summary_file_name"
    fi
}

append_environment_instructions() {
    local prompt_save_file="$1"
    local database_command_display="${FILTEREST_DATABASE_DISPLAY_COMMAND:-./filterest database}"

    if [[ "$FULL_ACCESS" == true ]]; then
        WORKER_PORT=$(find_worker_port)
        export WORKER_PORT
        cat >> "$prompt_save_file" <<DB_ACCESS_INSTR

ENVIRONMENT — FULL ACCESS MODE:
You have full system access including database and network.

Database access:
- Let the approved wrappers resolve native credentials through EASELECT_KEY_ROOT; do not read or print credential files directly.
- Use ${database_command_display} "SELECT ..." or ${database_command_display} --local "SELECT ..." for read-only queries through the approved wrapper.
- NEVER call psql directly from worker prompts.
- NEVER run modifying SQL (INSERT, UPDATE, DELETE, ALTER, DROP, CREATE). Only SELECT queries through ${database_command_display} are allowed.
- The database is a live development instance. Treat it as read-only.

Building and running the server:
- Use \`./ctl -p ${WORKER_PORT}\` if you need to start the server (NOT port 8082 — that is the dev server).
- After verifying, ALWAYS stop the server: \`./ctl --stop\` or \`fuser -k ${WORKER_PORT}/tcp\`.
- For compile-only checks (preferred): \`go build ./backend/...\` and \`npm run build\`.

Other access:
- You can run shell commands freely.
- You can access localhost services (dev server on port ${WORKER_DEV_PORT}, DB on port ${WORKER_DB_PORT}).
- You can install packages if needed.
DB_ACCESS_INSTR
        return 0
    fi

    cat >> "$prompt_save_file" <<'SANDBOX_INSTR'

ENVIRONMENT — SANDBOX MODE:
You are running in a workspace-write sandbox. You can read all files and write workspace files only.
You cannot access the database or network directly.
You CAN run `go build ./backend/...` to check compilation.
If you need schema information, check data/db_backups/ for SQL dump files, or data/ for pre-exported CSV/JSON snapshots.
SANDBOX_INSTR
}

append_summary_instruction() {
    local prompt_save_file="$1"
    local summary_relpath="$2"

    if [[ "$NO_SUMMARY_INSTR" == true ]]; then
        return 0
    fi

    if [[ "$RESEARCH_MODE" == true ]]; then
        cat >> "$prompt_save_file" <<SUMMARY_INSTR

CRITICAL OUTPUT INSTRUCTION — RESEARCH MODE:
This is a READ-ONLY research task. Do NOT modify any source files.
Write your complete findings/summary to the file ${summary_relpath}.
This is the ONLY output that will be read by the supervising agent. Terminal output is discarded.
Keep the summary concise (max 80 lines). Structure as:
1. Key findings (with file:line references)
2. Code snippets (only the relevant parts)
3. Analysis / recommendations
Do NOT print the summary to stdout — only write it to ${summary_relpath}.
SUMMARY_INSTR
        return 0
    fi

    cat >> "$prompt_save_file" <<SUMMARY_INSTR

CRITICAL OUTPUT INSTRUCTION:
Write your complete findings/summary to the file ${summary_relpath}.
This is the ONLY output that will be read by the supervising agent. Terminal output is discarded.
Keep the summary concise (max 80 lines). Include: key findings, file:line references, and recommended next steps.
Do NOT print the summary to stdout — only write it to ${summary_relpath}.
SUMMARY_INSTR
}

append_worker_prompt_instructions() {
    local prompt_save_file="$1"
    local output_dir_name="$2"
    local task_id="$3"

    SUMMARY_RELPATH=$(resolve_summary_relpath "$output_dir_name" "$task_id")
    append_environment_instructions "$prompt_save_file"
    append_summary_instruction "$prompt_save_file" "$SUMMARY_RELPATH"
}
