#!/usr/bin/env python3
"""Persist one coding-agent job and run it in its requested mode.
Connects the trusted runner configuration with the mode's engine run and durable status.
A web connection ending never owns or cancels the job's process.
"""
from __future__ import annotations
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time
import traceback
import uuid

from codex_engine import CODE_WORKSPACE, JOB_MODES, SITE_ASSISTANT

ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\Z")
ACTIVE = {"queued", "running"}
PUBLIC_FIELDS = ("job_id", "status", "mode", "dataset", "answer", "error_code", "changed_files",
                 "pending_changes", "api_calls", "plan")


class JobError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp-" + uuid.uuid4().hex)
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)


def run_timed(command, *, timeout, cancel_event=None, on_start=None, **options):
    """Timeout/cancellation ends the complete process group, including tools."""
    if cancel_event is not None and cancel_event.is_set():
        raise InterruptedError("coding job ended")
    payload = options.pop("input", None)
    with subprocess.Popen(command, start_new_session=True, stdin=subprocess.PIPE if payload is not None else None, **options) as process:
        if on_start is not None:
            on_start(process.pid)
        deadline = time.monotonic() + timeout
        first = True
        try:
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise InterruptedError("coding job ended")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(command, timeout)
                try:
                    process.communicate(input=payload if first else None,
                                        timeout=min(.1, remaining) if cancel_event is not None else remaining)
                    break
                except subprocess.TimeoutExpired:
                    first = False
                    if cancel_event is None:
                        raise
        except (subprocess.TimeoutExpired, InterruptedError):
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise
        return subprocess.CompletedProcess(command, process.returncode)


def offered_modes(config):
    """The modes this installation's runner offers, in a stable order."""
    return [mode for mode in JOB_MODES if mode in (config.get("modes") or {})]


def requested_mode(config, payload):
    """Every job names its mode; the runner rechecks it against its own offer."""
    mode = payload.get("mode")
    if not mode and payload.get("site_assistant"):
        # A web application from before modes existed only ever sent site access.
        mode = SITE_ASSISTANT
    if mode not in JOB_MODES:
        raise JobError(400, "a known job mode is required")
    if mode not in offered_modes(config):
        raise JobError(403, "this runner does not offer the requested mode")
    if mode == SITE_ASSISTANT and not isinstance(payload.get("site_assistant"), dict):
        raise JobError(400, "the site assistant needs the job's own site access")
    if mode == CODE_WORKSPACE and payload.get("site_assistant"):
        raise JobError(400, "code work never receives site access")
    return mode


class CodingJobs:
    """One configured site, a bounded writer, and persistent job receipts."""
    def __init__(self, config):
        self.config = config
        self.root = Path(config["jobs_root"]).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.Lock()
        self.process_lock = (self.root / ".writer.lock").open("a+")
        try:
            fcntl.flock(self.process_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("another runner owns this job directory") from error
        for path in self.root.glob("*/status.json"):
            state = json.loads(path.read_text())
            if state.get("status") in ACTIVE:
                state.update(status="interrupted", error_code="runner_restarted", finished_at=time.time())
                atomic_json(path, state)
        self.busy = False
        self.processes = {}

    def path(self, job_id):
        if not ID.fullmatch(job_id):
            raise JobError(400, "invalid job id")
        return self.root / job_id

    def read(self, job_id, actor=None, dataset=None):
        path = self.path(job_id) / "status.json"
        if not path.is_file():
            raise JobError(404, "job not found")
        state = json.loads(path.read_text())
        if actor is not None and (state["actor"] != actor or state["dataset"] != dataset):
            raise JobError(404, "job not found")
        return state

    def public(self, state):
        return {key: state[key] for key in PUBLIC_FIELDS if key in state}

    def submit(self, actor, payload):
        job_id = payload.get("request_id", "")
        directory = self.path(job_id)
        dataset, query = payload.get("dataset"), payload.get("query")
        if not isinstance(dataset, str) or not dataset.strip() or not isinstance(query, str) or not query.strip():
            raise JobError(400, "dataset and query required")
        if len(query) > 24000 or not isinstance(payload.get("messages", []), list):
            raise JobError(400, "invalid prompt")
        mode = requested_mode(self.config, payload)
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        with self.lock:
            if directory.exists():
                state = self.read(job_id, actor, dataset)
                if state["request_hash"] != fingerprint:
                    raise JobError(409, "request id already used")
                return self.public(state)
            if self.busy:
                raise JobError(429, "one coding job is already running")
            self.busy = True
            directory.mkdir(mode=0o700)
            state = dict(job_id=job_id, actor=actor, dataset=dataset, mode=mode,
                         request_hash=fingerprint, status="queued", created_at=time.time())
            if isinstance(payload.get("plan"), dict):
                # The application's own filter plan for this turn, shown back with the answer.
                state["plan"] = payload["plan"]
            atomic_json(directory / "status.json", state)
            atomic_json(directory / "request.json", payload)
        threading.Thread(target=self.run, args=(job_id,), daemon=True).start()
        return self.public(state)

    def update(self, job_id, **changes):
        with self.lock:
            state = self.read(job_id)
            state.update(changes)
            atomic_json(self.path(job_id) / "status.json", state)
            return state

    def track_process(self, job_id):
        """Remember a job's engine process group so stopping the runner ends it too."""
        def started(pid):
            with self.lock:
                self.processes[job_id] = pid
        return started

    def terminate_active(self):
        """End every running engine process group; a stopped runner leaves no orphan Codex."""
        with self.lock:
            groups = list(self.processes.values())
            self.processes.clear()
        for pid in groups:
            try:
                os.killpg(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass

    def run(self, job_id):
        try:
            state = self.update(job_id, status="running", started_at=time.time())
            if state["mode"] == SITE_ASSISTANT:
                from site_assistant_jobs import run_site_assistant_job
                run_site_assistant_job(self, job_id)
            else:
                from code_workspace_jobs import run_code_workspace_job
                run_code_workspace_job(self, job_id)
        except subprocess.TimeoutExpired:
            self.update(job_id, status="failed", error_code="coding_command_timeout", finished_at=time.time())
        except Exception:
            # The browser sees only the error code; the operator's job folder keeps the cause.
            with (self.path(job_id) / "runner_error.log").open("w") as log:
                os.fchmod(log.fileno(), 0o600)
                traceback.print_exc(file=log)
            self.update(job_id, status="failed", error_code="coding_job_failed", finished_at=time.time())
        finally:
            with self.lock:
                self.busy = False
                self.processes.pop(job_id, None)

    def apply_plan(self, job_id, actor, dataset, access):
        """Run one job's approved plan; the administrator's approval lives in the app."""
        if not isinstance(access, dict) or not isinstance(access.get("delegation_code"), str) \
                or not isinstance(access.get("site_base_url"), str):
            raise JobError(400, "fresh site access is required")
        with self.lock:
            state = self.read(job_id, actor, dataset)
            if state.get("mode", SITE_ASSISTANT) != SITE_ASSISTANT:
                raise JobError(409, "only a site assistant job has changes to approve")
            if state.get("status") not in {"awaiting_approval", "apply_failed"}:
                raise JobError(409, "this job has no changes waiting for approval")
            if self.busy:
                raise JobError(429, "one coding job is already running")
            self.busy = True
        try:
            from site_assistant_jobs import apply_site_assistant_plan
            apply_site_assistant_plan(self, job_id, access)
        except JobError:
            raise
        except Exception:
            self.update(job_id, status="apply_failed", error_code="apply_failed", finished_at=time.time())
        finally:
            with self.lock:
                self.busy = False
        return self.public(self.read(job_id))

    def close(self):
        fcntl.flock(self.process_lock, fcntl.LOCK_UN)
        self.process_lock.close()
