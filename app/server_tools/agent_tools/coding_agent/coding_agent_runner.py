#!/usr/bin/env python3
"""Serve one site's administrator coding jobs over a protected Unix socket.
Connects the web adapter, isolated persistent Git worktrees and a local Codex CLI.
Run as a dedicated non-root user; configuration and credentials are operator-owned.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import socket
import socketserver
import struct
import subprocess
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

from coding_agent_jobs import CodingJobs, JobError


def load_config(path):
    config = json.loads(Path(path).read_text())
    for field in ("socket", "repository", "jobs_root"):
        if not isinstance(config.get(field), str) or not Path(config[field]).is_absolute():
            raise ValueError(field + " must be an absolute path")
    if not isinstance(config.get("site_id"), str) or not config["site_id"]:
        raise ValueError("site_id is required")
    command = config.get("codex_command")
    if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command) or not Path(command[0]).is_absolute():
        raise ValueError("codex_command requires an installed absolute executable")
    if not isinstance(config.get("allowed_web_uids"), list) or not config["allowed_web_uids"] or not all(isinstance(x, int) and x > 0 for x in config["allowed_web_uids"]):
        raise ValueError("explicit non-root web peer UIDs are required")
    if os.getuid() in config["allowed_web_uids"]:
        raise ValueError("runner and web peer must use different Unix users")
    revision = config.get("source_revision", "")
    import re
    if not re.fullmatch("[a-f0-9]{40}", revision):
        raise ValueError("source_revision must be a full immutable commit")
    repo, jobs = Path(config["repository"]).resolve(), Path(config["jobs_root"]).resolve()
    if jobs == repo or repo in jobs.parents:
        raise ValueError("job storage must be outside the source repository")
    return config


def readiness(config):
    result = {"runner_ready": False, "authentication_verified": False, "reason_code": "runner_tools_missing"}
    if not os.access(config["codex_command"][0], os.X_OK):
        return result
    try:
        subprocess.run(["git", "-C", config["repository"], "cat-file", "-e", config["source_revision"] + "^{commit}"],
                       check=True, capture_output=True, timeout=10)
        subprocess.run([*config["codex_command"], "--version"], check=True, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return result
    # Local account status only; no model request and no credential output.
    environment = {**os.environ, **config.get("environment", {})}
    if config.get("codex_home"):
        environment["CODEX_HOME"] = config["codex_home"]
    try:
        login = subprocess.run([*config["codex_command"], "login", "status"],
                               env=environment, capture_output=True, timeout=10)
        result["authentication_verified"] = login.returncode == 0
    except (OSError, subprocess.SubprocessError):
        pass
    if not result["authentication_verified"]:
        result["reason_code"] = "runner_authentication_required"
        return result
    actions = config.get("maintenance_actions", {})
    if not all(isinstance(actions.get(k), list) and actions[k] and Path(actions[k][0]).is_absolute()
               and os.access(actions[k][0], os.X_OK) for k in ("plan", "apply")):
        result["reason_code"] = "maintenance_not_configured"
        return result
    result.update(runner_ready=True, reason_code="")
    return result


class RunnerServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def __init__(self, config):
        self.config = config
        self.jobs = CodingJobs(config)
        super().__init__(config["socket"], RunnerRequest)
        os.chmod(config["socket"], 0o660)


class RunnerRequest(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # request paths/prompts are not written to an access log

    def reply(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # accepted jobs persist independently of the browser connection

    def dispatch(self):
        try:
            _pid, uid, _gid = struct.unpack("3i", self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            config = self.server.config
            if self.headers.get("X-Filterest-Site") != config["site_id"]:
                raise JobError(403, "site mismatch")
            parts = urlsplit(self.path)
            if uid not in config["allowed_web_uids"]:
                raise JobError(403, "web peer not allowed")
            try:
                actor = int(self.headers.get("X-Filterest-Actor", "0"))
            except ValueError:
                raise JobError(403, "actor required")
            if actor <= 1:
                raise JobError(403, "actor required")
            if self.command == "GET" and parts.path == "/v1/capabilities":
                return self.reply(200, readiness(config))
            if self.command == "POST" and parts.path == "/v1/jobs":
                if not readiness(config)["runner_ready"]:
                    raise JobError(503, "runner is not ready")
                return self.reply(202, self.server.jobs.submit(actor, self.body()))
            if self.command == "GET" and parts.path.startswith("/v1/jobs/"):
                dataset = parse_qs(parts.query).get("dataset", [""])[0]
                state = self.server.jobs.read(parts.path.removeprefix("/v1/jobs/"), actor, dataset)
                return self.reply(200, self.server.jobs.public(state))
            raise JobError(404, "route not found")
        except JobError as error:
            self.reply(error.code, {"error": str(error)})
        except Exception:
            self.reply(500, {"error": "runner request failed"})

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 131072:
            raise JobError(400, "invalid request size")
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeError):
            raise JobError(400, "invalid JSON")
        if not isinstance(body, dict):
            raise JobError(400, "JSON object required")
        return body

    do_GET = dispatch
    do_POST = dispatch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--check", action="store_true", help="Check local tools/account without starting a model")
    args = parser.parse_args()
    if os.getuid() == 0:
        parser.error("runner must use a dedicated non-root user")
    config = load_config(args.config)
    if args.check:
        print(json.dumps(readiness(config)))
        return
    socket_path = Path(config["socket"])
    socket_path.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    if socket_path.exists():
        parser.error("socket already exists; verify the previous service is stopped before removing it")
    server = RunnerServer(config)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.jobs.close()
        socket_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
