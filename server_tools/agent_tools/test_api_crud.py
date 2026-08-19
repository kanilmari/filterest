#!/usr/bin/env python3
# test_api_crud.py
# Unit tests for the Easelect CRUD API command-line wrapper.
# Bridges CLI argument parsing, fake API clients, and destructive command guards.
# Exists to keep api_crud behavior stable without changing live application data.

import argparse
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

from server_tools.agent_tools import api_crud


class FakeClient:
    def __init__(self, *, base_url=None):
        self.base_url = base_url
        self.calls = []
        self.row_pages = None

    def list_datasets(self):
        self.calls.append(("list_datasets",))
        return ["app_demo"]

    def get_dataset_columns(self, dataset_name):
        self.calls.append(("get_dataset_columns", dataset_name))
        return [{"column_name": "title", "data_type": "text"}]

    def get_dataset_rows(self, dataset_name, **kwargs):
        self.calls.append(("get_dataset_rows", dataset_name, kwargs))
        if self.row_pages is not None:
            offset = int(kwargs.get("offset") or 0)
            return {"data": self.row_pages.get(offset, [])}
        return {"data": [{"id": 1, "title": "Demo"}]}

    def create_dataset(self, request_data):
        self.calls.append(("create_dataset", request_data))
        return {"text": "created"}

    def modify_columns(self, request_data):
        self.calls.append(("modify_columns", request_data))
        return {"message": "modified"}

    def drop_dataset(self, dataset_name):
        self.calls.append(("drop_dataset", dataset_name))
        return {"message": "dropped"}

    def add_row(self, dataset_name, row_data):
        self.calls.append(("add_row", dataset_name, row_data))
        return {"message": "added"}

    def update_row(self, dataset_name, row_id, updates):
        self.calls.append(("update_row", dataset_name, row_id, updates))
        return {"message": "updated"}

    def delete_rows(self, dataset_name, ids):
        self.calls.append(("delete_rows", dataset_name, ids))
        return {"message": "deleted"}

    def rename_tree_node(self, item_id, item_type, new_name, translations):
        self.calls.append(("rename_tree_node", item_id, item_type, new_name, translations))
        return {"message": "renamed"}

    def set_registration_enabled(self, enabled):
        self.calls.append(("set_registration_enabled", enabled))
        return {"verified": True, "after": enabled}

    def list_user_authentication(self):
        self.calls.append(("list_user_authentication",))
        return [{"user_id": 42, "verification_method": "none"}]

    def set_user_authentication(self, user_id, verification_method, *, fixed_pin=None):
        self.calls.append(("set_user_authentication", user_id, verification_method, fixed_pin))
        return {"user_id": user_id, "verification_method": verification_method}


class API_CRUDTest(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.patcher = patch.object(api_crud, "EaselectAPIClient", return_value=self.client)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def run_main(self, argv):
        output = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(output), redirect_stderr(stderr):
            exit_code = api_crud.main(argv)
        return exit_code, output.getvalue()

    def test_list_datasets_prints_plain_names(self):
        exit_code, output = self.run_main(["list-datasets"])

        self.assertEqual(exit_code, 0)
        self.assertEqual(output.strip(), "app_demo")
        self.assertEqual(self.client.calls, [("list_datasets",)])

    def test_create_dataset_builds_columns_from_flags(self):
        exit_code, output = self.run_main([
            "create-dataset",
            "app_demo",
            "--column",
            "id=SERIAL",
            "--column",
            "title=TEXT",
            "--grant-users-read",
        ])

        self.assertEqual(exit_code, 0)
        payload = self.client.calls[0][1]
        self.assertEqual(payload["dataset_name"], "app_demo")
        self.assertEqual(payload["columns"], {"id": "SERIAL", "title": "TEXT"})
        self.assertTrue(payload["grant_users_read"])
        self.assertEqual(json.loads(output), {"text": "created"})

    def test_modify_columns_requires_removal_confirmation(self):
        exit_code, _ = self.run_main([
            "modify-columns",
            "app_demo",
            "--remove",
            "old_title",
        ])

        self.assertEqual(exit_code, 1)
        self.assertEqual(self.client.calls, [])

    def test_update_row_parses_jsonish_set_values(self):
        exit_code, _ = self.run_main([
            "update-row",
            "app_demo",
            "7",
            "--set",
            "published=true",
            "--set",
            "title=Hello",
        ])

        self.assertEqual(exit_code, 0)
        self.assertEqual(self.client.calls, [
            (
                "update_row",
                "app_demo",
                7,
                [
                    {"column": "published", "value": True},
                    {"column": "title", "value": "Hello"},
                ],
            ),
        ])

    def test_drop_dataset_requires_matching_confirmation(self):
        exit_code, _ = self.run_main([
            "drop-dataset",
            "app_demo",
            "--confirm-dataset-name",
            "other",
        ])

        self.assertEqual(exit_code, 1)
        self.assertEqual(self.client.calls, [])

    def test_delete_rows_requires_confirm(self):
        exit_code, _ = self.run_main([
            "delete-rows",
            "app_demo",
            "--id",
            "1",
        ])

        self.assertEqual(exit_code, 1)
        self.assertEqual(self.client.calls, [])

    def test_export_rows_pages_until_empty_result(self):
        self.client.row_pages = {
            0: [{"id": 1}, {"id": 2}],
            2: [{"id": 3}],
            3: [],
        }

        exit_code, output = self.run_main([
            "export-rows",
            "app_demo",
            "--sort-column",
            "id",
            "--sort-order",
            "ASC",
        ])

        self.assertEqual(exit_code, 0)
        payload = json.loads(output)
        self.assertEqual(payload["data"], [{"id": 1}, {"id": 2}, {"id": 3}])
        self.assertEqual(payload["exported_row_count"], 3)
        self.assertEqual(
            [call[2]["offset"] for call in self.client.calls],
            [0, 2, 3],
        )

    def test_rename_tree_node_requires_matching_name_confirmation(self):
        exit_code, output = self.run_main([
            "rename-tree-node",
            "10000",
            "folder",
            "fintravel",
            "--translations-json",
            '{"fi":"Fintravel","en":"Fintravel"}',
            "--confirm-new-name",
            "fintravel",
        ])

        self.assertEqual(exit_code, 0)
        self.assertEqual(self.client.calls[0][:4], ("rename_tree_node", 10000, "folder", "fintravel"))
        self.assertEqual(json.loads(output), {"message": "renamed"})

    def test_registration_requires_explicit_confirmation(self):
        exit_code, _ = self.run_main(["registration", "true"])
        self.assertEqual(exit_code, 1)
        self.assertEqual(self.client.calls, [])

        exit_code, output = self.run_main(["registration", "true", "--confirm"])
        self.assertEqual(exit_code, 0)
        self.assertEqual(self.client.calls, [("set_registration_enabled", True)])
        self.assertTrue(json.loads(output)["verified"])

    def test_user_auth_set_none_requires_exact_confirmation(self):
        exit_code, _ = self.run_main([
            "user-auth-set", "42", "none",
            "--confirm-user-id", "41",
            "--confirm-method", "none",
        ])
        self.assertEqual(exit_code, 1)
        self.assertEqual(self.client.calls, [])

        exit_code, output = self.run_main([
            "user-auth-set", "42", "none",
            "--confirm-user-id", "42",
            "--confirm-method", "none",
        ])
        self.assertEqual(exit_code, 0)
        self.assertEqual(
            self.client.calls,
            [("set_user_authentication", 42, "none", None)],
        )
        self.assertEqual(json.loads(output)["verification_method"], "none")


if __name__ == "__main__":
    unittest.main()
