#!/usr/bin/env python3
"""Serve one site's administrator coding jobs over a protected Unix socket.
Connects the web adapter, isolated persistent Git worktrees and a local Codex CLI.
Run as a dedicated non-root user; configuration and credentials are operator-owned.
"""
from __future__ import annotations
import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import socket
import socketserver
import signal
import stat
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


class RunnerSocket:
    """Own one protected socket pathname across normal and crash restarts."""
    def __init__(self, path):
        self.path = Path(path)
        self.directory = None
        self.lock = None
        self.bound = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
            self.directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(self.directory)
            if info.st_uid != os.getuid() or info.st_mode & 0o022:
                raise ValueError("socket directory must be owned by the runner and not writable by other users")
            self.lock = os.open("." + self.path.name + ".lock",
                                os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                                0o600, dir_fd=self.directory)
            info = os.fstat(self.lock)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError("socket lock must be a private regular file owned by the runner")
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ValueError("another runner owns this socket") from error
            self.remove_stale()
        except BaseException:
            self.close()
            raise

    def identity(self):
        try:
            info = os.stat(self.path.name, dir_fd=self.directory, follow_symlinks=False)
        except FileNotFoundError:
            return None
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError("socket path must be a socket owned by the runner")
        return info.st_dev, info.st_ino

    def remove_stale(self):
        previous = self.identity()
        if previous is None:
            return
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
            probe.settimeout(1)
            try:
                probe.connect(str(self.path))
            except OSError as error:
                if error.errno not in (errno.ECONNREFUSED, errno.ENOENT):
                    raise ValueError("cannot establish that the existing socket is stale") from error
            else:
                raise ValueError("another live runner is listening on this socket")
        # A bound socket can refuse connections briefly before listen(). Do not
        # mistake that live startup window for a leftover filesystem socket.
        with Path("/proc/net/unix").open() as sockets:
            for line in sockets:
                fields = line.split(maxsplit=7)
                if len(fields) == 8 and fields[7].rstrip("\n") == str(self.path):
                    raise ValueError("another live process has bound this socket")
        current = self.identity()
        if current is None:
            return
        if current != previous:
            raise ValueError("socket changed during stale-socket verification")
        os.unlink(self.path.name, dir_fd=self.directory)

    def mark_bound(self):
        self.bound = self.identity()

    def close(self):
        try:
            if self.directory is not None and self.bound is not None:
                try:
                    unchanged = self.identity() == self.bound
                except ValueError:
                    unchanged = False
                if unchanged:
                    os.unlink(self.path.name, dir_fd=self.directory)
        finally:
            if self.lock is not None:
                os.close(self.lock)
                self.lock = None
            if self.directory is not None:
                os.close(self.directory)
                self.directory = None


class RunnerServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def __init__(self, config):
        self.config = config
        self.socket_owner = RunnerSocket(config["socket"])
        self.jobs = None
        try:
            self.jobs = CodingJobs(config)
            super().__init__(config["socket"], RunnerRequest)
            self.socket_owner.mark_bound()
            os.chmod(config["socket"], 0o660)
        except BaseException:
            try:
                if hasattr(self, "socket"):
                    super().server_close()
                if self.jobs is not None:
                    self.jobs.close()
            finally:
                self.socket_owner.close()
            raise

    def server_close(self):
        try:
            super().server_close()
        finally:
            self.socket_owner.close()


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
    server = None
    def terminate(_signum, _frame):
        raise KeyboardInterrupt
    previous = signal.signal(signal.SIGTERM, terminate)
    try:
        server = RunnerServer(config)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        # Finish cleanup even if systemd sends a second termination signal.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            if server is not None:
                try:
                    server.server_close()
                finally:
                    server.jobs.close()
        finally:
            signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    main()
