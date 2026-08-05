#!/usr/bin/env python3
# api_crud.py
# Command-line CRUD maintenance tool backed by the Easelect HTTP API.
# Bridges shell usage and the shared MCP-ready EaselectAPIClient CRUD methods.
# Exists so agents and developers can change datasets, columns, and rows without direct SQL.

import argparse
import json
import sys

try:
    from .easelect_api_client import EaselectAPIClient, EaselectAPIError
except ImportError:
    from easelect_api_client import EaselectAPIClient, EaselectAPIError


def load_json_argument(raw_value, label):
    """Load JSON between CLI arguments and structured API payloads."""
    if raw_value is None:
        return None
    value = str(raw_value)
    if value.startswith("@"):
        with open(value[1:], "r", encoding="utf-8") as handle:
            return json.load(handle)
    try:
        return json.loads(value)
    except json.JSONDecodeError as err:
        raise ValueError(f"{label} must be JSON or @path: {err}") from err


def parse_assignment(raw_value, label):
    """Parse one NAME=VALUE CLI assignment between terminal input and API fields."""
    if "=" not in raw_value:
        raise ValueError(f"{label} must use NAME=VALUE format")
    key, value = raw_value.split("=", 1)
    key = key.strip()
    if not key:
        raise ValueError(f"{label} name cannot be empty")
    return key, value


def parse_jsonish_value(raw_value):
    """Parse a CLI value as JSON when possible, otherwise keep it as a string."""
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError:
        return raw_value


def parse_column_map(entries):
    """Convert repeated NAME=TYPE pairs between CLI flags and create-dataset columns."""
    columns = {}
    for entry in entries or []:
        name, data_type = parse_assignment(entry, "--column")
        columns[name] = data_type
    return columns


def parse_added_columns(entries):
    """Convert repeated NAME=TYPE pairs between CLI flags and modify-columns additions."""
    return [
        {
            "original_name": "",
            "new_name": name,
            "data_type": data_type,
        }
        for name, data_type in (parse_assignment(entry, "--add") for entry in entries or [])
    ]


def parse_filter_map(entries):
    """Convert repeated KEY=VALUE filters between CLI flags and get-results params."""
    filters = {}
    for entry in entries or []:
        key, value = parse_assignment(entry, "--filter")
        filters[key] = value
    return filters


def parse_update_operations(args):
    """Normalize update-row flags between CLI input and the update-row API shape."""
    raw_updates = load_json_argument(args.updates_json, "--updates-json")
    if raw_updates is not None:
        if isinstance(raw_updates, dict):
            return [
                {"column": column, "value": value}
                for column, value in raw_updates.items()
            ]
        if isinstance(raw_updates, list):
            return raw_updates
        raise ValueError("--updates-json must be an object or array")

    updates = []
    for entry in args.set or []:
        column, value = parse_assignment(entry, "--set")
        updates.append({"column": column, "value": parse_jsonish_value(value)})
    if not updates:
        raise ValueError("provide --set or --updates-json")
    return updates


def print_json(payload):
    """Print structured payloads between API results and CLI output."""
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def print_plain_list(items):
    """Print list payloads between API results and human CLI output."""
    for item in items:
        print(item)


def print_columns(columns):
    """Print column metadata between API results and human CLI output."""
    for column in columns:
        print(f"{column.get('column_name', '')}\t{column.get('data_type', '')}")


def extract_rows(payload):
    """Normalize API row payloads between paged responses and export output."""
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return payload["data"]
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    if isinstance(payload, list):
        return payload
    raise ValueError("row payload must be a list or include data/rows")


def build_create_dataset_payload(args):
    """Build create-dataset payloads between CLI flags and the canonical API body."""
    raw_payload = load_json_argument(args.raw_json, "--raw-json")
    if raw_payload is not None:
        if not isinstance(raw_payload, dict):
            raise ValueError("--raw-json must be an object")
        return raw_payload

    columns = load_json_argument(args.columns_json, "--columns-json")
    if columns is None:
        columns = parse_column_map(args.column)
    if not isinstance(columns, dict) or not columns:
        raise ValueError("provide --column NAME=TYPE or --columns-json")

    payload = {
        "dataset_name": args.dataset_name,
        "columns": columns,
        "foreign_keys": load_json_argument(args.foreign_keys_json, "--foreign-keys-json") or [],
        "grant_users_read": bool(args.grant_users_read),
        "grant_guests_read": bool(args.grant_guests_read),
        "prevent_deletion": bool(args.prevent_deletion),
    }
    if args.folder_id is not None:
        payload["folder_id"] = args.folder_id
    create_folder = load_json_argument(args.create_folder_json, "--create-folder-json")
    if create_folder is not None:
        if not isinstance(create_folder, dict):
            raise ValueError("--create-folder-json must be an object")
        payload["create_folder"] = create_folder
    return payload


def build_modify_columns_payload(args):
    """Build modify-columns payloads between CLI flags and the canonical API body."""
    raw_payload = load_json_argument(args.raw_json, "--raw-json")
    if raw_payload is not None:
        if not isinstance(raw_payload, dict):
            raise ValueError("--raw-json must be an object")
        removed_columns = raw_payload.get("removed_columns") or []
        if removed_columns and not args.allow_column_removal:
            raise ValueError("--allow-column-removal is required when removing columns")
        return raw_payload

    added_columns = parse_added_columns(args.add)
    added_json = load_json_argument(args.added_json, "--added-json")
    if added_json is not None:
        if not isinstance(added_json, list):
            raise ValueError("--added-json must be an array")
        added_columns.extend(added_json)

    modified_columns = load_json_argument(args.modified_json, "--modified-json") or []
    if not isinstance(modified_columns, list):
        raise ValueError("--modified-json must be an array")

    removed_columns = list(args.remove or [])
    if removed_columns and not args.allow_column_removal:
        raise ValueError("--allow-column-removal is required when removing columns")

    return {
        "dataset_name": args.dataset_name,
        "modified_columns": modified_columns,
        "added_columns": added_columns,
        "removed_columns": removed_columns,
    }


def make_client(args):
    """Create an Easelect API client between parsed CLI args and shared auth logic."""
    return EaselectAPIClient(base_url=args.base_url)


def command_list_datasets(args):
    result = make_client(args).list_datasets()
    if args.json:
        print_json(result)
    else:
        print_plain_list(result)


def command_columns(args):
    result = make_client(args).get_dataset_columns(args.dataset_name)
    if args.json:
        print_json(result)
    else:
        print_columns(result)


def command_rows(args):
    result = make_client(args).get_dataset_rows(
        args.dataset_name,
        offset=args.offset,
        sort_column=args.sort_column,
        sort_order=args.sort_order,
        filters=parse_filter_map(args.filter),
        row_count=args.row_count,
        include_card_support=args.include_card_support,
        include_map_support=args.include_map_support,
    )
    print_json(result)


def command_export_rows(args):
    client = make_client(args)
    all_rows = []
    offset = args.offset
    pages_requested = 0
    first_payload = None

    while True:
        if pages_requested >= args.max_pages:
            raise ValueError(f"export stopped after --max-pages={args.max_pages}")

        page = client.get_dataset_rows(
            args.dataset_name,
            offset=offset,
            sort_column=args.sort_column,
            sort_order=args.sort_order,
            filters=parse_filter_map(args.filter),
            include_card_support=args.include_card_support,
            include_map_support=args.include_map_support,
        )
        pages_requested += 1
        if first_payload is None:
            first_payload = page if isinstance(page, dict) else {"data": []}

        rows = extract_rows(page)
        if not rows:
            break

        remaining = None if args.max_rows is None else args.max_rows - len(all_rows)
        if remaining is not None and remaining <= 0:
            break
        if remaining is not None and len(rows) > remaining:
            all_rows.extend(rows[:remaining])
            break

        all_rows.extend(rows)
        offset += len(rows)

    result = dict(first_payload or {})
    result["data"] = all_rows
    result["exported_row_count"] = len(all_rows)
    result["export_pages_requested"] = pages_requested
    result["export_offset_start"] = args.offset
    print_json(result)


def command_create_dataset(args):
    result = make_client(args).create_dataset(build_create_dataset_payload(args))
    print_json(result)


def command_modify_columns(args):
    result = make_client(args).modify_columns(build_modify_columns_payload(args))
    print_json(result)


def command_drop_dataset(args):
    if args.confirm_dataset_name != args.dataset_name:
        raise ValueError("--confirm-dataset-name must match dataset_name")
    result = make_client(args).drop_dataset(args.dataset_name)
    print_json(result)


def command_add_row(args):
    row = load_json_argument(args.row_json, "--row-json")
    if not isinstance(row, dict):
        raise ValueError("--row-json must be an object")
    result = make_client(args).add_row(args.dataset_name, row)
    print_json(result)


def command_update_row(args):
    result = make_client(args).update_row(
        args.dataset_name,
        args.id,
        parse_update_operations(args),
    )
    print_json(result)


def command_delete_rows(args):
    if not args.confirm:
        raise ValueError("--confirm is required when deleting rows")
    result = make_client(args).delete_rows(args.dataset_name, args.id)
    print_json(result)


def build_parser():
    """Build the api_crud parser between terminal commands and client methods."""
    parser = argparse.ArgumentParser(
        description="Maintain Easelect datasets, columns, and rows through application APIs."
    )
    parser.add_argument("--base-url", help="Easelect base URL, default https://localhost:8082")

    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list-datasets", help="List dataset names")
    list_parser.add_argument("--json", action="store_true")
    list_parser.set_defaults(func=command_list_datasets)

    columns_parser = subparsers.add_parser("columns", help="Read dataset columns")
    columns_parser.add_argument("dataset_name")
    columns_parser.add_argument("--json", action="store_true")
    columns_parser.set_defaults(func=command_columns)

    rows_parser = subparsers.add_parser("rows", help="Read dataset rows")
    rows_parser.add_argument("dataset_name")
    rows_parser.add_argument("--offset", type=int, default=0)
    rows_parser.add_argument("--sort-column")
    rows_parser.add_argument("--sort-order", choices=["ASC", "DESC"])
    rows_parser.add_argument("--filter", action="append", default=[])
    rows_parser.add_argument("--row-count", type=int)
    rows_parser.add_argument("--include-card-support", action="store_true")
    rows_parser.add_argument("--include-map-support", action="store_true")
    rows_parser.set_defaults(func=command_rows)

    export_rows_parser = subparsers.add_parser(
        "export-rows",
        help="Read all dataset rows by paging through the rows API",
    )
    export_rows_parser.add_argument("dataset_name")
    export_rows_parser.add_argument("--offset", type=int, default=0)
    export_rows_parser.add_argument("--sort-column")
    export_rows_parser.add_argument("--sort-order", choices=["ASC", "DESC"])
    export_rows_parser.add_argument("--filter", action="append", default=[])
    export_rows_parser.add_argument("--max-rows", type=int)
    export_rows_parser.add_argument("--max-pages", type=int, default=1000)
    export_rows_parser.add_argument("--include-card-support", action="store_true")
    export_rows_parser.add_argument("--include-map-support", action="store_true")
    export_rows_parser.set_defaults(func=command_export_rows)

    create_parser = subparsers.add_parser("create-dataset", help="Create a dataset")
    create_parser.add_argument("dataset_name")
    create_parser.add_argument("--column", action="append", default=[], help="Column NAME=TYPE")
    create_parser.add_argument("--columns-json", help="JSON object or @path with columns")
    create_parser.add_argument("--foreign-keys-json", help="JSON array or @path with FK definitions")
    create_parser.add_argument("--grant-users-read", action="store_true")
    create_parser.add_argument("--grant-guests-read", action="store_true")
    create_parser.add_argument("--prevent-deletion", action="store_true")
    create_parser.add_argument("--folder-id", type=int)
    create_parser.add_argument("--create-folder-json", help="JSON object or @path")
    create_parser.add_argument("--raw-json", help="Raw /api/create_dataset payload JSON object or @path")
    create_parser.set_defaults(func=command_create_dataset)

    modify_parser = subparsers.add_parser("modify-columns", help="Modify dataset columns")
    modify_parser.add_argument("dataset_name")
    modify_parser.add_argument("--add", action="append", default=[], help="Added column NAME=TYPE")
    modify_parser.add_argument("--added-json", help="JSON array or @path for added columns")
    modify_parser.add_argument("--modified-json", help="JSON array or @path for modified columns")
    modify_parser.add_argument("--remove", action="append", default=[], help="Column name to remove")
    modify_parser.add_argument("--allow-column-removal", action="store_true")
    modify_parser.add_argument("--raw-json", help="Raw /api/modify-columns payload JSON object or @path")
    modify_parser.set_defaults(func=command_modify_columns)

    drop_parser = subparsers.add_parser("drop-dataset", help="Drop a dataset")
    drop_parser.add_argument("dataset_name")
    drop_parser.add_argument("--confirm-dataset-name", required=True)
    drop_parser.set_defaults(func=command_drop_dataset)

    add_row_parser = subparsers.add_parser("add-row", help="Create one row")
    add_row_parser.add_argument("dataset_name")
    add_row_parser.add_argument("--row-json", required=True, help="JSON object or @path")
    add_row_parser.set_defaults(func=command_add_row)

    update_row_parser = subparsers.add_parser("update-row", help="Update one row")
    update_row_parser.add_argument("dataset_name")
    update_row_parser.add_argument("id", type=int)
    update_row_parser.add_argument("--set", action="append", default=[], help="Column=JSON_VALUE")
    update_row_parser.add_argument("--updates-json", help="JSON object/array or @path")
    update_row_parser.set_defaults(func=command_update_row)

    delete_rows_parser = subparsers.add_parser("delete-rows", help="Delete rows")
    delete_rows_parser.add_argument("dataset_name")
    delete_rows_parser.add_argument("--id", type=int, action="append", required=True)
    delete_rows_parser.add_argument("--confirm", action="store_true")
    delete_rows_parser.set_defaults(func=command_delete_rows)

    return parser


def main(argv=None):
    """Run api_crud between shell argv and the selected API command."""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (EaselectAPIError, OSError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
