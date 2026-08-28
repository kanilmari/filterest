#!/usr/bin/env python3
# test_easelect_api_client.py
# Verifies shared API client request shaping and transport safeguards.
# Bridges developer-tool requests with the public Filterest API client.
# Exists so authentication and request behavior remain stable across tools.

from __future__ import annotations

import os
from pathlib import Path
import ssl
import tempfile
import unittest
import urllib.request
from unittest.mock import Mock, patch

from .easelect_api_client import (
    DEFAULT_BASE_URL,
    LOCAL_NATIVE_PORT,
    EaselectAPIClient,
    EaselectAPIError,
    _SameOriginRedirectHandler,
    load_project_env,
)


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
            DEFAULT_BASE_URL,
            environment={},
        )
        non_native_local_context = EaselectAPIClient._ssl_context(
            f"https://localhost:{LOCAL_NATIVE_PORT + 1}",
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
            embedded_easelect=True,
        )

        self.assertFalse(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_NONE)

    def test_standalone_tls_ignores_legacy_easelect_insecure_override(self) -> None:
        legacy_context = EaselectAPIClient._ssl_context(
            "https://example.test",
            environment={"EASELECT_API_ALLOW_INSECURE_TLS": "1"},
            embedded_easelect=False,
        )
        filterest_context = EaselectAPIClient._ssl_context(
            "https://example.test",
            environment={"FILTEREST_API_ALLOW_INSECURE_TLS": "1"},
            embedded_easelect=False,
        )

        self.assertTrue(legacy_context.check_hostname)
        self.assertEqual(legacy_context.verify_mode, ssl.CERT_REQUIRED)
        self.assertFalse(filterest_context.check_hostname)
        self.assertEqual(filterest_context.verify_mode, ssl.CERT_NONE)

    def test_native_credentials_disable_ambient_https_proxy(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir) / "filterest"
            app_root = project_root / "app"
            app_root.mkdir(parents=True)
            (app_root / "go.mod").write_text(
                "module example.invalid/filterest\n",
                encoding="utf-8",
            )
            (app_root / "VERSION_APP").write_text("1.0.0\n", encoding="utf-8")
            with (
                patch.dict(
                    os.environ,
                    {"HTTPS_PROXY": "https://credential-sink.example:8443"},
                    clear=True,
                ),
                patch.object(
                    urllib.request,
                    "build_opener",
                    return_value=Mock(),
                ) as build_opener,
            ):
                EaselectAPIClient(project_root=str(project_root))

        handlers = build_opener.call_args.args
        proxy_handlers = [
            handler
            for handler in handlers
            if isinstance(handler, urllib.request.ProxyHandler)
        ]
        self.assertEqual(len(proxy_handlers), 1)
        self.assertEqual(proxy_handlers[0].proxies, {})

    def test_remote_explicit_credentials_keep_normal_proxy_support(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            urllib.request,
            "build_opener",
            return_value=Mock(),
        ) as build_opener:
            EaselectAPIClient(
                project_root=temp_dir,
                base_url="https://api.example.test",
                username="remote-user",
                password="remote-password",
                environment={},
            )

        self.assertFalse(any(
            isinstance(handler, urllib.request.ProxyHandler)
            for handler in build_opener.call_args.args
        ))

    def test_redirect_handler_allows_only_the_configured_origin(self) -> None:
        handler = _SameOriginRedirectHandler("https://localhost:8100")
        request = urllib.request.Request("https://localhost:8100/api/source")

        redirected = handler.redirect_request(
            request,
            None,
            307,
            "Temporary Redirect",
            {},
            "/api/destination",
        )

        self.assertEqual(
            redirected.full_url,
            "https://localhost:8100/api/destination",
        )

    def test_redirect_handler_rejects_cross_origin_and_tls_downgrade(self) -> None:
        handler = _SameOriginRedirectHandler("https://localhost:8100")
        request = urllib.request.Request("https://localhost:8100/api/source")
        unsafe_targets = (
            "https://credential-sink.example/api",
            "https://localhost:8199/api",
            "http://localhost:8100/api",
        )

        for target in unsafe_targets:
            with self.subTest(target=target), self.assertRaisesRegex(
                EaselectAPIError,
                "redirect outside",
            ):
                handler.redirect_request(
                    request,
                    None,
                    302,
                    "Found",
                    {},
                    target,
                )

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

    def test_standalone_client_ignores_ambient_easelect_and_process_dev_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir) / "filterest"
            app_root = project_root / "app"
            app_root.mkdir(parents=True)
            (app_root / "go.mod").write_text(
                "module example.invalid/filterest\n",
                encoding="utf-8",
            )
            (app_root / "VERSION_APP").write_text("1.0.0\n", encoding="utf-8")
            protected_root = project_root / "keys/filterest_runtime"
            protected_root.mkdir(parents=True)
            (protected_root / "development_environment.env").write_text(
                "DEV_USERNAME=standalone-user\n"
                "DEV_PASSWORD=standalone-password\n"
                "DEV_LOGIN_VERIFICATION_CODE=246810\n",
                encoding="utf-8",
            )
            client = EaselectAPIClient(
                project_root=str(project_root),
                environment={
                    "EASELECT_API_BASE_URL": "https://localhost:8082",
                    "EASELECT_API_USERNAME": "easelect-user",
                    "EASELECT_API_PASSWORD": "easelect-password",
                    "EASELECT_API_OTP_CODE": "111111",
                    "DEV_USERNAME": "ambient-dev-user",
                    "DEV_PASSWORD": "ambient-dev-password",
                    "DEV_LOGIN_VERIFICATION_CODE": "222222",
                    "LOGIN_OTP_CODE": "333333",
                    "DB_TASK_BASE_URL": "https://localhost:8999",
                    "EASELECT_KEY_ROOT": str(Path(temp_dir) / "easelect-keys"),
                },
            )

        self.assertEqual(client.base_url, "https://localhost:8100")
        self.assertEqual(client.username, "standalone-user")
        self.assertEqual(client.password, "standalone-password")
        self.assertEqual(client.otp_code, "246810")

    def test_filterest_api_values_override_legacy_values_for_any_product(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir) / "filterest"
            app_root = project_root / "app"
            app_root.mkdir(parents=True)
            (app_root / "go.mod").write_text(
                "module example.invalid/filterest\n",
                encoding="utf-8",
            )
            (app_root / "VERSION_APP").write_text("1.0.0\n", encoding="utf-8")
            client = EaselectAPIClient(
                project_root=str(project_root),
                environment={
                    "FILTEREST_API_BASE_URL": "https://127.0.0.1:8199/path/",
                    "FILTEREST_API_USERNAME": "filterest-user",
                    "FILTEREST_API_PASSWORD": "filterest-password",
                    "FILTEREST_API_OTP_CODE": "987654",
                    "EASELECT_API_BASE_URL": "https://localhost:8082",
                    "EASELECT_API_USERNAME": "easelect-user",
                    "EASELECT_API_PASSWORD": "easelect-password",
                    "EASELECT_API_OTP_CODE": "111111",
                },
            )

        self.assertEqual(client.base_url, "https://127.0.0.1:8199/path")
        self.assertEqual(client.username, "filterest-user")
        self.assertEqual(client.password, "filterest-password")
        self.assertEqual(client.otp_code, "987654")

    def test_remote_target_never_loads_protected_local_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir) / "filterest"
            app_root = project_root / "app"
            app_root.mkdir(parents=True)
            (app_root / "go.mod").write_text(
                "module example.invalid/filterest\n",
                encoding="utf-8",
            )
            (app_root / "VERSION_APP").write_text("1.0.0\n", encoding="utf-8")
            protected_root = project_root / "keys/filterest_runtime"
            protected_root.mkdir(parents=True)
            (protected_root / "development_environment.env").write_text(
                "DEV_USERNAME=local-user\n"
                "DEV_PASSWORD=local-password\n"
                "DEV_LOGIN_VERIFICATION_CODE=246810\n",
                encoding="utf-8",
            )

            client = EaselectAPIClient(
                project_root=str(project_root),
                base_url="https://api.example.test",
                environment={
                    "DEV_USERNAME": "ambient-user",
                    "DEV_PASSWORD": "ambient-password",
                    "DEV_LOGIN_VERIFICATION_CODE": "111111",
                },
            )

        self.assertEqual(client.project_env, {})
        self.assertEqual(client.username, "")
        self.assertEqual(client.password, "")
        self.assertIsNone(client.otp_code)
        client.fetch_csrf_token = Mock(side_effect=AssertionError("network used"))
        with self.assertRaisesRegex(RuntimeError, "protected local credentials"):
            client.login()

    def test_remote_target_accepts_only_api_specific_process_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = EaselectAPIClient(
                project_root=temp_dir,
                base_url="https://api.example.test",
                environment={
                    "FILTEREST_API_USERNAME": "remote-user",
                    "FILTEREST_API_PASSWORD": "remote-password",
                    "FILTEREST_API_OTP_CODE": "654321",
                    "DEV_USERNAME": "ambient-user",
                    "DEV_PASSWORD": "ambient-password",
                },
            )

        self.assertEqual(client.username, "remote-user")
        self.assertEqual(client.password, "remote-password")
        self.assertEqual(client.otp_code, "654321")

    def test_remote_target_accepts_explicit_constructor_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = EaselectAPIClient(
                project_root=temp_dir,
                base_url="https://api.example.test",
                username="prompted-user",
                password="prompted-password",
                otp_code="123456",
                environment={
                    "DEV_USERNAME": "ambient-user",
                    "DEV_PASSWORD": "ambient-password",
                },
            )

        self.assertEqual(client.username, "prompted-user")
        self.assertEqual(client.password, "prompted-password")
        self.assertEqual(client.otp_code, "123456")

    def test_remote_target_rejects_plaintext_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, self.assertRaisesRegex(
            EaselectAPIError,
            "require HTTPS",
        ):
            EaselectAPIClient(
                project_root=temp_dir,
                base_url="http://credential-sink.example",
                username="remote-user",
                password="remote-password",
                environment={},
            )

    def test_explicit_plaintext_loopback_target_remains_available(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = EaselectAPIClient(
                project_root=temp_dir,
                base_url="http://127.0.0.1:8199",
                username="local-user",
                password="local-password",
                environment={},
            )

        self.assertEqual(client.base_url, "http://127.0.0.1:8199")

    def test_private_easelect_client_retains_legacy_process_compatibility(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir) / "easelect"
            project_root.mkdir()
            (project_root / ".git").mkdir()
            (project_root / "VERSION_EASELECT").write_text(
                "1.0.0\n",
                encoding="utf-8",
            )
            key_root = Path(temp_dir) / "protected-keys"
            (key_root / "easelect_development").mkdir(parents=True)
            client = EaselectAPIClient(
                project_root=str(project_root),
                environment={
                    "EASELECT_KEY_ROOT": str(key_root),
                    "EASELECT_API_BASE_URL": "https://127.0.0.1:8082",
                    "EASELECT_API_USERNAME": "legacy-user",
                    "EASELECT_API_PASSWORD": "legacy-password",
                    "EASELECT_API_OTP_CODE": "135790",
                    "DEV_USERNAME": "dev-user",
                    "DEV_PASSWORD": "dev-password",
                    "LOGIN_OTP_CODE": "111111",
                },
            )

        self.assertEqual(client.base_url, "https://127.0.0.1:8082")
        self.assertEqual(client.username, "legacy-user")
        self.assertEqual(client.password, "legacy-password")
        self.assertEqual(client.otp_code, "135790")

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
