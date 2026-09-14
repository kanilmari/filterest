"""Check the fixed-argv maintenance seam without invoking any real updater."""
import json
from pathlib import Path
import sys
import uuid
import pytest
sys.path.insert(0, str(Path(__file__).parent))
from coding_agent_jobs import CodingJobs, JobError, atomic_json
from coding_agent_maintenance import execute_maintenance


def test_maintenance_uses_configured_command_and_records_result(tmp_path):
    script = tmp_path / "operation"
    script.write_text("#!/bin/sh\ntest \"$1\" = '--plan' && test \"$2\" = '9.3.8'\n")
    script.chmod(0o755)
    config = {"jobs_root": str(tmp_path / "jobs"), "repository": str(tmp_path),
              "maintenance_actions": {"plan": [str(script), "--plan", "{version}"]}}
    jobs = CodingJobs(config)
    job_id = str(uuid.uuid4())
    jobs.path(job_id).mkdir()
    atomic_json(jobs.path(job_id) / "status.json", {"job_id": job_id, "status": "running", "maintenance": []})
    try:
        receipt = execute_maintenance(jobs, job_id, "plan", "9.3.8")
        assert receipt["status"] == "completed"
        assert jobs.read(job_id)["maintenance"] == [receipt]
        with pytest.raises(JobError):
            execute_maintenance(jobs, job_id, "plan", "9.3.8; touch /tmp/not-allowed")
        with pytest.raises(JobError):
            execute_maintenance(jobs, job_id, "shell", "9.3.8")
        with pytest.raises(JobError):
            execute_maintenance(jobs, job_id, "apply", "9.3.8")
        jobs.update(job_id, status="completed")
        with pytest.raises(JobError):
            execute_maintenance(jobs, job_id, "plan", "9.3.8")
    finally:
        jobs.close()

def test_parallel_maintenance_is_rejected_and_receipts_are_preserved(tmp_path, monkeypatch):
    import threading
    import subprocess
    jobs = CodingJobs({"jobs_root": str(tmp_path / "jobs"), "repository": str(tmp_path),
                       "maintenance_actions": {"apply": ["/fixed/updater", "{version}"]}})
    job_id = str(uuid.uuid4())
    jobs.path(job_id).mkdir()
    atomic_json(jobs.path(job_id) / "status.json", {"job_id": job_id, "status": "running", "maintenance": [{"status": "earlier"}]})
    started, release = threading.Event(), threading.Event()
    commands = []
    def held(command, **_options):
        commands.append(command)
        started.set()
        assert release.wait(3)
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr("coding_agent_jobs.run_timed", held)
    thread = threading.Thread(target=execute_maintenance, args=(jobs, job_id, "apply", "9.3.8"))
    thread.start()
    try:
        assert started.wait(3)
        with pytest.raises(JobError) as error:
            execute_maintenance(jobs, job_id, "apply", "9.3.9")
        assert error.value.code == 409
        assert len(commands) == 1
    finally:
        release.set()
        thread.join(3)
    try:
        receipts = jobs.read(job_id)["maintenance"]
        assert len(receipts) == 2
        assert receipts[0] == {"status": "earlier"}
        assert receipts[1]["version"] == "9.3.8"
        execute_maintenance(jobs, job_id, "apply", "9.3.9")
        assert len(jobs.read(job_id)["maintenance"]) == 3
    finally:
        jobs.close()


def test_job_inbox_deduplicates_and_rejects_symlinks_and_inactive_jobs(tmp_path):
    import threading
    import time
    from coding_agent_maintenance import serve_maintenance_inbox
    script = tmp_path / "updater"
    invocations = tmp_path / "calls"
    script.write_text("#!/bin/sh\nprintf '%s\n' called >> " + str(invocations) + "\n")
    script.chmod(0o755)
    jobs = CodingJobs({"jobs_root": str(tmp_path / "jobs"), "repository": str(tmp_path),
                       "maintenance_actions": {"plan": [str(script), "{version}"]}})
    job_id = str(uuid.uuid4())
    inbox = jobs.path(job_id) / "workspace" / ".filterest-maintenance"
    inbox.mkdir(parents=True)
    atomic_json(jobs.path(job_id) / "status.json", {"job_id": job_id, "status": "running", "maintenance": []})
    outside = tmp_path / "outside.json"
    outside.write_text(json.dumps({"action": "plan", "version": "9.3.8"}))
    (inbox / (str(uuid.uuid4()) + ".request.json")).symlink_to(outside)
    stop = threading.Event()
    worker = threading.Thread(target=serve_maintenance_inbox, args=(jobs, job_id, inbox, stop))
    worker.start()
    name = str(uuid.uuid4())
    request, response = inbox / (name + ".request.json"), inbox / (name + ".response.json")
    def send(value):
        response.unlink(missing_ok=True)
        atomic_json(request, value)
        deadline = time.monotonic() + 3
        while not response.exists() and time.monotonic() < deadline:
            time.sleep(.01)
        return json.loads(response.read_text())
    try:
        assert send({"action": "plan", "version": "9.3.8"})["status"] == "completed"
        assert send({"action": "plan", "version": "9.3.8"})["status"] == "completed"
        assert send({"action": "apply", "version": "9.3.9"})["error_code"] == "request_id_reused"
        assert invocations.read_text().splitlines() == ["called"]
        assert json.loads(outside.read_text())["version"] == "9.3.8"
        assert len(jobs.read(job_id)["maintenance"]) == 1
    finally:
        stop.set(); worker.join(3)
    try:
        jobs.update(job_id, status="completed")
        serve_maintenance_inbox(jobs, job_id, inbox, threading.Event())
        assert invocations.read_text().splitlines() == ["called"]
    finally:
        jobs.close()
