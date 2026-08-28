# ==============================================================================
# ctl_completions.bash — Bash tab-completion for ./ctl
#
# Install (one-time, persists across shell sessions):
#   ./ctl --setup-completion
#
# Or load manually for current session only:
#   source server_tools/ctl/ctl_completions.bash
#
# Supports:
#   ctl --ref<TAB>              → --refresh-all-dev-targets
#   ctl --ins<TAB>              → --instance
#   ctl --instance s<TAB>       → serlog.com status-all sync-all
#   ctl i ser<TAB>              → serlog.com
# ==============================================================================

_CTL_PROJECT_ROOT="${_CTL_PROJECT_ROOT:-}"
if [[ -z "$_CTL_PROJECT_ROOT" ]]; then
    _CTL_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
fi

_ctl_list_instances() {
    local root="${_CTL_PROJECT_ROOT:-$PWD}"
    local dir
    for dir in "$root"/instances/*/; do
        [[ -d "$dir" ]] || continue
        local name="${dir%/}"
        name="${name##*/}"
        [[ "$name" == "template" ]] && continue
        printf '%s\n' "$name"
    done
}

_ctl_completions() {
    local cur prev words cword
    _init_completion 2>/dev/null || {
        cur="${COMP_WORDS[COMP_CWORD]}"
        prev="${COMP_WORDS[COMP_CWORD-1]}"
        words=("${COMP_WORDS[@]}")
        cword=$COMP_CWORD
    }

    local top_flags="--docker --restore-db --instance --traefik --stop --help --refresh-all-dev-targets --setup-completion -p --port"
    local top_words="list logs journal i"
    local instance_mass="list create upgrade-all status-all backup-all sync-all"
    local instance_flags="--init --sync --backup --logs --delete --restore --stop --ngrok --domain"
    local traefik_words="start stop logs"

    if [[ "$prev" == "-p" || "$prev" == "--port" ]]; then
        return
    fi

    if [[ "$prev" == "--restore" ]]; then
        _filedir 2>/dev/null || COMPREPLY=( $(compgen -f -- "$cur") )
        return
    fi

    if [[ "$prev" == "--domain" ]]; then
        return
    fi

    if [[ "$prev" == "--traefik" ]]; then
        COMPREPLY=( $(compgen -W "$traefik_words" -- "$cur") )
        return
    fi

    if [[ "$prev" == "journal" ]]; then
        local journal_targets="local $(_ctl_list_instances | tr '\n' ' ')"
        COMPREPLY=( $(compgen -W "$journal_targets" -- "$cur") )
        return
    fi

    local in_instance=false
    local instance_name_given=false
    local i
    for (( i=1; i < cword; i++ )); do
        if [[ "${words[i]}" == "--instance" || "${words[i]}" == "i" ]]; then
            in_instance=true
            continue
        fi

        if $in_instance && [[ "${words[i]}" != -* ]]; then
            case "${words[i]}" in
                list|create|upgrade-all|status-all|backup-all|sync-all)
                    return
                    ;;
                *)
                    instance_name_given=true
                    ;;
            esac
        fi
    done

    if $in_instance; then
        if ! $instance_name_given; then
            local instance_targets="${instance_mass} $(_ctl_list_instances | tr '\n' ' ')"
            COMPREPLY=( $(compgen -W "$instance_targets" -- "$cur") )
            return
        fi

        if [[ "$cur" == -* ]]; then
            COMPREPLY=( $(compgen -W "$instance_flags" -- "$cur") )
            return
        fi
        return
    fi

    if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "$top_flags" -- "$cur") )
        return
    fi

    COMPREPLY=( $(compgen -W "$top_words" -- "$cur") )
}

complete -o bashdefault -o default -F _ctl_completions ctl
complete -o bashdefault -o default -F _ctl_completions ./ctl

if [[ -n "${_CTL_PROJECT_ROOT:-}" && -x "$_CTL_PROJECT_ROOT/ctl" ]]; then
    complete -o bashdefault -o default -F _ctl_completions "$_CTL_PROJECT_ROOT/ctl"
fi
