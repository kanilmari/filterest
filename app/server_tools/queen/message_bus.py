# message_bus.py
# Sends optional Queen transcript metadata through Filterest's local API.
# Bridges the public Queen runtime with bee messages and linked task records.
# Uses only Python's standard library so a portable Filterest checkout needs no
# extra Python package merely to start Queen.

from __future__ import annotations

import json
import ssl
import urllib.parse
import urllib.request
from pathlib import Path

from ..agent_tools.easelect_api_client import load_project_env
from ..lib.easelect_private_paths import resolve_embedded_project_root


_CANONICAL_FILTEREST_ROOT = Path(__file__).resolve().parent.parent.parent
_PROJECT_ROOT = resolve_embedded_project_root(_CANONICAL_FILTEREST_ROOT)
_HTTP_TIMEOUT = 30


def _load_base_url() -> str:
    """Resolve the native application URL from Filterest's normal env chain."""
    environment = load_project_env(_PROJECT_ROOT)
    port = str(environment.get("APP_PORT") or "8082").strip()
    return f"https://localhost:{port}"


class MessageBus:
    """Send and receive Queen messages through the application HTTP API."""

    def __init__(self, base_url: str | None = None, timeout: int = _HTTP_TIMEOUT):
        self.base_url = (base_url or _load_base_url()).rstrip("/")
        self.endpoint = f"{self.base_url}/api/app/bee/messages"
        self.tasks_endpoint = f"{self.base_url}/api/app/agent-tools/tasks"
        self.timeout = timeout
        self._tls_context = ssl._create_unverified_context()

    def _request(
        self,
        method: str,
        endpoint: str,
        *,
        payload: dict | None = None,
        query: dict | None = None,
    ):
        url = endpoint
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"
        body = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        with urllib.request.urlopen(
            request,
            context=self._tls_context,
            timeout=self.timeout,
        ) as response:
            return json.loads(response.read().decode("utf-8"))

    def send(
        self,
        user_id: int,
        content: dict,
        task_id: int | None = None,
        title: str | None = None,
        thread_id: str | None = None,
        in_reply_to_id: int | None = None,
    ) -> dict:
        """Create one linked Queen message."""
        payload = {"user_id": user_id, "content": content}
        for key, value in (
            ("title", title),
            ("task_id", task_id),
            ("thread_id", thread_id),
            ("in_reply_to_id", in_reply_to_id),
        ):
            if value is not None:
                payload[key] = value
        return self._request("POST", self.endpoint, payload=payload)

    def fetch_since(self, task_id: int, since: str) -> list[dict]:
        """Return task messages at or after one timestamp."""
        return self._request("GET", self.endpoint, query={"task_id": task_id, "since": since})

    def fetch_thread(self, thread_id: str) -> list[dict]:
        """Return every message in one thread."""
        return self._request("GET", self.endpoint, query={"thread_id": thread_id})

    def fetch_conversation(self, task_id: int) -> list[dict]:
        """Return every message linked to one task."""
        return self._request("GET", self.endpoint, query={"task_id": task_id})

    def fetch_by_id(self, message_id: int) -> dict:
        """Return one message by identifier."""
        return self._request("GET", self.endpoint, query={"id": message_id})

    def fetch_task(self, task_id: int) -> dict:
        """Return one task linked to Queen messages."""
        return self._request("GET", self.tasks_endpoint, query={"id": task_id})
