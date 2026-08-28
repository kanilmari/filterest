# ==============================================================================
# worker_agent_completions.bash — Bash tab-completion for ./worker_agent
#
# Install (one-time, persists across shell sessions):
#   ./worker_agent --setup-completion
#
# Or load manually for current session only:
#   source server_tools/agent_tools/worker_agent/worker_agent_completions.bash
#
# Supports:
#   ./worker_agent --r<TAB>                → --routine --research
#   ./worker_agent --routine doc<TAB>      → documentation_audit
#   ./worker_agent --routine --l<TAB>      → --list
#   ./worker_agent family=cl<TAB>          → family=claude
# ==============================================================================

# Resolve the routines directory once at source time
_WORKER_AGENT_ROUTINES_DIR="${FILTEREST_WORKER_ROUTINES_DIR:-${_WORKER_AGENT_ROUTINES_DIR:-}}"
if [[ -z "$_WORKER_AGENT_ROUTINES_DIR" ]]; then
    # Try relative to this script
    _WORKER_AGENT_ROUTINES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/routines"
fi

_worker_agent_completions() {
    local cur prev words cword
    _init_completion 2>/dev/null || {
        # Fallback if _init_completion not available
        cur="${COMP_WORDS[COMP_CWORD]}"
        prev="${COMP_WORDS[COMP_CWORD-1]}"
        words=("${COMP_WORDS[@]}")
        cword=$COMP_CWORD
    }

    # Top-level flags (before --routine is seen)
    local top_flags="--help --list --status --wait --prompt-file --ticket
        --task-id --background --research --dry-run --no-summary-instr
        --full-access --claude-model --routine"

    # Routine sub-flags (after --routine <name>)
    local routine_flags="--list --dry-run --help --backend"

    # Check if --routine appears in previous words
    local in_routine=false
    local routine_name_given=false
    local i
    for (( i=1; i < cword; i++ )); do
        if [[ "${words[i]}" == "--routine" ]]; then
            in_routine=true
        elif $in_routine && [[ "${words[i]}" != -* ]]; then
            routine_name_given=true
        fi
    done

    # ── Context: after --routine ──
    if $in_routine; then
        # After --routine, completing routine name or sub-flags
        if [[ "$cur" == -* ]]; then
            COMPREPLY=( $(compgen -W "$routine_flags" -- "$cur") )
            return
        fi

        # Complete routine names (from JSON files)
        if ! $routine_name_given; then
            if [[ -d "$_WORKER_AGENT_ROUTINES_DIR" ]]; then
                local names=()
                local f
                for f in "$_WORKER_AGENT_ROUTINES_DIR"/*.json; do
                    [[ -f "$f" ]] || continue
                    local basename="${f##*/}"
                    names+=("${basename%.json}")
                done
                COMPREPLY=( $(compgen -W "${names[*]}" -- "$cur") )
            fi
            return
        fi
        return
    fi

    # ── Context: family= prefix ──
    if [[ "$cur" == family=* ]]; then
        local prefix="${cur#family=}"
        local families="family=codex family=claude family=auto"
        COMPREPLY=( $(compgen -W "$families" -- "$cur") )
        return
    fi

    # ── Context: after --prompt-file or --ticket → file completion ──
    if [[ "$prev" == "--prompt-file" || "$prev" == "-f" || "$prev" == "--ticket" || "$prev" == "-t" ]]; then
        _filedir 2>/dev/null || COMPREPLY=( $(compgen -f -- "$cur") )
        return
    fi

    # ── Context: after --status or --wait → no completion ──
    if [[ "$prev" == "--status" || "$prev" == "-s" || "$prev" == "--wait" || "$prev" == "-w" ]]; then
        return
    fi

    # ── Default: top-level flags ──
    if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "$top_flags" -- "$cur") )
        return
    fi

    # family= suggestion when typing "f"
    if [[ "$cur" == f* ]]; then
        COMPREPLY=( $(compgen -W "family=codex family=claude family=auto" -- "$cur") )
        return
    fi
}

# Register for multiple command forms
complete -o bashdefault -o default -F _worker_agent_completions worker_agent
complete -o bashdefault -o default -F _worker_agent_completions ./worker_agent

# Also register for absolute path if we can detect the project root
if [[ -n "${FILTEREST_WORKSPACE_ROOT:-}" ]]; then
    _wa_root="$FILTEREST_WORKSPACE_ROOT"
    if [[ -x "$_wa_root/worker_agent" ]]; then
        complete -o bashdefault -o default -F _worker_agent_completions "$_wa_root/worker_agent"
    fi
    unset _wa_root
fi
