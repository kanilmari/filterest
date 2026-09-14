#!/usr/bin/env python3
"""Call only the operator-configured maintenance actions for the current job.
Connects an isolated coding worktree to the existing guarded site updater.
No browser payload or model-generated shell command becomes an executable.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import subprocess
import time
import hashlib
from pathlib import Path
import stat
import uuid

VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")


def execute_maintenance(jobs, job_id, action, version, cancel_event=None):
    from coding_agent_jobs import JobError, run_timed
    if action not in ("plan", "apply") or not isinstance(version, str) or not VERSION.fullmatch(version):
        raise JobError(400, "valid maintenance action and version required")
    if not jobs.maintenance_lock.acquire(blocking=False):
        raise JobError(409, "one maintenance action is already running")
    try:
        state = jobs.read(job_id)
        if state["status"] != "running":
            raise JobError(409, "maintenance requires the active coding job")
        configured = jobs.config.get("maintenance_actions", {}).get(action)
        if not isinstance(configured, list) or not configured or not all(isinstance(x, str) for x in configured):
            raise JobError(503, "maintenance action is not configured")
        # Only a numeric release version is substituted into a trusted argv array.
        # Existing updater owns backup, source identity, publication and cutover guards.
        command = [part.replace("{version}", version) for part in configured]
        directory = jobs.path(job_id)
        receipt = {"action": action, "version": version, "started_at": time.time()}
        try:
            with (directory / ("maintenance-" + str(time.time_ns()) + ".log")).open("wb") as log:
                completed = run_timed(command, cwd=jobs.config["repository"], stdout=log,
                                           stderr=subprocess.STDOUT, timeout=jobs.config.get("maintenance_timeout_seconds", 1800),
                                           cancel_event=cancel_event)
            receipt.update(status="completed" if completed.returncode == 0 else "failed",
                           exit_code=completed.returncode, finished_at=time.time())
        except subprocess.TimeoutExpired:
            receipt.update(status="failed", error_code="maintenance_timeout", finished_at=time.time())
        except InterruptedError:
            receipt.update(status="failed", error_code="maintenance_cancelled", finished_at=time.time())
        except OSError:
            receipt.update(status="failed", error_code="maintenance_command_failed", finished_at=time.time())
        jobs.append_maintenance(job_id, receipt)
        return receipt
    finally:
        jobs.maintenance_lock.release()


def _read_request(directory_fd, name):
    """Never follow a model-created symlink, including an inbox replacement."""
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ValueError("invalid maintenance request file")
        value = json.loads(source.read(4097))
    if not isinstance(value, dict) or set(value) != {"action", "version"}:
        raise ValueError("action and version are required")
    return value


def _reply(directory_fd, name, value):
    temporary = ".reply-" + uuid.uuid4().hex
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
    with os.fdopen(fd, "w") as target:
        json.dump(value, target)
    os.replace(temporary, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)


def serve_maintenance_inbox(jobs, job_id, inbox, stop):
    """A fixed job's private file bridge works inside Linux's network-off sandbox."""
    from coding_agent_jobs import ID, JobError, atomic_json
    expected = jobs.path(job_id) / "workspace" / ".filterest-maintenance"
    if inbox != expected or inbox.is_symlink():
        return
    try:
        directory_fd = os.open(inbox, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        return
    receipts_path = jobs.path(job_id) / "maintenance-inbox-receipts.json"
    receipts = json.loads(receipts_path.read_text()) if receipts_path.exists() else {}
    try:
        while not stop.is_set() and jobs.read(job_id)["status"] == "running":
            if inbox.is_symlink() or inbox.resolve() != expected:
                break
            for name in os.listdir(directory_fd):
                if stop.is_set():
                    break
                if not name.endswith(".request.json") or not ID.fullmatch(name.removesuffix(".request.json")):
                    continue
                try:
                    request = _read_request(directory_fd, name)
                    digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
                    if name in receipts:
                        previous = receipts[name]
                        result = previous["result"] if previous["digest"] == digest else {"status": "failed", "error_code": "request_id_reused"}
                    else:
                        try:
                            result = execute_maintenance(jobs, job_id, request["action"], request["version"], cancel_event=stop)
                        except JobError as error:
                            result = {"status": "failed", "error_code": "maintenance_rejected", "http_status": error.code}
                        receipts[name] = {"digest": digest, "result": result}
                        atomic_json(receipts_path, receipts)
                    _reply(directory_fd, name.replace(".request.json", ".response.json"), result)
                    os.unlink(name, dir_fd=directory_fd)
                except (OSError, ValueError):
                    # Invalid/symlink request stays unexecuted; it cannot target a host path.
                    continue
            stop.wait(.05)
    finally:
        os.close(directory_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action", choices=("plan", "apply"), default="plan")
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    if not VERSION.fullmatch(args.version):
        parser.error("version must be numeric MAJOR.MINOR.PATCH")
    inbox = Path(os.environ["FILTEREST_CODING_AGENT_INBOX"])
    if not inbox.is_absolute() or inbox.is_symlink():
        parser.error("a runner-owned active job inbox is required")
    name = str(uuid.uuid4())
    request = inbox / (name + ".request.json")
    temporary = inbox / ("." + name + ".tmp")
    with temporary.open("x") as target:
        json.dump({"action": args.action, "version": args.version}, target)
    os.replace(temporary, request)
    response = inbox / (name + ".response.json")
    deadline = time.monotonic() + 1900
    while time.monotonic() < deadline:
        if response.is_file() and not response.is_symlink():
            result = json.loads(response.read_text())
            print(json.dumps(result))
            if result.get("status") != "completed":
                raise SystemExit(1)
            return
        time.sleep(.1)
    raise SystemExit("Maintenance receipt did not arrive; inspect the existing job before retrying")


if __name__ == "__main__":
    main()
