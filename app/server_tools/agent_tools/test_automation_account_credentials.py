#!/usr/bin/env python3
# test_automation_account_credentials.py
# Verifies protected file handling and fail-closed automation credential orchestration.
# Bridges mocked manager/API readback with the public credential CLI contract.
# Exists so failures cannot publish an unverified secret or silently rotate a working account.

from __future__ import annotations

import contextlib
import io
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from . import automation_account_credentials as credential_module
from .automation_account_credentials import (
    AUTOMATION_ACCOUNT_USERNAME,
    AutomationCredentialError,
    AutomationCredentialResult,
    ensure_automation_credentials,
    load_automation_credentials,
    load_manager_token,
    main,
)


MANAGER_TOKEN = "test-manager-token-with-more-than-thirty-two-characters"
TEST_PASSWORD = "generated-automation-password-1234567890"


def ready_record(*, created: bool, generation: int = 1) -> dict[str, object]:
    return {
        "exists": True,
        "ready": True,
        "created": created,
        "user_id": 44,
        "username": AUTOMATION_ACCOUNT_USERNAME,
        "enabled": True,
        "admin_group_member": True,
        "admin_access_allowed": True,
        "privileged": False,
        "verification_method": "none",
        "authentication_generation": generation,
    }


class FakeAPIClient:
    passwords: list[str] = []

    def __init__(self, *, password: str, **_kwargs) -> None:
        self.password = password
        self.last_verification_method = None

    def login(self) -> dict[str, object]:
        self.__class__.passwords.append(self.password)
        self.last_verification_method = "none"
        return {"authenticated": True}


class AutomationAccountCredentialsTest(unittest.TestCase):
    def setUp(self) -> None:
        FakeAPIClient.passwords = []
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        os.chmod(self.root, 0o700)
        self.manager_environment = self.root / "runtime.env"
        self.manager_environment.write_text(
            f"EASELECT_SYSTEM_MANAGER_TOKEN={MANAGER_TOKEN}\n",
            encoding="utf-8",
        )
        os.chmod(self.manager_environment, 0o600)
        self.credentials_file = self.root / "filterest-agent.env"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_create_writes_owner_only_standard_credentials_after_readback(self) -> None:
        manager_calls: list[tuple[str, dict[str, str] | None]] = []

        def manager_request(_base_url, _token, method, *, payload=None):
            manager_calls.append((method, payload))
            return ready_record(created=method == "POST")

        with (
            patch.object(credential_module, "_manager_request", side_effect=manager_request),
            patch.object(credential_module, "EaselectAPIClient", FakeAPIClient),
        ):
            result = ensure_automation_credentials(
                api_base_url="https://filterest.example",
                manager_base_url="http://127.0.0.1:18182",
                manager_environment_file=self.manager_environment,
                credentials_file=self.credentials_file,
                password_factory=lambda _size: TEST_PASSWORD,
            )

        self.assertEqual(result.action, "created")
        self.assertEqual(manager_calls, [
            ("POST", {"password": TEST_PASSWORD}),
            ("GET", None),
        ])
        self.assertEqual(FakeAPIClient.passwords, [TEST_PASSWORD])
        self.assertEqual(stat.S_IMODE(self.credentials_file.stat().st_mode), 0o600)
        stored = load_automation_credentials(self.credentials_file)
        self.assertEqual(stored["FILTEREST_API_BASE_URL"], "https://filterest.example")
        self.assertEqual(stored["FILTEREST_API_USERNAME"], AUTOMATION_ACCOUNT_USERNAME)
        self.assertEqual(stored["FILTEREST_API_PASSWORD"], TEST_PASSWORD)

    def test_manager_failure_does_not_publish_credential_file(self) -> None:
        with patch.object(
            credential_module,
            "_manager_request",
            side_effect=AutomationCredentialError("system-manager automation API returned HTTP 500"),
        ):
            with self.assertRaisesRegex(AutomationCredentialError, "HTTP 500"):
                ensure_automation_credentials(
                    api_base_url="https://filterest.example",
                    manager_base_url="http://127.0.0.1:18182",
                    manager_environment_file=self.manager_environment,
                    credentials_file=self.credentials_file,
                    password_factory=lambda _size: TEST_PASSWORD,
                )
        self.assertFalse(self.credentials_file.exists())

    def test_existing_verified_credential_is_not_rotated_without_flag(self) -> None:
        self.credentials_file.write_text(
            "FILTEREST_API_BASE_URL=https://filterest.example\n"
            f"FILTEREST_API_USERNAME={AUTOMATION_ACCOUNT_USERNAME}\n"
            f"FILTEREST_API_PASSWORD={TEST_PASSWORD}\n",
            encoding="utf-8",
        )
        os.chmod(self.credentials_file, 0o600)
        manager_calls: list[str] = []

        def manager_request(_base_url, _token, method, *, payload=None):
            self.assertIsNone(payload)
            manager_calls.append(method)
            return ready_record(created=False, generation=5)

        with (
            patch.object(credential_module, "_manager_request", side_effect=manager_request),
            patch.object(credential_module, "EaselectAPIClient", FakeAPIClient),
        ):
            result = ensure_automation_credentials(
                api_base_url="https://filterest.example",
                manager_base_url="http://127.0.0.1:18182",
                manager_environment_file=self.manager_environment,
                credentials_file=self.credentials_file,
            )

        self.assertEqual(result.action, "unchanged")
        self.assertEqual(manager_calls, ["GET"])
        self.assertEqual(FakeAPIClient.passwords, [TEST_PASSWORD])

    def test_existing_file_for_another_target_fails_before_network(self) -> None:
        self.credentials_file.write_text(
            "FILTEREST_API_BASE_URL=https://another.example\n"
            f"FILTEREST_API_USERNAME={AUTOMATION_ACCOUNT_USERNAME}\n"
            f"FILTEREST_API_PASSWORD={TEST_PASSWORD}\n",
            encoding="utf-8",
        )
        os.chmod(self.credentials_file, 0o600)
        with patch.object(credential_module, "_manager_request") as manager_request:
            with self.assertRaisesRegex(AutomationCredentialError, "another API target"):
                ensure_automation_credentials(
                    api_base_url="https://filterest.example",
                    manager_base_url="http://127.0.0.1:18182",
                    manager_environment_file=self.manager_environment,
                    credentials_file=self.credentials_file,
                )
            manager_request.assert_not_called()

    def test_secret_inputs_require_owner_only_files(self) -> None:
        os.chmod(self.manager_environment, 0o644)
        with self.assertRaisesRegex(AutomationCredentialError, "0600"):
            load_manager_token(self.manager_environment)

    def test_targets_must_be_clean_origins(self) -> None:
        with self.assertRaisesRegex(AutomationCredentialError, "must not contain a path"):
            ensure_automation_credentials(
                api_base_url="https://filterest.example/not-an-origin",
                manager_base_url="http://127.0.0.1:18182",
                manager_environment_file=self.manager_environment,
                credentials_file=self.credentials_file,
            )

    def test_main_reports_only_non_secret_result(self) -> None:
        stdout = io.StringIO()
        result = AutomationCredentialResult(
            action="created",
            base_url="https://filterest.example",
            username=AUTOMATION_ACCOUNT_USERNAME,
            user_id=44,
            authentication_generation=1,
        )
        with (
            patch.object(credential_module, "ensure_automation_credentials", return_value=result),
            contextlib.redirect_stdout(stdout),
        ):
            exit_code = main([
                "--api-base-url", "https://filterest.example",
                "--manager-environment-file", str(self.manager_environment),
                "--credentials-file", str(self.credentials_file),
            ])
        self.assertEqual(exit_code, 0)
        self.assertNotIn(TEST_PASSWORD, stdout.getvalue())
        self.assertIn("action=created", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
