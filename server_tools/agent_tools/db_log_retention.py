#!/usr/bin/env python3
# db_log_retention.py
# CLI wrapper for the admin log-retention API in Easelect.
# Bridges authenticated local operator sessions and the canonical backend log-retention handlers.
# Exists so old log rows can be previewed and pruned without manual curl commands or direct SQL usage.

import argparse
import json
import sys

import db_task


def _normalize_tables(csv_value):
    if not csv_value:
        return []
    seen = set()
    tables = []
    for item in csv_value.split(","):
        value = item.strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        tables.append(value)
    return tables


def _print_response(payload):
    if not isinstance(payload, dict):
        print(json.dumps(payload, indent=2))
        return

    print(f"before: {payload.get('before')}")
    print(f"dry_run: {payload.get('dry_run')}")
    print(f"total_matched: {payload.get('total_matched', 0)}")
    print(f"total_deleted: {payload.get('total_deleted', 0)}")
    print("")
    print(f"{'TABLE':<24} {'PRESENT':<8} {'MATCHED':<10} {'DELETED':<10} SKIPPED")
    print("-" * 76)
    for item in payload.get("results", []):
        table_name = item.get("table_name", "")
        present = "yes" if item.get("present") else "no"
        matched = item.get("matched_rows", 0)
        deleted = item.get("deleted_rows", 0)
        skipped = item.get("skipped_reason", "")
        print(f"{table_name:<24} {present:<8} {matched:<10} {deleted:<10} {skipped}")


def cmd_preview(args):
    params = {"before": args.before}
    tables = _normalize_tables(args.tables)
    if tables:
        params["tables"] = ",".join(tables)
    payload = db_task._api("GET", "/api/log-retention/preview", params=params)
    _print_response(payload)


def cmd_prune(args):
    tables = _normalize_tables(args.tables)
    preview_params = {"before": args.before}
    if tables:
        preview_params["tables"] = ",".join(tables)

    preview = db_task._api("GET", "/api/log-retention/preview", params=preview_params)
    print("Preview:")
    _print_response(preview)

    if not args.yes:
        print("")
        print("Dry safeguard: rerun with --yes to execute deletion through the API.", file=sys.stderr)
        return

    payload = {
        "before": args.before,
        "tables": tables,
        "dry_run": False,
    }
    result = db_task._api("POST", "/api/log-retention/prune", data=payload)
    print("")
    print("Prune result:")
    _print_response(result)


def main():
    parser = argparse.ArgumentParser(
        description="db_log_retention: Preview and prune old rows from allowed log tables via the admin API.",
    )
    subparsers = parser.add_subparsers(dest="command")

    preview_p = subparsers.add_parser("preview", help="Preview how many rows would be deleted")
    preview_p.add_argument("--before", required=True, help="Delete rows older than this cutoff (YYYY-MM-DD or RFC3339)")
    preview_p.add_argument("--tables", help="Comma-separated subset of allowed log tables")

    prune_p = subparsers.add_parser("prune", help="Delete rows older than the given cutoff")
    prune_p.add_argument("--before", required=True, help="Delete rows older than this cutoff (YYYY-MM-DD or RFC3339)")
    prune_p.add_argument("--tables", help="Comma-separated subset of allowed log tables")
    prune_p.add_argument("--yes", action="store_true", help="Actually execute the prune after preview")

    args = parser.parse_args()
    if args.command == "preview":
        cmd_preview(args)
        return
    if args.command == "prune":
        cmd_prune(args)
        return
    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
