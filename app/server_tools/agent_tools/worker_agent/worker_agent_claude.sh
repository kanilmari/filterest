# worker_agent_claude.sh — Local Claude discovery, effort and subscription checks.
# Connects worker argument validation and dispatch to the installed Claude CLI.
# Refuses undocumented efforts before run artifacts or a worker can be created.
# Sourced by worker_agent_backend_runner.sh; never downloads a CLI.

find_claude_bin() {
    if command -v claude &>/dev/null; then
        echo "claude"
        return 0
    fi
    # The Claude Code extension bundles the CLI. Desktop VS Code keeps it under
    # ~/.vscode, while Remote/WSL and Insiders builds use their own extension
    # roots, so every known root is scanned before the backend is declared missing.
    local -a ext_roots=(
        "$HOME/.vscode/extensions"
        "$HOME/.vscode-server/extensions"
        "$HOME/.vscode-insiders/extensions"
        "$HOME/.vscode-server-insiders/extensions"
    )
    local -a ext_candidates=()
    local ext_root ext_candidate
    for ext_root in "${ext_roots[@]}"; do
        for ext_candidate in "$ext_root"/anthropic.claude-code-*/resources/native-binary/claude; do
            if [[ -x "$ext_candidate" ]]; then
                ext_candidates+=("$ext_candidate")
            fi
        done
    done
    if (( ${#ext_candidates[@]} > 0 )); then
        # Version sort selects the newest build; a plain sort ranks 2.1.9 above 2.1.270.
        printf '%s\n' "${ext_candidates[@]}" | sort -V | tail -1
        return 0
    fi
    return 1
}

# Validate tokens before even probing the CLI. Family-specific options avoid
# changing Codex's accepted effort vocabulary or its configuration arguments.
validate_claude_effort() {
    case "$CLAUDE_EFFORT" in
        ""|low|medium|high|xhigh|max) ;;
        *) err "Invalid Claude effort: $CLAUDE_EFFORT (expected: low, medium, high, xhigh, max). No worker was started."; return 1 ;;
    esac
    [[ -n "$CLAUDE_EFFORT" ]] || return 0
    if [[ "$BACKEND" == codex ]]; then
        err "--claude-effort requires family=claude or family=auto. No worker was started."
        return 1
    fi
    CLAUDE_BIN=$(find_claude_bin) || {
        err "Cannot validate --claude-effort: Claude CLI not found. No worker was started."
        return 127
    }
    # Pin the executable used for the help probe and for foreground/detached
    # execution. Help is local, bounded, and never submits a model request.
    CLAUDE_BIN=$(realpath -e -- "$(type -P -- "$CLAUDE_BIN")") || return 127
    local help_output
    if ! help_output=$(billing_env env -u CLAUDECODE timeout 20 "$CLAUDE_BIN" --help 2>&1 < /dev/null); then
        err "Cannot read Claude CLI --help from $CLAUDE_BIN. No worker was started."
        return 1
    fi
    if ! python3 -c '
import re, sys
help_text = sys.stdin.read()
option = re.search(r"(?ms)^\s*--effort\s+<level>\s+(.*?)(?=^\s*--|\Z)", help_text)
choices = re.findall(r"\(([^()]*)\)", option[1]) if option else []
sys.exit(0 if any(sys.argv[1] in re.split(r"[,\s]+", group.strip()) for group in choices) else 1)
' "$CLAUDE_EFFORT" <<< "$help_output"; then
        err "Unsupported Claude effort: $CLAUDE_EFFORT. Installed CLI --help must document --effort <level> and this level. No worker was started."
        return 1
    fi
}

verify_claude_subscription() {
    if [[ -z "${CLAUDE_BIN:-}" ]]; then
        CLAUDE_BIN=$(find_claude_bin) || {
            err "Claude CLI not found on PATH or in a Claude Code VS Code extension. No worker was started."
            return 127
        }
    fi
    local status_json="" status_exit=0 sign_in=""
    status_json=$(billing_env env -u CLAUDECODE timeout 20 "$CLAUDE_BIN" auth status --json \
        2>/dev/null < /dev/null) || status_exit=$?
    # Only the sign-in method and provider are read; e-mail and organisation are not.
    sign_in=$(python3 -c '
import json, re, sys
try:
    status = json.loads(sys.stdin.read())
except ValueError:
    status = {}
if not isinstance(status, dict) or status.get("loggedIn") is not True:
    print("none")
    raise SystemExit
def name(value):
    return re.sub(r"[^A-Za-z0-9._-]", "", str(value))[:40] or "unknown"
method = name(status.get("authMethod") or "")
provider = name(status.get("apiProvider") or "firstParty")
print(method if provider == "firstParty" else method + " via " + provider)
' <<< "$status_json") || sign_in="unreadable"
    if (( status_exit == 0 )) && [[ "$sign_in" == "claude.ai" ]]; then
        BILLING_ACCOUNT="Claude signed in with claude.ai"
        return 0
    fi
    if (( status_exit == 124 )); then
        err "Claude CLI did not report its sign-in within 20 s ($CLAUDE_BIN auth status)."
    else
        err "Claude CLI is not signed in with a claude.ai subscription (sign-in: $sign_in)."
    fi
    err "Sign in with '$CLAUDE_BIN auth login --claudeai', or pass --api to bill an API key deliberately. No worker was started."
    return 1
}

