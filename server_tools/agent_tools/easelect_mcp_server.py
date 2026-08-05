#!/usr/bin/env python3
# easelect_mcp_server.py
# Minimal MCP stdio server backed by the shared Easelect HTTP API client.
# Bridges MCP JSON-RPC tool calls and easelect_api_client.py developer actions.
# Exists so agents can use app-validated APIs instead of direct database writes.

import json
import sys

try:
    from .easelect_api_client import EaselectAPIClient, EaselectAPIError
except ImportError:
    from easelect_api_client import EaselectAPIClient, EaselectAPIError


MCP_PROTOCOL_VERSION = "2025-03-26"
SERVER_INFO = {
    "name": "easelect-dev-api",
    "version": "0.1.0",
}
LANG_KEY_HANDOVER_RESOURCE_URI = "easelect://developer/lang-key-api-handover"
SERVER_INSTRUCTIONS = (
    "For Easelect language-key changes, use get_lang_key and upsert_lang_keys. "
    "Run upsert_lang_keys with dry_run=true first, then repeat with dry_run=false "
    "to write through the application API. Never update system_lang_keys with direct SQL."
)
LANG_KEY_HANDOVER_TEXT = """# Easelect MCP Language-Key API Handover

Command: `./easelect_mcp`
Default app URL: `https://localhost:8082`
Override URL per call with `base_url`, or set `EASELECT_API_BASE_URL`.

Use these MCP tools for language keys:
- `get_lang_key` with `{"lang_key":"view_card"}`
- `upsert_lang_keys` with `{"dry_run":true,"updates":[{"lang_key":"view_card","fi":"Kortit","en":"Cards"}]}`
- repeat `upsert_lang_keys` with `dry_run:false` after the preview looks correct

Rules:
- This path logs in to the dev app, fetches CSRF, and calls `/api/update-lang-key`.
- Do not write `system_lang_keys` with direct SQL.
- Omitted fields are preserved by reading the existing key before writing.
- `fi`, `en`, `ch`, `yue`, and `usage_explanation` are accepted update fields.

Minimal next-chat notice:
Use repo MCP command `./easelect_mcp`; for language keys call `get_lang_key` then
`upsert_lang_keys` with `dry_run:true`, then `dry_run:false`.
"""


RESOURCE_DEFINITIONS = [
    {
        "uri": LANG_KEY_HANDOVER_RESOURCE_URI,
        "name": "lang-key-api-handover",
        "description": "Minimal handover for changing Easelect language keys through the app API.",
        "mimeType": "text/markdown",
    },
]


TOOL_DEFINITIONS = [
    {
        "name": "get_lang_key_api_handover",
        "description": (
            "Return the minimal handover for changing language keys through this MCP server."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "list_datasets",
        "description": "List dataset names through the Easelect application API.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "base_url": {
                    "type": "string",
                    "description": "Optional Easelect base URL. Defaults to https://localhost:8082.",
                },
            },
        },
    },
    {
        "name": "get_dataset_columns",
        "description": "Read current column metadata for one dataset.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string"},
                "base_url": {"type": "string"},
            },
            "required": ["dataset_name"],
        },
    },
    {
        "name": "get_dataset_rows",
        "description": "Read one page of dataset rows through /api/get-results.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string"},
                "offset": {"type": "integer"},
                "sort_column": {"type": "string"},
                "sort_order": {"type": "string", "enum": ["ASC", "DESC"]},
                "filters": {"type": "object", "additionalProperties": True},
                "row_count": {"type": "integer"},
                "include_card_support": {"type": "boolean"},
                "include_map_support": {"type": "boolean"},
                "base_url": {"type": "string"},
            },
            "required": ["dataset_name"],
        },
    },
    {
        "name": "create_dataset",
        "description": "Create a dataset through /api/create_dataset.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string"},
                "columns": {
                    "type": "object",
                    "description": "Column-name to SQL type map, for example {\"id\":\"SERIAL\",\"title\":\"TEXT\"}.",
                    "additionalProperties": {"type": "string"},
                },
                "foreign_keys": {"type": "array", "items": {"type": "object"}},
                "grant_users_read": {"type": "boolean"},
                "grant_guests_read": {"type": "boolean"},
                "prevent_deletion": {"type": "boolean"},
                "folder_id": {"type": "integer"},
                "create_folder": {"type": "object"},
                "request": {
                    "type": "object",
                    "description": "Optional raw /api/create_dataset payload. Overrides the high-level fields.",
                },
                "base_url": {"type": "string"},
            },
            "required": ["dataset_name", "columns"],
        },
    },
    {
        "name": "modify_columns",
        "description": "Add, rename, change type, or remove columns through /api/modify-columns.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string"},
                "added_columns": {"type": "array", "items": {"type": "object"}},
                "modified_columns": {"type": "array", "items": {"type": "object"}},
                "removed_columns": {"type": "array", "items": {"type": "string"}},
                "allow_column_removal": {
                    "type": "boolean",
                    "description": "Must be true when removed_columns is non-empty.",
                },
                "request": {
                    "type": "object",
                    "description": "Optional raw /api/modify-columns payload. Overrides the high-level fields.",
                },
                "base_url": {"type": "string"},
            },
            "required": ["dataset_name"],
        },
    },
    {
        "name": "drop_dataset",
        "description": "Drop a dataset through /api/drop-dataset. Requires confirm_dataset_name to match.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string"},
                "confirm_dataset_name": {"type": "string"},
                "base_url": {"type": "string"},
            },
            "required": ["dataset_name", "confirm_dataset_name"],
        },
    },
    {
        "name": "add_row",
        "description": "Create one row through /api/add-row-multipart without file uploads.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string"},
                "row": {"type": "object", "additionalProperties": True},
                "base_url": {"type": "string"},
            },
            "required": ["dataset_name", "row"],
        },
    },
    {
        "name": "update_row",
        "description": "Update one row through /api/update-row.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string"},
                "id": {"type": "integer"},
                "updates": {
                    "description": "Either {\"column\":\"value\"} or [{\"column\":\"name\",\"value\":\"value\"}].",
                    "oneOf": [
                        {"type": "object", "additionalProperties": True},
                        {"type": "array", "items": {"type": "object"}},
                    ],
                },
                "base_url": {"type": "string"},
            },
            "required": ["dataset_name", "id", "updates"],
        },
    },
    {
        "name": "delete_rows",
        "description": "Delete rows through /api/delete-rows. Requires confirm=true.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string"},
                "ids": {"type": "array", "items": {"type": "integer"}},
                "confirm": {"type": "boolean"},
                "base_url": {"type": "string"},
            },
            "required": ["dataset_name", "ids", "confirm"],
        },
    },
    {
        "name": "get_lang_key",
        "description": (
            "Fetch one system_lang_keys entry through the Easelect application API before editing."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "lang_key": {
                    "type": "string",
                    "description": "Language key to fetch, for example view_card.",
                },
                "base_url": {
                    "type": "string",
                    "description": "Optional Easelect base URL. Defaults to https://localhost:8082.",
                },
            },
            "required": ["lang_key"],
        },
    },
    {
        "name": "upsert_lang_keys",
        "description": (
            "Upsert system_lang_keys entries through /api/update-lang-key. Use dry_run=true first."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "updates": {
                    "type": "array",
                    "description": "Language-key updates to apply.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "lang_key": {"type": "string"},
                            "fi": {"type": "string"},
                            "en": {"type": "string"},
                            "ch": {"type": "string"},
                            "usage_explanation": {"type": "string"},
                        },
                        "required": ["lang_key"],
                    },
                },
                "dry_run": {
                    "type": "boolean",
                    "description": "Preview changes without writing through the API.",
                },
                "base_url": {
                    "type": "string",
                    "description": "Optional Easelect base URL. Defaults to https://localhost:8082.",
                },
            },
            "required": ["updates"],
        },
    },
]


def make_jsonrpc_response(request_id, *, result=None, error=None):
    """Build one JSON-RPC response between an MCP request id and result/error data."""
    response = {"jsonrpc": "2.0"}
    if request_id is not None:
        response["id"] = request_id
    if error is not None:
        response["error"] = error
    else:
        response["result"] = result if result is not None else {}
    return response


def make_jsonrpc_error(code, message):
    """Build a JSON-RPC error object between protocol code and readable message."""
    return {
        "code": code,
        "message": message,
    }


def make_tool_result(payload, *, is_error=False):
    """Build an MCP tool result between Python payloads and text/structured content."""
    text = payload if isinstance(payload, str) else json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    )
    result = {
        "content": [
            {
                "type": "text",
                "text": text,
            }
        ],
        "isError": is_error,
    }
    if not is_error and not isinstance(payload, str):
        result["structuredContent"] = payload
    return result


def build_client(arguments, client_factory):
    """Create an API client between optional MCP arguments and the shared client class."""
    base_url = arguments.get("base_url") if isinstance(arguments, dict) else None
    return client_factory(base_url=base_url)


def require_string(arguments, name):
    """Validate one required string between MCP arguments and tool dispatch needs."""
    value = arguments.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    return value.strip()


def require_updates(arguments):
    """Validate language-key update objects between MCP input and API client upserts."""
    updates = arguments.get("updates")
    if not isinstance(updates, list) or not updates:
        raise ValueError("updates must be a non-empty array")
    for index, update in enumerate(updates):
        if not isinstance(update, dict):
            raise ValueError(f"updates[{index}] must be an object")
        if not str(update.get("lang_key") or update.get("key") or "").strip():
            raise ValueError(f"updates[{index}].lang_key is required")
    return updates


def require_object(arguments, name):
    """Validate one required object between MCP arguments and API payloads."""
    value = arguments.get(name)
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def require_ids(arguments):
    """Validate row ids between MCP delete arguments and the delete API payload."""
    ids = arguments.get("ids")
    if not isinstance(ids, list) or not ids:
        raise ValueError("ids must be a non-empty array")
    return [int(row_id) for row_id in ids]


def build_create_dataset_payload(arguments):
    """Build create-dataset payloads between MCP fields and the canonical API body."""
    raw_request = arguments.get("request")
    if isinstance(raw_request, dict):
        return raw_request
    dataset_name = require_string(arguments, "dataset_name")
    columns = require_object(arguments, "columns")
    payload = {
        "dataset_name": dataset_name,
        "columns": columns,
        "foreign_keys": arguments.get("foreign_keys") or [],
        "grant_users_read": bool(arguments.get("grant_users_read", False)),
        "grant_guests_read": bool(arguments.get("grant_guests_read", False)),
        "prevent_deletion": bool(arguments.get("prevent_deletion", False)),
    }
    if isinstance(arguments.get("folder_id"), int):
        payload["folder_id"] = arguments["folder_id"]
    if isinstance(arguments.get("create_folder"), dict):
        payload["create_folder"] = arguments["create_folder"]
    return payload


def build_modify_columns_payload(arguments):
    """Build modify-columns payloads between MCP fields and the canonical API body."""
    raw_request = arguments.get("request")
    if isinstance(raw_request, dict):
        removed_columns = raw_request.get("removed_columns") or []
        if removed_columns and not arguments.get("allow_column_removal"):
            raise ValueError("allow_column_removal must be true when removing columns")
        return raw_request
    dataset_name = require_string(arguments, "dataset_name")
    removed_columns = arguments.get("removed_columns") or []
    if removed_columns and not arguments.get("allow_column_removal"):
        raise ValueError("allow_column_removal must be true when removing columns")
    return {
        "dataset_name": dataset_name,
        "modified_columns": arguments.get("modified_columns") or [],
        "added_columns": arguments.get("added_columns") or [],
        "removed_columns": removed_columns,
    }


def normalize_row_updates(updates):
    """Normalize row updates between compact MCP input and /api/update-row arrays."""
    if isinstance(updates, dict):
        return [
            {"column": column, "value": value}
            for column, value in updates.items()
        ]
    if isinstance(updates, list) and updates:
        for index, update in enumerate(updates):
            if not isinstance(update, dict) or not str(update.get("column") or "").strip():
                raise ValueError(f"updates[{index}].column is required")
        return updates
    raise ValueError("updates must be a non-empty object or array")


def call_tool(name, arguments, *, client_factory=EaselectAPIClient):
    """Dispatch one MCP tool call between tool names and Easelect API client methods."""
    if not isinstance(arguments, dict):
        arguments = {}

    if name == "list_datasets":
        client = build_client(arguments, client_factory)
        return client.list_datasets()

    if name == "get_dataset_columns":
        dataset_name = require_string(arguments, "dataset_name")
        client = build_client(arguments, client_factory)
        return client.get_dataset_columns(dataset_name)

    if name == "get_dataset_rows":
        dataset_name = require_string(arguments, "dataset_name")
        client = build_client(arguments, client_factory)
        return client.get_dataset_rows(
            dataset_name,
            offset=arguments.get("offset") or 0,
            sort_column=arguments.get("sort_column"),
            sort_order=arguments.get("sort_order"),
            filters=arguments.get("filters") or {},
            row_count=arguments.get("row_count"),
            include_card_support=bool(arguments.get("include_card_support", False)),
            include_map_support=bool(arguments.get("include_map_support", False)),
        )

    if name == "create_dataset":
        client = build_client(arguments, client_factory)
        return client.create_dataset(build_create_dataset_payload(arguments))

    if name == "modify_columns":
        client = build_client(arguments, client_factory)
        return client.modify_columns(build_modify_columns_payload(arguments))

    if name == "drop_dataset":
        dataset_name = require_string(arguments, "dataset_name")
        confirm_dataset_name = require_string(arguments, "confirm_dataset_name")
        if confirm_dataset_name != dataset_name:
            raise ValueError("confirm_dataset_name must match dataset_name")
        client = build_client(arguments, client_factory)
        return client.drop_dataset(dataset_name)

    if name == "add_row":
        dataset_name = require_string(arguments, "dataset_name")
        row = require_object(arguments, "row")
        client = build_client(arguments, client_factory)
        return client.add_row(dataset_name, row)

    if name == "update_row":
        dataset_name = require_string(arguments, "dataset_name")
        row_id = int(arguments.get("id") or 0)
        if row_id <= 0:
            raise ValueError("id must be a positive integer")
        client = build_client(arguments, client_factory)
        return client.update_row(
            dataset_name,
            row_id,
            normalize_row_updates(arguments.get("updates")),
        )

    if name == "delete_rows":
        if arguments.get("confirm") is not True:
            raise ValueError("confirm must be true when deleting rows")
        dataset_name = require_string(arguments, "dataset_name")
        client = build_client(arguments, client_factory)
        return client.delete_rows(dataset_name, require_ids(arguments))

    if name == "get_lang_key_api_handover":
        return {
            "command": "./easelect_mcp",
            "resource_uri": LANG_KEY_HANDOVER_RESOURCE_URI,
            "summary": SERVER_INSTRUCTIONS,
            "text": LANG_KEY_HANDOVER_TEXT,
        }

    if name == "get_lang_key":
        lang_key = require_string(arguments, "lang_key")
        client = build_client(arguments, client_factory)
        client.login()
        return client.get_lang_key(lang_key)

    if name == "upsert_lang_keys":
        updates = require_updates(arguments)
        dry_run = bool(arguments.get("dry_run", False))
        client = build_client(arguments, client_factory)
        return client.upsert_lang_keys_many(updates, dry_run=dry_run)

    raise ValueError(f"unknown tool: {name}")


def handle_request(message, *, client_factory=EaselectAPIClient):
    """Handle one MCP JSON-RPC message between stdio transport and tool dispatch."""
    request_id = message.get("id")
    method = message.get("method")

    if message.get("jsonrpc") != "2.0":
        return make_jsonrpc_response(
            request_id,
            error=make_jsonrpc_error(-32600, "invalid request"),
        )

    if method == "initialize":
        return make_jsonrpc_response(
            request_id,
            result={
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {
                        "listChanged": False,
                    },
                },
                "serverInfo": SERVER_INFO,
                "instructions": SERVER_INSTRUCTIONS,
            },
        )

    if method == "ping":
        return make_jsonrpc_response(request_id, result={})

    if method == "notifications/initialized":
        return None

    if method == "tools/list":
        return make_jsonrpc_response(request_id, result={"tools": TOOL_DEFINITIONS})

    if method == "resources/list":
        return make_jsonrpc_response(request_id, result={"resources": RESOURCE_DEFINITIONS})

    if method == "resources/read":
        params = message.get("params") or {}
        if not isinstance(params, dict):
            return make_jsonrpc_response(
                request_id,
                error=make_jsonrpc_error(-32602, "invalid params"),
            )
        if params.get("uri") != LANG_KEY_HANDOVER_RESOURCE_URI:
            return make_jsonrpc_response(
                request_id,
                error=make_jsonrpc_error(-32002, "resource not found"),
            )
        return make_jsonrpc_response(
            request_id,
            result={
                "contents": [
                    {
                        "uri": LANG_KEY_HANDOVER_RESOURCE_URI,
                        "mimeType": "text/markdown",
                        "text": LANG_KEY_HANDOVER_TEXT,
                    }
                ]
            },
        )

    if method == "tools/call":
        params = message.get("params") or {}
        if not isinstance(params, dict):
            return make_jsonrpc_response(
                request_id,
                error=make_jsonrpc_error(-32602, "invalid params"),
            )
        name = params.get("name")
        if not isinstance(name, str) or not name.strip():
            return make_jsonrpc_response(
                request_id,
                error=make_jsonrpc_error(-32602, "tool name is required"),
            )
        arguments = params.get("arguments") or {}
        try:
            payload = call_tool(
                name.strip(),
                arguments,
                client_factory=client_factory,
            )
            return make_jsonrpc_response(
                request_id,
                result=make_tool_result(payload),
            )
        except (EaselectAPIError, OSError, ValueError) as err:
            return make_jsonrpc_response(
                request_id,
                result=make_tool_result(str(err), is_error=True),
            )

    return make_jsonrpc_response(
        request_id,
        error=make_jsonrpc_error(-32601, "method not found"),
    )


def iter_stdin_messages(stdin):
    """Yield non-empty JSON lines between stdin streams and the MCP main loop."""
    for raw_line in stdin:
        line = raw_line.strip()
        if line:
            yield line


def main_loop(stdin=sys.stdin, stdout=sys.stdout, *, client_factory=EaselectAPIClient):
    """Run the stdio MCP loop between newline-delimited JSON input and output."""
    for line in iter_stdin_messages(stdin):
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            response = make_jsonrpc_response(
                None,
                error=make_jsonrpc_error(-32700, "parse error"),
            )
        else:
            response = handle_request(message, client_factory=client_factory)

        if response is not None:
            stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
            stdout.write("\n")
            stdout.flush()


def main():
    """Start the default stdio MCP server for command-line wrapper execution."""
    if len(sys.argv) > 1 and sys.argv[1] in {"--handover", "handover"}:
        print(LANG_KEY_HANDOVER_TEXT)
        return 0
    main_loop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
