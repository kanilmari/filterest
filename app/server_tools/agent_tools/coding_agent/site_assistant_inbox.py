#!/usr/bin/env python3
"""site_assistant_inbox.py

Serves one active assistant job's request files with the delegated site session.

Between: the model's request files inside the sandbox and the site's API bridge.

Why: the runner keeps the credential and the boundary. It reads only regular
request files of the fixed inbox, never follows a symlink, answers each request
once, and keeps a full record of the calls for the job receipt.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import uuid

REQUEST_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
MAX_REQUEST_BYTES = 262_144
REQUEST_FIELDS = {"method", "path", "query", "body"}


def read_request(directory_fd, name):
    """Read one request file without following a model-created symlink."""
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_REQUEST_BYTES:
            raise ValueError("invalid assistant request file")
        value = json.loads(source.read(MAX_REQUEST_BYTES + 1))
    if not isinstance(value, dict) or not set(value) <= REQUEST_FIELDS or "path" not in value:
        raise ValueError("assistant request fields are invalid")
    return value


def write_reply(directory_fd, name, value):
    """Publish one answer atomically inside the inbox."""
    temporary = ".reply-" + uuid.uuid4().hex
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
    with os.fdopen(descriptor, "w") as target:
        json.dump(value, target, ensure_ascii=False)
    os.replace(temporary, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)


def serve_inbox(session, inbox, stop, record=None, poll_seconds=0.05):
    """Answer the job's calls until stop is set or the inbox is replaced.

    session: an exchanged SiteAPISession.
    inbox: the runner-created directory the engine writes into.
    record: optional callback receiving every completed call for the receipt.
    """
    inbox = Path(inbox)
    if inbox.is_symlink() or not inbox.is_dir():
        return []
    expected = inbox.resolve()
    directory_fd = os.open(inbox, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    answered = {}
    calls = []
    try:
        while not stop.is_set():
            if inbox.is_symlink() or inbox.resolve() != expected:
                break
            for name in sorted(os.listdir(directory_fd)):
                if stop.is_set():
                    break
                if not name.endswith(".request.json") or not REQUEST_ID.fullmatch(name.removesuffix(".request.json")):
                    continue
                try:
                    request = read_request(directory_fd, name)
                except (OSError, ValueError):
                    # An unreadable or symlinked request stays unexecuted.
                    continue
                digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
                if name in answered:
                    previous = answered[name]
                    result = previous["result"] if previous["digest"] == digest else {
                        "status": 409, "error": "request_id_reused",
                    }
                else:
                    result = perform(session, request)
                    answered[name] = {"digest": digest, "result": result}
                    calls.append(result)
                    if record is not None:
                        record(result)
                try:
                    write_reply(directory_fd, name.replace(".request.json", ".response.json"), result)
                    os.unlink(name, dir_fd=directory_fd)
                except OSError:
                    continue
            stop.wait(poll_seconds)
    finally:
        os.close(directory_fd)
    return calls


def perform(session, request):
    """Run one call through the bridge and describe it as data for the model."""
    started = time.time()
    try:
        result = session.call(
            request.get("method", "GET"),
            request.get("path", ""),
            query=request.get("query") or None,
            body=request.get("body"),
        )
    except Exception as error:  # BridgeError and unexpected transport failures
        return {
            "status": 0,
            "error": "call_refused",
            "detail": str(error)[:500],
            "requested": {"method": request.get("method"), "path": request.get("path")},
            "duration_seconds": round(time.time() - started, 3),
        }
    result["duration_seconds"] = round(time.time() - started, 3)
    return result
