#!/usr/bin/env python3
# test_api_asset_linking.py
# Unit tests for the Easelect asset-linking API command-line wrapper.
# Bridges CLI argument parsing, fake API clients, and read-only status calls.
# Exists to keep demo media readiness export tooling stable without live data.

import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

try:
    from filterest.app.server_tools.agent_tools import api_asset_linking
except ModuleNotFoundError:
    from server_tools.agent_tools import api_asset_linking


class FakeClient:
    def __init__(self, *, base_url=None):
        self.base_url = base_url
        self.calls = []

    def login(self):
        self.calls.append(("login",))

    def request(self, method, path, *, query=None):
        self.calls.append(("request", method, path, query or {}))
        return {
            "image_asset_linkings": [
                {"parent_table": "tiketit", "enabled": True}
            ],
            "attachment_asset_linkings": [],
        }


class APIAssetLinkingTest(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.patcher = patch.object(api_asset_linking, "EaselectAPIClient", return_value=self.client)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def run_main(self, argv):
        output = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(output), redirect_stderr(stderr):
            exit_code = api_asset_linking.main(argv)
        return exit_code, output.getvalue(), stderr.getvalue()

    def test_status_fetches_all_asset_linking_rows(self):
        exit_code, output, stderr = self.run_main(["status"])

        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(
            self.client.calls,
            [
                ("login",),
                ("request", "GET", "/api/asset-linking/status", {}),
            ],
        )
        self.assertEqual(json.loads(output)["image_asset_linkings"][0]["parent_table"], "tiketit")

    def test_status_accepts_table_filter(self):
        exit_code, _, _ = self.run_main(["status", "--table", "tiketit"])

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            self.client.calls[-1],
            ("request", "GET", "/api/asset-linking/status", {"table": "tiketit"}),
        )


if __name__ == "__main__":
    unittest.main()
