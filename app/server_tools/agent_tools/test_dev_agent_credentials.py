#!/usr/bin/env python3

from __future__ import annotations

import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
