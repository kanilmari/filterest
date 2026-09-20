# worker_agent_defaults.sh — Single source of truth for worker defaults.
# Connects the shared CLI dispatcher with explicit backend and tool defaults.
# Keeps worker launches reproducible without downloading tools at runtime.
# Sourced by worker_agent_core.sh. Change defaults here only.

# Options: claude | codex
DEFAULT_BACKEND="codex"

# Exact installed CLI version required for Codex runs. Upgrade deliberately.
DEFAULT_CODEX_VERSION="0.155.1"

# Options: sonnet | opus | haiku (or full model ID like claude-sonnet-4-6)
DEFAULT_CLAUDE_MODEL="opus"

# Codex reasoning effort when a run does not name one. Codex's own default is
# the lowest setting, which is not what this project wants from a worker: the
# expensive part of a worker run is the supervision its summary costs, not the
# thinking that produced it. A run may still override this.
DEFAULT_CODEX_REASONING_EFFORT="xhigh"
