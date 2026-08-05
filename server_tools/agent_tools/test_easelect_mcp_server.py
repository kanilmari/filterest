#!/usr/bin/env python3
# test_easelect_mcp_server.py
# Unit tests for the Easelect developer MCP stdio request handler.
# Bridges JSON-RPC protocol requests and a fake EaselectAPIClient.
# Exists to keep the first MCP wrapper stable without needing a live server.

import io
import json
import unittest

from server_tools.agent_tools import easelect_mcp_server


class FakeEaselectClient:
    def __init__(self, *, base_url=None):
        self.base_url = base_url
        self.logged_in = False
        self.calls = []

    def login(self):
        self.logged_in = True
        self.calls.append(("login", None))

    def get_lang_key(self, lang_key):
        self.calls.append(("get_lang_key", lang_key))
        return {
            "lang_key": lang_key,
            "fi": "Kortit",
            "en": "Cards",
            "ch": "卡片",
            "usage_explanation": "",
        }

    def upsert_lang_keys_many(self, updates, *, dry_run=False):
        self.calls.append(("upsert_lang_keys_many", updates, dry_run))
        return [
            {
                "lang_key": update["lang_key"],
                "dry_run": dry_run,
                "before": {},
                "after": update,
                "changed": True,
            }
            for update in updates
        ]

    def list_datasets(self):
        self.calls.append(("list_datasets", None))
        return ["app_services", "system_users"]

    def get_dataset_columns(self, dataset_name):
        self.calls.append(("get_dataset_columns", dataset_name))
        return [{"column_name": "title", "data_type": "text"}]

    def get_dataset_rows(self, dataset_name, **kwargs):
        self.calls.append(("get_dataset_rows", dataset_name, kwargs))
        return {"columns": ["id", "title"], "data": [{"id": 1, "title": "Demo"}]}

    def create_dataset(self, request_data):
        self.calls.append(("create_dataset", request_data))
        return {"text": "Taulu luotu onnistuneesti"}

    def modify_columns(self, request_data):
        self.calls.append(("modify_columns", request_data))
        return {"message": "Muutokset tallennettu onnistuneesti"}

    def drop_dataset(self, dataset_name):
        self.calls.append(("drop_dataset", dataset_name))
        return {"message": f"Taulu {dataset_name} poistettu"}

    def add_row(self, dataset_name, row_data):
        self.calls.append(("add_row", dataset_name, row_data))
        return {"message": "row added"}

    def update_row(self, dataset_name, row_id, updates):
        self.calls.append(("update_row", dataset_name, row_id, updates))
        return {"message": "Row updated successfully"}

    def delete_rows(self, dataset_name, ids):
        self.calls.append(("delete_rows", dataset_name, ids))
        return {"message": "Rivit poistettu onnistuneesti"}


class FakeClientFactory:
    def __init__(self):
        self.clients = []

    def __call__(self, *, base_url=None):
        client = FakeEaselectClient(base_url=base_url)
        self.clients.append(client)
        return client


class EaselectMCPServerTest(unittest.TestCase):
    def test_initialize_uses_project_mcp_protocol(self):
        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {},
        })

        self.assertEqual(response["result"]["protocolVersion"], "2025-03-26")
        self.assertEqual(response["result"]["serverInfo"]["name"], "easelect-dev-api")
        self.assertIn("upsert_lang_keys", response["result"]["instructions"])

    def test_tools_list_exposes_initial_lang_key_tools(self):
        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        })
        tool_names = [tool["name"] for tool in response["result"]["tools"]]

        self.assertEqual(tool_names, [
            "get_lang_key_api_handover",
            "list_datasets",
            "get_dataset_columns",
            "get_dataset_rows",
            "create_dataset",
            "modify_columns",
            "drop_dataset",
            "add_row",
            "update_row",
            "delete_rows",
            "get_lang_key",
            "upsert_lang_keys",
        ])

    def test_resources_expose_lang_key_handover(self):
        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 12,
            "method": "resources/list",
            "params": {},
        })

        resources = response["result"]["resources"]
        self.assertEqual(resources[0]["uri"], "easelect://developer/lang-key-api-handover")

        read_response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 13,
            "method": "resources/read",
            "params": {
                "uri": "easelect://developer/lang-key-api-handover",
            },
        })

        text = read_response["result"]["contents"][0]["text"]
        self.assertIn("upsert_lang_keys", text)
        self.assertIn("dry_run:true", text)

    def test_list_datasets_tool_routes_to_client(self):
        factory = FakeClientFactory()

        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 20,
            "method": "tools/call",
            "params": {
                "name": "list_datasets",
                "arguments": {},
            },
        }, client_factory=factory)

        self.assertFalse(response["result"]["isError"])
        self.assertEqual(response["result"]["structuredContent"], ["app_services", "system_users"])
        self.assertEqual(factory.clients[0].calls, [("list_datasets", None)])

    def test_create_dataset_tool_builds_canonical_payload(self):
        factory = FakeClientFactory()

        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 21,
            "method": "tools/call",
            "params": {
                "name": "create_dataset",
                "arguments": {
                    "dataset_name": "app_demo",
                    "columns": {
                        "id": "SERIAL",
                        "title": "TEXT",
                    },
                    "grant_users_read": True,
                },
            },
        }, client_factory=factory)

        self.assertFalse(response["result"]["isError"])
        self.assertEqual(factory.clients[0].calls[0][0], "create_dataset")
        self.assertEqual(factory.clients[0].calls[0][1]["dataset_name"], "app_demo")
        self.assertTrue(factory.clients[0].calls[0][1]["grant_users_read"])

    def test_modify_columns_requires_explicit_removal_flag(self):
        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 22,
            "method": "tools/call",
            "params": {
                "name": "modify_columns",
                "arguments": {
                    "dataset_name": "app_demo",
                    "removed_columns": ["old_column"],
                },
            },
        }, client_factory=FakeClientFactory())

        self.assertTrue(response["result"]["isError"])
        self.assertIn("allow_column_removal", response["result"]["content"][0]["text"])

    def test_drop_dataset_requires_matching_confirm_name(self):
        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 23,
            "method": "tools/call",
            "params": {
                "name": "drop_dataset",
                "arguments": {
                    "dataset_name": "app_demo",
                    "confirm_dataset_name": "other",
                },
            },
        }, client_factory=FakeClientFactory())

        self.assertTrue(response["result"]["isError"])
        self.assertIn("confirm_dataset_name must match", response["result"]["content"][0]["text"])

    def test_update_row_normalizes_mapping_updates(self):
        factory = FakeClientFactory()

        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 24,
            "method": "tools/call",
            "params": {
                "name": "update_row",
                "arguments": {
                    "dataset_name": "app_demo",
                    "id": 7,
                    "updates": {
                        "title": "Updated",
                    },
                },
            },
        }, client_factory=factory)

        self.assertFalse(response["result"]["isError"])
        self.assertEqual(factory.clients[0].calls, [
            ("update_row", "app_demo", 7, [{"column": "title", "value": "Updated"}]),
        ])

    def test_delete_rows_requires_confirm_true(self):
        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 25,
            "method": "tools/call",
            "params": {
                "name": "delete_rows",
                "arguments": {
                    "dataset_name": "app_demo",
                    "ids": [1],
                },
            },
        }, client_factory=FakeClientFactory())

        self.assertTrue(response["result"]["isError"])
        self.assertIn("confirm must be true", response["result"]["content"][0]["text"])

    def test_get_lang_key_tool_logs_in_and_returns_structured_content(self):
        factory = FakeClientFactory()

        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "get_lang_key",
                "arguments": {
                    "lang_key": "view_card",
                    "base_url": "https://example.test",
                },
            },
        }, client_factory=factory)

        self.assertFalse(response["result"]["isError"])
        self.assertEqual(response["result"]["structuredContent"]["en"], "Cards")
        self.assertEqual(factory.clients[0].base_url, "https://example.test")
        self.assertEqual(factory.clients[0].calls, [
            ("login", None),
            ("get_lang_key", "view_card"),
        ])

    def test_handover_tool_returns_minimal_next_chat_notice(self):
        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 31,
            "method": "tools/call",
            "params": {
                "name": "get_lang_key_api_handover",
                "arguments": {},
            },
        }, client_factory=FakeClientFactory())

        self.assertFalse(response["result"]["isError"])
        self.assertEqual(response["result"]["structuredContent"]["command"], "./easelect_mcp")
        self.assertIn("upsert_lang_keys", response["result"]["structuredContent"]["text"])

    def test_upsert_lang_keys_tool_routes_dry_run_updates(self):
        factory = FakeClientFactory()

        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "upsert_lang_keys",
                "arguments": {
                    "dry_run": True,
                    "updates": [
                        {
                            "lang_key": "view_article",
                            "fi": "Artikkeli",
                            "en": "Article",
                        }
                    ],
                },
            },
        }, client_factory=factory)

        self.assertFalse(response["result"]["isError"])
        self.assertTrue(response["result"]["structuredContent"][0]["dry_run"])
        self.assertEqual(factory.clients[0].calls, [
            (
                "upsert_lang_keys_many",
                [{"lang_key": "view_article", "fi": "Artikkeli", "en": "Article"}],
                True,
            ),
        ])

    def test_tool_validation_error_is_returned_as_mcp_tool_error(self):
        response = easelect_mcp_server.handle_request({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "get_lang_key",
                "arguments": {},
            },
        }, client_factory=FakeClientFactory())

        self.assertTrue(response["result"]["isError"])
        self.assertIn("lang_key is required", response["result"]["content"][0]["text"])

    def test_main_loop_handles_newline_delimited_json(self):
        stdin = io.StringIO(
            '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}\n'
            '{"jsonrpc":"2.0","id":2,"method":"resources/list","params":{}}\n'
        )
        stdout = io.StringIO()

        easelect_mcp_server.main_loop(
            stdin,
            stdout,
            client_factory=FakeClientFactory(),
        )
        responses = [
            json.loads(line)
            for line in stdout.getvalue().splitlines()
            if line.strip()
        ]

        self.assertEqual(responses[0]["result"], {})
        self.assertEqual(
            responses[1]["result"]["resources"][0]["uri"],
            "easelect://developer/lang-key-api-handover",
        )


if __name__ == "__main__":
    unittest.main()
