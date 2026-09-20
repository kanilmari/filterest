#!/usr/bin/env python3
"""site_assistant_api_bridge.py

Runs a site assistant's HTTP calls against its own site with the asking
administrator's short-lived delegation.

Between: an assistant engine (Codex, Claude) writing request files in its
sandbox, and the site's ordinary application API.

Why: the engine gets no network of its own. Every call goes through this
bridge, which holds the delegated session, records what was attempted, and
turns a refused write into a plan entry the administrator can approve.
"""

from __future__ import annotations

import http.cookiejar
import json
import time
import urllib.error
import urllib.parse
import urllib.request

# One assistant call may not run forever; the runner bounds the whole job too.
REQUEST_TIMEOUT_SECONDS = 60
MAX_RESPONSE_BYTES = 1_048_576
READ_METHODS = ("GET", "HEAD")
WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
APPROVAL_ERROR = "site_assistant_approval_required"


class BridgeError(RuntimeError):
    """A call could not be made at all, for example a broken delegation."""


class SiteAPISession:
    """One delegated session against one site."""

    def __init__(self, base_url, opener_factory=None):
        self.base_url = str(base_url).rstrip("/")
        if not self.base_url.startswith(("http://127.0.0.1", "http://localhost", "https://")):
            raise BridgeError("site base URL must be the site's loopback port or an HTTPS address")
        self.cookies = http.cookiejar.CookieJar()
        factory = opener_factory or urllib.request.build_opener
        self._opener = factory(urllib.request.HTTPCookieProcessor(self.cookies))
        self._csrf_token = None
        self.delegation = None
        self.attempted_writes = []

    # ── session ────────────────────────────────────────────────────────────
    def exchange(self, code):
        """Trade the job's one-time code for the administrator's session."""
        response = self._send("POST", "/api/site-assistant/delegation/exchange", body={"code": code})
        if response["status"] != 200 or not response["json"].get("authenticated"):
            raise BridgeError("delegation exchange failed: %s" % response["json"].get("error", response["status"]))
        self.delegation = response["json"]
        return self.delegation

    def api_catalog(self, route=None):
        """Read this installation's own API description as assistant context."""
        path = route or self.delegation.get("api_catalog_route", "/api/admin/site-assistant/api-catalog")
        response = self._send("GET", path, query={"format": "markdown"})
        if response["status"] != 200:
            raise BridgeError("API catalog is unavailable: HTTP %s" % response["status"])
        return response["text"]

    # ── calls ──────────────────────────────────────────────────────────────
    def call(self, method, path, query=None, body=None):
        """Perform one assistant call and describe the outcome as plain data."""
        method = str(method or "").upper().strip()
        if method not in READ_METHODS + WRITE_METHODS:
            raise BridgeError("unsupported method %r" % method)
        if not isinstance(path, str) or not path.startswith("/api/"):
            raise BridgeError("assistant calls must target an /api/ path")
        if path.startswith("/api/site-assistant/delegation/"):
            raise BridgeError("the delegation route is not callable from a job")

        response = self._send(method, path, query=query, body=body)
        result = {
            "method": method,
            "path": path,
            "query": query or {},
            "status": response["status"],
            "body": response["json"] if response["json"] != {} else response["text"][:4000],
        }
        if response["status"] == 403 and response["json"].get("error") == APPROVAL_ERROR:
            call = response["json"].get("call", {})
            result["needs_approval"] = True
            result["approval"] = {
                "method": call.get("method", method),
                "path": call.get("path", path),
                "query": call.get("query", ""),
                "body_sha256": call.get("body_sha256", ""),
            }
            self._record_plan_entry(result["approval"], query, body)
        return result

    def planned_writes(self):
        """Write calls the assistant attempted that need the owner's approval."""
        return list(self.attempted_writes)

    def _record_plan_entry(self, approval, query, body):
        for existing in self.attempted_writes:
            if existing["approval"] == approval:
                return
        self.attempted_writes.append({
            "approval": approval,
            "query": query or {},
            "body": body,
            "attempted_at": time.time(),
        })

    # ── transport ──────────────────────────────────────────────────────────
    def _send(self, method, path, query=None, body=None):
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query, doseq=True)
        headers = {"Accept": "application/json"}
        payload = None
        if body is not None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if method in WRITE_METHODS and self.delegation is not None:
            headers["X-CSRF-Token"] = self._csrf()

        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with self._opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return _describe(response.status, response.read(MAX_RESPONSE_BYTES + 1))
        except urllib.error.HTTPError as error:
            return _describe(error.code, error.read(MAX_RESPONSE_BYTES + 1))
        except urllib.error.URLError as error:
            raise BridgeError("site is unreachable: %s" % error) from error

    def _csrf(self):
        if self._csrf_token:
            return self._csrf_token
        response = self._send("GET", "/api/csrf-token")
        token = str(response["json"].get("csrf_token") or "").strip()
        if not token:
            raise BridgeError("the site did not return a CSRF token")
        self._csrf_token = token
        return token


def _describe(status, raw):
    if len(raw) > MAX_RESPONSE_BYTES:
        raw = raw[:MAX_RESPONSE_BYTES]
    text = raw.decode("utf-8", errors="replace")
    try:
        decoded = json.loads(text)
    except ValueError:
        decoded = {}
    if not isinstance(decoded, dict):
        decoded = {"value": decoded}
    return {"status": status, "text": text, "json": decoded}
