"""Verify standalone retention CLIs and their authenticated API boundary."""

from types import SimpleNamespace
from unittest.mock import Mock, call, patch

try:
    from filterest.app.server_tools.agent_tools import db_data_retention, db_log_retention
    from filterest.app.server_tools.agent_tools.easelect_api_client import (
        authenticated_api_request,
    )

    API_CLIENT_PATCH_TARGET = (
        "filterest.app.server_tools.agent_tools.easelect_api_client.EaselectAPIClient"
    )
except ModuleNotFoundError:
    from server_tools.agent_tools import db_data_retention, db_log_retention
    from server_tools.agent_tools.easelect_api_client import authenticated_api_request

    API_CLIENT_PATCH_TARGET = (
        "server_tools.agent_tools.easelect_api_client.EaselectAPIClient"
    )


def test_authenticated_api_request_logs_in_and_protects_mutations() -> None:
    client = Mock()
    client.request.return_value = {"ok": True}

    with patch(
        API_CLIENT_PATCH_TARGET,
        return_value=client,
    ):
        result = authenticated_api_request(
            "post",
            "/api/data-retention/prune",
            data={"dry_run": False},
        )

    assert result == {"ok": True}
    client.login.assert_called_once_with()
    client.request.assert_called_once_with(
        "POST",
        "/api/data-retention/prune",
        data={"dry_run": False},
        query=None,
        csrf=True,
    )


def test_data_prune_without_confirmation_only_previews() -> None:
    args = SimpleNamespace(policies="Old, old, Logs", yes=False)

    with patch.object(
        db_data_retention,
        "authenticated_api_request",
        return_value={"results": []},
    ) as request:
        db_data_retention.cmd_prune(args)

    request.assert_called_once_with(
        "GET",
        "/api/data-retention/preview",
        query={"policies": "Old,Logs"},
    )


def test_log_prune_confirmation_previews_before_delete() -> None:
    args = SimpleNamespace(before="2026-01-01", tables="Audit, audit", yes=True)

    with patch.object(
        db_log_retention,
        "authenticated_api_request",
        side_effect=[{"results": []}, {"results": []}],
    ) as request:
        db_log_retention.cmd_prune(args)

    assert request.call_args_list == [
        call(
            "GET",
            "/api/log-retention/preview",
            query={"before": "2026-01-01", "tables": "audit"},
        ),
        call(
            "POST",
            "/api/log-retention/prune",
            data={"before": "2026-01-01", "tables": ["audit"], "dry_run": False},
        ),
    ]
