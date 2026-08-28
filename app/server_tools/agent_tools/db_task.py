#!/usr/bin/env python3
# db_task.py
# Manages DB-backed Filterest tasks through the agent-tools HTTP API.
# Bridges terminal workflows, canonical task metadata, and dump-to-disk backups.
# Keeps human and agent task operations on the same validated ticket lifecycle.
# Exists so live ticket state stays in dev_agent_tasks instead of ad hoc files.

import argparse
import atexit
import datetime
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

_CANONICAL_FILTEREST_ROOT = Path(__file__).resolve().parents[2]
if not __package__ and str(_CANONICAL_FILTEREST_ROOT) not in sys.path:
    sys.path.insert(0, str(_CANONICAL_FILTEREST_ROOT))

try:
    from ..lib.easelect_private_paths import (
        resolve_easelect_private_paths,
        resolve_embedded_project_root,
    )
except ImportError:
    from server_tools.lib.easelect_private_paths import (
        resolve_easelect_private_paths,
        resolve_embedded_project_root,
    )


PROJECT_ROOT = str(resolve_embedded_project_root(_CANONICAL_FILTEREST_ROOT))
_IS_EMBEDDED_EASELECT_CHECKOUT = Path(PROJECT_ROOT) != _CANONICAL_FILTEREST_ROOT
DUMP_DIR = os.environ.get(
    "FILTEREST_TASK_DUMP_DIR",
    os.path.join(PROJECT_ROOT, "agent_tasks", "_db_dump"),
)
TEST_CREDENTIALS_FILE = os.environ.get(
    "FILTEREST_TEST_CREDENTIAL_FILE",
    os.path.join(PROJECT_ROOT, "dev_env_test_creds.txt"),
)
DATABASE_COMMAND = os.environ.get(
    "FILTEREST_DATABASE_COMMAND",
    str(_CANONICAL_FILTEREST_ROOT / "filterest"),
)
DATABASE_SUBCOMMAND = os.environ.get(
    "FILTEREST_DATABASE_SUBCOMMAND",
    "database",
).strip()
DATABASE_DISPLAY_COMMAND = os.environ.get(
    "FILTEREST_DATABASE_DISPLAY_COMMAND",
    "./filterest database",
)
WORKER_AGENT_COMMAND = os.environ.get(
    "FILTEREST_WORKER_AGENT_COMMAND",
    str(_CANONICAL_FILTEREST_ROOT / "worker_agent"),
)
REMOTE_TEST_ADMIN_FALLBACK_ENV = "DB_TASK_ALLOW_REMOTE_TEST_ADMIN_FALLBACK"
REMOTE_DEV_CREDENTIALS_ENV = "DB_TASK_ALLOW_REMOTE_DEV_CREDENTIALS"
INSECURE_TLS_ENV = "DB_TASK_ALLOW_INSECURE_TLS"
LOCAL_NATIVE_PORT = 8082 if _IS_EMBEDDED_EASELECT_CHECKOUT else 8100
_DEV_USERNAME_EXPLICIT_KEY = "_DB_TASK_DEV_USERNAME_EXPLICIT"
_DEV_PASSWORD_EXPLICIT_KEY = "_DB_TASK_DEV_PASSWORD_EXPLICIT"
_OTP_EXPLICIT_KEY = "_DB_TASK_OTP_EXPLICIT"

# Default server — the native dev instance
BASE_URL = os.environ.get("DB_TASK_BASE_URL", f"https://localhost:{LOCAL_NATIVE_PORT}")

# Status aliases matching ./task conventions
STATUS_ALIASES = {
    "start": "in_progress",
    "hold": "on_hold",
    "close": "done",
    "reject": "rejected",
    "archive": "archived",
    "delete": "to_be_deleted",
}

TASK_STATUS_VALUES = {
    "new",
    "backlog",
    "backlog_later",
    "backlog_nice_to_have",
    "in_progress",
    "on_hold",
    "awaiting_human_decision",
    "done",
    "rejected",
    "aborted",
    "archived",
    "to_be_deleted",
}

TASK_STATUS_INPUT_ALIASES = {
    "awaiting_review": "awaiting_human_decision",
    "closed": "done",
    "done_autonomously": "done",
    "later": "backlog_later",
    "nice_to_have": "backlog_nice_to_have",
}

# Statuses considered "active" (shown by default in list)
ACTIVE_STATUSES = {
    "new",
    "backlog",
    "backlog_later",
    "backlog_nice_to_have",
    "in_progress",
    "on_hold",
    "awaiting_human_decision",
}
DEV_RATE_LIMIT_WARNING_HEADER = "x-dev-ratelimit-would-exceed"
HTTP_STATUS_MARKER = "__DB_TASK_HTTP_STATUS__:"
DIRECT_DB_SUPPORTED_COMMANDS = {"list", "show", "dump"}
COMMENT_DATASET = "dev_agent_tasks"
CURL_CONNECT_TIMEOUT_SECONDS = 5
CURL_MAX_TIME_SECONDS = 30
SUBPROCESS_TIMEOUT_SECONDS = CURL_MAX_TIME_SECONDS + 5
DIRECT_DB_TIMEOUT_SECONDS = 30
TODO_STATUS_VALUES = {"todo", "partially_done", "needs_review", "not_applicable", "done"}

TASK_SELECT_COLUMNS = (
    "t.id, t.title, t.issue_type, t.status, t.created AS created_at, t.updated AS updated_at, "
    "t.content, t.priority, t.tags, t.parent_id, t.assigned_to, "
    "t.queue_id, q.slug AS queue_slug, q.title AS queue_title"
)
TASK_FROM_CLAUSE = " FROM dev_agent_tasks t LEFT JOIN dev_agent_task_queues q ON q.id = t.queue_id"

ISSUE_TYPES = {"task", "incident", "bug", "epic"}
QUEUE_CLEAR_ALIASES = {"", "none", "clear", "unassigned"}
ACTIVE_QUEUE_HEADING_RE = re.compile(r"^##\s+Active\b.*queue\b", re.IGNORECASE)
HEADING_RE = re.compile(r"^(#{2,6})\s+(.*\S)\s*$")
BULLET_RE = re.compile(r"^-\s+(.*\S)\s*$")
NONE_QUEUE_ITEM_RE = re.compile(r"^none(?:\s+currently)?\.?$", re.IGNORECASE)
DUMP_FOLDER_RE = re.compile(r"^(\d{4})-.+")


def _split_curl_response(output):
    """Split curl output into headers and body."""
    if "\r\n\r\n" in output:
        return output.split("\r\n\r\n", 1)
    if "\n\n" in output:
        return output.split("\n\n", 1)
    return "", output


def _emit_dev_warning(headers):
    """Surface dev-only backend warnings that would otherwise stay in headers/logs."""
    for line in headers.splitlines():
        if ":" not in line:
            continue
        name, _, value = line.partition(":")
        if name.strip().lower() == DEV_RATE_LIMIT_WARNING_HEADER and value.strip().lower() == "true":
            print(
                "Warning: login rate limit would normally be exceeded here, but dev mode allowed the request.",
                file=sys.stderr,
            )
            return


def _sql_literal(value):
    """Quote a SQL string literal for SELECT-only direct DB fallback queries."""
    return "'" + str(value).replace("'", "''") + "'"


def _normalize_status_for_db(status):
    normalized = (status or "").strip()
    if not normalized:
        return ""
    return TASK_STATUS_INPUT_ALIASES.get(normalized, normalized)


def _normalize_status_for_client(status):
    return _normalize_status_for_db(status)


def _normalize_todo_status(status):
    """Normalize CLI/API todo statuses to the structured todo vocabulary."""
    normalized = (status or "").strip().lower()
    return normalized or "todo"


def _validate_todo_status(status, *, context="todo status"):
    """Validate a structured todo status before sending it to the API."""
    normalized = _normalize_todo_status(status)
    if normalized not in TODO_STATUS_VALUES:
        allowed = ", ".join(sorted(TODO_STATUS_VALUES))
        print(
            f"Error: invalid {context} '{status}'. Allowed values: {allowed}",
            file=sys.stderr,
        )
        sys.exit(1)
    return normalized


def _validate_task_status(status, *, context):
    normalized = _normalize_status_for_db(status)
    if not normalized:
        print(f"Error: {context} cannot be empty.", file=sys.stderr)
        sys.exit(1)
    if normalized not in TASK_STATUS_VALUES:
        allowed = ", ".join(sorted(TASK_STATUS_VALUES))
        print(
            f"Error: invalid {context} '{status}'. Allowed values: {allowed}",
            file=sys.stderr,
        )
        sys.exit(1)
    return normalized


def _normalize_task_for_client(task):
    if isinstance(task, dict) and task.get("status"):
        task = dict(task)
        task["status"] = _normalize_status_for_client(task["status"])
        task["issue_type"] = task.get("issue_type") or "task"
    return task


def _normalize_issue_type(issue_type):
    if not issue_type:
        return "task"
    if issue_type not in ISSUE_TYPES:
        print(
            f"Error: invalid issue type '{issue_type}'. Allowed values: task, incident, bug, epic",
            file=sys.stderr,
        )
        sys.exit(1)
    return issue_type


def _normalize_queue_slug(queue_slug):
    return (queue_slug or "").strip().lower()


def _normalize_parent_id(parent_value):
    """Normalize a parent selector for update operations."""
    if parent_value is None:
        return False, None

    normalized = str(parent_value).strip().lower()
    if normalized in {"", "none", "clear", "unassigned"}:
        return True, None

    try:
        parent_id = int(normalized)
    except ValueError:
        print(
            "Error: invalid parent ID. Use an integer task ID or 'none' to clear it.",
            file=sys.stderr,
        )
        sys.exit(1)

    if parent_id <= 0:
        print(
            "Error: parent ID must be a positive integer or 'none' to clear it.",
            file=sys.stderr,
        )
        sys.exit(1)

    return True, parent_id


def _normalize_group_slug_list(group_slugs):
    """Normalize a list of group slugs while preserving caller order."""
    normalized = []
    seen = set()
    for slug in group_slugs or []:
        value = (slug or "").strip().lower()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)
    return normalized


def _parse_group_slug_csv(group_slugs):
    """Parse one comma-separated CLI/API groups argument into normalized slugs."""
    if group_slugs is None:
        return []
    return _normalize_group_slug_list(group_slugs.split(","))


def _task_group_slug_list(task):
    """Extract one task's normalized group slug membership for comparisons."""
    if not isinstance(task, dict):
        return []
    groups = task.get("groups") or []
    if not isinstance(groups, list):
        return []
    return _normalize_group_slug_list(
        group.get("slug") for group in groups if isinstance(group, dict)
    )


def _queue_item_key(item_text):
    """Extract a stable key from one markdown queue bullet."""
    hash_ticket = re.search(r"`(#\d+)`", item_text)
    if hash_ticket:
        return hash_ticket.group(1)

    first_code_span = re.search(r"`([^`]+)`", item_text)
    if first_code_span:
        return first_code_span.group(1).strip()

    token_match = re.search(r"([A-Za-z0-9_./:-]+)", item_text)
    if token_match:
        return token_match.group(1)

    return item_text.strip()


def _queue_item_slug(item_text):
    """Turn a queue key/text into a worker-safe task-id suffix."""
    key = _queue_item_key(item_text).strip().lower()
    if key.startswith("#") and key[1:].isdigit():
        return f"ticket{key[1:]}"
    slug = re.sub(r"[^a-z0-9]+", "_", key).strip("_")
    return slug[:48] or "queue_item"


def _finalize_queue_item(items, current_subheading, current_lines):
    if not current_lines:
        return
    text = " ".join(part.strip() for part in current_lines if part.strip()).strip()
    if not text or NONE_QUEUE_ITEM_RE.match(text):
        return
    items.append(
        {
            "text": text,
            "key": _queue_item_key(text),
            "slug": _queue_item_slug(text),
            "subheading": current_subheading or "Active queue",
        }
    )


def _parse_active_queue_items(content):
    """Extract bullet items from the first level-2 'Active ... queue' section."""
    if not content:
        return []

    items = []
    in_active_queue = False
    current_subheading = None
    current_lines = []

    for raw_line in content.splitlines():
        line = raw_line.rstrip()
        heading_match = HEADING_RE.match(line)
        if heading_match:
            level = len(heading_match.group(1))
            heading_text = heading_match.group(2).strip()

            if level == 2:
                if in_active_queue:
                    _finalize_queue_item(items, current_subheading, current_lines)
                    break
                if ACTIVE_QUEUE_HEADING_RE.match(line):
                    in_active_queue = True
                    current_subheading = heading_text
                    current_lines = []
                continue

            if not in_active_queue:
                continue

            _finalize_queue_item(items, current_subheading, current_lines)
            current_lines = []
            current_subheading = heading_text
            continue

        if not in_active_queue:
            continue

        bullet_match = BULLET_RE.match(line)
        if bullet_match:
            _finalize_queue_item(items, current_subheading, current_lines)
            current_lines = [bullet_match.group(1).strip()]
            continue

        if current_lines:
            if not line.strip():
                _finalize_queue_item(items, current_subheading, current_lines)
                current_lines = []
            elif raw_line.startswith(("  ", "\t")):
                current_lines.append(line.strip())
            else:
                _finalize_queue_item(items, current_subheading, current_lines)
                current_lines = []

    if in_active_queue:
        _finalize_queue_item(items, current_subheading, current_lines)

    return items


def _build_continue_prompt(parent_task, queue_item, batch_index, batch_count):
    """Build a generic single-item worker prompt from a parent ticket queue item."""
    task_id = parent_task["id"]
    title = parent_task.get("title") or f"task-{task_id}"
    return (
        f"Continue parent DB ticket #{task_id}: {title}\n\n"
        f"This is queue item {batch_index} of {batch_count}. Work on exactly one active queue item and then stop.\n\n"
        f"Target queue subsection: {queue_item['subheading']}\n"
        f"Target queue item key: {queue_item['key']}\n"
        f"Target queue item text: {queue_item['text']}\n\n"
        "Required workflow:\n"
        f"1. Read the parent ticket fresh with `./db_task show {task_id} --direct-db` before doing anything else.\n"
        "2. Confirm that the same queue item is still active in the parent ticket.\n"
        "3. Follow the parent ticket's own rules and worker instructions. Do not start a second queue item.\n"
        "4. If the queue item is ambiguous or no longer active, stop and explain why instead of guessing.\n"
        "5. If you complete the item, update the parent ticket so this queue item leaves the active queue.\n"
        "6. Verify the concrete work you performed before finishing.\n"
        "7. End with a concise worker summary.\n"
    )


def _write_continue_prompt(prompt):
    fd, path = tempfile.mkstemp(prefix="db_task_continue_", suffix=".md")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(prompt)
    return path


def _continue_run_task_id(parent_task_id, queue_item):
    return f"task_continue_ticket_{parent_task_id}_{queue_item['slug']}"


def _base_url_supports_local_direct_db_shadow():
    """Return True when the configured API target is the local native instance."""
    return _is_local_native_base_url(BASE_URL)


def _task_drift_fields(api_task, direct_task):
    """Return the canonical task fields that differ between API and direct DB reads."""
    if not isinstance(api_task, dict) or not isinstance(direct_task, dict):
        return []

    drift_fields = []
    fields = [
        "title",
        "status",
        "content",
        "queue_id",
        "queue_slug",
        "queue_title",
    ]
    for field in fields:
        if api_task.get(field) != direct_task.get(field):
            drift_fields.append(field)

    if sorted(_task_group_slug_list(api_task)) != sorted(_task_group_slug_list(direct_task)):
        drift_fields.append("groups")

    return drift_fields


def _direct_db_shadow_available():
    """Return whether this Python runtime can execute the optional local DB helper."""
    try:
        return importlib.util.find_spec("psycopg2") is not None
    except (ImportError, ValueError):
        return False


def _read_single_task_reconciled(task_id):
    """Read one task via API and reconcile against direct DB when local drift is detected."""
    api_task = _normalize_task_for_client(_api("GET", "/api/app/agent-tools/tasks", params={"id": str(task_id)}))
    if not _base_url_supports_local_direct_db_shadow() or not _direct_db_shadow_available():
        return api_task

    direct_task = _direct_db_fetch_tasks(task_id=task_id)
    if not direct_task:
        return api_task

    drift_fields = _task_drift_fields(api_task, direct_task)
    if drift_fields:
        print(
            "Warning: API task read drifted from local DB for "
            f"task #{task_id}; using direct DB values for {', '.join(drift_fields)}.",
            file=sys.stderr,
        )
        return direct_task

    return api_task


def _run_direct_db_query(query):
    """Run a read-only query through Filterest's public database command."""
    cmd = [DATABASE_COMMAND]
    if DATABASE_SUBCOMMAND:
        cmd.append(DATABASE_SUBCOMMAND)
    cmd.extend(["--local", query])
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=DIRECT_DB_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        print(
            f"Error: direct DB fallback timed out after {DIRECT_DB_TIMEOUT_SECONDS}s",
            file=sys.stderr,
        )
        sys.exit(1)

    stdout = result.stdout.strip()
    stderr = result.stderr.strip()

    if result.returncode != 0:
        detail = stderr or stdout or "unknown direct DB error"
        print(f"Error: direct DB fallback failed: {detail}", file=sys.stderr)
        sys.exit(1)

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON response from direct DB fallback: {stdout[:200]}", file=sys.stderr)
        sys.exit(1)

    if isinstance(payload, dict) and payload.get("error"):
        print(f"Error: direct DB fallback failed: {payload['error']}", file=sys.stderr)
        sys.exit(1)

    return payload


def _direct_db_attach_groups(tasks):
    """Attach group metadata to one task or a task list using read-only direct DB queries."""
    if isinstance(tasks, dict):
        task_items = [tasks]
        single_task = True
    elif isinstance(tasks, list):
        task_items = [task for task in tasks if isinstance(task, dict)]
        single_task = False
    else:
        return tasks

    task_ids = []
    for task in task_items:
        task["groups"] = []
        task_id = task.get("id")
        if isinstance(task_id, int):
            task_ids.append(task_id)

    if not task_ids:
        return task_items[0] if single_task and task_items else tasks

    task_ids_sql = ", ".join(str(task_id) for task_id in sorted(set(task_ids)))
    payload = _run_direct_db_query(
        "SELECT r.task_id, g.id, g.slug, g.title, g.description, g.sort_order, "
        "g.created AS created_at, g.updated AS updated_at "
        "FROM dev_agent_task_group_relations r "
        "JOIN dev_agent_task_groups g ON g.id = r.group_id "
        f"WHERE r.task_id IN ({task_ids_sql}) "
        "ORDER BY r.task_id, g.sort_order, g.slug"
    )

    groups_by_task = {task_id: [] for task_id in task_ids}
    for row in payload or []:
        if not isinstance(row, dict):
            continue
        task_id = row.get("task_id")
        if task_id not in groups_by_task:
            continue
        groups_by_task[task_id].append(
            {
                "id": row.get("id"),
                "slug": row.get("slug"),
                "title": row.get("title"),
                "description": row.get("description") or "",
                "sort_order": row.get("sort_order", 0),
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
            }
        )

    for task in task_items:
        task["groups"] = groups_by_task.get(task.get("id"), [])

    return task_items[0] if single_task and task_items else tasks


def _direct_db_fetch_tasks(status=None, task_id=None, queue=None, groups=None):
    """Read tasks directly from the local DB via the existing read-only db helper."""
    conditions = []
    if status:
        normalized_status = _validate_task_status(status, context="status filter")
        conditions.append(f"t.status = {_sql_literal(normalized_status)}")
    if task_id is not None:
        conditions.append(f"t.id = {int(task_id)}")
    normalized_queue = _normalize_queue_slug(queue)
    if normalized_queue not in QUEUE_CLEAR_ALIASES:
        conditions.append(f"q.slug = {_sql_literal(normalized_queue)}")
    normalized_groups = _parse_group_slug_csv(groups)
    if normalized_groups:
        group_literals = ", ".join(_sql_literal(group_slug) for group_slug in normalized_groups)
        conditions.append(
            "t.id IN ("
            "SELECT r.task_id "
            "FROM dev_agent_task_group_relations r "
            "JOIN dev_agent_task_groups g ON g.id = r.group_id "
            f"WHERE g.slug IN ({group_literals})"
            ")"
        )

    where_clause = ""
    if conditions:
        where_clause = " WHERE " + " AND ".join(conditions)

    query = (
        f"SELECT {TASK_SELECT_COLUMNS}"
        f"{TASK_FROM_CLAUSE}{where_clause} ORDER BY t.status, t.id"
    )
    payload = _run_direct_db_query(query)

    if task_id is not None:
        if isinstance(payload, list):
            task = _normalize_task_for_client(payload[0]) if payload else None
        else:
            task = _normalize_task_for_client(payload)
        return _direct_db_attach_groups(task)

    tasks = [_normalize_task_for_client(task) for task in payload]
    return _direct_db_attach_groups(tasks)


def _load_credentials():
    """Load login credentials from project files before process-level overrides."""
    private_paths = resolve_easelect_private_paths(Path(PROJECT_ROOT))
    creds = {}
    for path in [
        private_paths.runtime_env_file,
        private_paths.development_env_file,
        Path(TEST_CREDENTIALS_FILE),
    ]:
        if not os.path.exists(path):
            continue
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                creds[key.strip()] = val.strip()
    dev_username_explicit = bool(os.environ.get("DEV_USERNAME"))
    dev_password_explicit = bool(os.environ.get("DEV_PASSWORD"))
    dev_login_code_explicit = bool(os.environ.get("DEV_LOGIN_VERIFICATION_CODE"))
    otp_explicit = bool(os.environ.get("LOGIN_OTP_CODE")) or dev_login_code_explicit
    if dev_username_explicit:
        creds["DEV_USERNAME"] = os.environ["DEV_USERNAME"]
    if dev_password_explicit:
        creds["DEV_PASSWORD"] = os.environ["DEV_PASSWORD"]
    if otp_explicit:
        creds["LOGIN_OTP_CODE"] = os.environ["LOGIN_OTP_CODE"]
    if dev_login_code_explicit:
        creds["DEV_LOGIN_VERIFICATION_CODE"] = os.environ["DEV_LOGIN_VERIFICATION_CODE"]
    if os.environ.get("EASELECT_API_USERNAME"):
        creds["DEV_USERNAME"] = os.environ["EASELECT_API_USERNAME"]
        dev_username_explicit = True
    if os.environ.get("EASELECT_API_PASSWORD"):
        creds["DEV_PASSWORD"] = os.environ["EASELECT_API_PASSWORD"]
        dev_password_explicit = True
    if os.environ.get("EASELECT_API_OTP_CODE"):
        creds["DEV_LOGIN_VERIFICATION_CODE"] = os.environ["EASELECT_API_OTP_CODE"]
        otp_explicit = True
    creds[_DEV_USERNAME_EXPLICIT_KEY] = dev_username_explicit
    creds[_DEV_PASSWORD_EXPLICIT_KEY] = dev_password_explicit
    creds[_OTP_EXPLICIT_KEY] = otp_explicit
    return creds


def _is_local_native_base_url(base_url):
    """Allow implicit development credentials only for the native loopback app."""
    try:
        parsed = urllib.parse.urlsplit(base_url)
        port = parsed.port
    except (TypeError, ValueError):
        return False

    return (
        parsed.scheme == "https"
        and parsed.hostname in {"localhost", "127.0.0.1"}
        and port == LOCAL_NATIVE_PORT
        and parsed.username is None
        and parsed.password is None
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
    )


def _credential_attempts(creds, *, base_url=None, environment=None):
    """Return explicit credentials plus dev fallbacks only for approved targets."""
    resolved_base_url = BASE_URL if base_url is None else base_url
    resolved_environment = os.environ if environment is None else environment
    attempts = []
    username = (creds.get("DEV_USERNAME") or "").strip()
    password = (creds.get("DEV_PASSWORD") or "").strip()
    is_local_native = _is_local_native_base_url(resolved_base_url)
    allow_remote_dev_credentials = (
        resolved_environment.get(REMOTE_DEV_CREDENTIALS_ENV) == "1"
    )
    dev_credentials_are_explicit = (
        creds.get(_DEV_USERNAME_EXPLICIT_KEY) is True
        and creds.get(_DEV_PASSWORD_EXPLICIT_KEY) is True
    )
    if username and password and (
        is_local_native
        or allow_remote_dev_credentials
        or dev_credentials_are_explicit
    ):
        attempts.append((username, password))

    allow_remote_test_admin = (
        resolved_environment.get(REMOTE_TEST_ADMIN_FALLBACK_ENV) == "1"
    )
    if not is_local_native and not allow_remote_test_admin:
        return attempts

    test_admin_pair = (
        (creds.get("TEST_ADMIN_USER") or "").strip(),
        (creds.get("TEST_ADMIN_PASS") or "").strip(),
    )
    if all(test_admin_pair) and test_admin_pair not in attempts:
        attempts.append(test_admin_pair)
    if not is_local_native:
        return attempts

    return attempts


_cached_session = None
_session_cookie_jar_path = None


def _cleanup_session_cookie_jar():
    """Remove the process-owned cookie jar without following alternate paths."""
    global _session_cookie_jar_path
    path = _session_cookie_jar_path
    _session_cookie_jar_path = None
    if not path:
        return
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def _reset_session_cookie_jar(path):
    """Create or truncate a cookie jar while enforcing owner-only permissions."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        os.fchmod(fd, 0o600)
    finally:
        os.close(fd)


def _get_session_cookie_jar_path():
    """Return one process-scoped cookie-jar path for db_task HTTP sessions."""
    global _session_cookie_jar_path
    if _session_cookie_jar_path:
        flags = os.O_WRONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            fd = os.open(_session_cookie_jar_path, flags)
        except FileNotFoundError:
            _session_cookie_jar_path = None
        else:
            try:
                os.fchmod(fd, 0o600)
            finally:
                os.close(fd)
            return _session_cookie_jar_path

    fd, path = tempfile.mkstemp(prefix="db_task_cookies_", suffix=".txt")
    try:
        os.fchmod(fd, 0o600)
    finally:
        os.close(fd)
    _session_cookie_jar_path = path
    return path


atexit.register(_cleanup_session_cookie_jar)


def _curl_uses_insecure_tls(*, base_url=None, environment=None):
    """Allow curl -k only for exact native dev or an explicit remote opt-in."""
    resolved_base_url = BASE_URL if base_url is None else base_url
    resolved_environment = os.environ if environment is None else environment
    return (
        _is_local_native_base_url(resolved_base_url)
        or resolved_environment.get(INSECURE_TLS_ENV) == "1"
    )


def _curl_session_command(jar):
    """Build the shared curl prefix with target-aware TLS verification."""
    cmd = ["curl"]
    if _curl_uses_insecure_tls():
        cmd.append("-k")
    cmd += [
        "-s",
        "--connect-timeout",
        str(CURL_CONNECT_TIMEOUT_SECONDS),
        "--max-time",
        str(CURL_MAX_TIME_SECONDS),
        "-D",
        "-",
        "-b",
        jar,
        "-c",
        jar,
    ]
    return cmd


def _curl_raw(jar, method, path, data=None, extra_headers=None):
    """Low-level curl call that returns parsed JSON or raw text."""
    cmd = _curl_session_command(jar)
    if method != "GET":
        cmd += ["-X", method]
    if data:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    if extra_headers:
        for h in extra_headers:
            cmd += ["-H", h]
    cmd.append(f"{BASE_URL}{path}")
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return None
    if result.returncode != 0:
        return None
    headers, body = _split_curl_response(result.stdout)
    _emit_dev_warning(headers)
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def _is_session_valid(jar):
    """Check if existing cookie jar has a valid authenticated session."""
    if not os.path.exists(jar):
        return False
    # Check if cookie file is recent (< 30 min)
    try:
        age = datetime.datetime.now().timestamp() - os.path.getmtime(jar)
        if age > 1800:
            return False
    except OSError:
        return False
    auth_modes = _curl_raw(jar, "GET", "/api/auth-modes")
    return isinstance(auth_modes, dict) and auth_modes.get("needs_button") == "logout"


def _get_session():
    """Authenticate and return (cookie_jar_path, csrf_token).
    Reuses an existing session if the cookie jar is still valid."""
    global _cached_session
    jar = _get_session_cookie_jar_path()

    # Check cached in-process session
    if _cached_session:
        return _cached_session

    # Check if existing jar is still authenticated
    if _is_session_valid(jar):
        info = _curl_raw(jar, "GET", "/api/csrf-token")
        csrf = info.get("csrf_token", "") if isinstance(info, dict) else ""
        _cached_session = (jar, csrf)
        return jar, csrf

    # Fresh login needed — truncate in place so curl never recreates it as 0644.
    try:
        _reset_session_cookie_jar(jar)
    except OSError as error:
        print(f"Error: Cannot secure DB task cookie jar: {error}", file=sys.stderr)
        sys.exit(1)

    creds = _load_credentials()
    dev_otp_code = creds.get("DEV_LOGIN_VERIFICATION_CODE", "")
    test_otp_code = creds.get("LOGIN_OTP_CODE", "")
    if (
        not _is_local_native_base_url(BASE_URL)
        and os.environ.get(REMOTE_DEV_CREDENTIALS_ENV) != "1"
        and creds.get(_OTP_EXPLICIT_KEY) is not True
    ):
        dev_otp_code = ""
        test_otp_code = ""

    credential_attempts = _credential_attempts(creds)
    if not credential_attempts:
        print("Error: Cannot find usable DB task login credentials", file=sys.stderr)
        sys.exit(1)

    last_error = "unknown error"
    for username, password in credential_attempts:
        is_primary_dev_account = (
            username == (creds.get("DEV_USERNAME") or "").strip()
            and password == (creds.get("DEV_PASSWORD") or "").strip()
        )
        otp_code = dev_otp_code if is_primary_dev_account else test_otp_code
        # Step 1: Get initial CSRF from the public bootstrap endpoint.
        info = _curl_raw(jar, "GET", "/api/csrf-token")
        if not info or not isinstance(info, dict):
            print("Error: Cannot reach server at " + BASE_URL, file=sys.stderr)
            sys.exit(1)
        csrf = info.get("csrf_token", "")

        # Step 2: Login phase 1 (credentials)
        resp = _curl_raw(jar, "POST", "/api/login", {"username": username, "password": password, "csrf_token": csrf})
        if not resp or not isinstance(resp, dict):
            print("Error: Login phase 1 failed", file=sys.stderr)
            sys.exit(1)
        if resp.get("error"):
            last_error = resp["error"]
            if last_error == "wrong_credentials":
                continue
            print(f"Error: {last_error}", file=sys.stderr)
            sys.exit(1)
        if resp.get("authenticated"):
            break

        # Step 3: Refresh CSRF for OTP
        info = _curl_raw(jar, "GET", "/api/csrf-token")
        csrf = info.get("csrf_token", "") if isinstance(info, dict) else ""

        # Step 4: Login phase 2 (OTP)
        resp = _curl_raw(jar, "POST", "/api/login", {
            "username": username, "password": password,
            "csrf_token": csrf, "otp_code": otp_code,
        })
        if isinstance(resp, dict) and resp.get("authenticated"):
            break
        last_error = resp.get("error", "unknown error") if isinstance(resp, dict) else "unknown error"
    else:
        print(f"Error: Login failed: {last_error}", file=sys.stderr)
        sys.exit(1)

    # Step 5: Get session CSRF for API calls
    info = _curl_raw(jar, "GET", "/api/csrf-token")
    csrf = info.get("csrf_token", "") if isinstance(info, dict) else ""

    _cached_session = (jar, csrf)
    return jar, csrf


def _api(method, path, data=None, params=None):
    """Make an authenticated API call and reject HTTP/API error payloads."""
    jar, csrf = _get_session()

    url = f"{BASE_URL}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    cmd = _curl_session_command(jar)
    cmd += ["-X", method]
    cmd += ["-H", f"X-CSRF-Token: {csrf}"]
    if data:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    cmd += ["--write-out", f"\n{HTTP_STATUS_MARKER}%{{http_code}}"]
    cmd.append(url)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        print(
            f"Error: API call timed out after {CURL_MAX_TIME_SECONDS}s: {method} {path}",
            file=sys.stderr,
        )
        sys.exit(1)
    if result.returncode != 0:
        print(f"Error: API call failed: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    response_output, status_separator, status_text = result.stdout.rpartition(
        f"\n{HTTP_STATUS_MARKER}"
    )
    if not status_separator or not re.fullmatch(r"\d{3}", status_text.strip()):
        print(
            f"Error: API call failed closed: {method} {path} returned no valid HTTP status",
            file=sys.stderr,
        )
        sys.exit(1)

    http_status = int(status_text.strip())
    headers, body = _split_curl_response(response_output)
    _emit_dev_warning(headers)

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        if not 200 <= http_status < 300:
            message = body.strip()[:200] or "empty response body"
            print(
                f"Error: API call failed: {method} {path} returned HTTP {http_status}: {message}",
                file=sys.stderr,
            )
            sys.exit(1)
        if body.strip():
            print(f"Error: Invalid JSON response: {body[:200]}", file=sys.stderr)
            sys.exit(1)
        payload = None

    payload_code = payload.get("code") if isinstance(payload, dict) else None
    payload_error = payload.get("error") if isinstance(payload, dict) else None
    payload_status = payload_code if isinstance(payload_code, int) else http_status
    if not 200 <= http_status < 300 or payload_error or payload_status >= 400:
        message = str(payload_error or "API error")
        print(
            f"Error: API call failed: {method} {path} returned HTTP {payload_status}: {message}",
            file=sys.stderr,
        )
        sys.exit(1)

    return payload


def _read_tasks(args, status=None, task_id=None, queue=None, groups=None):
    """Read tasks from either the HTTP API or the direct local DB fallback."""
    normalized_status = None
    if status:
        normalized_status = _validate_task_status(status, context="status filter")

    if getattr(args, "direct_db", False):
        print("Using direct DB fallback (--direct-db).", file=sys.stderr)
        return _direct_db_fetch_tasks(status=normalized_status, task_id=task_id, queue=queue, groups=groups)

    if task_id is not None and status is None:
        return _read_single_task_reconciled(task_id)

    params = {}
    if normalized_status:
        params["status"] = normalized_status
    if task_id is not None:
        params["id"] = str(task_id)
    normalized_queue = _normalize_queue_slug(queue)
    if normalized_queue not in QUEUE_CLEAR_ALIASES:
        params["queue"] = normalized_queue
    if groups:
        params["groups"] = groups
    payload = _api("GET", "/api/app/agent-tools/tasks", params=params)
    if isinstance(payload, list):
        return [_normalize_task_for_client(task) for task in payload]
    return _normalize_task_for_client(payload)


def _read_task_or_exit(task_id):
    """Fetch one task via the API and exit cleanly when it does not exist."""
    task = _read_tasks(argparse.Namespace(direct_db=False), task_id=task_id)
    if not task or not isinstance(task, dict) or not task.get("id"):
        print(f"Error: Task #{task_id} not found", file=sys.stderr)
        sys.exit(1)
    return task


def _read_task_runs(task_id=None, run_id=None, status=None):
    """Read task runs from the DB-native task-runs API."""
    params = {}
    if task_id is not None:
        params["task_id"] = str(task_id)
    if run_id is not None:
        params["run_id"] = str(run_id)
    if status:
        params["status"] = status
    payload = _api("GET", "/api/app/agent-tools/task-runs", params=params)
    if isinstance(payload, list):
        return payload
    return payload


def _filter_tasks(tasks, children_of=None, roots=False):
    """Apply parent/epic navigation filters client-side."""
    if children_of is not None:
        tasks = [task for task in tasks if task.get("parent_id") == children_of]
    if roots:
        tasks = [task for task in tasks if not task.get("parent_id")]
    return tasks


def _list_comments(task_id, page=1):
    """List comments for one db_task row through the existing generic comment endpoint."""
    _read_task_or_exit(task_id)
    payload = _api(
        "GET",
        "/api/comments",
        params={"dataset": COMMENT_DATASET, "row_id": str(task_id), "page": str(page)},
    )
    if not isinstance(payload, dict):
        print("Error: Unexpected response while fetching comments", file=sys.stderr)
        sys.exit(1)
    return payload


def _create_comment(task_id, comment_text):
    """Create one comment for a db_task row through the generic comment endpoint."""
    _read_task_or_exit(task_id)
    payload = _api(
        "POST",
        "/api/comments/create",
        data={"dataset": COMMENT_DATASET, "row_id": task_id, "comment_text": comment_text},
    )
    if not isinstance(payload, dict) or not payload.get("success"):
        print("Error: Failed to create comment", file=sys.stderr)
        sys.exit(1)
    return payload


def _delete_comment(comment_id):
    """Delete one comment through the generic comment endpoint."""
    payload = _api("DELETE", "/api/comments/delete", params={"id": str(comment_id)})
    if not isinstance(payload, dict) or not payload.get("success"):
        print(f"Error: Failed to delete comment #{comment_id}", file=sys.stderr)
        sys.exit(1)
    return payload


def _list_todos(task_id):
    """List structured todo rows for one DB-backed task."""
    _read_task_or_exit(task_id)
    payload = _api(
        "GET",
        "/api/app/agent-tools/task-todos",
        params={"task_id": str(task_id)},
    )
    if not isinstance(payload, list):
        print("Error: Unexpected response while fetching todos", file=sys.stderr)
        sys.exit(1)
    return payload


def _create_todo(task_id, todo_text, parent_todo_id=None, sort_order=None, *, verify_task=True):
    """Create one structured todo row through the agent-tools todo endpoint."""
    if verify_task:
        _read_task_or_exit(task_id)
    payload = {
        "task_id": task_id,
        "todo_text": todo_text,
    }
    if parent_todo_id is not None:
        payload["parent_todo_id"] = parent_todo_id
    if sort_order is not None:
        payload["sort_order"] = sort_order
    todo = _api("POST", "/api/app/agent-tools/task-todos", data=payload)
    if not isinstance(todo, dict) or not todo.get("id"):
        print("Error: Failed to create todo", file=sys.stderr)
        sys.exit(1)
    return todo


def _update_todo(todo_id, *, todo_text=None, status=None, sort_order=None):
    """Update one structured todo row through the agent-tools todo endpoint."""
    payload = {"id": todo_id}
    if todo_text is not None:
        payload["todo_text"] = todo_text
    if status is not None:
        payload["status"] = _validate_todo_status(status)
    if sort_order is not None:
        payload["sort_order"] = sort_order
    if len(payload) == 1:
        print("Error: todo update requires at least one field to change", file=sys.stderr)
        sys.exit(1)
    todo = _api("PATCH", "/api/app/agent-tools/task-todos", data=payload)
    if not isinstance(todo, dict) or not todo.get("id"):
        print(f"Error: Failed to update todo #{todo_id}", file=sys.stderr)
        sys.exit(1)
    return todo


def _delete_todo(todo_id):
    """Delete one structured todo row through the agent-tools todo endpoint."""
    payload = _api("DELETE", "/api/app/agent-tools/task-todos", params={"id": str(todo_id)})
    if not isinstance(payload, dict) or not payload.get("success"):
        print(f"Error: Failed to delete todo #{todo_id}", file=sys.stderr)
        sys.exit(1)
    return payload


def _todo_done_marker(todo):
    """Render one todo status as a terminal-friendly checkbox."""
    status = todo.get("status")
    if status == "done":
        return "[x]"
    if status == "partially_done":
        return "[~]"
    if status == "needs_review":
        return "[?]"
    if status == "not_applicable":
        return "[-]"
    return "[ ]"


def _format_todo_line(todo, *, indent=""):
    """Render one todo row with its stable DB id and completion state."""
    todo_id = todo.get("id", "?")
    text = (todo.get("todo_text") or "").strip()
    status = todo.get("status")
    status_label = ""
    if status not in (None, "", "todo", "done"):
        status_label = f" [{status}]"
    completed = ""
    if status == "done" and todo.get("completed_at"):
        completed = f" completed {str(todo['completed_at'])[:19]}"
    return f"{indent}{_todo_done_marker(todo)} #{todo_id} {text}{status_label}{completed}"


def _print_todo_tree(task_id, todos):
    """Print a two-level todo tree grouped by parent_todo_id."""
    print(f"Task #{task_id} todos ({len(todos)} total)")
    print("-" * 80)
    if not todos:
        print("No todos")
        return

    children_by_parent = {}
    parents = []
    for todo in todos:
        parent_id = todo.get("parent_todo_id")
        if parent_id:
            children_by_parent.setdefault(parent_id, []).append(todo)
        else:
            parents.append(todo)

    for parent in parents:
        print(_format_todo_line(parent))
        for child in children_by_parent.get(parent.get("id"), []):
            print(_format_todo_line(child, indent="  "))

    orphan_children = [
        child
        for parent_id, child_items in children_by_parent.items()
        if parent_id not in {parent.get("id") for parent in parents}
        for child in child_items
    ]
    for child in orphan_children:
        print(_format_todo_line(child))


def _read_todo_import_content(args):
    if args.stdin:
        return sys.stdin.read()
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            return f.read()
    print("Error: import-tree requires --file or --stdin", file=sys.stderr)
    sys.exit(1)


def _parse_todo_import_tree(content):
    """Parse a two-level markdown bullet tree into parent/child todo rows."""
    tree = []
    current_parent = None
    for line_number, raw_line in enumerate(content.splitlines(), start=1):
        if not raw_line.strip():
            continue
        bullet_match = re.match(r"^(\s*)[-*]\s+(.*\S)\s*$", raw_line)
        if not bullet_match:
            if raw_line.lstrip().startswith("#"):
                continue
            print(
                f"Error: import-tree line {line_number} is not a markdown bullet: {raw_line}",
                file=sys.stderr,
            )
            sys.exit(1)
        indent = bullet_match.group(1).replace("\t", "  ")
        text = bullet_match.group(2).strip()
        if not text:
            continue
        if len(text) > 5000:
            print(f"Error: import-tree line {line_number} exceeds 5000 characters", file=sys.stderr)
            sys.exit(1)
        if len(indent) == 0:
            current_parent = {"text": text, "children": []}
            tree.append(current_parent)
            continue
        if current_parent is None:
            print(
                f"Error: import-tree line {line_number} is indented before any parent item",
                file=sys.stderr,
            )
            sys.exit(1)
        current_parent["children"].append({"text": text})

    return tree


def slugify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')


def _dump_folder_name(task):
    """Build the canonical dump folder name for a task."""
    slug = slugify(task.get("title", "untitled"))[:60]
    task_id = task["id"]
    return f"{task_id:04d}-{slug}"


def _dump_task(task):
    """Write a single task to the dump directory as a markdown file."""
    os.makedirs(DUMP_DIR, exist_ok=True)

    task_id = task["id"]
    dump_folder = os.path.join(DUMP_DIR, _dump_folder_name(task))
    os.makedirs(dump_folder, exist_ok=True)

    dump_path = os.path.join(dump_folder, "ticket.md")

    tags_str = ", ".join(task.get("tags", []))
    parent_str = str(task["parent_id"]) if task.get("parent_id") else ""
    queue_slug = task.get("queue_slug") or ""
    queue_title = task.get("queue_title") or ""
    groups_str_dump = ", ".join(g["slug"] for g in task.get("groups", []))
    content = f"""<!-- Status: {task.get('status', 'unknown')} -->
<!-- id: {task_id} -->
<!-- issue_type: {task.get('issue_type', 'task')} -->
<!-- priority: {task.get('priority', 'normal')} -->
<!-- tags: {tags_str} -->
<!-- parent_id: {parent_str} -->
<!-- assigned_to: {task.get('assigned_to', '')} -->
<!-- queue_slug: {queue_slug} -->
<!-- queue_title: {queue_title} -->
<!-- groups: {groups_str_dump} -->
<!-- dumped_at: {datetime.datetime.now().isoformat()} -->
# {task.get('title', 'Untitled')}
Created: {task.get('created_at', '')[:10]}

**Type:** {task.get('issue_type', 'task')}
**Status:** {task.get('status', 'unknown')}
**Priority:** {task.get('priority', 'normal')}
**Queue:** {queue_title or queue_slug or '(none)'}

{task.get('content', '')}
"""
    with open(dump_path, "w", encoding="utf-8") as f:
        f.write(content)

    return dump_path


def _strip_db_task_dump_wrappers(content):
    """Strip db_task dump metadata wrappers so update --content-file writes real content."""
    stripped = 0
    while True:
        lines = content.splitlines(keepends=True)
        if len(lines) < 8 or not lines[0].startswith("<!-- Status:"):
            return content, stripped
        if not any(line.startswith("<!-- dumped_at:") for line in lines[:16]):
            return content, stripped
        queue_index = next((index for index, line in enumerate(lines[:32]) if line.startswith("**Queue:**")), None)
        if queue_index is None:
            return content, stripped
        start_index = queue_index + 1
        if start_index < len(lines) and lines[start_index].strip() == "":
            start_index += 1
        content = "".join(lines[start_index:])
        stripped += 1


def _read_content_file(path, *, keep_dump_wrapper=False):
    """Read a content file and prevent dump wrapper metadata from becoming task content."""
    with open(path, encoding="utf-8") as f:
        content = f.read()
    if keep_dump_wrapper:
        return content
    content, stripped = _strip_db_task_dump_wrappers(content)
    if stripped:
        plural = "wrapper" if stripped == 1 else "wrappers"
        print(
            f"Warning: stripped {stripped} db_task dump {plural} from --content-file; "
            "only canonical task content was sent to the API.",
            file=sys.stderr,
        )
    return content


def _existing_dump_folders():
    """List existing numeric task dump folders for duplicate/stale audits."""
    if not os.path.isdir(DUMP_DIR):
        return []
    folders = []
    for name in sorted(os.listdir(DUMP_DIR)):
        match = DUMP_FOLDER_RE.match(name)
        if not match:
            continue
        path = os.path.join(DUMP_DIR, name)
        if not os.path.isdir(path):
            continue
        folders.append({"task_id": int(match.group(1)), "name": name, "path": path})
    return folders


def _build_dump_stale_report(tasks, *, include_orphans=False):
    """Find stale same-ID dump folders without treating backups as task source of truth."""
    expected_by_id = {int(task["id"]): _dump_folder_name(task) for task in tasks if task.get("id") is not None}
    title_by_id = {int(task["id"]): task.get("title", "") for task in tasks if task.get("id") is not None}
    stale = []
    orphans = []
    for folder in _existing_dump_folders():
        task_id = folder["task_id"]
        expected_name = expected_by_id.get(task_id)
        if expected_name is None:
            if include_orphans:
                orphans.append(folder)
            continue
        if folder["name"] == expected_name:
            continue
        stale.append({
            "task_id": task_id,
            "title": title_by_id.get(task_id, ""),
            "name": folder["name"],
            "path": folder["path"],
            "expected_name": expected_name,
            "expected_path": os.path.join(DUMP_DIR, expected_name),
        })
    return {"stale": stale, "orphans": orphans}


def _print_dump_stale_report(report):
    """Print a concise stale dump report for operators before any optional prune."""
    stale = report.get("stale", [])
    orphans = report.get("orphans", [])
    if not stale and not orphans:
        print("No stale duplicate dump folders found.")
        return
    if stale:
        print(f"Stale duplicate dump folders ({len(stale)}):")
        for item in stale:
            rel_path = os.path.relpath(item["path"], PROJECT_ROOT)
            print(f"  #{item['task_id']}: {rel_path} (current: {item['expected_name']})")
    if orphans:
        print(f"Orphan-looking dump folders not matched by the dumped task set ({len(orphans)}):")
        for item in orphans[:20]:
            print(f"  {os.path.relpath(item['path'], PROJECT_ROOT)}")
        if len(orphans) > 20:
            print(f"  ... {len(orphans) - 20} more")


def _prune_stale_dump_folders(report):
    """Delete only stale same-ID dump folders after explicit operator confirmation."""
    removed = 0
    for item in report.get("stale", []):
        shutil.rmtree(item["path"])
        removed += 1
        print(f"Pruned stale dump folder: {os.path.relpath(item['path'], PROJECT_ROOT)}")
    print(f"Pruned {removed} stale duplicate dump folder(s).")


def _dump_all_tasks(tasks):
    """Dump all tasks to disk. Returns count of dumped tasks."""
    count = 0
    for task in tasks:
        _dump_task(task)
        count += 1
    return count


def cmd_list(args):
    """List tasks, by default only active ones."""
    tasks = _read_tasks(args, status=args.status, queue=args.queue, groups=getattr(args, "groups", None))
    if not tasks:
        tasks = []

    tasks = _filter_tasks(tasks, children_of=args.children_of, roots=args.roots)

    if not args.all and not args.status:
        tasks = [t for t in tasks if t.get("status") in ACTIVE_STATUSES]

    print(f"\n{'STATUS':<20} | {'ID':<5} | {'TYPE':<10} | {'PRI':<6} | {'QUEUE':<20} | {'GROUPS':<20} | {'TITLE'}")
    print("-" * 135)

    tasks.sort(key=lambda x: (x.get("status", ""), x.get("id", 0)))

    for t in tasks:
        title = (t.get("title") or f"task-{t.get('id', '?')}")[:40]
        pri = t.get("priority", "normal")[:6]
        issue_type = (t.get("issue_type") or "task")[:10]
        queue_label = (t.get("queue_title") or t.get("queue_slug") or "-")[:20]
        groups_label = ",".join(g["slug"] for g in t.get("groups", []))[:20] or "-"
        print(f"{t['status'].upper():<20} | {t['id']:<5} | {issue_type:<10} | {pri:<6} | {queue_label:<20} | {groups_label:<20} | {title}")

    print(f"\n{len(tasks)} task(s) shown")


def cmd_new(args):
    """Create a new task."""
    description = args.description
    date_str = datetime.date.today().isoformat()

    data = {
        "title": description,
        "issue_type": _normalize_issue_type(args.issue_type),
        "status": "new",
        "content": f"# {description}\nCreated: {date_str}\n\n{description}",
        "priority": args.priority or "normal",
    }

    if args.parent is not None:
        _read_task_or_exit(args.parent)
        data["parent_id"] = args.parent
    normalized_queue = _normalize_queue_slug(args.queue)
    if normalized_queue not in QUEUE_CLEAR_ALIASES:
        data["queue_slug"] = normalized_queue
    group_slugs = _parse_group_slug_csv(getattr(args, "groups", None))
    if group_slugs:
        data["group_slugs"] = group_slugs

    task = _api("POST", "/api/app/agent-tools/tasks", data=data)
    if task and isinstance(task, dict) and task.get("id"):
        print(f"Created task #{task['id']}: {description}")
        dump_path = _dump_task(task)
        print(f"  Dumped to: {os.path.relpath(dump_path, PROJECT_ROOT)}")
    else:
        print("Error: Failed to create task", file=sys.stderr)
        sys.exit(1)


def cmd_show(args):
    """Show a single task by ID."""
    task = _read_tasks(args, task_id=args.id)
    if not task or not isinstance(task, dict) or not task.get("id"):
        print(f"Error: Task #{args.id} not found", file=sys.stderr)
        sys.exit(1)

    tags = ", ".join(task.get("tags", [])) or "(none)"
    parent = task.get("parent_id") or "(none)"
    related_tasks = _read_tasks(argparse.Namespace(direct_db=args.direct_db), status=None)
    parent_task = None
    children = []
    if isinstance(related_tasks, list):
        if task.get("parent_id"):
            parent_task = next((item for item in related_tasks if item.get("id") == task.get("parent_id")), None)
        children = [item for item in related_tasks if item.get("parent_id") == task["id"]]

    print(f"Task #{task['id']}: {task['title']}")
    print(f"  Type:       {task.get('issue_type') or 'task'}")
    print(f"  Status:     {task['status']}")
    print(f"  Priority:   {task.get('priority', 'normal')}")
    print(f"  Tags:       {tags}")
    print(f"  Queue:      {task.get('queue_title') or task.get('queue_slug') or '(none)'}")
    groups = task.get("groups", [])
    groups_str = ", ".join(g["slug"] for g in groups) if groups else "(none)"
    print(f"  Groups:     {groups_str}")
    print(f"  Parent:     {parent}")
    if parent_task:
        print(f"  ParentTask: #{parent_task['id']} {parent_task.get('title', '')[:60]}")
    print(f"  Assigned:   {task.get('assigned_to') or '(none)'}")
    print(f"  Created:    {task.get('created_at', '')[:19]}")
    print(f"  Updated:    {task.get('updated_at', '')[:19]}")
    print(f"  Children:   {len(children)}")
    if children:
        print("\n--- Children ---")
        for child in children[:10]:
            print(f"#{child['id']} | {child.get('status', '')} | {child.get('title', '')[:70]}")
    if task.get("content"):
        print(f"\n--- Content ---\n{task['content']}")


def cmd_move(args):
    """Move a task to a new status."""
    status = STATUS_ALIASES.get(args.status, args.status)
    status = _validate_task_status(status, context="status")
    data = {"id": args.id, "status": status}
    task = _api("PATCH", "/api/app/agent-tools/tasks", data=data)
    if task and isinstance(task, dict):
        print(f"Task #{args.id} → {_normalize_status_for_client(status)}")
        # Fetch full task for dump
        full_task = _api("GET", "/api/app/agent-tools/tasks", params={"id": str(args.id)})
        if full_task and isinstance(full_task, dict):
            _dump_task(full_task)
    else:
        print(f"Error: Failed to move task #{args.id}", file=sys.stderr)
        sys.exit(1)


def _load_update_content(args):
    if args.content is not None:
        return args.content
    if args.content_file is None:
        return None
    return _read_content_file(
        args.content_file,
        keep_dump_wrapper=getattr(args, "keep_dump_wrapper_content", False),
    )


def _verify_task_fields(task, expected):
    mismatches = []
    for field, expected_value in expected.items():
        if field == "groups":
            actual_value = sorted(_task_group_slug_list(task))
            expected_value = sorted(_normalize_group_slug_list(expected_value))
        else:
            actual_value = task.get(field)
        if actual_value != expected_value:
            mismatches.append((field, expected_value, actual_value))
    return mismatches


def cmd_update(args):
    """Update task fields through the API and verify the stored result."""
    payload = {"id": args.id}

    if args.status is not None:
        payload["status"] = _validate_task_status(
            STATUS_ALIASES.get(args.status, args.status),
            context="status",
        )
    if args.title is not None:
        payload["title"] = args.title
    if args.priority is not None:
        payload["priority"] = args.priority
    if args.assigned_to is not None:
        payload["assigned_to"] = args.assigned_to
    if args.queue is not None:
        payload["queue_slug"] = _normalize_queue_slug(args.queue)
    parent_value = getattr(args, "parent", None)
    if parent_value is not None:
        has_parent, parent_id = _normalize_parent_id(parent_value)
        if has_parent:
            payload["parent_id"] = parent_id
    if getattr(args, "groups", None) is not None:
        payload["group_slugs"] = _parse_group_slug_csv(args.groups)

    content = _load_update_content(args)
    if content is not None:
        payload["content"] = content

    if len(payload) == 1:
        print("Error: update requires at least one field to change", file=sys.stderr)
        sys.exit(1)

    task = _api("PATCH", "/api/app/agent-tools/tasks", data=payload)
    if not task or not isinstance(task, dict):
        print(f"Error: Failed to update task #{args.id}", file=sys.stderr)
        sys.exit(1)

    full_task = _read_single_task_reconciled(args.id)
    if not full_task or not isinstance(full_task, dict):
        print(f"Error: Task #{args.id} updated but verification read failed", file=sys.stderr)
        sys.exit(1)

    expected = {}
    for field in ("title", "content", "priority", "assigned_to"):
        if field in payload:
            expected[field] = payload[field]
    if "status" in payload:
        expected["status"] = _normalize_status_for_client(payload["status"])
    if "queue_slug" in payload:
        normalized_queue = _normalize_queue_slug(payload["queue_slug"])
        expected["queue_slug"] = None if normalized_queue in QUEUE_CLEAR_ALIASES else normalized_queue
    if "parent_id" in payload:
        expected["parent_id"] = payload["parent_id"]
    if "group_slugs" in payload:
        expected["groups"] = payload["group_slugs"]

    mismatches = _verify_task_fields(full_task, expected)
    if mismatches:
        print(f"Error: Verification failed for task #{args.id}", file=sys.stderr)
        for field, expected_value, actual_value in mismatches:
            print(
                f"  {field}: expected {expected_value!r}, got {actual_value!r}",
                file=sys.stderr,
            )
        sys.exit(1)

    dump_path = _dump_task(full_task)
    print(f"Task #{args.id} updated and verified")
    print(f"  Title:    {full_task.get('title', '')}")
    print(f"  Status:   {full_task.get('status', '')}")
    print(f"  Queue:    {full_task.get('queue_title') or full_task.get('queue_slug') or '(none)'}")
    print(f"  Groups:   {', '.join(_task_group_slug_list(full_task)) or '(none)'}")
    print(f"  Dumped to: {os.path.relpath(dump_path, PROJECT_ROOT)}")


def cmd_restore(args):
    """Backward-compatible alias for cmd_update."""
    cmd_update(args)


def cmd_continue(args):
    """Continue a parent ticket queue by delegating the next item(s) to worker_agent."""
    if args.count < 1:
        print("Error: --count must be at least 1", file=sys.stderr)
        sys.exit(1)

    worker_agent = WORKER_AGENT_COMMAND
    processed = 0

    for batch_index in range(1, args.count + 1):
        parent_task = _read_single_task_reconciled(args.id)
        if not parent_task or not isinstance(parent_task, dict):
            print(f"Error: Parent task #{args.id} not found", file=sys.stderr)
            sys.exit(1)

        queue_items = _parse_active_queue_items(parent_task.get("content") or "")
        if not queue_items:
            if processed == 0:
                print(f"Task #{args.id} has no active queue items.")
            else:
                print(f"Task #{args.id} queue is now empty after {processed} item(s).")
            return

        queue_item = queue_items[0]
        run_task_id = _continue_run_task_id(args.id, queue_item)
        prompt_path = _write_continue_prompt(
            _build_continue_prompt(parent_task, queue_item, batch_index, args.count)
        )

        try:
            launch_cmd = [worker_agent, "--task-id", run_task_id, "--background"]
            if args.family:
                launch_cmd.append(f"family={args.family}")
            if args.research:
                launch_cmd.append("--research")
            if not args.full_access:
                launch_cmd.append("--no-full-access")
            launch_cmd += ["--prompt-file", prompt_path]

            wait_cmd = [worker_agent, "--wait", run_task_id]
            if args.dry_run:
                print(f"[dry-run] would launch: {' '.join(launch_cmd)}")
                print(f"[dry-run] would wait with: {' '.join(wait_cmd)}")
                return

            launch_result = subprocess.run(
                launch_cmd,
                cwd=PROJECT_ROOT,
                text=True,
            )
            if launch_result.returncode != 0:
                print(
                    f"Error: Failed to launch worker for queue item {queue_item['key']}",
                    file=sys.stderr,
                )
                sys.exit(1)

            wait_result = subprocess.run(
                wait_cmd,
                cwd=PROJECT_ROOT,
                text=True,
            )
            if wait_result.returncode != 0:
                print(
                    f"Error: Worker failed for queue item {queue_item['key']}",
                    file=sys.stderr,
                )
                subprocess.run(
                    [worker_agent, "--status", run_task_id],
                    cwd=PROJECT_ROOT,
                    text=True,
                )
                sys.exit(1)

            refreshed_task = _read_single_task_reconciled(args.id)
            refreshed_queue = _parse_active_queue_items((refreshed_task or {}).get("content") or "")
            refreshed_keys = {item["key"] for item in refreshed_queue}
            if queue_item["key"] in refreshed_keys:
                print(
                    "Error: Parent ticket queue did not advance after worker completed "
                    f"queue item {queue_item['key']}.",
                    file=sys.stderr,
                )
                sys.exit(1)

            processed += 1
            print(
                f"Queue item {queue_item['key']} completed for parent task #{args.id} "
                f"({processed}/{args.count})."
            )
        finally:
            try:
                os.remove(prompt_path)
            except FileNotFoundError:
                pass


def cmd_start(args):
    args.status = "in_progress"
    cmd_move(args)


def cmd_hold(args):
    args.status = "on_hold"
    cmd_move(args)


def cmd_close(args):
    args.status = "done"
    cmd_move(args)


def cmd_dump(args):
    """Dump tasks to disk backup."""
    if args.prune_stale and not args.yes:
        print("Error: --prune-stale requires --yes", file=sys.stderr)
        sys.exit(1)
    dumped_tasks = []
    if args.id:
        task = _read_tasks(args, task_id=args.id)
        if task and isinstance(task, dict) and task.get("id"):
            path = _dump_task(task)
            dumped_tasks = [task]
            print(f"Dumped task #{args.id} → {os.path.relpath(path, PROJECT_ROOT)}")
        else:
            print(f"Error: Task #{args.id} not found", file=sys.stderr)
            sys.exit(1)
    else:
        tasks = _read_tasks(args)
        if not tasks:
            print("No tasks to dump")
            return
        dumped_tasks = tasks
        count = _dump_all_tasks(tasks)
        print(f"Dumped {count} task(s) to {os.path.relpath(DUMP_DIR, PROJECT_ROOT)}/")
    if args.audit_stale or args.prune_stale:
        report = _build_dump_stale_report(dumped_tasks, include_orphans=not bool(args.id))
        _print_dump_stale_report(report)
        if args.prune_stale:
            _prune_stale_dump_folders(report)


def cmd_comments_list(args):
    """List comments for one task."""
    payload = _list_comments(args.task_id, page=args.page)
    comments = payload.get("comments", [])
    total = payload.get("total", 0)

    print(f"Task #{args.task_id} comments ({total} total)")
    print("-" * 80)

    if not comments:
        print("No comments")
        return

    for comment in comments:
        comment_id = comment.get("id", "?")
        username = comment.get("username") or "unknown"
        created = comment.get("created", "")[:19]
        text = (comment.get("comment_text") or "").replace("\n", " ").strip()
        print(f"#{comment_id} | {username} | {created}")
        print(text)
        print("-" * 80)


def cmd_comments_add(args):
    """Add one comment to a task."""
    payload = _create_comment(args.task_id, args.comment_text)
    print(f"Added comment #{payload['id']} to task #{args.task_id}")


def cmd_comments_delete(args):
    """Delete one comment by comment ID."""
    _delete_comment(args.comment_id)
    print(f"Deleted comment #{args.comment_id}")


def cmd_todos_list(args):
    """List structured todo rows for one task."""
    todos = _list_todos(args.task_id)
    _print_todo_tree(args.task_id, todos)


def cmd_todos_add(args):
    """Add one structured todo row to a task."""
    todo = _create_todo(
        args.task_id,
        args.todo_text,
        parent_todo_id=args.parent,
        sort_order=args.sort_order,
    )
    parent_suffix = f" under #{args.parent}" if args.parent else ""
    print(f"Added todo #{todo['id']} to task #{args.task_id}{parent_suffix}")


def cmd_todos_done(args):
    """Mark one todo row done without changing the parent task status."""
    todo = _update_todo(args.todo_id, status="done")
    print(f"Todo #{todo['id']} marked done")


def cmd_todos_reopen(args):
    """Reopen one todo row without changing the parent task status."""
    todo = _update_todo(args.todo_id, status="todo")
    print(f"Todo #{todo['id']} reopened")


def cmd_todos_update(args):
    """Update one structured todo row."""
    todo = _update_todo(
        args.todo_id,
        todo_text=args.text,
        status=args.status,
        sort_order=args.sort_order,
    )
    print(f"Todo #{todo['id']} updated")


def cmd_todos_delete(args):
    """Delete one structured todo row."""
    _delete_todo(args.todo_id)
    print(f"Deleted todo #{args.todo_id}")


def cmd_todos_import_tree(args):
    """Import a two-level markdown bullet tree as structured task todos."""
    _read_task_or_exit(args.task_id)
    content = _read_todo_import_content(args)
    tree = _parse_todo_import_tree(content)
    if not tree:
        print("No todo bullets found.")
        return

    if args.dry_run:
        print(f"[dry-run] would create {sum(1 + len(item['children']) for item in tree)} todo(s)")
        for parent in tree:
            print(f"- {parent['text']}")
            for child in parent["children"]:
                print(f"  - {child['text']}")
        return

    created_count = 0
    for parent_index, parent in enumerate(tree, start=1):
        parent_todo = _create_todo(
            args.task_id,
            parent["text"],
            sort_order=parent_index * 10,
            verify_task=False,
        )
        created_count += 1
        for child_index, child in enumerate(parent["children"], start=1):
            _create_todo(
                args.task_id,
                child["text"],
                parent_todo_id=parent_todo["id"],
                sort_order=child_index * 10,
                verify_task=False,
            )
            created_count += 1

    print(f"Imported {created_count} todo(s) to task #{args.task_id}")


def cmd_runs_list(args):
    """List execution runs for one task."""
    _read_task_or_exit(args.task_id)
    runs = _read_task_runs(task_id=args.task_id, status=args.status)
    if not runs:
        runs = []

    print(f"Task #{args.task_id} runs")
    print(f"\n{'RUN ID':<36} | {'STATUS':<24} | {'BACKEND':<8} | {'STARTED'}")
    print("-" * 100)
    for run in runs:
        status = (run.get("status") or "unknown")[:24]
        backend = (run.get("worker_backend") or "-")[:8]
        started = (run.get("started_at") or "")[:19]
        print(f"{run.get('run_id', '')[:36]:<36} | {status:<24} | {backend:<8} | {started}")

    print(f"\n{len(runs)} run(s) shown")


def cmd_runs_show(args):
    """Show one execution run by run ID."""
    run = _read_task_runs(run_id=args.run_id)
    if not run or not isinstance(run, dict) or not run.get("run_id"):
        print(f"Error: Run '{args.run_id}' not found", file=sys.stderr)
        sys.exit(1)

    print(f"Run:        {run.get('run_id')}")
    print(f"  Task ID:      {run.get('task_id')}")
    print(f"  Status:       {run.get('status')}")
    print(f"  Triggered by: {run.get('triggered_by')}")
    print(f"  Backend:      {run.get('worker_backend') or '(none)'}")
    print(f"  Started:      {(run.get('started_at') or '')[:19]}")
    print(f"  Finished:     {(run.get('finished_at') or '')[:19] or '(not finished)'}")
    print(f"  Reviewed:     {(run.get('reviewed_at') or '')[:19] or '(not reviewed)'}")
    print(f"  Exit code:    {run.get('exit_code') if run.get('exit_code') is not None else '(none)'}")
    print(f"  Progress:     {run.get('progress_relpath') or '(none)'}")
    print(f"  Summary:      {run.get('summary_relpath') or '(none)'}")
    print(f"  Log:          {run.get('log_relpath') or '(none)'}")
    print(f"  Prompt:       {run.get('prompt_relpath') or '(none)'}")
    print(f"  Run status:   {run.get('run_status_relpath') or '(none)'}")
    print(f"  Notes:        {run.get('review_notes') or '(none)'}")


def cmd_groups_list(args):
    """List all available task groups."""
    groups = _api("GET", "/api/app/agent-tools/task-groups")
    if not isinstance(groups, list):
        print("Error: Failed to fetch groups", file=sys.stderr)
        sys.exit(1)

    print(f"\n{'ID':<5} | {'SLUG':<20} | {'SORT':<5} | {'TITLE':<20} | {'DESCRIPTION'}")
    print("-" * 90)

    for g in groups:
        desc = (g.get("description") or "")[:30]
        print(f"{g['id']:<5} | {g['slug']:<20} | {g.get('sort_order', 0):<5} | {g['title']:<20} | {desc}")

    print(f"\n{len(groups)} group(s)")


def main():
    parser = argparse.ArgumentParser(
        description="db_task: Database-backed ticket manager for Easelect",
        epilog="Source of truth: dev_agent_tasks table. Dumps to agent_tasks/_db_dump/ for backup.",
    )
    subparsers = parser.add_subparsers(dest="command")

    # list
    list_p = subparsers.add_parser("list", help="List tasks (active by default)")
    list_p.add_argument("--status", help="Filter by status")
    list_p.add_argument("--queue", help="Filter by queue slug (for example: security, tukisuu)")
    list_p.add_argument("--groups", help="Filter by group slugs, comma-separated (for example: frontend,backend)")
    list_p.add_argument("--all", action="store_true", help="Show all tasks including done/archived")
    list_p.add_argument("--direct-db", action="store_true", help=f"Read directly from local DB via {DATABASE_DISPLAY_COMMAND} (read-only fallback mode)")
    list_group = list_p.add_mutually_exclusive_group()
    list_group.add_argument("--children-of", type=int, help="List direct children of one parent task")
    list_group.add_argument("--roots", action="store_true", help="List only root tasks with no parent")

    # new
    new_p = subparsers.add_parser("new", help="Create a new task")
    new_p.add_argument("description", help="Task description / title")
    new_p.add_argument("--issue-type", choices=["task", "incident", "bug", "epic"], default="task")
    new_p.add_argument("--priority", choices=["low", "normal", "high", "critical"], default="normal")
    new_p.add_argument("--parent", type=int, help="Parent task ID for epic/subtask linking")
    new_p.add_argument("--queue", help="Assign queue slug on create")
    new_p.add_argument("--groups", help="Assign group slugs on create, comma-separated (e.g. frontend,backend)")

    # show
    show_p = subparsers.add_parser("show", help="Show task details")
    show_p.add_argument("id", type=int, help="Task ID")
    show_p.add_argument("--direct-db", action="store_true", help=f"Read directly from local DB via {DATABASE_DISPLAY_COMMAND} (read-only fallback mode)")

    # move
    move_p = subparsers.add_parser("move", help="Change task status")
    move_p.add_argument("id", type=int, help="Task ID")
    move_p.add_argument("status", help="New status (or alias: start, hold, close, reject, archive, delete)")

    def add_update_arguments(target_parser, *, verb):
        target_parser.add_argument("id", type=int, help="Task ID")
        target_parser.add_argument("--title", help=f"{verb} task title")
        target_parser.add_argument("--status", help=f"{verb} task status")
        target_parser.add_argument(
            "--priority",
            choices=["low", "normal", "high", "critical"],
            help=f"{verb} task priority",
        )
        target_parser.add_argument("--assigned-to", dest="assigned_to", help=f"{verb} assigned_to")
        target_parser.add_argument("--queue", help=f"{verb} queue slug, or use 'none' to clear the queue")
        target_parser.add_argument("--parent", help=f"{verb} parent task ID, or use 'none' to clear the parent")
        target_parser.add_argument("--groups", help=f"{verb} group slugs, comma-separated (e.g. frontend,backend)")
        update_content = target_parser.add_mutually_exclusive_group()
        update_content.add_argument("--content", help=f"{verb} content inline")
        update_content.add_argument("--content-file", help=f"{verb} content from a file")
        target_parser.add_argument(
            "--keep-dump-wrapper-content",
            action="store_true",
            help="Do not strip db_task dump metadata when --content-file points at a dumped ticket.md",
        )

    # update
    update_p = subparsers.add_parser(
        "update",
        help="Update task fields through the API and verify them",
        description=(
            "Update task fields such as title, content, queue, parent, or other metadata. "
            "Use start/hold/close or move for normal workflow status transitions."
        ),
    )
    add_update_arguments(update_p, verb="Update")

    # restore (legacy alias kept for compatibility)
    restore_p = subparsers.add_parser(
        "restore",
        help="Legacy alias for 'update'",
        description=(
            "Legacy alias for 'update'. Prefer './db_task update ...' for field edits. "
            "Use start/hold/close or move for normal workflow status transitions."
        ),
    )
    add_update_arguments(restore_p, verb="Restore")

    continue_p = subparsers.add_parser(
        "continue",
        help="Continue a parent ticket queue by delegating the next item(s) to worker_agent",
    )
    continue_p.add_argument("id", type=int, help="Parent task ID")
    continue_p.add_argument("--count", type=int, default=1, help="How many queue items to process serially")
    continue_p.add_argument(
        "--family",
        choices=["auto", "claude", "codex"],
        help="Worker backend family override (default: worker_agent default)",
    )
    continue_p.add_argument("--research", action="store_true", help="Launch worker in read-only research mode")
    continue_p.add_argument(
        "--no-full-access",
        dest="full_access",
        action="store_false",
        help="Restrict Codex worker sandbox instead of using the default full-access mode",
    )
    continue_p.set_defaults(full_access=True)
    continue_p.add_argument("--dry-run", action="store_true", help="Print worker commands instead of running them")

    # Shortcut commands
    for shortcut in ["start", "hold", "close"]:
        p = subparsers.add_parser(shortcut, help=f"Move task to {STATUS_ALIASES[shortcut]}")
        p.add_argument("id", type=int, help="Task ID")

    # dump
    dump_p = subparsers.add_parser("dump", help="Dump tasks to disk backup")
    dump_p.add_argument("id", type=int, nargs="?", help="Task ID (omit for all)")
    dump_p.add_argument("--direct-db", action="store_true", help=f"Read directly from local DB via {DATABASE_DISPLAY_COMMAND} (read-only fallback mode)")
    dump_p.add_argument("--audit-stale", action="store_true", help="Report stale same-ID dump folders without deleting them")
    dump_p.add_argument("--prune-stale", action="store_true", help="Delete stale same-ID dump folders after dumping; requires --yes")
    dump_p.add_argument("--yes", action="store_true", help="Confirm --prune-stale deletion")

    # comments
    comments_p = subparsers.add_parser("comments", help="Manage task comments via system_comments")
    comments_sub = comments_p.add_subparsers(dest="comments_command")

    comments_list_p = comments_sub.add_parser("list", help="List comments for a task")
    comments_list_p.add_argument("task_id", type=int, help="Task ID")
    comments_list_p.add_argument("--page", type=int, default=1, help="Comment page number (default: 1)")

    comments_add_p = comments_sub.add_parser("add", help="Add a comment to a task")
    comments_add_p.add_argument("task_id", type=int, help="Task ID")
    comments_add_p.add_argument("comment_text", help="Comment text")

    comments_delete_p = comments_sub.add_parser("delete", help="Delete a comment by comment ID")
    comments_delete_p.add_argument("comment_id", type=int, help="Comment ID")

    # todos
    todos_p = subparsers.add_parser("todos", help="Manage structured task todos")
    todos_sub = todos_p.add_subparsers(dest="todos_command")

    todos_list_p = todos_sub.add_parser("list", help="List todos for a task")
    todos_list_p.add_argument("task_id", type=int, help="Task ID")

    todos_add_p = todos_sub.add_parser("add", help="Add a todo to a task")
    todos_add_p.add_argument("task_id", type=int, help="Task ID")
    todos_add_p.add_argument("todo_text", help="Todo text")
    todos_add_p.add_argument("--parent", type=int, help="Parent todo ID for a second-level item")
    todos_add_p.add_argument("--sort-order", type=int, help="Explicit sort order")

    todos_done_p = todos_sub.add_parser("done", help="Mark a todo done")
    todos_done_p.add_argument("todo_id", type=int, help="Todo ID")

    todos_reopen_p = todos_sub.add_parser("reopen", help="Reopen a done todo")
    todos_reopen_p.add_argument("todo_id", type=int, help="Todo ID")

    todos_update_p = todos_sub.add_parser("update", help="Update todo fields")
    todos_update_p.add_argument("todo_id", type=int, help="Todo ID")
    todos_update_p.add_argument("--text", help="Replacement todo text")
    todos_update_p.add_argument("--status", choices=sorted(TODO_STATUS_VALUES), help="Replacement todo status")
    todos_update_p.add_argument("--sort-order", type=int, help="Replacement sort order")

    todos_delete_p = todos_sub.add_parser("delete", help="Delete a todo by ID")
    todos_delete_p.add_argument("todo_id", type=int, help="Todo ID")

    todos_import_p = todos_sub.add_parser("import-tree", help="Import a two-level markdown bullet tree")
    todos_import_p.add_argument("task_id", type=int, help="Task ID")
    import_source = todos_import_p.add_mutually_exclusive_group(required=True)
    import_source.add_argument("--file", help="Markdown bullet tree file")
    import_source.add_argument("--stdin", action="store_true", help="Read markdown bullet tree from stdin")
    todos_import_p.add_argument("--dry-run", action="store_true", help="Print parsed todos without creating rows")

    # runs
    runs_p = subparsers.add_parser("runs", help="Inspect DB-native worker/queen runs for tasks")
    runs_sub = runs_p.add_subparsers(dest="runs_command")

    runs_list_p = runs_sub.add_parser("list", help="List runs for one task")
    runs_list_p.add_argument("task_id", type=int, help="Task ID")
    runs_list_p.add_argument("--status", help="Filter runs by status")

    runs_show_p = runs_sub.add_parser("show", help="Show one run by run_id")
    runs_show_p.add_argument("run_id", help="Run ID")

    # groups
    groups_p = subparsers.add_parser("groups", help="Manage task groups")
    groups_sub = groups_p.add_subparsers(dest="groups_command")

    groups_sub.add_parser("list", help="List all available task groups")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    cmd_map = {
        "list": cmd_list,
        "new": cmd_new,
        "show": cmd_show,
        "move": cmd_move,
        "update": cmd_update,
        "restore": cmd_restore,
        "continue": cmd_continue,
        "start": cmd_start,
        "hold": cmd_hold,
        "close": cmd_close,
        "dump": cmd_dump,
        "comments": {
            "list": cmd_comments_list,
            "add": cmd_comments_add,
            "delete": cmd_comments_delete,
        },
        "todos": {
            "list": cmd_todos_list,
            "add": cmd_todos_add,
            "done": cmd_todos_done,
            "reopen": cmd_todos_reopen,
            "update": cmd_todos_update,
            "delete": cmd_todos_delete,
            "import-tree": cmd_todos_import_tree,
        },
        "runs": {
            "list": cmd_runs_list,
            "show": cmd_runs_show,
        },
        "groups": {
            "list": cmd_groups_list,
        },
    }

    if args.command == "comments":
        handler = cmd_map["comments"].get(getattr(args, "comments_command", None))
        if not handler:
            comments_p.print_help()
            sys.exit(1)
        handler(args)
    elif args.command == "todos":
        handler = cmd_map["todos"].get(getattr(args, "todos_command", None))
        if not handler:
            todos_p.print_help()
            sys.exit(1)
        handler(args)
    elif args.command == "runs":
        handler = cmd_map["runs"].get(getattr(args, "runs_command", None))
        if not handler:
            runs_p.print_help()
            sys.exit(1)
        handler(args)
    elif args.command == "groups":
        handler = cmd_map["groups"].get(getattr(args, "groups_command", None))
        if not handler:
            groups_p.print_help()
            sys.exit(1)
        handler(args)
    else:
        handler = cmd_map.get(args.command)
        if handler:
            handler(args)
        else:
            parser.print_help()
            sys.exit(1)


if __name__ == "__main__":
    main()
