#!/usr/bin/env python3
"""Unit tests for db_task queue continuation helpers.

These tests protect the generic parent-ticket queue runner that delegates one
active queue item at a time to worker_agent. They verify both markdown parsing
and the stop-on-no-progress guard so the runner stays reusable beyond #804.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from filterest.app.server_tools.agent_tools import db_task
except ModuleNotFoundError:
    from server_tools.agent_tools import db_task


def db_task_dump_wrapper(content: str, *, task_id: int = 7, title: str = "Example") -> str:
    """Build a representative db_task dump wrapper around canonical ticket content."""
    return f"""<!-- Status: in_progress -->
<!-- id: {task_id} -->
<!-- issue_type: task -->
<!-- priority: normal -->
<!-- tags:  -->
<!-- parent_id:  -->
<!-- assigned_to:  -->
<!-- queue_slug: feature_development -->
<!-- queue_title: Feature Development -->
<!-- groups: backend -->
<!-- dumped_at: 2026-06-02T04:00:00 -->
# {title}
Created: 2026-06-02

**Type:** task
**Status:** in_progress
**Priority:** normal
**Queue:** Feature Development

{content}"""


QUEUE_TICKET = """# Example

## Already handled
- `#1` old item

## Active restoration queue
These are still open.

### primary bucket
- `#290` `foo.md` (`db_len=1`, `git_len=2`)
- `#294` `bar.md` (`db_len=3`, `git_len=4`)

### secondary bucket
- `#999` multiline item
  with additional context

## Metadata-only cases
- `#25` metadata-only
"""


def test_parse_active_queue_items_extracts_bullets_with_subheadings() -> None:
    """The parser should return only active queue items, preserving the subsection label."""
    items = db_task._parse_active_queue_items(QUEUE_TICKET)

    assert [item["key"] for item in items] == ["#290", "#294", "#999"]
    assert items[0]["subheading"] == "primary bucket"
    assert items[2]["text"].endswith("with additional context")


def test_parse_active_queue_items_skips_none_currently_marker() -> None:
    """A queue subsection that says 'None currently.' should not produce a fake work item."""
    content = """## Active queue

### empty
- None currently.

### pending
- `#42` real item
"""

    items = db_task._parse_active_queue_items(content)

    assert [item["key"] for item in items] == ["#42"]


def test_parse_group_slug_csv_normalizes_and_dedupes() -> None:
    """Group CSV parsing should trim, lowercase, and preserve first-seen order."""
    parsed = db_task._parse_group_slug_csv(" Frontend,backend,frontend, Testing ,, BACKEND ")

    assert parsed == ["frontend", "backend", "testing"]


def test_parse_todo_import_tree_builds_two_level_tree() -> None:
    """Todo import should convert markdown bullets into a parent/child task tree."""
    content = """# Component list

- Käyttäjät ja IDM
  - Profiili / sen muokkaus
  - Salasanan vaihto
- Käyttöoikeudet
  - Taulukohtaiset käyttäjäoikeudet
  - Jono- ja lokero -näkyvyysrajaukset
"""

    tree = db_task._parse_todo_import_tree(content)

    assert tree == [
        {
            "text": "Käyttäjät ja IDM",
            "children": [
                {"text": "Profiili / sen muokkaus"},
                {"text": "Salasanan vaihto"},
            ],
        },
        {
            "text": "Käyttöoikeudet",
            "children": [
                {"text": "Taulukohtaiset käyttäjäoikeudet"},
                {"text": "Jono- ja lokero -näkyvyysrajaukset"},
            ],
        },
    ]


def test_parse_todo_import_tree_rejects_non_bullet_content() -> None:
    """Todo import should fail loudly instead of silently flattening prose."""
    with pytest.raises(SystemExit, match="1"):
        db_task._parse_todo_import_tree("- Parent\nplain prose\n")


def test_cmd_todos_import_tree_verifies_task_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bulk-ish CLI imports should avoid one task-read API call per imported todo."""
    read_calls: list[int] = []
    create_calls: list[dict[str, object]] = []

    def fake_create_todo(
        task_id: int,
        todo_text: str,
        parent_todo_id: int | None = None,
        sort_order: int | None = None,
        *,
        verify_task: bool = True,
    ) -> dict[str, int]:
        create_calls.append(
            {
                "task_id": task_id,
                "todo_text": todo_text,
                "parent_todo_id": parent_todo_id,
                "sort_order": sort_order,
                "verify_task": verify_task,
            }
        )
        return {"id": len(create_calls)}

    monkeypatch.setattr(db_task, "_read_task_or_exit", lambda task_id: read_calls.append(task_id))
    monkeypatch.setattr(db_task, "_read_todo_import_content", lambda args: "- Parent\n  - Child\n")
    monkeypatch.setattr(db_task, "_create_todo", fake_create_todo)

    db_task.cmd_todos_import_tree(argparse.Namespace(task_id=42, dry_run=False))

    assert read_calls == [42]
    assert create_calls == [
        {
            "task_id": 42,
            "todo_text": "Parent",
            "parent_todo_id": None,
            "sort_order": 10,
            "verify_task": False,
        },
        {
            "task_id": 42,
            "todo_text": "Child",
            "parent_todo_id": 1,
            "sort_order": 10,
            "verify_task": False,
        },
    ]


def test_todo_status_helpers_support_review_inventory_states() -> None:
    """The CLI should keep richer assessment statuses visible for component inventories."""
    assert db_task._validate_todo_status(" partially_done ") == "partially_done"
    assert db_task._validate_todo_status("needs_review") == "needs_review"
    assert db_task._validate_todo_status("not_applicable") == "not_applicable"
    assert db_task._format_todo_line(
        {
            "id": 10,
            "todo_text": "SSO-kirjautuminen",
            "status": "needs_review",
        }
    ) == "[?] #10 SSO-kirjautuminen [needs_review]"


def test_get_session_cookie_jar_path_is_process_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    """db_task should create and reuse one private random jar per process."""
    monkeypatch.setattr(db_task, "_session_cookie_jar_path", None)

    jar_path = Path(db_task._get_session_cookie_jar_path())
    try:
        assert jar_path.name.startswith("db_task_cookies_")
        assert jar_path.suffix == ".txt"
        assert jar_path.stat().st_mode & 0o777 == 0o600
        assert Path(db_task._get_session_cookie_jar_path()) == jar_path
    finally:
        jar_path.unlink(missing_ok=True)


def test_credential_attempts_do_not_synthesize_tracked_login_fallback() -> None:
    """db_task must use resolved or explicit credentials, never a tracked password."""
    attempts = db_task._credential_attempts({
        "DEV_USERNAME": "removed-user",
        "DEV_PASSWORD": "old-password",
    })

    assert attempts == [("removed-user", "old-password")]


def test_aborted_is_valid_but_not_active_status() -> None:
    """aborted is terminal: db_task accepts it but default lists should hide it."""
    assert db_task._validate_task_status("aborted", context="status") == "aborted"
    assert "aborted" in db_task.TASK_STATUS_VALUES
    assert "aborted" not in db_task.ACTIVE_STATUSES


def test_task_drift_fields_detects_group_membership_changes() -> None:
    """Task drift reconciliation should treat changed group membership as canonical drift."""
    api_task = {"title": "Example", "status": "new", "groups": [{"slug": "frontend"}]}
    direct_task = {"title": "Example", "status": "new", "groups": [{"slug": "backend"}]}

    drift_fields = db_task._task_drift_fields(api_task, direct_task)

    assert drift_fields == ["groups"]


def test_strip_db_task_dump_wrappers_removes_nested_metadata() -> None:
    """Content-file guard should strip one or more dumped-ticket wrappers."""
    canonical_content = "# Example\nCreated: 2026-06-02\n\n## Body\nReal task content.\n"
    wrapped = db_task_dump_wrapper(db_task_dump_wrapper(canonical_content))

    stripped, count = db_task._strip_db_task_dump_wrappers(wrapped)

    assert count == 2
    assert stripped == canonical_content


def test_build_dump_stale_report_and_prune_keep_current_folder(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Stale dump cleanup should touch only same-ID stale folders after confirmation."""
    current = tmp_path / "0007-current-title"
    stale = tmp_path / "0007-old-title"
    orphan = tmp_path / "0008-orphan"
    current.mkdir()
    stale.mkdir()
    orphan.mkdir()
    monkeypatch.setattr(db_task, "DUMP_DIR", str(tmp_path))

    report = db_task._build_dump_stale_report([{"id": 7, "title": "Current title"}], include_orphans=True)

    assert [item["name"] for item in report["stale"]] == ["0007-old-title"]
    assert [item["name"] for item in report["orphans"]] == ["0008-orphan"]

    db_task._prune_stale_dump_folders(report)

    assert current.exists()
    assert not stale.exists()
    assert orphan.exists()


def test_direct_db_fetch_tasks_attaches_groups_and_filters_by_group_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    """Direct DB fallback should filter by groups and attach group metadata to each returned task."""
    queries: list[str] = []

    def fake_run_direct_db_query(query: str):
        queries.append(query)
        if "SELECT r.task_id, g.id, g.slug" in query:
            return [
                {
                    "task_id": 7,
                    "id": 10,
                    "slug": "frontend",
                    "title": "Frontend",
                    "description": "UI work",
                    "sort_order": 1,
                    "created_at": "2026-03-29T10:00:00",
                    "updated_at": "2026-03-29T10:00:00",
                }
            ]
        return [
            {
                "id": 7,
                "title": "Example",
                "status": "new",
                "issue_type": "task",
            }
        ]

    monkeypatch.setattr(db_task, "_run_direct_db_query", fake_run_direct_db_query)

    tasks = db_task._direct_db_fetch_tasks(groups=" Frontend,backend ")

    assert len(tasks) == 1
    assert tasks[0]["groups"] == [
        {
            "id": 10,
            "slug": "frontend",
            "title": "Frontend",
            "description": "UI work",
            "sort_order": 1,
            "created_at": "2026-03-29T10:00:00",
            "updated_at": "2026-03-29T10:00:00",
        }
    ]
    assert "WHERE g.slug IN ('frontend', 'backend')" in queries[0]


def test_cmd_update_sends_group_slugs_and_verifies_groups(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """update should forward normalized group slugs and verify the reloaded task membership."""
    api_calls: list[tuple[str, str, object]] = []

    def fake_api(method: str, path: str, data=None, params=None):
        api_calls.append((method, path, data if data is not None else params))
        return {"id": 7}

    monkeypatch.setattr(db_task, "_api", fake_api)
    monkeypatch.setattr(
        db_task,
        "_read_single_task_reconciled",
        lambda task_id: {
            "id": task_id,
            "title": "Example",
            "status": "new",
            "queue_slug": "testing",
            "groups": [{"slug": "frontend"}, {"slug": "backend"}],
        },
    )
    monkeypatch.setattr(db_task, "_dump_task", lambda task: "/tmp/example.md")

    args = argparse.Namespace(
        id=7,
        status=None,
        title=None,
        priority=None,
        assigned_to=None,
        queue=None,
        parent=None,
        groups=" frontend,backend,frontend ",
        content=None,
        content_file=None,
    )

    db_task.cmd_update(args)

    stdout = capsys.readouterr().out
    assert api_calls == [
        ("PATCH", "/api/app/agent-tools/tasks", {"id": 7, "group_slugs": ["frontend", "backend"]})
    ]
    assert "Task #7 updated and verified" in stdout
    assert "Groups:   frontend, backend" in stdout


def test_cmd_update_strips_dump_wrapper_from_content_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """update --content-file should not write db_task dump metadata into task content."""
    canonical_content = "# Example\nCreated: 2026-06-02\n\n## Body\nReal task content.\n"
    content_file = tmp_path / "ticket.md"
    content_file.write_text(db_task_dump_wrapper(canonical_content), encoding="utf-8")
    api_calls: list[tuple[str, str, object]] = []

    def fake_api(method: str, path: str, data=None, params=None):
        api_calls.append((method, path, data if data is not None else params))
        return {"id": 7}

    monkeypatch.setattr(db_task, "_api", fake_api)
    monkeypatch.setattr(
        db_task,
        "_read_single_task_reconciled",
        lambda task_id: {
            "id": task_id,
            "title": "Example",
            "status": "new",
            "queue_slug": "testing",
            "groups": [],
            "content": canonical_content,
        },
    )
    monkeypatch.setattr(db_task, "_dump_task", lambda task: "/tmp/example.md")

    args = argparse.Namespace(
        id=7,
        status=None,
        title=None,
        priority=None,
        assigned_to=None,
        queue=None,
        parent=None,
        groups=None,
        content=None,
        content_file=str(content_file),
        keep_dump_wrapper_content=False,
    )

    db_task.cmd_update(args)

    captured = capsys.readouterr()
    assert api_calls == [
        ("PATCH", "/api/app/agent-tools/tasks", {"id": 7, "content": canonical_content})
    ]
    assert "stripped 1 db_task dump wrapper" in captured.err
    assert "Task #7 updated and verified" in captured.out


def test_cmd_new_omits_legacy_filename_from_create_payload(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """new should create DB-native tasks without inventing an md-era filename."""
    api_calls: list[tuple[str, str, object]] = []

    def fake_api(method: str, path: str, data=None, params=None):
        api_calls.append((method, path, data if data is not None else params))
        return {"id": 11, "title": "Fresh task", "content": "hello", "status": "new"}

    monkeypatch.setattr(db_task, "_api", fake_api)
    monkeypatch.setattr(db_task, "_dump_task", lambda task: "/tmp/example.md")

    args = argparse.Namespace(
        description="Fresh task",
        issue_type="task",
        priority="normal",
        parent=None,
        queue=None,
        groups=None,
    )

    db_task.cmd_new(args)

    stdout = capsys.readouterr().out
    assert api_calls == [
        (
            "POST",
            "/api/app/agent-tools/tasks",
            {
                "title": "Fresh task",
                "issue_type": "task",
                "status": "new",
                "content": f"# Fresh task\nCreated: {db_task.datetime.date.today().isoformat()}\n\nFresh task",
                "priority": "normal",
            },
        )
    ]
    assert "Created task #11: Fresh task" in stdout


def test_cmd_update_sends_parent_id_and_verifies_parent(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """update should forward parent IDs and verify the reloaded task relationship."""
    api_calls: list[tuple[str, str, object]] = []

    def fake_api(method: str, path: str, data=None, params=None):
        api_calls.append((method, path, data if data is not None else params))
        return {"id": 7}

    monkeypatch.setattr(db_task, "_api", fake_api)
    monkeypatch.setattr(
        db_task,
        "_read_single_task_reconciled",
        lambda task_id: {
            "id": task_id,
            "title": "Example",
            "status": "new",
            "queue_slug": "testing",
            "parent_id": 21,
            "groups": [],
        },
    )
    monkeypatch.setattr(db_task, "_dump_task", lambda task: "/tmp/example.md")

    args = argparse.Namespace(
        id=7,
        status=None,
        title=None,
        priority=None,
        assigned_to=None,
        queue=None,
        parent="21",
        groups=None,
        content=None,
        content_file=None,
    )

    db_task.cmd_update(args)

    stdout = capsys.readouterr().out
    assert api_calls == [
        ("PATCH", "/api/app/agent-tools/tasks", {"id": 7, "parent_id": 21})
    ]
    assert "Task #7 updated and verified" in stdout


def test_cmd_update_clears_parent_when_requested(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """update should allow clearing a parent relationship with the 'none' sentinel."""
    api_calls: list[tuple[str, str, object]] = []

    def fake_api(method: str, path: str, data=None, params=None):
        api_calls.append((method, path, data if data is not None else params))
        return {"id": 7}

    monkeypatch.setattr(db_task, "_api", fake_api)
    monkeypatch.setattr(
        db_task,
        "_read_single_task_reconciled",
        lambda task_id: {
            "id": task_id,
            "title": "Example",
            "status": "new",
            "queue_slug": "testing",
            "parent_id": None,
            "groups": [],
        },
    )
    monkeypatch.setattr(db_task, "_dump_task", lambda task: "/tmp/example.md")

    args = argparse.Namespace(
        id=7,
        status=None,
        title=None,
        priority=None,
        assigned_to=None,
        queue=None,
        parent="none",
        groups=None,
        content=None,
        content_file=None,
    )

    db_task.cmd_update(args)

    stdout = capsys.readouterr().out
    assert api_calls == [
        ("PATCH", "/api/app/agent-tools/tasks", {"id": 7, "parent_id": None})
    ]
    assert "Task #7 updated and verified" in stdout


def test_cmd_continue_launches_worker_and_advances_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    """continue should launch worker_agent for the first queue item and require queue progress."""
    parent_before = {"id": 804, "title": "Parent", "content": QUEUE_TICKET}
    parent_after = {"id": 804, "title": "Parent", "content": QUEUE_TICKET.replace("- `#290` `foo.md` (`db_len=1`, `git_len=2`)\n", "", 1)}
    reads = iter([parent_before, parent_after])

    monkeypatch.setattr(db_task, "_read_single_task_reconciled", lambda task_id: next(reads))
    monkeypatch.setattr(db_task, "_write_continue_prompt", lambda prompt: "/tmp/fake_prompt.md")

    removed_paths: list[str] = []
    monkeypatch.setattr(db_task.os, "remove", removed_paths.append)

    calls: list[list[str]] = []

    class Result:
        def __init__(self, returncode: int = 0) -> None:
            self.returncode = returncode

    def fake_run(cmd, cwd=None, text=None, **kwargs):
        calls.append(list(cmd))
        return Result(0)

    monkeypatch.setattr(db_task.subprocess, "run", fake_run)

    args = argparse.Namespace(
        id=804,
        count=1,
        family="codex",
        research=False,
        full_access=True,
        dry_run=False,
    )

    db_task.cmd_continue(args)

    assert calls[0][:5] == [
        db_task.WORKER_AGENT_COMMAND,
        "--task-id",
        "task_continue_ticket_804_ticket290",
        "--background",
        "family=codex",
    ]
    assert calls[1] == [db_task.WORKER_AGENT_COMMAND, "--wait", "task_continue_ticket_804_ticket290"]
    assert removed_paths == ["/tmp/fake_prompt.md"]


def test_cmd_continue_stops_when_worker_does_not_advance_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    """continue should fail fast if the same queue item remains active after worker completion."""
    parent = {"id": 804, "title": "Parent", "content": QUEUE_TICKET}
    reads = iter([parent, parent])

    monkeypatch.setattr(db_task, "_read_single_task_reconciled", lambda task_id: next(reads))
    monkeypatch.setattr(db_task, "_write_continue_prompt", lambda prompt: "/tmp/fake_prompt.md")
    monkeypatch.setattr(db_task.os, "remove", lambda path: None)

    class Result:
        def __init__(self, returncode: int = 0) -> None:
            self.returncode = returncode

    monkeypatch.setattr(db_task.subprocess, "run", lambda *args, **kwargs: Result(0))

    args = argparse.Namespace(
        id=804,
        count=1,
        family=None,
        research=False,
        full_access=True,
        dry_run=False,
    )

    with pytest.raises(SystemExit, match="1"):
        db_task.cmd_continue(args)
