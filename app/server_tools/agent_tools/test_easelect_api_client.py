#!/usr/bin/env python3
# test_easelect_api_client.py
# Verifies shared API client request shaping for developer tooling.

from __future__ import annotations

import os
from pathlib import Path
import ssl
import tempfile
import unittest
from unittest.mock import Mock, patch

from .easelect_api_client import EaselectAPIClient, load_project_env


class CapturingClient(EaselectAPIClient):
    def __init__(self) -> None:
        self.calls = []

    def login(self):
        return {"authenticated": True}

    def request(self, method, path, *, data=None, query=None, csrf=False, expect_json=True):
        self.calls.append(
            {
                "method": method,
                "path": path,
                "data": data,
                "query": query,
                "csrf": csrf,
                "expect_json": expect_json,
            }
        )
        return {"ok": True}


class PagingClient(EaselectAPIClient):
    def __init__(self, pages) -> None:
        self.pages = pages
        self.offsets = []
        self.kwargs = []

    def get_dataset_rows(self, dataset_name, *, offset=0, **kwargs):
        self.offsets.append(offset)
        self.kwargs.append(kwargs)
        return {"data": self.pages.get(offset, [])}


class EaselectAPIClientTest(unittest.TestCase):
    def test_tls_context_skips_verification_only_for_exact_native_origin(self) -> None:
        local_context = EaselectAPIClient._ssl_context(
            "https://localhost:8082",
            environment={},
        )
        non_native_local_context = EaselectAPIClient._ssl_context(
            "https://localhost:8090",
            environment={},
        )

        self.assertFalse(local_context.check_hostname)
        self.assertEqual(local_context.verify_mode, ssl.CERT_NONE)
        self.assertTrue(non_native_local_context.check_hostname)
        self.assertEqual(non_native_local_context.verify_mode, ssl.CERT_REQUIRED)

    def test_tls_context_verifies_remote_hosts_by_default(self) -> None:
        context = EaselectAPIClient._ssl_context(
            "https://fintravel.fi",
            environment={},
        )

        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_tls_context_requires_explicit_opt_in_to_skip_remote_verification(self) -> None:
        context = EaselectAPIClient._ssl_context(
            "https://example.test",
            environment={"EASELECT_API_ALLOW_INSECURE_TLS": "1"},
        )

        self.assertFalse(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_NONE)

    def test_lang_key_upsert_uses_admin_route_and_preserves_omitted_yue(self) -> None:
        client = CapturingClient()
        before = {
            "fi": "Vanha",
            "en": "Old",
            "ch": "旧",
            "yue": "舊",
            "usage_explanation": "Existing context",
        }
        client.get_lang_key = Mock(side_effect=[before, {**before, "fi": "Linkki"}])

        result = client.upsert_lang_key({"lang_key": "link", "fi": "Linkki"})

        self.assertTrue(result["changed"])
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0]["method"], "POST")
        self.assertEqual(client.calls[0]["path"], "/api/admin/lang-key")
        self.assertTrue(client.calls[0]["csrf"])
        self.assertEqual(client.calls[0]["data"]["yue"], "舊")

    def test_load_project_env_uses_external_key_root_for_private_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir) / "easelect"
            project_root.mkdir()
            (project_root / ".git").mkdir()
            (project_root / "VERSION_EASELECT").write_text("1.0.0\n", encoding="utf-8")
            key_root = Path(temp_dir) / "keys"
            development_root = key_root / "easelect_development"
            development_root.mkdir(parents=True)
            (development_root / "runtime_environment.env").write_text(
                "DB_NAME=runtime\n",
                encoding="utf-8",
            )
            (development_root / "development_environment.env").write_text(
                "DB_NAME=development\n"
                "DEV_USERNAME=local-user\n"
                "DEV_PASSWORD=local-password\n"
                "LOGIN_OTP_CODE=123456\n",
                encoding="utf-8",
            )
            (project_root / ".env").write_text("DB_NAME=legacy\n", encoding="utf-8")

            with patch.dict(
                os.environ,
                {"EASELECT_KEY_ROOT": str(key_root)},
                clear=True,
            ):
                loaded = load_project_env(str(project_root))

        self.assertEqual(loaded["DB_NAME"], "development")
        self.assertEqual(loaded["DEV_USERNAME"], "local-user")
        self.assertEqual(loaded["DEV_PASSWORD"], "local-password")
        self.assertEqual(loaded["LOGIN_OTP_CODE"], "123456")

    def test_client_uses_resolved_credentials_without_tracked_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir) / "easelect"
            project_root.mkdir()
            (project_root / ".git").mkdir()
            (project_root / "VERSION_EASELECT").write_text(
                "1.0.0\n",
                encoding="utf-8",
            )
            key_root = Path(temp_dir) / "keys"
            development_root = key_root / "easelect_development"
            development_root.mkdir(parents=True)
            (development_root / "development_environment.env").write_text(
                "DEV_USERNAME=resolved-user\nDEV_PASSWORD=resolved-password\n",
                encoding="utf-8",
            )

            with patch.dict(
                os.environ,
                {"EASELECT_KEY_ROOT": str(key_root)},
                clear=True,
            ):
                client = EaselectAPIClient(project_root=str(project_root))

        self.assertEqual(client.username, "resolved-user")
        self.assertEqual(client.password, "resolved-password")

    def test_login_fails_closed_when_credentials_are_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            with patch.dict(os.environ, {}, clear=True):
                client = EaselectAPIClient(project_root=str(project_root))

        with self.assertRaisesRegex(RuntimeError, "login credentials are missing"):
            client.login()

    def test_update_row_converts_dict_updates_to_batch_payload(self) -> None:
        client = CapturingClient()
        client.update_row("app_service_catalog", 392, {"cached_image": "104_392_15.svg"})

        self.assertEqual(len(client.calls), 1)
        payload = client.calls[0]["data"]
        self.assertEqual(payload["id"], 392)
        self.assertEqual(
            payload["updates"],
            [{"column": "cached_image", "value": "104_392_15.svg"}],
        )

    def test_set_column_multilingual_uses_canonical_admin_payload(self) -> None:
        client = CapturingClient()

        client.set_column_multilingual("travel_deals", 526, True)

        self.assertEqual(
            client.calls,
            [{
                "method": "POST",
                "path": "/api/admin/column-multilingual",
                "data": {
                    "dataset": "travel_deals",
                    "column_uid": 526,
                    "is_multilingual": True,
                },
                "query": None,
                "csrf": True,
                "expect_json": True,
            }],
        )

    def test_login_reuses_authenticated_client_session(self) -> None:
        client = EaselectAPIClient.__new__(EaselectAPIClient)
        client._authenticated = True

        self.assertEqual(client.login(), {"authenticated": True, "cached": True})

    def test_login_provider_receives_fixed_pin_method(self) -> None:
        client = EaselectAPIClient.__new__(EaselectAPIClient)
        client._authenticated = False
        client.username = "admin"
        client.password = "secret"
        client.otp_code = "stale-environment-code"
        client.verification_code_provider = Mock(return_value="2468")
        client.fetch_csrf_token = Mock(return_value="csrf")
        first = {"otp_required": True, "verification_method": "fixed_pin"}
        client.request = Mock(side_effect=[first, {"authenticated": True}])

        result = client.login()

        self.assertTrue(result["authenticated"])
        client.verification_code_provider.assert_called_once_with(first)
        self.assertEqual(client.request.call_args_list[1].kwargs["data"]["otp_code"], "2468")

    def test_all_rows_pages_until_empty_even_when_first_page_is_short(self) -> None:
        client = PagingClient({0: [{"id": 1}, {"id": 2}], 2: [{"id": 3}], 3: []})

        rows = client.get_all_dataset_rows("system_lang_keys")

        self.assertEqual(rows, [{"id": 1}, {"id": 2}, {"id": 3}])
        self.assertEqual(client.offsets, [0, 2, 3])
        self.assertTrue(all("row_count" not in kwargs for kwargs in client.kwargs))

    def test_rename_tree_node_uses_transactional_api_payload(self) -> None:
        client = CapturingClient()

        client.rename_tree_node(10000, "folder", "fintravel", {"fi": "Fintravel"})

        self.assertEqual(client.calls[0]["path"], "/api/rename-tree-node")
        self.assertEqual(client.calls[0]["data"]["item_id"], 10000)
        self.assertTrue(client.calls[0]["csrf"])

    def test_registration_update_has_authoritative_public_readback(self) -> None:
        client = EaselectAPIClient.__new__(EaselectAPIClient)
        client.login = Mock(return_value={"authenticated": True})
        client.get_all_dataset_rows = Mock(side_effect=[
            [{
                "id": 25,
                "key": "registration_enabled",
                "boolean_value": False,
                "json_value": {"value": False},
                "value_type": 2,
            }],
            [{
                "id": 25,
                "key": "registration_enabled",
                "boolean_value": True,
                "json_value": {"value": True},
                "value_type": 2,
            }],
        ])
        client.update_row = Mock(return_value={"ok": True})
        client.get_auth_modes = Mock(return_value={"registration_enabled": True})

        result = client.set_registration_enabled(True)

        client.update_row.assert_called_once_with(
            "system_config",
            25,
            {
                "json_value": '{"value":true}',
                "boolean_value": True,
                "value_type": 2,
            },
        )
        self.assertEqual(result, {
            "key": "registration_enabled",
            "before": False,
            "after": True,
            "verified": True,
        })

    def test_registration_setting_is_created_when_public_bootstrap_omitted_it(self) -> None:
        client = EaselectAPIClient.__new__(EaselectAPIClient)
        client.login = Mock(return_value={"authenticated": True})
        client.get_all_dataset_rows = Mock(side_effect=[
            [],
            [{
                "id": 3010,
                "key": "registration_enabled",
                "json_value": {"value": True},
                "value_type": 2,
            }],
        ])
        client.add_row = Mock(return_value={"ok": True})
        client.get_auth_modes = Mock(return_value={"registration_enabled": True})

        result = client.set_registration_enabled(True)

        payload = client.add_row.call_args.args[1]
        self.assertEqual(payload["key"], "registration_enabled")
        self.assertEqual(payload["json_value"], '{"value":true}')
        self.assertIs(payload["boolean_value"], True)
        self.assertEqual(payload["value_type"], 2)
        self.assertTrue(result["verified"])

    def test_user_authentication_list_returns_only_api_user_rows(self) -> None:
        client = CapturingClient()
        client.request = Mock(return_value={"users": [{"user_id": 42, "verification_method": "none"}]})

        users = client.list_user_authentication()

        self.assertEqual(users, [{"user_id": 42, "verification_method": "none"}])
        client.request.assert_called_once_with("GET", "/api/admin/user-authentication")

    def test_user_authentication_set_uses_admin_api_and_csrf(self) -> None:
        client = CapturingClient()

        client.set_user_authentication(42, "none")

        self.assertEqual(client.calls, [{
            "method": "POST",
            "path": "/api/admin/user-authentication",
            "data": {"user_id": 42, "verification_method": "none"},
            "query": None,
            "csrf": True,
            "expect_json": True,
        }])

    def test_user_authentication_fixed_pin_is_validated_before_request(self) -> None:
        client = CapturingClient()

        with self.assertRaisesRegex(RuntimeError, "4-8 digits"):
            client.set_user_authentication(42, "fixed_pin", fixed_pin="12ab")
        self.assertEqual(client.calls, [])

    def test_symbol_assignment_uses_admin_api_and_verifies_readback(self) -> None:
        client = EaselectAPIClient.__new__(EaselectAPIClient)
        client.login = Mock(return_value={"authenticated": True})
        before = {
            "symbols": [{"key": "map", "url": "/symbol-assets/map.svg"}],
            "datasets": [{"table_uid": 10006, "dataset_name": "travel_info", "icon_key": "table"}],
            "fields": [],
        }
        after = {
            "symbols": before["symbols"],
            "datasets": [{"table_uid": 10006, "dataset_name": "travel_info", "icon_key": "map"}],
            "fields": [],
        }
        client.request = Mock(side_effect=[before, {"status": "ok"}, after])

        result = client.assign_symbol("dataset", 10006, "map")

        self.assertTrue(result["verified"])
        self.assertEqual(result["before"]["icon_key"], "table")
        self.assertEqual(result["after"]["icon_key"], "map")
        self.assertEqual(
            client.request.call_args_list[1].kwargs,
            {
                "data": {
                    "target_type": "dataset",
                    "target_uid": 10006,
                    "icon_key": "map",
                },
                "csrf": True,
            },
        )
        self.assertEqual(client.request.call_args_list[1].args, ("POST", "/api/admin/symbols"))

    def test_symbol_assignment_rejects_missing_target_before_write(self) -> None:
        client = EaselectAPIClient.__new__(EaselectAPIClient)
        client.login = Mock(return_value={"authenticated": True})
        client.request = Mock(return_value={"symbols": [], "datasets": [], "fields": []})

        with self.assertRaisesRegex(RuntimeError, "was not unique"):
            client.assign_symbol("dataset", 10006, "map")

        client.request.assert_called_once_with("GET", "/api/admin/symbols")


if __name__ == "__main__":
    unittest.main()
