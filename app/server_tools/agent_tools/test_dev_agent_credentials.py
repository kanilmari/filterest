#!/usr/bin/env python3

from __future__ import annotations

import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from . import dev_agent_credentials


class VerifiedAdminClient:
    instances = []

    def __init__(self, *, base_url, username, password, otp_code):
        self.base_url = base_url
        self.username = username
        self.password = password
        self.otp_code = otp_code
        self.logged_in = False
        self.last_verification_method = "fixed_pin"
        self.__class__.instances.append(self)

    def login(self):
        self.logged_in = True
        return {"authenticated": True}

    def request(self, method, path, *, data=None, csrf=False):
        if path == "/api/app/workline-observatory/board":
            return {"worklines": []}
        return {
            "users": [{
                "user_id": 42,
                "username": self.username,
                "enabled": True,
                "admin_group_member": True,
                "admin_access_allowed": True,
                "verification_method": "fixed_pin",
            }]
        }


class DevAgentCredentialsTest(unittest.TestCase):
    def setUp(self):
        VerifiedAdminClient.instances.clear()

    def test_standalone_test_credentials_use_installation_keys(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            installation_root = Path(temp_dir) / "filterest"
            application_root = installation_root / "app"
            application_root.mkdir(parents=True)
            expected = (
                installation_root
                / "keys/filterest_runtime/dev_env_test_creds.txt"
            )

            self.assertEqual(
                dev_agent_credentials._resolve_test_credential_file(
                    application_root=application_root,
                    environment={},
                    project_root=installation_root,
                ),
                expected,
            )

    def test_embedded_easelect_test_credentials_keep_outer_root_default(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            easelect_root = Path(temp_dir) / "easelect"
            application_root = easelect_root / "filterest/app"
            (easelect_root / ".git").mkdir(parents=True)
            (easelect_root / "VERSION_EASELECT").write_text("test\n", encoding="utf-8")
            application_root.mkdir(parents=True)

            self.assertEqual(
                dev_agent_credentials._resolve_test_credential_file(
                    application_root=application_root,
                    environment={},
                    project_root=easelect_root,
                ),
                easelect_root / "dev_env_test_creds.txt",
            )

    def test_explicit_test_credential_path_is_normalized_without_chmod(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            application_root = root / "filterest/app"
            application_root.mkdir(parents=True)
            protected_parent = root / "protected"
            protected_parent.mkdir(mode=0o755)
            protected_parent.chmod(0o755)
            credential_file = protected_parent / "dev_env_test_creds.txt"
            credential_file.write_text(
                "TEST_ADMIN_USER=test-admin\nTEST_ADMIN_PASS=test-password\n",
                encoding="utf-8",
            )
            configured = protected_parent / "temporary/../dev_env_test_creds.txt"

            resolved = dev_agent_credentials._resolve_test_credential_file(
                application_root=application_root,
                environment={"FILTEREST_TEST_CREDENTIAL_FILE": str(configured)},
                project_root=root / "filterest",
            )

            self.assertEqual(resolved, credential_file)
            self.assertEqual(
                dev_agent_credentials._load_test_credentials(resolved),
                {
                    "TEST_ADMIN_USER": "test-admin",
                    "TEST_ADMIN_PASS": "test-password",
                },
            )
            self.assertEqual(stat.S_IMODE(protected_parent.stat().st_mode), 0o755)

    def test_test_credential_path_inside_app_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            application_root = Path(temp_dir) / "filterest/app"
            application_root.mkdir(parents=True)
            configured = application_root / "dev_env_test_creds.txt"

            with self.assertRaisesRegex(
                dev_agent_credentials.AgentCredentialConfigurationError,
                "outside immutable app source",
            ):
                dev_agent_credentials._resolve_test_credential_file(
                    application_root=application_root,
                    environment={"FILTEREST_TEST_CREDENTIAL_FILE": str(configured)},
                    project_root=application_root.parent,
                )

    def test_parent_symlink_into_app_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            application_root = root / "filterest/app"
            application_root.mkdir(parents=True)
            linked_parent = root / "linked-parent"
            linked_parent.symlink_to(application_root, target_is_directory=True)

            with self.assertRaisesRegex(
                dev_agent_credentials.AgentCredentialConfigurationError,
                "outside immutable app source",
            ):
                dev_agent_credentials._resolve_test_credential_file(
                    application_root=application_root,
                    environment={
                        "FILTEREST_TEST_CREDENTIAL_FILE": str(
                            linked_parent / "dev_env_test_creds.txt"
                        )
                    },
                    project_root=application_root.parent,
                )

    def test_symlinked_test_credential_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            application_root = root / "filterest/app"
            application_root.mkdir(parents=True)
            target = root / "external-target.txt"
            target.write_text("unchanged\n", encoding="utf-8")
            credential_file = root / "dev_env_test_creds.txt"
            credential_file.symlink_to(target)

            with self.assertRaisesRegex(
                dev_agent_credentials.AgentCredentialConfigurationError,
                "must not be a symlink",
            ):
                dev_agent_credentials._resolve_test_credential_file(
                    application_root=application_root,
                    environment={
                        "FILTEREST_TEST_CREDENTIAL_FILE": str(credential_file)
                    },
                    project_root=application_root.parent,
                )
            self.assertEqual(target.read_text(encoding="utf-8"), "unchanged\n")

    def test_native_target_validation_is_structural_for_standalone(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            installation_root = Path(temp_dir) / "filterest"
            application_root = installation_root / "app"
            application_root.mkdir(parents=True)
            (application_root / "go.mod").write_text(
                "module example.invalid/filterest\n",
                encoding="utf-8",
            )
            (application_root / "VERSION_APP").write_text(
                "1.0.0\n",
                encoding="utf-8",
            )

            self.assertEqual(
                dev_agent_credentials._require_native_credential_target(
                    "https://127.0.0.1:8100/",
                    project_root=installation_root,
                ),
                "https://127.0.0.1:8100",
            )
            with self.assertRaisesRegex(
                dev_agent_credentials.AgentCredentialConfigurationError,
                "port 8100",
            ):
                dev_agent_credentials._require_native_credential_target(
                    "https://localhost:8082",
                    project_root=installation_root,
                )

    def test_remote_target_is_rejected_before_prompts_files_or_network(self):
        username_reader = Mock(side_effect=AssertionError("username prompt used"))
        secret_reader = Mock(side_effect=AssertionError("secret prompt used"))
        client_factory = Mock(side_effect=AssertionError("network client used"))

        with (
            patch.object(
                dev_agent_credentials,
                "_resolve_test_credential_file",
                side_effect=AssertionError("credential file resolved"),
            ) as credential_resolver,
            patch.object(
                dev_agent_credentials,
                "load_project_env",
                side_effect=AssertionError("protected environment read"),
            ) as environment_loader,
            self.assertRaisesRegex(
                dev_agent_credentials.AgentCredentialConfigurationError,
                "exact native loopback service",
            ),
        ):
            dev_agent_credentials.configure_agent_credentials(
                base_url="https://credential-sink.example",
                client_factory=client_factory,
                username_reader=username_reader,
                secret_reader=secret_reader,
            )

        username_reader.assert_not_called()
        secret_reader.assert_not_called()
        client_factory.assert_not_called()
        credential_resolver.assert_not_called()
        environment_loader.assert_not_called()

    def test_persist_replaces_credentials_and_preserves_unrelated_values(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            env_file = Path(temp_dir) / "development_environment.env"
            env_file.write_text(
                "ENVIRONMENT_TYPE=dev\nDEV_USERNAME=old\nDEV_PASSWORD=old-password-value\n",
                encoding="utf-8",
            )
            dev_agent_credentials.persist_agent_credentials(
                env_file,
                username="agent_admin",
                password="new $ecret password!",
                pin="246810",
            )
            content = env_file.read_text(encoding="utf-8")

            self.assertIn("ENVIRONMENT_TYPE=dev", content)
            self.assertIn("DEV_USERNAME='agent_admin'", content)
            self.assertIn("DEV_PASSWORD='new $ecret password!'", content)
            self.assertIn("DEV_LOGIN_VERIFICATION_CODE='246810'", content)
            self.assertEqual(stat.S_IMODE(env_file.stat().st_mode), 0o600)

    def test_configure_verifies_fixed_pin_admin_before_persisting(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            env_file = Path(temp_dir) / "development_environment.env"
            env_file.write_text("ENVIRONMENT_TYPE=dev\n", encoding="utf-8")
            secrets = iter([
                "Strong password 123!",
                "Strong password 123!",
                "246810",
                "246810",
            ])
            with patch("builtins.print"):
                result = dev_agent_credentials.configure_agent_credentials(
                    client_factory=VerifiedAdminClient,
                    username_reader=lambda _prompt: "agent_admin",
                    secret_reader=lambda _prompt: next(secrets),
                    env_file=env_file,
                )

            client = VerifiedAdminClient.instances[0]
            self.assertTrue(client.logged_in)
            self.assertEqual(client.otp_code, "246810")
            self.assertEqual(result["username"], "agent_admin")
            self.assertIn("DEV_USERNAME='agent_admin'", env_file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
