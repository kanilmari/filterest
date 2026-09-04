#!/usr/bin/env python3
# test_api_lang.py
# Verifies language-key batch validation, database checks, and write readback.
# Bridges the API-backed command line tool with deterministic failure exit codes.
# Exists so new UI copy cannot silently ship with absent or partial translations.

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

try:
    from filterest.app.server_tools.agent_tools import api_lang
    from filterest.app.server_tools.agent_tools.easelect_api_client import (
        EaselectAPIClient,
        EaselectAPIError,
    )
except ModuleNotFoundError:
    from server_tools.agent_tools import api_lang
    from server_tools.agent_tools.easelect_api_client import (
        EaselectAPIClient,
        EaselectAPIError,
    )


COMPLETE_KEY = {
    "exists": True,
    "fi": "Tallenna",
    "en": "Save",
    "ch": "保存",
    "yue": "儲存",
    "usage_explanation": "Button that saves the edited form.",
}


class FakeClient:
    responses = {}
    instances = []

    def __init__(self, *, base_url=None):
        self.base_url = base_url
        self.calls = []
        self.__class__.instances.append(self)

    def login(self):
        self.calls.append(("login",))

    def get_lang_key(self, lang_key):
        self.calls.append(("get", lang_key))
        return dict(self.__class__.responses.get(lang_key, {"exists": False}))

    def upsert_lang_keys_many(self, updates, *, dry_run=False):
        self.calls.append(("upsert_many", updates, dry_run))
        return [
            {
                "lang_key": update["lang_key"],
                "dry_run": dry_run,
                "before": {},
                "after": update,
            }
            for update in updates
        ]


class APILangTest(unittest.TestCase):
    def setUp(self):
        FakeClient.responses = {}
        FakeClient.instances = []
        self.patcher = patch.object(api_lang, "EaselectAPIClient", FakeClient)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def run_main(self, argv):
        output = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(output), redirect_stderr(stderr):
            exit_code = api_lang.main(argv)
        return exit_code, output.getvalue(), stderr.getvalue()

    def write_json(self, payload):
        handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", delete=False)
        with handle:
            json.dump(payload, handle, ensure_ascii=False)
        self.addCleanup(Path(handle.name).unlink, missing_ok=True)
        return handle.name

    def test_check_returns_success_only_for_a_complete_existing_key(self):
        FakeClient.responses["save"] = COMPLETE_KEY

        exit_code, output, stderr = self.run_main(["check", "save"])

        self.assertEqual(exit_code, 0)
        self.assertEqual(output, "OK save\n")
        self.assertEqual(stderr, "")
        self.assertEqual(FakeClient.instances[0].calls, [("login",), ("get", "save")])

    def test_check_fails_for_a_missing_key_with_an_actionable_reason(self):
        exit_code, output, stderr = self.run_main(["check", "missing_key"])

        self.assertEqual(exit_code, 1)
        self.assertIn("not registered", output)
        self.assertIn("missing: fi, en, ch, yue, usage_explanation", output)
        self.assertEqual(stderr, "")

    def test_check_many_compares_the_expected_reviewed_values(self):
        FakeClient.responses["save"] = {**COMPLETE_KEY, "en": "Store"}
        path = self.write_json({"save": {key: value for key, value in COMPLETE_KEY.items() if key != "exists"}})

        exit_code, output, _ = self.run_main(["check-many", "--file", path])

        self.assertEqual(exit_code, 1)
        self.assertIn("readback mismatch: en", output)

    def test_upsert_many_can_require_complete_reviewed_entries_before_login(self):
        path = self.write_json({"save": {"fi": "Tallenna", "en": "Save"}})

        exit_code, _, stderr = self.run_main([
            "upsert-many",
            "--file",
            path,
            "--require-complete",
            "--dry-run",
        ])

        self.assertEqual(exit_code, 1)
        self.assertIn("missing required field(s): ch, yue, usage_explanation", stderr)
        self.assertEqual(FakeClient.instances, [])

    def test_object_batch_rejects_nested_identity_and_non_string_values(self):
        authored_values = {key: value for key, value in COMPLETE_KEY.items() if key != "exists"}
        nested_path = self.write_json({"save": {"lang_key": "delete", **authored_values}})
        typed_path = self.write_json({"save": {**authored_values, "fi": 123}})

        nested_exit, _, nested_stderr = self.run_main([
            "upsert-many", "--file", nested_path, "--dry-run"
        ])
        typed_exit, _, typed_stderr = self.run_main([
            "upsert-many", "--file", typed_path, "--dry-run"
        ])

        self.assertEqual(nested_exit, 1)
        self.assertIn("must not repeat their identity", nested_stderr)
        self.assertEqual(typed_exit, 1)
        self.assertIn("field(s) must be strings: fi", typed_stderr)
        self.assertEqual(FakeClient.instances, [])


class LanguageKeyReadbackTest(unittest.TestCase):
    def test_shared_client_sends_only_the_requested_patch_fields(self):
        client = object.__new__(EaselectAPIClient)
        client.get_lang_key = Mock(side_effect=[
            COMPLETE_KEY,
            {**COMPLETE_KEY, "en": "Store"},
        ])
        client.request = Mock(return_value={"success": True})

        client.upsert_lang_key({"lang_key": "save", "en": "Store"})

        client.request.assert_called_once_with(
            "POST",
            "/api/admin/lang-key",
            data={"lang_key": "save", "en": "Store"},
            csrf=True,
        )

    def test_shared_client_rejects_a_success_response_with_wrong_readback(self):
        client = object.__new__(EaselectAPIClient)
        client.get_lang_key = Mock(side_effect=[
            {"exists": False, "fi": "", "en": "", "ch": "", "yue": "", "usage_explanation": ""},
            {"exists": True, "fi": "Tallenna", "en": "Store", "ch": "保存", "yue": "儲存", "usage_explanation": "Button."},
        ])
        client.request = Mock(return_value={"success": True})

        with self.assertRaisesRegex(EaselectAPIError, "readback mismatch.*en"):
            client.upsert_lang_key({
                "lang_key": "save",
                "fi": "Tallenna",
                "en": "Save",
                "ch": "保存",
                "yue": "儲存",
                "usage_explanation": "Button.",
            })


if __name__ == "__main__":
    unittest.main()
