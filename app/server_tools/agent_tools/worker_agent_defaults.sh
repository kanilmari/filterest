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
