# persistent_agent.py
# Stateful agent wrapper for Queen persistent CLI sessions.
# Bridges agent identity (role, config) with a CLIBackend session.
# Exists to give each agent a persistent context that survives across turns.

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from ..lib.easelect_private_paths import resolve_embedded_project_root
from .cli_backend import CLIBackend, get_backend

logger = logging.getLogger("queen.persistent_agent")


class PersistentAgent:
    """
    One agent = one persistent CLI session with rich internal context.

    The agent maintains its own full history (tool calls, outputs, reasoning)
    inside the CLI session. Other agents only see the final written message
    returned by each turn.

    Lifecycle:
      1. __init__ — load config + role prompt
      2. start()  — open CLI session, prime with role prompt
      3. turn()   — receive a message, think, return only the written reply
      4. stop()   — tear down the session
    """

    def __init__(self, agent_dir: Path, family: str, project_root: Path | None = None):
        self.agent_dir = agent_dir
        canonical_filterest_root = Path(__file__).resolve().parent.parent.parent
        self.project_root = project_root or resolve_embedded_project_root(canonical_filterest_root)
        self.config = self._load_config()
        self.role_prompt = self._load_role_prompt()
        self.family = family

        self._backend: CLIBackend | None = None
        self._turn_count = 0

    @property
    def agent_name(self) -> str:
        return self.config.get("agent_name", self.agent_dir.name)

    @property
    def user_id(self) -> int:
        return self.config.get("user_id", 0)

    @property
    def is_alive(self) -> bool:
        return self._backend is not None and self._backend.is_alive

    @property
    def session_id(self) -> str | None:
        if self._backend is None:
            return None
        return self._backend.session_id

    @property
    def turn_count(self) -> int:
        return self._turn_count

    def start(self) -> None:
        """Open a new persistent CLI session and prime it with the role prompt."""
        self._backend = get_backend(
            self.family,
            project_root=self.project_root,
        )
        session_name = f"queen-{self.agent_name}-{int(time.time())}"
        logger.info("Starting %s agent (family=%s, session=%s)", self.agent_name, self.family, session_name)
        self._backend.start(self.role_prompt, session_name)
        self._turn_count = 0

    def attach(self, session_id: str, *, turn_count: int = 0) -> None:
        """Reattach this agent wrapper to an existing CLI session."""
        self._backend = get_backend(
            self.family,
            project_root=self.project_root,
        )
        self._backend.attach(session_id)
        self._turn_count = max(0, turn_count)
        logger.info(
            "Reattached %s agent (family=%s, session_id=%s, turn_count=%d)",
            self.agent_name,
            self.family,
            self.session_id,
            self._turn_count,
        )

    def turn(self, incoming_message: str) -> str:
        """
        Execute one conversational turn.

        Args:
            incoming_message: The text from the other agent (message only,
                              no CLI history or reasoning — just the "cream").

        Returns:
            The agent's written reply text (again, just the cream — the CLI
            session retains all the rich internal context for future turns).
        """
        if self._backend is None or not self._backend.is_alive:
            raise RuntimeError(f"Agent {self.agent_name} session not started")

        self._turn_count += 1
        logger.info("[%s] turn %d — receiving %d chars", self.agent_name, self._turn_count, len(incoming_message))

        reply = self._backend.send(incoming_message)

        if not reply.strip():
            logger.error("[%s] turn %d — backend returned empty reply", self.agent_name, self._turn_count)
            raise RuntimeError(f"Agent {self.agent_name} returned empty reply on turn {self._turn_count}")

        logger.info("[%s] turn %d — replied %d chars", self.agent_name, self._turn_count, len(reply))
        return reply

    def stop(self) -> None:
        """Tear down the CLI session."""
        if self._backend:
            self._backend.stop()
            self._backend = None
        logger.info("Agent %s stopped after %d turns", self.agent_name, self._turn_count)

    def _load_config(self) -> dict:
        config_path = self.agent_dir / "config.json"
        if not config_path.exists():
            raise FileNotFoundError(f"No config.json in {self.agent_dir}")
        with open(config_path) as f:
            return json.load(f)

    def _load_role_prompt(self) -> str:
        prompt_path = self.agent_dir / "role_prompt.md"
        if not prompt_path.exists():
            return ""
        return prompt_path.read_text()
