"""test_lifecycle_updates.py
Verify native/Docker update ordering, failures, readiness and exclusive locks.
Connect the updater to isolated release checkouts and shared recorder fixtures.
Preserve lifecycle guarantees without real databases, services or network access.
"""

from __future__ import annotations

import fcntl
import os
from pathlib import Path
import stat
import subprocess
import time

import pytest

from native_lifecycle_fixture import (
    assert_calls_in_order,
    build_update_fixture,
    git_output,
    logged_calls,
    run_update,
    update_backups,
)


def test_docker_updater_dry_run_calls_no_docker_command(tmp_path: Path) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)

    completed = run_update(fixture, "--dry-run")

    assert completed.returncode == 0, completed.stderr
    assert "Profile: docker" in completed.stdout
    assert "image rebuild" in completed.stdout
    assert "Dry run complete" in completed.stdout
    assert not [call for call in logged_calls(fixture) if call.startswith("docker")]
    assert update_backups(fixture) == []
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]


def test_docker_updater_backs_up_fast_forwards_and_waits_for_ready(tmp_path: Path) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    settings = fixture["settings"]
    assert isinstance(checkout, Path) and isinstance(settings, dict)

    completed = run_update(fixture, "--yes")

    assert completed.returncode == 0, completed.stderr
    assert "Filterest update completed: 8.51.0" in completed.stdout
    calls = logged_calls(fixture)
    assert_calls_in_order(
        calls,
        [
            "docker images --quiet app",
            "docker stop app",
            "docker exec -T db sh -c",
            "docker exec -T db pg_restore --list",
            "docker up --build --detach",
            "docker-up ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST= fd9=closed",
            "curl https://localhost:8100/system/ready",
            "docker ps",
        ],
    )
    assert not [call for call in calls if call.startswith(("pg_dump", "install", "filterest"))]
    assert not [call for call in calls if "--wait" in call]
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["target_commit"]
    assert "FILTEREST_APP_VERSION=8.51.0" in (checkout / "keys/docker.env").read_text(
        encoding="utf-8"
    )
    assert not (checkout / "data/runtime/filterest-setup-complete").exists()

    [backup] = update_backups(fixture)
    assert stat.S_IMODE(backup.stat().st_mode) == 0o700
    assert (backup / "database.dump").read_text(encoding="utf-8") == "PGDMP docker dump"
    for name in (
        "database.dump",
        "database.roles.sql",
        "database.sha256",
        "database.backup.json",
        "database.settings.tar.gz",
        "storage.tar.gz",
        "bootstrap.tar.gz",
        "installation_settings.tar.gz",
        "manifest.txt",
    ):
        assert stat.S_IMODE((backup / name).stat().st_mode) == 0o600, name
    archived = subprocess.run(
        ["tar", "-tzf", str(backup / "installation_settings.tar.gz")],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    assert "keys/docker.env" in archived
    assert {"config/", "projects/"} <= set(archived)
    manifest = (backup / "manifest.txt").read_text(encoding="utf-8")
    assert "profile=docker\n" in manifest
    assert f"source_commit={fixture['old_commit']}\n" in manifest
    assert "app_image_id=sha256:previous-app-image\n" in manifest
    for key in ("DB_ADMIN_PASSWORD", "SESSION_SECRET_KEY"):
        secret = settings[key]
        assert secret not in completed.stdout + completed.stderr
        assert not [call for call in calls if secret in call]


def test_docker_updater_stops_the_new_app_when_it_does_not_become_ready(
    tmp_path: Path,
) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)

    completed = run_update(
        fixture,
        "--yes",
        "--ready-timeout",
        "1",
        extra_environment={"FILTEREST_TEST_READY_VERSION": "8.50.0"},
    )

    assert completed.returncode != 0
    [backup] = update_backups(fixture)
    assert "version 8.50.0 answered, expected 8.51.0" in completed.stderr
    assert "application container was stopped" in completed.stderr
    assert str(backup) in completed.stderr
    calls = logged_calls(fixture)
    up_index = next(index for index, call in enumerate(calls) if call.startswith("docker up"))
    assert "docker stop app" in calls[up_index:]
    assert "docker ps" not in calls
    assert (backup / "manifest.txt").is_file()
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["target_commit"]


def test_docker_updater_changes_nothing_when_the_dump_fails(tmp_path: Path) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)

    completed = run_update(
        fixture, "--yes", extra_environment={"FILTEREST_TEST_DUMP_STATUS": "1"}
    )

    assert completed.returncode != 0
    assert "nothing was written" in completed.stderr
    assert "stopped before changing the installation" in completed.stderr
    [backup] = update_backups(fixture)
    assert not (backup / "manifest.txt").exists()
    assert all(p.name.startswith("database-tool-") for p in backup.iterdir())
    assert not [call for call in logged_calls(fixture) if call.startswith("docker up")]
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]


@pytest.mark.parametrize(
    ("change", "expected_error"),
    (
        ("native-marker", "records both a Docker installation"),
        ("empty-native-marker", "records both a Docker installation"),
        ("native-settings", "records both a Docker installation"),
        ("inherited-setting", "COMPOSE_PROJECT_NAME"),
        # Matching today, but the update rewrites it before the restart.
        ("inherited-matching-version", "FILTEREST_APP_VERSION"),
    ),
)
def test_docker_updater_refuses_ambiguous_installations_before_any_change(
    tmp_path: Path, change: str, expected_error: str
) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)
    extra_environment: dict[str, str] = {}
    if change == "native-marker":
        (checkout / "data/runtime/filterest-setup-complete").write_text(
            "profile=admin\napp_version=8.50.0\ndb_version=9.0.0\n", encoding="utf-8"
        )
    elif change == "empty-native-marker":
        (checkout / "data/runtime/filterest-setup-complete").write_text("", encoding="utf-8")
    elif change == "native-settings":
        # A native setup that stopped before its completion marker.
        native_settings = checkout / "keys/filterest_runtime/development_environment.env"
        native_settings.write_text("FILTEREST_INSTALL_PROFILE=development\n", encoding="utf-8")
    elif change == "inherited-matching-version":
        extra_environment["FILTEREST_APP_VERSION"] = "8.50.0"
    else:
        extra_environment["COMPOSE_PROJECT_NAME"] = "another-stack"

    completed = run_update(fixture, "--yes", extra_environment=extra_environment)

    assert completed.returncode != 0
    assert expected_error in completed.stderr
    assert "another-stack" not in completed.stderr
    assert not [call for call in logged_calls(fixture) if call.startswith("docker")]
    assert update_backups(fixture) == []
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]


def test_updater_refuses_a_second_update_while_one_holds_the_lock(tmp_path: Path) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)
    lock_path = checkout / "data/runtime/filterest-update.lock"

    with lock_path.open("a", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        completed = run_update(fixture, "--yes")

    assert completed.returncode != 0
    assert "another Filterest update is already running" in completed.stderr
    assert "docker stop app" not in logged_calls(fixture)
    assert update_backups(fixture) == []
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]


def test_updater_lets_only_one_of_two_concurrent_updates_proceed(tmp_path: Path) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)
    slow_stop = dict(fixture["environment"])  # type: ignore[arg-type]
    slow_stop["FILTEREST_TEST_STOP_DELAY"] = "3"

    first = subprocess.Popen(
        ["bash", str(checkout / "app/server_tools/update_filterest.sh"), "--yes"],
        cwd=checkout.parent,
        env=slow_stop,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 30
        while "docker stop app" not in logged_calls(fixture):
            assert first.poll() is None, first.communicate()
            assert time.monotonic() < deadline, "the first update never reached its stop"
            time.sleep(0.05)
        second = run_update(fixture, "--yes")
        _, first_stderr = first.communicate(timeout=60)
    finally:
        if first.poll() is None:
            first.kill()
            first.wait()

    assert second.returncode != 0
    assert "another Filterest update is already running" in second.stderr
    assert first.returncode == 0, first_stderr
    assert logged_calls(fixture).count("docker stop app") == 1
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["target_commit"]


def test_docker_updater_changes_nothing_when_the_app_does_not_stop(tmp_path: Path) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)

    completed = run_update(fixture, "--yes", extra_environment={"FILTEREST_TEST_STOP_STATUS": "1"})

    assert completed.returncode != 0
    assert "stopped before changing the installation" in completed.stderr
    assert update_backups(fixture) == []
    # Read-only role preflight runs before stopping; no snapshot or restart follows
    # a failed stop, even though the earlier checks used docker exec.
    assert any('pg_dumpall --roles-only' in call for call in logged_calls(fixture))
    assert not [
        call for call in logged_calls(fixture)
        if call.startswith("docker up") or "pg_dump " in call or "pg_restore " in call
    ]
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]


def test_docker_updater_changes_nothing_when_a_file_archive_fails(tmp_path: Path) -> None:
    if os.geteuid() == 0:
        pytest.skip("root can read a file without read permission")
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)
    unreadable = checkout / "data/storage/unreadable.bin"
    unreadable.write_text("operator file\n", encoding="utf-8")
    unreadable.chmod(0)

    try:
        completed = run_update(fixture, "--yes")
    finally:
        unreadable.chmod(0o600)

    assert completed.returncode != 0
    assert "before shutdown" in completed.stderr
    assert update_backups(fixture) == []
    assert not any('stop app' in call for call in logged_calls(fixture))
    assert not [call for call in logged_calls(fixture) if call.startswith("docker up")]
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]


def test_docker_updater_keeps_the_checkout_when_the_fast_forward_fails(tmp_path: Path) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)
    # Untracked, so the checkout still counts as clean, but in the release's way.
    (checkout / "app/RELEASE_NOTES.txt").write_text("operator copy\n", encoding="utf-8")

    completed = run_update(fixture, "--yes")

    assert completed.returncode != 0
    assert "Recovery checkout preflight refused" in completed.stderr
    assert update_backups(fixture) == []
    assert not [call for call in logged_calls(fixture) if call.startswith(("docker up", "docker stop"))]
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]
    assert (checkout / "app/RELEASE_NOTES.txt").read_text(encoding="utf-8") == "operator copy\n"


@pytest.mark.parametrize(
    ("failure", "expected_outcome"),
    (
        ({"FILTEREST_TEST_UP_STATUS": "1"}, "so its application container was stopped"),
        (
            {"FILTEREST_TEST_READY_VERSION": "8.50.0", "FILTEREST_TEST_STOP_FAILS_AFTER_UP": "1"},
            "stopping its application container failed, so it may still be running",
        ),
    ),
)
def test_docker_updater_reports_a_new_version_that_does_not_start(
    tmp_path: Path, failure: dict[str, str], expected_outcome: str
) -> None:
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)

    completed = run_update(fixture, "--yes", "--ready-timeout", "1", extra_environment=failure)

    assert completed.returncode != 0
    assert "did not start and report ready" in completed.stderr
    assert expected_outcome in completed.stderr
    calls = logged_calls(fixture)
    up_index = next(index for index, call in enumerate(calls) if call.startswith("docker up"))
    assert "docker stop app" in calls[up_index:]
    assert "docker ps" not in calls
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["target_commit"]


@pytest.mark.parametrize(
    "marker",
    (
        "",
        "app_version=8.50.0\n",
        "profile=admin\nprofile=development\n",
        "profile=admin\nprofile=\n",
        "profile=docker\n",
    ),
)
def test_native_updater_refuses_a_marker_without_exactly_one_known_profile(
    tmp_path: Path, marker: str
) -> None:
    fixture = build_update_fixture(tmp_path, "development")
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)
    (checkout / "data/runtime/filterest-setup-complete").write_text(marker, encoding="utf-8")

    completed = run_update(fixture, "--yes")

    assert completed.returncode != 0
    assert "must record exactly one profile" in completed.stderr
    assert logged_calls(fixture) == []
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]


@pytest.mark.parametrize("profile", ("admin", "development"))
def test_native_updater_applies_the_release_for_each_profile(
    tmp_path: Path, profile: str
) -> None:
    fixture = build_update_fixture(tmp_path, profile)
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)

    completed = run_update(fixture, "--yes")
    if profile == "development":
        assert completed.returncode != 0
        assert "Recovery native source build refused" in completed.stderr
        assert update_backups(fixture) == []
        assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]
        assert "go build" not in logged_calls(fixture)
        return

    assert completed.returncode == 0, completed.stderr
    calls = logged_calls(fixture)
    stop_call = "run_filterest_admin.sh stop"
    start_call = "run_filterest_admin.sh start"
    assert_calls_in_order(
        calls,
        [
            stop_call,
            "pg_dump",
            f"install_filterest.sh --profile {profile} --yes --no-start",
            f"{start_call} ENABLE_SQL_MIGRATIONS=true "
            "EASELECT_MIGRATION_FILE_ALLOWLIST= fd9=closed",
            "filterest status",
        ],
    )
    assert not [call for call in calls if call.startswith("docker")]
    # The backup keeps the restricted roles' grants: a restore needs them.
    [dump_call] = [call.split() for call in calls if call.startswith("pg_dump ")]
    assert "--format=custom" in dump_call
    assert "--no-owner" not in dump_call
    assert "--no-privileges" not in dump_call
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["target_commit"]
    assert (checkout / "data/runtime/filterest-setup-complete").read_text(
        encoding="utf-8"
    ) == f"profile={profile}\napp_version=8.51.0\ndb_version=9.0.0\n"
    [backup] = update_backups(fixture)
    assert (backup / "database.dump").read_text(encoding="utf-8") == "native dump"
    assert {path.name for path in backup.iterdir() if not path.name.startswith("database-tool-")} == {
        "database.dump", "database.roles.sql", "database.sha256", "database.backup.json", "database.properties.json",
        "database.settings.tar.gz", "installation_settings.tar.gz", "manifest.txt", "storage.tar.gz", "update.backup.json",
    }
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in backup.iterdir())
    manifest = (backup / "manifest.txt").read_text(encoding="utf-8")
    assert f"profile={profile}\n" in manifest
    assert f"source_commit={fixture['old_commit']}\n" in manifest
    assert "native-test-secret" not in completed.stdout + completed.stderr

