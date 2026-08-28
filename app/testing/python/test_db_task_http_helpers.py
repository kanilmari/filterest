#!/usr/bin/env python3
# test_db_task_http_helpers.py
# Unit tests for db_task.py HTTP and direct-DB subprocess guardrails.
# Bridges fake subprocess results and the shared DB-backed task CLI helpers.
# Exists so local developer CLIs fail promptly and encode API query strings safely.

import contextlib
import io
import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from filterest.app.server_tools.agent_tools import db_task
except ModuleNotFoundError:
    from server_tools.agent_tools import db_task


def api_curl_response(status, payload):
    """Build curl output with headers, JSON, and db_task's final status marker."""
    body = json.dumps(payload)
    return (
        f"HTTP/1.1 {status} Test Response\r\n\r\n{body}"
        f"\n{db_task.HTTP_STATUS_MARKER}{status}"
    )


class DBTaskHTTPHelpersTest(unittest.TestCase):
    def test_load_credentials_reads_e2e_admin_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".git").mkdir()
            (root / "VERSION_EASELECT").write_text("1.0.0\n", encoding="utf-8")
            key_root = root.parent / f"{root.name}-keys"
            development_root = key_root / "easelect_development"
            development_root.mkdir(parents=True)
            (development_root / "runtime_environment.env").write_text(
                "DB_NAME=easelect\n",
                encoding="utf-8",
            )
            (development_root / "development_environment.env").write_text(
                "LOGIN_OTP_CODE=123456\n",
                encoding="utf-8",
            )
            (root / "dev_env_test_creds.txt").write_text(
                "TEST_ADMIN_USER=test_admin\nTEST_ADMIN_PASS=test-password\n",
                encoding="utf-8",
            )

            with (
                patch.object(db_task, "PROJECT_ROOT", temp_dir),
                patch.object(
                    db_task,
                    "TEST_CREDENTIALS_FILE",
                    str(root / "dev_env_test_creds.txt"),
                ),
                patch.dict(
                    os.environ,
                    {"EASELECT_KEY_ROOT": str(key_root)},
                    clear=True,
                ),
            ):
                credentials = db_task._load_credentials()

        self.assertEqual(credentials["TEST_ADMIN_USER"], "test_admin")
        self.assertEqual(credentials["TEST_ADMIN_PASS"], "test-password")
        self.assertEqual(credentials["LOGIN_OTP_CODE"], "123456")
        self.assertFalse(credentials[db_task._DEV_USERNAME_EXPLICIT_KEY])
        self.assertFalse(credentials[db_task._DEV_PASSWORD_EXPLICIT_KEY])
        self.assertFalse(credentials[db_task._OTP_EXPLICIT_KEY])

    def test_private_load_credentials_marks_legacy_process_overrides_as_explicit(self):
        with (
            patch.object(db_task, "PROJECT_ROOT", "/missing"),
            patch.object(db_task, "TEST_CREDENTIALS_FILE", "/missing/test_creds.txt"),
            patch.object(db_task, "_IS_EMBEDDED_EASELECT_CHECKOUT", True),
            patch.dict(os.environ, {
                "EASELECT_API_USERNAME": "remote_user",
                "EASELECT_API_PASSWORD": "remote-password",
                "EASELECT_API_OTP_CODE": "654321",
            }, clear=True),
        ):
            credentials = db_task._load_credentials()

        self.assertTrue(credentials[db_task._DEV_USERNAME_EXPLICIT_KEY])
        self.assertTrue(credentials[db_task._DEV_PASSWORD_EXPLICIT_KEY])
        self.assertTrue(credentials[db_task._OTP_EXPLICIT_KEY])

    def test_standalone_load_credentials_ignores_legacy_process_values(self):
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
                "DEV_USERNAME=standalone_user\n"
                "DEV_PASSWORD=standalone-password\n"
                "DEV_LOGIN_VERIFICATION_CODE=246810\n",
                encoding="utf-8",
            )
            with (
                patch.object(db_task, "PROJECT_ROOT", str(project_root)),
                patch.object(
                    db_task,
                    "TEST_CREDENTIALS_FILE",
                    str(protected_root / "dev_env_test_creds.txt"),
                ),
                patch.object(db_task, "_IS_EMBEDDED_EASELECT_CHECKOUT", False),
                patch.dict(
                    os.environ,
                    {
                        "EASELECT_API_USERNAME": "easelect_user",
                        "EASELECT_API_PASSWORD": "easelect-password",
                        "EASELECT_API_OTP_CODE": "111111",
                        "DEV_USERNAME": "ambient_dev_user",
                        "DEV_PASSWORD": "ambient-dev-password",
                        "DEV_LOGIN_VERIFICATION_CODE": "222222",
                        "LOGIN_OTP_CODE": "333333",
                    },
                    clear=True,
                ),
            ):
                credentials = db_task._load_credentials()

        self.assertEqual(credentials["DEV_USERNAME"], "standalone_user")
        self.assertEqual(credentials["DEV_PASSWORD"], "standalone-password")
        self.assertEqual(credentials["DEV_LOGIN_VERIFICATION_CODE"], "246810")
        self.assertFalse(credentials[db_task._DEV_USERNAME_EXPLICIT_KEY])
        self.assertFalse(credentials[db_task._DEV_PASSWORD_EXPLICIT_KEY])
        self.assertFalse(credentials[db_task._OTP_EXPLICIT_KEY])

    def test_standalone_load_credentials_accepts_filterest_process_values(self):
        with (
            patch.object(db_task, "PROJECT_ROOT", "/missing"),
            patch.object(db_task, "TEST_CREDENTIALS_FILE", "/missing/test_creds.txt"),
            patch.object(db_task, "_IS_EMBEDDED_EASELECT_CHECKOUT", False),
            patch.dict(
                os.environ,
                {
                    "FILTEREST_API_USERNAME": "filterest_user",
                    "FILTEREST_API_PASSWORD": "filterest-password",
                    "FILTEREST_API_OTP_CODE": "654321",
                    "EASELECT_API_USERNAME": "easelect_user",
                    "EASELECT_API_PASSWORD": "easelect-password",
                    "EASELECT_API_OTP_CODE": "111111",
                },
                clear=True,
            ),
        ):
            credentials = db_task._load_credentials()

        self.assertEqual(credentials["DEV_USERNAME"], "filterest_user")
        self.assertEqual(credentials["DEV_PASSWORD"], "filterest-password")
        self.assertEqual(credentials["DEV_LOGIN_VERIFICATION_CODE"], "654321")
        self.assertTrue(credentials[db_task._DEV_USERNAME_EXPLICIT_KEY])
        self.assertTrue(credentials[db_task._DEV_PASSWORD_EXPLICIT_KEY])
        self.assertTrue(credentials[db_task._OTP_EXPLICIT_KEY])

    def test_db_task_target_keeps_specific_override_and_gates_legacy_easelect(self):
        hostile_environment = {
            "EASELECT_API_BASE_URL": "https://localhost:8082",
        }
        with patch.object(db_task, "_IS_EMBEDDED_EASELECT_CHECKOUT", False):
            self.assertEqual(
                db_task._resolve_db_task_base_url(hostile_environment),
                "https://localhost:8100",
            )
            self.assertEqual(
                db_task._resolve_db_task_base_url({
                    **hostile_environment,
                    "FILTEREST_API_BASE_URL": "https://localhost:8199/",
                }),
                "https://localhost:8199",
            )
            self.assertEqual(
                db_task._resolve_db_task_base_url({
                    **hostile_environment,
                    "FILTEREST_API_BASE_URL": "https://localhost:8199",
                    "DB_TASK_BASE_URL": "https://localhost:8299/",
                }),
                "https://localhost:8299",
            )
        with patch.object(db_task, "_IS_EMBEDDED_EASELECT_CHECKOUT", True):
            self.assertEqual(
                db_task._resolve_db_task_base_url(hostile_environment),
                "https://localhost:8082",
            )

    def test_db_task_target_rejects_remote_http_and_malformed_urls(self):
        rejected_targets = (
            "http://tasks.example.com",
            "ftp://tasks.example.com",
            "https://user:password@tasks.example.com",
            "https://tasks.example.com?target=other",
            "https://tasks.example.com#other",
            "https://tasks.example.com:not-a-port",
        )

        for target in rejected_targets:
            with self.subTest(target=target), self.assertRaises(ValueError):
                db_task._validate_db_task_base_url(target)

    def test_db_task_target_keeps_explicit_plaintext_loopback_available(self):
        for target in (
            "http://localhost:8199",
            "http://127.0.0.1:8199/",
            "http://[::1]:8199",
        ):
            with self.subTest(target=target):
                self.assertEqual(
                    db_task._validate_db_task_base_url(target),
                    target.rstrip("/"),
                )

    def test_remote_http_is_rejected_before_curl_runs(self):
        with (
            patch.object(db_task, "BASE_URL", "http://credential-sink.example"),
            patch.object(db_task.subprocess, "run") as curl,
            self.assertRaisesRegex(ValueError, "require HTTPS"),
        ):
            db_task._curl_raw("/tmp/cookies", "GET", "/api/csrf-token")

        curl.assert_not_called()

    def test_db_task_target_normalization_preserves_path_prefix(self):
        calls = []

        def fake_run(command, **_kwargs):
            calls.append(command)
            return subprocess.CompletedProcess(
                command,
                0,
                stdout='HTTP/1.1 200 OK\r\n\r\n{"ok":true}',
                stderr="",
            )

        with (
            patch.object(
                db_task,
                "BASE_URL",
                "https://tasks.example.com/filterest/",
            ),
            patch.object(db_task.subprocess, "run", side_effect=fake_run),
        ):
            result = db_task._curl_raw(
                "/tmp/cookies",
                "GET",
                "/api/csrf-token",
            )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(
            calls[0][-1],
            "https://tasks.example.com/filterest/api/csrf-token",
        )

    def test_credential_attempts_prefer_explicit_then_e2e_admin(self):
        credentials = {
            "DEV_USERNAME": "explicit_user",
            "DEV_PASSWORD": "explicit-password",
            "TEST_ADMIN_USER": "test_admin",
            "TEST_ADMIN_PASS": "test-password",
        }

        attempts = db_task._credential_attempts(
            credentials,
            base_url="https://localhost:8082",
            environment={},
        )

        self.assertEqual(
            attempts,
            [
                ("explicit_user", "explicit-password"),
                ("test_admin", "test-password"),
            ],
        )

    def test_credential_attempts_use_e2e_admin_when_dev_credentials_are_absent(self):
        attempts = db_task._credential_attempts({
            "TEST_ADMIN_USER": "test_admin",
            "TEST_ADMIN_PASS": "test-password",
        }, base_url="https://127.0.0.1:8082", environment={})

        self.assertEqual(attempts[0], ("test_admin", "test-password"))

    def test_credential_attempts_reject_noncanonical_ipv6_loopback_url(self):
        attempts = db_task._credential_attempts({
            "TEST_ADMIN_USER": "test_admin",
            "TEST_ADMIN_PASS": "test-password",
        }, base_url="https://[::1]:8082/", environment={})

        self.assertEqual(attempts, [])

    def test_credential_attempts_reject_implicit_credentials_for_non_native_targets(self):
        credentials = {
            "TEST_ADMIN_USER": "test_admin",
            "TEST_ADMIN_PASS": "test-password",
        }
        unsafe_targets = [
            "https://example.com:8082",
            "https://localhost:8090",
            "http://localhost:8082",
            "https://localhost.evil.example:8082",
            "https://user:password@localhost:8082",
            "https://localhost:8082/api",
        ]

        for target in unsafe_targets:
            with self.subTest(target=target):
                self.assertEqual(
                    db_task._credential_attempts(
                        credentials,
                        base_url=target,
                        environment={},
                    ),
                    [],
                )

    def test_credential_attempts_keep_only_explicit_credentials_for_remote_target(self):
        attempts = db_task._credential_attempts({
            "DEV_USERNAME": "explicit_user",
            "DEV_PASSWORD": "explicit-password",
            db_task._DEV_USERNAME_EXPLICIT_KEY: True,
            db_task._DEV_PASSWORD_EXPLICIT_KEY: True,
            "TEST_ADMIN_USER": "test_admin",
            "TEST_ADMIN_PASS": "test-password",
        }, base_url="https://tasks.example.com", environment={})

        self.assertEqual(attempts, [("explicit_user", "explicit-password")])

    def test_credential_attempts_reject_file_dev_credentials_for_remote_target(self):
        attempts = db_task._credential_attempts({
            "DEV_USERNAME": "file_user",
            "DEV_PASSWORD": "file-password",
            db_task._DEV_USERNAME_EXPLICIT_KEY: False,
            db_task._DEV_PASSWORD_EXPLICIT_KEY: False,
        }, base_url="https://tasks.example.com", environment={})

        self.assertEqual(attempts, [])

    def test_credential_attempts_allow_file_dev_credentials_with_remote_opt_in(self):
        attempts = db_task._credential_attempts({
            "DEV_USERNAME": "file_user",
            "DEV_PASSWORD": "file-password",
            db_task._DEV_USERNAME_EXPLICIT_KEY: False,
            db_task._DEV_PASSWORD_EXPLICIT_KEY: False,
        }, base_url="https://tasks.example.com", environment={
            db_task.REMOTE_DEV_CREDENTIALS_ENV: "1",
        })

        self.assertEqual(attempts, [("file_user", "file-password")])

    def test_credential_attempts_require_narrow_opt_in_for_remote_test_admin(self):
        credentials = {
            "TEST_ADMIN_USER": "test_admin",
            "TEST_ADMIN_PASS": "test-password",
        }

        attempts = db_task._credential_attempts(
            credentials,
            base_url="https://tasks.example.com",
            environment={db_task.REMOTE_TEST_ADMIN_FALLBACK_ENV: "1"},
        )

        self.assertEqual(
            attempts,
            [("test_admin", "test-password")],
        )

    def test_remote_fallback_rejection_does_not_print_test_admin_secret(self):
        secret = "must-not-appear-in-output"
        stderr = io.StringIO()

        with (
            tempfile.TemporaryDirectory() as temp_dir,
            patch.object(db_task, "BASE_URL", "https://tasks.example.com"),
            patch.object(db_task, "_cached_session", None),
            patch.object(
                db_task,
                "_get_session_cookie_jar_path",
                return_value=str(Path(temp_dir) / "cookies.txt"),
            ),
            patch.object(db_task, "_is_session_valid", return_value=False),
            patch.object(
                db_task,
                "_load_credentials",
                return_value={
                    "TEST_ADMIN_USER": "test_admin",
                    "TEST_ADMIN_PASS": secret,
                },
            ),
            patch.dict(os.environ, {}, clear=True),
            contextlib.redirect_stderr(stderr),
            self.assertRaises(SystemExit) as raised,
        ):
            db_task._get_session()

        self.assertEqual(raised.exception.code, 1)
        self.assertIn("Cannot find usable DB task login credentials", stderr.getvalue())
        self.assertNotIn(secret, stderr.getvalue())

    def test_local_direct_db_shadow_requires_exact_native_https_origin(self):
        allowed = [
            "https://localhost:8082",
            "https://localhost:8082/",
            "https://127.0.0.1:8082",
        ]
        rejected = [
            "http://localhost:8082",
            "https://localhost:8090",
            "https://127.0.0.1:8082/api",
            "https://[::1]:8082",
            "https://localhost.evil.example:8082",
        ]

        for target in allowed:
            with self.subTest(target=target), patch.object(db_task, "BASE_URL", target):
                self.assertTrue(db_task._base_url_supports_local_direct_db_shadow())
        for target in rejected:
            with self.subTest(target=target), patch.object(db_task, "BASE_URL", target):
                self.assertFalse(db_task._base_url_supports_local_direct_db_shadow())

    def test_cookie_jar_is_owner_only_and_cleanup_removes_it(self):
        with (
            tempfile.TemporaryDirectory() as temp_dir,
            patch.object(db_task.tempfile, "gettempdir", return_value=temp_dir),
            patch.object(db_task, "_session_cookie_jar_path", None),
        ):
            jar = db_task._get_session_cookie_jar_path()
            self.assertEqual(stat.S_IMODE(os.stat(jar).st_mode), 0o600)
            db_task._cleanup_session_cookie_jar()
            self.assertFalse(os.path.exists(jar))

    def test_cookie_jar_reset_repairs_permissions_without_recreating_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            jar = Path(temp_dir) / "cookies.txt"
            jar.write_text("stale", encoding="utf-8")
            os.chmod(jar, 0o644)

            db_task._reset_session_cookie_jar(str(jar))

            self.assertEqual(jar.read_text(encoding="utf-8"), "")
            self.assertEqual(stat.S_IMODE(jar.stat().st_mode), 0o600)

    def test_api_encodes_query_params_and_sets_curl_timeouts(self):
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append((cmd, kwargs))
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout=api_curl_response(200, {"ok": True}),
                stderr="",
            )

        with patch.object(db_task, "_get_session", return_value=("/tmp/jar", "csrf-token")):
            with patch.object(db_task.subprocess, "run", side_effect=fake_run):
                result = db_task._api(
                    "GET",
                    "/api/example",
                    params={"title": "hello world", "status": "new"},
                )

        self.assertEqual(result, {"ok": True})
        cmd, kwargs = calls[0]
        self.assertIn("--connect-timeout", cmd)
        self.assertIn("--max-time", cmd)
        self.assertEqual(kwargs["timeout"], db_task.SUBPROCESS_TIMEOUT_SECONDS)
        self.assertEqual(
            cmd[-1],
            f"{db_task.BASE_URL}/api/example?title=hello+world&status=new",
        )
        self.assertIn("-k", cmd)

    def test_raw_curl_keeps_json_and_sensitive_headers_out_of_process_arguments(self):
        password = "raw-password-must-not-enter-argv"
        otp = "raw-otp-must-not-enter-argv"
        csrf = "raw-csrf-must-not-enter-argv"
        header_paths = []

        def fake_run(cmd, **kwargs):
            rendered_argv = "\n".join(cmd)
            for secret in (password, otp, csrf):
                self.assertNotIn(secret, rendered_argv)
            self.assertEqual(
                json.loads(kwargs["input"]),
                {"password": password, "otp_code": otp},
            )
            self.assertIn("--data-binary", cmd)
            self.assertEqual(cmd[cmd.index("--data-binary") + 1], "@-")

            header_reference = cmd[cmd.index("--header") + 1]
            self.assertTrue(header_reference.startswith("@"))
            header_path = Path(header_reference[1:])
            header_paths.append(header_path)
            self.assertEqual(stat.S_IMODE(header_path.stat().st_mode), 0o600)
            self.assertEqual(
                header_path.read_text(encoding="utf-8"),
                f"X-CSRF-Token: {csrf}\n",
            )
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout='HTTP/1.1 200 OK\r\n\r\n{"ok":true}',
                stderr="",
            )

        with patch.object(db_task.subprocess, "run", side_effect=fake_run):
            result = db_task._curl_raw(
                "/tmp/jar",
                "POST",
                "/api/login",
                {"password": password, "otp_code": otp},
                [f"X-CSRF-Token: {csrf}"],
            )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(header_paths), 1)
        self.assertFalse(header_paths[0].exists())

    def test_authenticated_api_keeps_csrf_and_json_out_of_process_arguments(self):
        csrf = "api-csrf-must-not-enter-argv"
        body_secret = "api-json-must-not-enter-argv"
        header_paths = []

        def fake_run(cmd, **kwargs):
            rendered_argv = "\n".join(cmd)
            self.assertNotIn(csrf, rendered_argv)
            self.assertNotIn(body_secret, rendered_argv)
            self.assertEqual(json.loads(kwargs["input"]), {"secret": body_secret})

            header_reference = cmd[cmd.index("--header") + 1]
            header_path = Path(header_reference.removeprefix("@"))
            header_paths.append(header_path)
            self.assertEqual(
                header_path.read_text(encoding="utf-8"),
                f"X-CSRF-Token: {csrf}\n",
            )
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout=api_curl_response(200, {"ok": True}),
                stderr="",
            )

        with (
            patch.object(db_task, "_get_session", return_value=("/tmp/jar", csrf)),
            patch.object(db_task.subprocess, "run", side_effect=fake_run),
        ):
            result = db_task._api(
                "POST",
                "/api/app/agent-tools/tasks",
                data={"secret": body_secret},
            )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(header_paths), 1)
        self.assertFalse(header_paths[0].exists())

    def test_native_curl_disables_hostile_ambient_proxies_on_both_ports(self):
        hostile_proxy_environment = {
            "HTTP_PROXY": "http://credential-sink.example:8080",
            "HTTPS_PROXY": "http://credential-sink.example:8443",
            "ALL_PROXY": "socks5://credential-sink.example:1080",
        }

        for port in (8082, 8100):
            target = f"https://localhost:{port}"
            with (
                self.subTest(target=target),
                patch.object(db_task, "LOCAL_NATIVE_PORT", port),
                patch.object(db_task, "BASE_URL", target),
                patch.dict(os.environ, hostile_proxy_environment, clear=True),
            ):
                command = db_task._curl_session_command("/tmp/cookies")

            self.assertIn("--noproxy", command)
            no_proxy_index = command.index("--noproxy")
            self.assertEqual(command[no_proxy_index + 1], "*")
            self.assertIn("-k", command)

    def test_remote_https_curl_keeps_normal_proxy_support(self):
        with patch.object(db_task, "BASE_URL", "https://tasks.example.com"):
            command = db_task._curl_session_command("/tmp/cookies")

        self.assertNotIn("--noproxy", command)

    def test_api_verifies_remote_tls_by_default(self):
        calls = []

        def fake_run(cmd, **_kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout=api_curl_response(200, {"ok": True}),
                stderr="",
            )

        with (
            patch.object(db_task, "BASE_URL", "https://tasks.example.com"),
            patch.object(db_task, "_get_session", return_value=("/tmp/jar", "csrf-token")),
            patch.object(db_task.subprocess, "run", side_effect=fake_run),
            patch.dict(os.environ, {}, clear=True),
        ):
            result = db_task._api("GET", "/api/example")

        self.assertEqual(result, {"ok": True})
        self.assertNotIn("-k", calls[0])

    def test_api_rejects_http_503_error_payload(self):
        response = subprocess.CompletedProcess(
            ["curl"],
            0,
            stdout=api_curl_response(
                503,
                {"code": 503, "error": "authentication state unavailable"},
            ),
            stderr="",
        )

        with (
            patch.object(db_task, "_get_session", return_value=("/tmp/jar", "csrf-token")),
            patch.object(db_task.subprocess, "run", return_value=response),
            contextlib.redirect_stderr(io.StringIO()) as stderr,
            self.assertRaises(SystemExit) as raised,
        ):
            db_task._api("GET", "/api/app/agent-tools/tasks")

        self.assertEqual(raised.exception.code, 1)
        self.assertIn("HTTP 503", stderr.getvalue())
        self.assertIn("authentication state unavailable", stderr.getvalue())

    def test_api_rejects_error_dict_even_when_http_status_is_200(self):
        response = subprocess.CompletedProcess(
            ["curl"],
            0,
            stdout=api_curl_response(
                200,
                {"code": 503, "error": "authentication state unavailable"},
            ),
            stderr="",
        )

        with (
            patch.object(db_task, "_get_session", return_value=("/tmp/jar", "csrf-token")),
            patch.object(db_task.subprocess, "run", return_value=response),
            contextlib.redirect_stderr(io.StringIO()) as stderr,
            self.assertRaises(SystemExit) as raised,
        ):
            db_task._api("GET", "/api/app/agent-tools/tasks")

        self.assertEqual(raised.exception.code, 1)
        self.assertIn("HTTP 503", stderr.getvalue())

    def test_api_fails_closed_without_valid_http_status_marker(self):
        for output in (
            'HTTP/1.1 503 Test Response\r\n\r\n{"error":"unavailable"}',
            'HTTP/1.1 503 Test Response\r\n\r\n{"error":"unavailable"}\n'
            f"{db_task.HTTP_STATUS_MARKER}invalid",
        ):
            with self.subTest(output=output):
                with (
                    patch.object(db_task, "_get_session", return_value=("/tmp/jar", "csrf-token")),
                    patch.object(
                        db_task.subprocess,
                        "run",
                        return_value=subprocess.CompletedProcess(
                            ["curl"], 0, stdout=output, stderr=""
                        ),
                    ),
                    contextlib.redirect_stderr(io.StringIO()) as stderr,
                    self.assertRaises(SystemExit),
                ):
                    db_task._api("GET", "/api/app/agent-tools/tasks")

                self.assertIn("failed closed", stderr.getvalue())

    def test_task_list_rejects_503_before_iterating_error_dict(self):
        response = subprocess.CompletedProcess(
            ["curl"],
            0,
            stdout=api_curl_response(
                503,
                {"code": 503, "error": "authentication state unavailable"},
            ),
            stderr="",
        )
        args = type("Args", (), {"direct_db": False})()

        with (
            patch.object(db_task, "_get_session", return_value=("/tmp/jar", "csrf-token")),
            patch.object(db_task.subprocess, "run", return_value=response),
            contextlib.redirect_stderr(io.StringIO()) as stderr,
            self.assertRaises(SystemExit),
        ):
            db_task._read_tasks(args)

        self.assertIn("HTTP 503", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_reconciled_show_rejects_503_before_direct_db_shadow(self):
        response = subprocess.CompletedProcess(
            ["curl"],
            0,
            stdout=api_curl_response(
                503,
                {"code": 503, "error": "authentication state unavailable"},
            ),
            stderr="",
        )

        with (
            patch.object(db_task, "_get_session", return_value=("/tmp/jar", "csrf-token")),
            patch.object(db_task.subprocess, "run", return_value=response),
            patch.object(db_task, "_direct_db_fetch_tasks") as direct_read,
            contextlib.redirect_stderr(io.StringIO()) as stderr,
            self.assertRaises(SystemExit),
        ):
            db_task._read_single_task_reconciled(834)

        direct_read.assert_not_called()
        self.assertIn("HTTP 503", stderr.getvalue())
        self.assertNotIn("drifted", stderr.getvalue())

    def test_todos_surface_503_instead_of_unexpected_response(self):
        response = subprocess.CompletedProcess(
            ["curl"],
            0,
            stdout=api_curl_response(
                503,
                {"code": 503, "error": "authentication state unavailable"},
            ),
            stderr="",
        )

        with (
            patch.object(db_task, "_read_task_or_exit", return_value={"id": 834}),
            patch.object(db_task, "_get_session", return_value=("/tmp/jar", "csrf-token")),
            patch.object(db_task.subprocess, "run", return_value=response),
            contextlib.redirect_stderr(io.StringIO()) as stderr,
            self.assertRaises(SystemExit),
        ):
            db_task._list_todos(834)

        self.assertIn("HTTP 503", stderr.getvalue())
        self.assertNotIn("Unexpected response", stderr.getvalue())

    def test_curl_insecure_tls_requires_exact_local_target_or_opt_in(self):
        self.assertTrue(db_task._curl_uses_insecure_tls(
            base_url="https://localhost:8082",
            environment={},
        ))
        self.assertFalse(db_task._curl_uses_insecure_tls(
            base_url="https://tasks.example.com",
            environment={},
        ))
        self.assertTrue(db_task._curl_uses_insecure_tls(
            base_url="https://tasks.example.com",
            environment={db_task.INSECURE_TLS_ENV: "1"},
        ))

    def test_curl_raw_returns_none_on_subprocess_timeout(self):
        with patch.object(db_task.subprocess, "run", side_effect=subprocess.TimeoutExpired("curl", 1)):
            result = db_task._curl_raw("/tmp/jar", "GET", "/api/example")

        self.assertIsNone(result)

    def test_direct_db_query_exits_on_subprocess_timeout(self):
        with patch.object(db_task.subprocess, "run", side_effect=subprocess.TimeoutExpired("db", 1)):
            with self.assertRaises(SystemExit) as raised:
                db_task._run_direct_db_query("SELECT 1")

        self.assertEqual(raised.exception.code, 1)

    def test_direct_db_query_reads_json_with_timeout(self):
        def fake_run(cmd, **kwargs):
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout=json.dumps([{"id": 1}]),
                stderr="",
            )

        with patch.object(db_task.subprocess, "run", side_effect=fake_run) as run_mock:
            result = db_task._run_direct_db_query("SELECT 1")

        self.assertEqual(result, [{"id": 1}])
        self.assertEqual(run_mock.call_args.kwargs["timeout"], db_task.DIRECT_DB_TIMEOUT_SECONDS)
        expected_prefix = [db_task.DATABASE_COMMAND]
        if db_task.DATABASE_SUBCOMMAND:
            expected_prefix.append(db_task.DATABASE_SUBCOMMAND)
        expected_prefix.append("--local")
        self.assertEqual(run_mock.call_args.args[0][:-1], expected_prefix)

    def test_reconciled_read_keeps_api_result_when_optional_db_driver_is_missing(self):
        api_task = {"id": 7, "title": "API task", "status": "in_progress"}

        with (
            patch.object(db_task, "_api", return_value=api_task),
            patch.object(db_task, "_base_url_supports_local_direct_db_shadow", return_value=True),
            patch.object(db_task, "_direct_db_shadow_available", return_value=False),
            patch.object(db_task, "_direct_db_fetch_tasks") as direct_read,
        ):
            result = db_task._read_single_task_reconciled(7)

        self.assertEqual(result, db_task._normalize_task_for_client(api_task))
        direct_read.assert_not_called()

    def test_reconciled_read_still_checks_available_local_db_shadow(self):
        api_task = {"id": 7, "title": "API task", "status": "in_progress"}

        with (
            patch.object(db_task, "_api", return_value=api_task),
            patch.object(db_task, "_base_url_supports_local_direct_db_shadow", return_value=True),
            patch.object(db_task, "_direct_db_shadow_available", return_value=True),
            patch.object(db_task, "_direct_db_fetch_tasks", return_value=api_task) as direct_read,
        ):
            result = db_task._read_single_task_reconciled(7)

        self.assertEqual(result, db_task._normalize_task_for_client(api_task))
        direct_read.assert_called_once_with(task_id=7)


if __name__ == "__main__":
    unittest.main()
