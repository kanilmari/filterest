#!/usr/bin/env python3
# db_report.py
# Manages stable development worklines and retrospective reports through the private app API.
# Bridges shell workflows, shared authenticated API access, and canonical DB-backed history.
# Exists so agents can preserve and retrieve concise prior-work context without direct SQL or raw chats.

from __future__ import annotations

import argparse
import getpass
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath

_CANONICAL_FILTEREST_ROOT = Path(__file__).resolve().parents[2]
if not __package__ and str(_CANONICAL_FILTEREST_ROOT) not in sys.path:
    sys.path.insert(0, str(_CANONICAL_FILTEREST_ROOT))

try:
    from ..lib.easelect_private_paths import resolve_embedded_project_root
    from .easelect_api_client import (
        DEFAULT_BASE_URL,
        EaselectAPIClient,
        EaselectAPIError,
        resolve_api_base_url,
    )
    from .dev_agent_credentials import configure_agent_credentials
except ImportError:
    from server_tools.lib.easelect_private_paths import resolve_embedded_project_root
    from server_tools.agent_tools.easelect_api_client import (
        DEFAULT_BASE_URL,
        EaselectAPIClient,
        EaselectAPIError,
        resolve_api_base_url,
    )
    from server_tools.agent_tools.dev_agent_credentials import configure_agent_credentials


_REPOSITORY_ROOT = resolve_embedded_project_root(_CANONICAL_FILTEREST_ROOT)


WORKLINES_PATH = "/api/app/agent-tools/worklines"
REPORTS_PATH = "/api/app/agent-tools/workline-reports"
LINKS_PATH = "/api/app/agent-tools/workline-tasks"
HANDOVERS_PATH = "/api/app/agent-tools/handover-reports"
OBSERVATORY_BOARD_PATH = "/api/app/workline-observatory/board"


def read_text_file(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def read_metadata_file(path: str | None) -> dict:
    if not path:
        return {}
    value = json.loads(read_text_file(path))
    if not isinstance(value, dict):
        raise ValueError("metadata file must contain a JSON object")
    return value


def print_json(value) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def print_workline(workline: dict, *, include_details: bool = True) -> None:
    tags = ", ".join(workline.get("tags") or []) or "-"
    tasks = ", ".join(str(value) for value in workline.get("task_ids") or []) or "-"
    print(f"#{workline['id']} [{workline['status']}] {workline['title']}")
    print(f"  reports: {workline.get('report_count', 0)} | tasks: {tasks} | tags: {tags}")
    if include_details:
        print(f"  created: {workline.get('created_at', '-')} | updated: {workline.get('updated_at', '-')}")
        if workline.get("latest_report_at"):
            print(f"  latest report: {workline['latest_report_at']}")


def print_observatory_workline(workline: dict) -> None:
    tasks = ", ".join(str(value) for value in workline.get("task_ids") or []) or "-"
    latest_report = workline.get("latest_report") or {}
    report_id = latest_report.get("id") or "-"
    print(
        f"#{workline['id']} [{workline['status']}] phase {workline.get('current_phase', 0)} "
        f"{workline['title']}"
    )
    print(f"  latest report: {report_id} | tasks: {tasks}")
    change = workline.get("latest_status_change") or {}
    actor = change.get("changed_by_username") or "unknown user"
    source = change.get("source") or "unknown source"
    changed_at = change.get("changed_at") or "-"
    print(
        f"  lifecycle revision: {workline.get('status_revision', 0)} | "
        f"last decision: {actor} via {source} at {changed_at}"
    )
    if workline.get("status_reconciliation_needed"):
        print("  ATTENTION: lifecycle state changed after the latest canonical report")


def print_report(report: dict, *, include_content: bool = True) -> None:
    print(
        f"#{report['id']} workline #{report['workline_id']} "
        f"[{report['state']}/{report['outcome']}] {report['title']}"
    )
    print(
        f"  type: {report['report_type']} | source: {report['source_kind']} "
        f"| created: {report.get('created_at', '-')}"
    )
    if report.get("supersedes_report_id"):
        print(f"  supersedes: #{report['supersedes_report_id']}")
    if report.get("source_ref"):
        print(f"  source ref: {report['source_ref']}")
    tags = ", ".join(report.get("tags") or [])
    if tags:
        print(f"  tags: {tags}")
    if report.get("redaction_reason"):
        print(f"  redaction reason: {report['redaction_reason']}")
    if report.get("phase_gate"):
        changed = report.get("changed_this_turn")
        print(
            f"  snapshot: phase {report.get('current_phase', '-')} "
            f"(gate {report['phase_gate']}) | "
            f"workline {report.get('workline_status_snapshot', '-')} | changed: {changed}"
        )
        own_paths = report.get("git_workline_changed_paths") or []
        other = report.get("git_has_other_changes")
        print(
            f"  git: {report.get('git_worktree_state', '-')} at "
            f"{report.get('git_head_commit', '-')} | own paths: {len(own_paths)} | other changes: {other}"
        )
    if include_content:
        print()
        print(report.get("content", ""))


def request(client, method: str, path: str, *, data=None, query=None):
    return client.request(
        method,
        path,
        data=data,
        query=query,
        csrf=method.upper() in {"POST", "PUT", "PATCH", "DELETE"},
    )


def make_client(args, client_factory=EaselectAPIClient):
    if not args.prompt_credentials:
        return client_factory(base_url=args.base_url)

    username = str(args.credential_username or "").strip()
    if not username:
        raise ValueError("--credential-username is required with --prompt-credentials")
    target = str(args.base_url or resolve_api_base_url()).rstrip("/")
    print("Authentication context:")
    print(f"  Service: Filterest workline-report API at {target}")
    print(f"  Existing account authorizing access: {username}")
    print("  Target: canonical development worklines and retrospective reports")
    print("  A password prompt follows; a PIN or verification-code prompt may follow.")
    password = getpass.getpass(f"Password for existing account '{username}': ")

    def verification_code_provider(response):
        method = str(response.get("verification_method") or "").strip()
        prompts = {
            "fixed_pin": f"Fixed PIN for existing account '{username}': ",
            "totp": f"Authenticator code for existing account '{username}': ",
            "email": f"Email verification code for existing account '{username}': ",
        }
        return getpass.getpass(
            prompts.get(method, f"Login verification code for existing account '{username}': ")
        ).strip()

    return client_factory(
        base_url=target,
        username=username,
        password=password,
        verification_code_provider=verification_code_provider,
    )


def command_workline_list(args, client):
    query = {"limit": args.limit}
    if args.status:
        query["status"] = args.status
    if args.search:
        query["q"] = args.search
    result = request(client, "GET", WORKLINES_PATH, query=query)
    if args.json:
        print_json(result)
        return
    if not result:
        print("No worklines found.")
        return
    for workline in result:
        print_workline(workline, include_details=False)


def command_workline_show(args, client):
    result = request(client, "GET", WORKLINES_PATH, query={"id": args.id})
    if args.json:
        print_json(result)
    else:
        print_workline(result)


def command_workline_board(args, client):
    result = request(client, "GET", OBSERVATORY_BOARD_PATH)
    if args.json:
        print_json(result)
        return
    worklines = result.get("worklines") or []
    if not worklines:
        print("No active, paused, or owner-changed worklines awaiting reconciliation found.")
        return
    for workline in worklines:
        print_observatory_workline(workline)


def command_workline_new(args, client):
    payload = {"title": args.title, "status": args.status, "tags": args.tag}
    result = request(client, "POST", WORKLINES_PATH, data=payload)
    if args.json:
        print_json(result)
    else:
        print("Created workline:")
        print_workline(result)


def command_workline_update(args, client):
    payload = {"id": args.id}
    if args.title is not None:
        payload["title"] = args.title
    if args.status is not None:
        payload["status"] = args.status
    if args.tag is not None:
        payload["tags"] = args.tag
    result = request(client, "PATCH", WORKLINES_PATH, data=payload)
    if args.json:
        print_json(result)
    else:
        print("Updated workline:")
        print_workline(result)


def command_workline_state(args, client):
    payload = {"id": args.id, "status": args.target_status}
    result = request(client, "PATCH", WORKLINES_PATH, data=payload)
    if args.json:
        print_json(result)
    else:
        print_workline(result)


def command_workline_link(args, client):
    result = request(
        client,
        "POST",
        LINKS_PATH,
        data={"workline_id": args.id, "task_id": args.task_id},
    )
    if args.json:
        print_json(result)
    else:
        print(
            f"Linked workline #{result['workline_id']} ({result['workline_title']}) "
            f"to task #{result['task_id']} ({result['task_title']})."
        )


def command_workline_unlink(args, client):
    result = request(
        client,
        "DELETE",
        LINKS_PATH,
        query={"workline_id": args.id, "task_id": args.task_id},
    )
    if args.json:
        print_json(result)
    else:
        print(f"Removed task #{args.task_id} from workline #{args.id}.")


def command_report_list(args, client):
    query = {"limit": args.limit}
    if args.workline_id:
        query["workline_id"] = args.workline_id
    if args.state:
        query["state"] = args.state
    if args.search:
        query["q"] = args.search
    result = request(client, "GET", REPORTS_PATH, query=query)
    if args.json:
        print_json(result)
        return
    if not result:
        print("No reports found.")
        return
    for report in result:
        print_report(report, include_content=False)


def command_report_show(args, client):
    result = request(client, "GET", REPORTS_PATH, query={"id": args.id})
    if args.json:
        print_json(result)
    else:
        print_report(result)


def _normalize_git_snapshot_path(value: str, *, field_name: str) -> str:
    raw = str(value).strip().replace("\\", "/")
    normalized = str(PurePosixPath(raw))
    if (
        not raw
        or raw.startswith("/")
        or normalized in {".", ".."}
        or normalized.startswith("../")
    ):
        raise ValueError(f"{field_name} must be a repository-relative path")
    return normalized.rstrip("/")


def collect_git_snapshot(
    workline_paths: list[str],
    workline_prefixes: list[str] | tuple[str, ...] = (),
) -> dict:
    head_result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    status_result = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        check=True,
        capture_output=True,
    )
    fields = status_result.stdout.split(b"\0")
    dirty_paths: set[str] = set()
    index = 0
    while index < len(fields):
        field = fields[index]
        index += 1
        if not field:
            continue
        if len(field) < 4:
            raise ValueError("unexpected git status record")
        status = field[:2].decode("ascii", errors="replace")
        dirty_paths.add(field[3:].decode("utf-8", errors="surrogateescape"))
        if "R" in status or "C" in status:
            if index >= len(fields) or not fields[index]:
                raise ValueError("incomplete git rename status record")
            dirty_paths.add(fields[index].decode("utf-8", errors="surrogateescape"))
            index += 1

    normalized_own_paths = sorted({
        _normalize_git_snapshot_path(value, field_name="git path")
        for value in workline_paths
    })
    unknown_paths = sorted(set(normalized_own_paths) - dirty_paths)
    if unknown_paths:
        raise ValueError(
            "workline git paths are not dirty at snapshot time: " + ", ".join(unknown_paths)
        )

    normalized_prefixes = sorted({
        _normalize_git_snapshot_path(value, field_name="git path prefix")
        for value in workline_prefixes
    })
    covered_by_prefix: set[str] = set()
    unknown_prefixes: list[str] = []
    for prefix in normalized_prefixes:
        covered = {
            path for path in dirty_paths
            if path == prefix or path.startswith(prefix + "/")
        }
        if not covered:
            unknown_prefixes.append(prefix)
            continue
        covered_by_prefix.update(covered)
    if unknown_prefixes:
        raise ValueError(
            "workline git path prefixes cover no dirty paths: "
            + ", ".join(unknown_prefixes)
        )

    owned_dirty_paths = set(normalized_own_paths) | covered_by_prefix
    reported_paths = sorted({
        *normalized_own_paths,
        *(f"{prefix}/**" for prefix in normalized_prefixes),
    })
    return {
        "git_head_commit": head_result.stdout.strip().lower(),
        "git_worktree_state": "dirty" if dirty_paths else "clean",
        "git_has_other_changes": bool(dirty_paths - owned_dirty_paths),
        "git_workline_changed_paths": reported_paths,
    }


def report_add_payload(args) -> dict:
    next_step = str(args.next_step or "").strip()
    if args.workline_status in {"active", "paused"} and not next_step:
        raise ValueError("open workline reports require --next-step")
    if args.workline_status in {"closed", "archived"} and next_step:
        raise ValueError("closed workline reports must omit --next-step")
    git_snapshot = collect_git_snapshot(args.git_path, args.git_path_prefix)
    snapshot = read_metadata_file(args.snapshot_file)
    return {
        "workline_id": args.workline_id,
        "title": args.title,
        "report_type": args.report_type or ("completion" if args.phase == "5-6" else "progress"),
        "outcome": args.outcome,
        "phase_gate": args.phase,
        "current_phase": args.current_phase,
        "workline_status_snapshot": args.workline_status,
        "sync_workline_status": args.sync_workline_status,
        "changed_this_turn": args.changed_this_turn,
        "context": args.context,
        "plain_language": args.plain_language,
        "technical": args.technical,
        "next_step": next_step,
        "snapshot": snapshot,
        **git_snapshot,
        "source_kind": args.source_kind,
        "source_ref": args.source_ref or "",
        "tags": args.tag,
        "metadata": read_metadata_file(args.metadata_file),
        "supersedes_report_id": args.supersedes,
    }


def command_report_add(args, client):
    result = request(client, "POST", REPORTS_PATH, data=report_add_payload(args))
    if args.json:
        print_json(result)
    else:
        print("Created report:")
        print_report(result)


def command_report_state(args, client):
    payload = {"id": args.id, "state": args.target_state}
    result = request(client, "PATCH", REPORTS_PATH, data=payload)
    if args.json:
        print_json(result)
    else:
        print_report(result)


def command_report_redact(args, client):
    payload = {"id": args.id, "state": "redacted", "redaction_reason": args.reason}
    result = request(client, "PATCH", REPORTS_PATH, data=payload)
    if args.json:
        print_json(result)
    else:
        print("Redacted report free-form fields:")
        print_report(result)


def print_handover(report: dict, *, include_markdown: bool = True) -> None:
    print(f"#{report['id']} [{report['state']}] {report['title']}")
    print(
        f"  source: {report['source_kind']} | items: {len(report.get('items') or [])} "
        f"| created: {report.get('created_at', '-')}"
    )
    if report.get("supersedes_handover_id"):
        print(f"  supersedes: #{report['supersedes_handover_id']}")
    if include_markdown and report.get("markdown"):
        print()
        print(report["markdown"], end="" if report["markdown"].endswith("\n") else "\n")


def parse_handover_items(values: list[str]) -> list[dict]:
    items = []
    for value in values:
        parts = value.split(":")
        if len(parts) != 2:
            raise ValueError("handover items must use WORKLINE_ID:REPORT_ID")
        try:
            workline_id, report_id = (int(part) for part in parts)
        except ValueError as err:
            raise ValueError("handover item identifiers must be integers") from err
        if workline_id <= 0 or report_id <= 0:
            raise ValueError("handover item identifiers must be positive")
        items.append({"workline_id": workline_id, "workline_report_id": report_id})
    return items


def command_handover_list(args, client):
    query = {"limit": args.limit}
    if args.state:
        query["state"] = args.state
    if args.search:
        query["q"] = args.search
    result = request(client, "GET", HANDOVERS_PATH, query=query)
    if args.json:
        print_json(result)
        return
    if not result:
        print("No handover reports found.")
        return
    for report in result:
        print_handover(report, include_markdown=False)


def command_handover_show(args, client):
    result = request(client, "GET", HANDOVERS_PATH, query={"id": args.id})
    if args.json:
        print_json(result)
    else:
        print_handover(result)


def command_handover_latest(args, client):
    result = request(client, "GET", HANDOVERS_PATH, query={"latest": "true"})
    if args.json:
        print_json(result)
    else:
        print_handover(result)


def command_handover_add(args, client):
    payload = {
        "title": args.title,
        "source_kind": args.source_kind,
        "source_ref": args.source_ref or "",
        "tags": args.tag,
        "metadata": read_metadata_file(args.metadata_file),
        "supersedes_handover_id": args.supersedes,
        "items": parse_handover_items(args.item),
    }
    result = request(client, "POST", HANDOVERS_PATH, data=payload)
    if args.json:
        print_json(result)
    else:
        print("Created handover report:")
        print_handover(result)


def command_handover_state(args, client):
    result = request(
        client,
        "PATCH",
        HANDOVERS_PATH,
        data={"id": args.id, "state": args.target_state},
    )
    if args.json:
        print_json(result)
    else:
        print_handover(result)


def add_common_list_arguments(parser):
    parser.add_argument("--search", help="Case-insensitive title/content search")
    parser.add_argument("--limit", type=int, default=50, help="Maximum 1-100 rows")


def command_credentials_configure(args, _client=None):
    result = configure_agent_credentials(base_url=args.base_url)
    print(f"Verified and stored dedicated agent administrator: {result['username']}")
    print(f"Protected credential file: {result['env_file']}")
    print("Password and fixed PIN were not printed.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage canonical Filterest development worklines and retrospective reports through the app API."
    )
    parser.add_argument(
        "--base-url",
        help=f"Filterest application URL, default {DEFAULT_BASE_URL}",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    parser.add_argument(
        "--prompt-credentials",
        action="store_true",
        help="Prompt securely for an existing account instead of using resolved dev credentials",
    )
    parser.add_argument(
        "--credential-username",
        help="Exact existing account name used with --prompt-credentials",
    )
    top = parser.add_subparsers(dest="domain", required=True)

    credentials = top.add_parser(
        "credentials",
        help="Configure the persistent native-development agent administrator",
    )
    credential_commands = credentials.add_subparsers(dest="command", required=True)
    credential_configure = credential_commands.add_parser(
        "configure",
        help="Prompt once, verify administrator access and fixed PIN, then store securely",
    )
    credential_configure.set_defaults(func=command_credentials_configure, skip_default_login=True)

    workline = top.add_parser("workline", help="Manage stable workline identities")
    workline_commands = workline.add_subparsers(dest="command", required=True)

    workline_board = workline_commands.add_parser(
        "board",
        help="Read the observatory's active/paused title, status, and exact phase truth",
    )
    workline_board.set_defaults(func=command_workline_board)

    workline_list = workline_commands.add_parser("list", help="List worklines")
    workline_list.add_argument("--status", choices=["active", "paused", "closed", "archived"])
    add_common_list_arguments(workline_list)
    workline_list.set_defaults(func=command_workline_list)

    workline_show = workline_commands.add_parser("show", help="Show one workline")
    workline_show.add_argument("id", type=int)
    workline_show.set_defaults(func=command_workline_show)

    workline_new = workline_commands.add_parser("new", help="Create a workline")
    workline_new.add_argument("--title", required=True)
    workline_new.add_argument("--status", default="active", choices=["active", "paused", "closed"])
    workline_new.add_argument("--tag", action="append", default=[])
    workline_new.set_defaults(func=command_workline_new)

    workline_update = workline_commands.add_parser("update", help="Update mutable workline metadata")
    workline_update.add_argument("id", type=int)
    workline_update.add_argument("--title")
    workline_update.add_argument("--status", choices=["active", "paused", "closed", "archived"])
    workline_update.add_argument("--tag", action="append", default=None, help="Replace tags; repeat for many")
    workline_update.set_defaults(func=command_workline_update)

    for name, status in (("activate", "active"), ("pause", "paused"), ("close", "closed"), ("archive", "archived")):
        state_parser = workline_commands.add_parser(name, help=f"Set workline status to {status}")
        state_parser.add_argument("id", type=int)
        state_parser.set_defaults(func=command_workline_state, target_status=status)

    workline_link = workline_commands.add_parser("link-task", help="Link an existing DB ticket")
    workline_link.add_argument("id", type=int, help="Workline ID")
    workline_link.add_argument("task_id", type=int)
    workline_link.set_defaults(func=command_workline_link)

    workline_unlink = workline_commands.add_parser("unlink-task", help="Remove a ticket link")
    workline_unlink.add_argument("id", type=int, help="Workline ID")
    workline_unlink.add_argument("task_id", type=int)
    workline_unlink.set_defaults(func=command_workline_unlink)

    report = top.add_parser("report", help="Create, read, correct, archive, or redact reports")
    report_commands = report.add_subparsers(dest="command", required=True)

    report_list = report_commands.add_parser("list", help="List reports")
    report_list.add_argument("--workline-id", type=int)
    report_list.add_argument("--state", choices=["final", "superseded", "redacted", "archived"])
    add_common_list_arguments(report_list)
    report_list.set_defaults(func=command_report_list)

    report_show = report_commands.add_parser("show", help="Show one full report")
    report_show.add_argument("id", type=int)
    report_show.set_defaults(func=command_report_show)

    report_add = report_commands.add_parser("add", help="Create an append-first report")
    report_add.add_argument("workline_id", type=int)
    report_add.add_argument("--title", required=True)
    report_add.add_argument("--phase", required=True, choices=["2", "3-4", "5-6"])
    report_add.add_argument("--current-phase", required=True, type=int, choices=range(0, 7))
    report_add.add_argument(
        "--workline-status",
        required=True,
        choices=["active", "paused", "closed", "archived"],
    )
    report_add.add_argument(
        "--sync-workline-status",
        action="store_true",
        help=(
            "Atomically change the workline lifecycle status to --workline-status "
            "while creating this report"
        ),
    )
    report_add.add_argument("--context", required=True)
    report_add.add_argument("--plain-language", required=True)
    report_add.add_argument("--technical", required=True)
    report_add.add_argument("--next-step")
    changed_group = report_add.add_mutually_exclusive_group(required=True)
    changed_group.add_argument("--changed-this-turn", dest="changed_this_turn", action="store_true")
    changed_group.add_argument("--no-change-this-turn", dest="changed_this_turn", action="store_false")
    report_add.add_argument(
        "--git-path",
        action="append",
        default=[],
        help="Repository-relative dirty path owned by this workline; repeat for many",
    )
    report_add.add_argument(
        "--git-path-prefix",
        action="append",
        default=[],
        help=(
            "Repository-relative directory whose complete dirty subtree belongs to this "
            "workline; repeat for large move batches"
        ),
    )
    report_add.add_argument("--snapshot-file", help="Optional structured JSON snapshot details")
    report_add.add_argument(
        "--type",
        dest="report_type",
        default=None,
        choices=["completion", "progress", "decision", "closure"],
    )
    report_add.add_argument(
        "--outcome",
        default="completed",
        choices=["completed", "partial", "blocked", "no_change", "decision"],
    )
    report_add.add_argument("--source-kind", default="codex")
    report_add.add_argument("--source-ref")
    report_add.add_argument("--tag", action="append", default=[])
    report_add.add_argument("--metadata-file")
    report_add.add_argument("--supersedes", type=int, help="Prior report ID corrected by this row")
    report_add.set_defaults(func=command_report_add)

    for name, state in (("archive", "archived"), ("restore", "final")):
        state_parser = report_commands.add_parser(name, help=f"Set report state to {state}")
        state_parser.add_argument("id", type=int)
        state_parser.set_defaults(func=command_report_state, target_state=state)

    report_redact = report_commands.add_parser("redact", help="Irreversibly remove report free-form fields")
    report_redact.add_argument("id", type=int)
    report_redact.add_argument("--reason", required=True)
    report_redact.set_defaults(func=command_report_redact)

    handover = top.add_parser("handover", help="Create and retrieve aggregate chat handovers")
    handover_commands = handover.add_subparsers(dest="command", required=True)

    handover_list = handover_commands.add_parser("list", help="List handover metadata")
    handover_list.add_argument("--state", choices=["final", "superseded", "archived"])
    add_common_list_arguments(handover_list)
    handover_list.set_defaults(func=command_handover_list)

    handover_show = handover_commands.add_parser("show", help="Render one full handover")
    handover_show.add_argument("id", type=int)
    handover_show.set_defaults(func=command_handover_show)

    handover_latest = handover_commands.add_parser("latest", help="Render the latest final handover")
    handover_latest.set_defaults(func=command_handover_latest)

    handover_add = handover_commands.add_parser("add", help="Create an immutable handover manifest")
    handover_add.add_argument("--title", required=True)
    handover_add.add_argument(
        "--item",
        action="append",
        required=True,
        help="WORKLINE_ID:REPORT_ID in rendered order; repeat for each workline",
    )
    handover_add.add_argument("--source-kind", default="codex")
    handover_add.add_argument("--source-ref")
    handover_add.add_argument("--tag", action="append", default=[])
    handover_add.add_argument("--metadata-file")
    handover_add.add_argument("--supersedes", type=int)
    handover_add.set_defaults(func=command_handover_add)

    for name, state in (("archive", "archived"), ("restore", "final")):
        state_parser = handover_commands.add_parser(name, help=f"Set handover state to {state}")
        state_parser.add_argument("id", type=int)
        state_parser.set_defaults(func=command_handover_state, target_state=state)

    return parser


def main(argv=None, *, client_factory=EaselectAPIClient) -> int:
    args = build_parser().parse_args(argv)
    try:
        if getattr(args, "skip_default_login", False):
            args.func(args, None)
            return 0
        client = make_client(args, client_factory)
        client.login()
        args.func(args, client)
    except (EaselectAPIError, OSError, ValueError, json.JSONDecodeError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
