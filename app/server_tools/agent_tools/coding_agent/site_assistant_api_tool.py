#!/usr/bin/env python3
"""site_assistant_api_tool.py

The only way an assistant engine reaches its own site.

Between: a model running in a network-off sandbox and the runner, which holds
the administrator's short-lived delegation.

Why: the engine may not open network connections, hold credentials or choose a
host. It writes one request file into the active job's inbox; the runner
performs the call and writes the answer back. A refused write returns the
approval the administrator still has to give, not an error the model can bypass.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
import uuid

RESPONSE_WAIT_SECONDS = 180
READ_METHODS = ("GET", "HEAD")
WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def parse_query(pairs):
    """Turn repeated name=value arguments into one query mapping."""
    query = {}
    for pair in pairs or []:
        name, separator, value = pair.partition("=")
        if not separator or not name.strip():
            raise SystemExit("query arguments use name=value")
        query[name.strip()] = value
    return query


def read_body(raw):
    """Accept inline JSON or @file so large payloads stay out of the argument list."""
    if raw is None:
        return None
    text = raw
    if raw.startswith("@"):
        path = Path(raw[1:])
        if not path.is_file() or path.is_symlink():
            raise SystemExit("body file not found: %s" % raw[1:])
        text = path.read_text()
    try:
        return json.loads(text)
    except ValueError as error:
        raise SystemExit("body must be JSON: %s" % error)


def submit(inbox, request):
    """Hand one request to the runner and wait for its written answer."""
    name = str(uuid.uuid4())
    temporary = inbox / ("." + name + ".tmp")
    with temporary.open("x") as target:
        json.dump(request, target, ensure_ascii=False)
    os.replace(temporary, inbox / (name + ".request.json"))

    response_path = inbox / (name + ".response.json")
    deadline = time.monotonic() + RESPONSE_WAIT_SECONDS
    while time.monotonic() < deadline:
        if response_path.is_file() and not response_path.is_symlink():
            return json.loads(response_path.read_text())
        time.sleep(0.05)
    raise SystemExit("the site did not answer in time; report this instead of retrying blindly")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[2])
    parser.add_argument("--method", default="GET")
    parser.add_argument("--path", required=True, help="application API path, for example /api/get-results")
    parser.add_argument("--query", action="append", default=[], help="name=value, repeat for several")
    parser.add_argument("--body", help="JSON object, or @file containing it")
    arguments = parser.parse_args(argv)

    method = arguments.method.upper().strip()
    if method not in READ_METHODS + WRITE_METHODS:
        parser.error("unsupported method %r" % arguments.method)
    if not arguments.path.startswith("/api/"):
        parser.error("path must be an application API path starting with /api/")
    if method in READ_METHODS and arguments.body:
        parser.error("a read call takes no body")

    inbox_value = os.environ.get("FILTEREST_SITE_ASSISTANT_INBOX", "")
    inbox = Path(inbox_value)
    if not inbox_value or not inbox.is_absolute() or inbox.is_symlink() or not inbox.is_dir():
        parser.error("this tool runs only inside an active assistant job")

    result = submit(inbox, {
        "method": method,
        "path": arguments.path,
        "query": parse_query(arguments.query),
        "body": read_body(arguments.body),
    })
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    if result.get("needs_approval"):
        # A write waits for the administrator; the model must not treat it as done.
        return 2
    status = result.get("status", 0)
    return 0 if 200 <= int(status) < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())
