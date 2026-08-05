#!/usr/bin/env python3
# api_lang.py
# Command-line language-key maintenance tool backed by the Easelect HTTP API.
# Bridges shell usage and the shared MCP-ready EaselectAPIClient.
# Exists so agents and developers can update system_lang_keys without direct SQL.

import argparse
import json
import sys

from easelect_api_client import EaselectAPIClient, EaselectAPIError


def load_updates_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [
            {"lang_key": key, **value}
            for key, value in data.items()
            if isinstance(value, dict)
        ]
    raise ValueError("updates file must contain a JSON array or object")


def print_result(result):
    marker = "DRY-RUN" if result["dry_run"] else "UPDATED"
    print(f"{marker} {result['lang_key']}")
    for field in ("fi", "en", "ch", "yue", "usage_explanation"):
        before = result["before"].get(field, "")
        after = result["after"].get(field, "")
        if before != after:
            print(f"  {field}: {before!r} -> {after!r}")


def command_get(args):
    client = EaselectAPIClient(base_url=args.base_url)
    client.login()
    result = client.get_lang_key(args.lang_key)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(args.lang_key)
        for field in ("fi", "en", "ch", "yue", "usage_explanation"):
            print(f"  {field}: {result.get(field, '')!r}")


def command_upsert(args):
    update = {"lang_key": args.lang_key}
    for field in ("fi", "en", "ch", "yue", "usage_explanation"):
        value = getattr(args, field)
        if value is not None:
            update[field] = value

    client = EaselectAPIClient(base_url=args.base_url)
    results = client.upsert_lang_keys_many([update], dry_run=args.dry_run)
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        print_result(results[0])


def command_upsert_many(args):
    updates = load_updates_file(args.file)
    client = EaselectAPIClient(base_url=args.base_url)
    results = client.upsert_lang_keys_many(updates, dry_run=args.dry_run)
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for result in results:
            print_result(result)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Maintain Easelect language keys through the application API."
    )
    parser.add_argument("--base-url", help="Easelect base URL, default https://localhost:8082")

    subparsers = parser.add_subparsers(dest="command", required=True)

    get_parser = subparsers.add_parser("get", help="Fetch one language key")
    get_parser.add_argument("lang_key")
    get_parser.add_argument("--json", action="store_true")
    get_parser.set_defaults(func=command_get)

    upsert_parser = subparsers.add_parser("upsert", help="Upsert one language key")
    upsert_parser.add_argument("lang_key")
    upsert_parser.add_argument("--fi")
    upsert_parser.add_argument("--en")
    upsert_parser.add_argument("--ch")
    upsert_parser.add_argument("--usage-explanation")
    upsert_parser.add_argument("--dry-run", action="store_true")
    upsert_parser.add_argument("--json", action="store_true")
    upsert_parser.set_defaults(func=command_upsert)

    many_parser = subparsers.add_parser("upsert-many", help="Upsert many language keys from JSON")
    many_parser.add_argument("--file", required=True, help="JSON array or object with lang-key updates")
    many_parser.add_argument("--dry-run", action="store_true")
    many_parser.add_argument("--json", action="store_true")
    many_parser.set_defaults(func=command_upsert_many)

    return parser


def main(argv=None):
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
