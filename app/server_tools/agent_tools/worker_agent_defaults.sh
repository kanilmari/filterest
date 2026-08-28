# worker_agent_defaults.sh — Single source of truth for worker defaults.
# Sourced by worker_agent_core.sh. Change defaults here only.

# Options: claude | codex
DEFAULT_BACKEND="codex"

# Options: sonnet | opus | haiku (or full model ID like claude-sonnet-4-6)
DEFAULT_CLAUDE_MODEL="opus"
