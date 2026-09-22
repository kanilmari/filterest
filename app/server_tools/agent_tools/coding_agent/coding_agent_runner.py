#!/usr/bin/env python3
"""Serve one site's administrator coding-agent jobs over a protected Unix socket.
Connects the web adapter with the job modes this installation offers and the pinned Codex engine.
A production runner uses a dedicated non-root user; a developer's runner is that developer.
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
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

from codex_engine import (CODE_WORKSPACE, JOB_MODES, PINNED_CODEX_VERSION, SITE_ASSISTANT,
                          code_workspace_sandbox, engine_environment, executable_status)
from coding_agent_jobs import CodingJobs, JobError, atomic_json, offered_modes, requested_mode

DEDICATED = "dedicated"
SAME_USER_WORKSTATION = "same_user_workstation"
REMOVED_SETTINGS = ("repository", "source_revision", "maintenance_actions")


def absolute(value, field):
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError(field + " must be an absolute path")
    return Path(value)


def load_config(path):
    return validate_config(json.loads(Path(path).read_text()))


def validate_config(config):
    """Reject an unsafe or outdated configuration before anything starts."""
    for field in ("socket", "jobs_root"):
        absolute(config.get(field), field)
    if not isinstance(config.get("site_id"), str) or not config["site_id"]:
        raise ValueError("site_id is required")
    command = config.get("codex_command")
    if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command) or not Path(command[0]).is_absolute():
        raise ValueError("codex_command requires an installed absolute executable")
    leftover = [field for field in REMOVED_SETTINGS if field in config]
    if leftover:
        raise ValueError("the isolated source-copy variant was removed; delete " + ", ".join(leftover)
                         + " and list the offered job modes under modes")
    identity = config.get("identity", DEDICATED)
    if identity not in (DEDICATED, SAME_USER_WORKSTATION):
        raise ValueError("identity must be dedicated or same_user_workstation")
    uids = config.get("allowed_web_uids")
    if not isinstance(uids, list) or not uids or not all(isinstance(x, int) and x > 0 for x in uids):
        raise ValueError("explicit non-root web peer UIDs are required")
    if identity == DEDICATED and os.getuid() in uids:
        raise ValueError("runner and web peer must use different Unix users")
    if identity == SAME_USER_WORKSTATION and uids != [os.getuid()]:
        # On a developer's own machine the web server and the runner are that developer.
        raise ValueError("a same-user workstation runner accepts only its own user as web peer")
    modes = config.get("modes")
    if not isinstance(modes, dict) or not modes or not set(modes) <= set(JOB_MODES) \
            or not all(isinstance(value, dict) for value in modes.values()):
        raise ValueError("modes must offer at least one of: " + ", ".join(JOB_MODES))
    jobs = Path(config["jobs_root"]).resolve()
    if CODE_WORKSPACE in modes:
        # Editing code is a development-machine capability by a fixed rule: a
        # dedicated production runner can never offer it, whatever else it lists.
        if identity != SAME_USER_WORKSTATION:
            raise ValueError("code_workspace is offered only by a same-user workstation runner")
        settings = modes[CODE_WORKSPACE]
        workspace = absolute(settings.get("workspace"), "modes.code_workspace.workspace")
        repositories = [absolute(value, "modes.code_workspace.repositories")
                        for value in settings.get("repositories") or [str(workspace)]]
        code_workspace_sandbox(config)
        for repository in {workspace, *repositories}:
            repository = repository.resolve()
            if jobs == repository or repository in jobs.parents:
                raise ValueError("job storage must be outside the source checkout")
    if config.get("site_tls_ca_file"):
        absolute(config["site_tls_ca_file"], "site_tls_ca_file")
    return config


def private_modes(config):
    """Socket permissions: the web peer's group on a server, the owner alone on a workstation."""
    if config.get("identity") == SAME_USER_WORKSTATION:
        return 0o700, 0o600
    return 0o750, 0o660


def readiness(config):
    """Local tools, account and per-mode checks only; never a model request."""
    result = {"runner_ready": False, "authentication_verified": False, "reason_code": "runner_tools_missing",
              "modes": [], "offered_modes": offered_modes(config), "codex_version": "",
              "pinned_codex_version": PINNED_CODEX_VERSION}
    status = executable_status(config["codex_command"], engine_environment(config, SITE_ASSISTANT))
    result["codex_version"] = status["version"]
    result["authentication_verified"] = status["authenticated"]
    if not status["installed"]:
        return result
    if not status["pinned"]:
        result["reason_code"] = "runner_version_mismatch"
        return result
    if not status["authenticated"]:
        result["reason_code"] = "runner_authentication_required"
        return result
    ready = []
    for mode in result["offered_modes"]:
        if mode == CODE_WORKSPACE:
            workspace = Path(config["modes"][CODE_WORKSPACE]["workspace"])
            if not (workspace / ".git").exists():
                continue
        ready.append(mode)
    result["modes"] = ready
    if not ready:
        result["reason_code"] = "runner_mode_unavailable"
        return result
    result.update(runner_ready=True, reason_code="")
    return result


class RunnerSocket:
    """Own one protected socket pathname across normal and crash restarts."""
    def __init__(self, path, directory_mode=0o750):
        self.path = Path(path)
        self.directory = None
        self.lock = None
        self.bound = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=directory_mode)
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
        directory_mode, socket_mode = private_modes(config)
        self.socket_owner = RunnerSocket(config["socket"], directory_mode)
        self.jobs = None
        try:
            self.jobs = CodingJobs(config)
            super().__init__(config["socket"], RunnerRequest)
            self.socket_owner.mark_bound()
            os.chmod(config["socket"], socket_mode)
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
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # A reloaded page drops its poll; accepted jobs persist independently.
            self.close_connection = True

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
                body = self.body()
                mode = requested_mode(config, body)
                if mode not in readiness(config)["modes"]:
                    raise JobError(503, "runner is not ready for this mode")
                return self.reply(202, self.server.jobs.submit(actor, body))
            if self.command == "POST" and parts.path.startswith("/v1/jobs/") and parts.path.endswith("/apply"):
                job_id = parts.path.removeprefix("/v1/jobs/").removesuffix("/apply")
                body = self.body()
                return self.reply(200, self.server.jobs.apply_plan(
                    job_id, actor, str(body.get("dataset", "")), body.get("site_assistant")))
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


def socket_is_live(path):
    """Whether a runner currently accepts connections on this socket; no request is sent."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
        probe.settimeout(1)
        try:
            probe.connect(str(path))
        except OSError:
            return False
    return True


def workstation_config(arguments):
    """The developer machine's runner: the developer's own user, private paths, both modes."""
    workspace = str(Path(arguments.workspace).resolve())
    repositories = [str(Path(value).resolve()) for value in arguments.repository] or [workspace]
    config = {
        "site_id": arguments.site_id,
        "identity": SAME_USER_WORKSTATION,
        "socket": arguments.socket,
        "allowed_web_uids": [os.getuid()],
        "jobs_root": arguments.jobs_root,
        "codex_command": [arguments.codex],
        "modes": {
            CODE_WORKSPACE: {"workspace": workspace, "repositories": list(dict.fromkeys(repositories))},
            SITE_ASSISTANT: {},
        },
    }
    if arguments.site_tls_ca_file:
        config["site_tls_ca_file"] = arguments.site_tls_ca_file
    return validate_config(config)


def write_private_config(path, config):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    atomic_json(path, config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--check", action="store_true", help="Check local tools/account without starting a model")
    parser.add_argument("--status", action="store_true", help="Report whether this runner is listening")
    parser.add_argument("--init-workstation", action="store_true",
                        help="Write this developer machine's runner configuration, then exit")
    parser.add_argument("--site-id")
    parser.add_argument("--socket")
    parser.add_argument("--jobs-root")
    parser.add_argument("--codex")
    parser.add_argument("--workspace")
    parser.add_argument("--repository", action="append", default=[])
    parser.add_argument("--site-tls-ca-file")
    args = parser.parse_args()
    if os.getuid() == 0:
        parser.error("runner must not run as root")
    if args.init_workstation:
        missing = [name for name in ("site_id", "socket", "jobs_root", "codex", "workspace") if not getattr(args, name)]
        if missing:
            parser.error("--init-workstation needs --" + ", --".join(name.replace("_", "-") for name in missing))
        write_private_config(args.config, workstation_config(args))
        return
    config = load_config(args.config)
    if args.check:
        print(json.dumps(readiness(config)))
        return
    if args.status:
        print(json.dumps({"running": socket_is_live(config["socket"]), "socket": config["socket"]}))
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
                    server.jobs.terminate_active()
                    server.server_close()
                finally:
                    server.jobs.close()
        finally:
            signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    main()
