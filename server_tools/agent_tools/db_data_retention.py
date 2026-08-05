#!/usr/bin/env python3
# db_data_retention.py
# CLI wrapper for the admin data-retention API in Easelect.
# Bridges authenticated local operator sessions and the canonical backend data-retention handlers.
# Exists so retention policies can be previewed and pruned without manual curl commands or direct SQL usage.

import argparse
import json
import sys

import db_task


def _normalize_policies(csv_value):
    if not csv_value:
        return []
    seen = set()
    policies = []
    for item in csv_value.split(","):
        value = item.strip()
        if not value:
            continue
        normalized = value.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        policies.append(value)
    return policies


def _print_response(payload):
    if not isinstance(payload, dict):
        print(json.dumps(payload, indent=2))
        return

    print(f"dry_run: {payload.get('dry_run')}")
    print(f"ran_at: {payload.get('ran_at')}")
    print(f"total_matched: {payload.get('total_matched', 0)}")
    print(f"total_deleted: {payload.get('total_deleted', 0)}")
    print("")
    print(f"{'POLICY':<30} {'TABLE':<24} {'MATCHED':<10} {'DELETED':<10} SKIPPED")
    print("-" * 96)
    for item in payload.get("results", []):
        policy_name = item.get("policy_name", "")
        table_name = item.get("table_name", "")
        matched = item.get("matched_rows", 0)
        deleted = item.get("deleted_rows", 0)
        skipped = item.get("skipped_reason", "")
        print(f"{policy_name:<30} {table_name:<24} {matched:<10} {deleted:<10} {skipped}")


def cmd_preview(args):
    params = {}
    policies = _normalize_policies(args.policies)
    if policies:
        params["policies"] = ",".join(policies)
    payload = db_task._api("GET", "/api/data-retention/preview", params=params or None)
    _print_response(payload)


def cmd_prune(args):
    policies = _normalize_policies(args.policies)
    preview_params = {}
    if policies:
        preview_params["policies"] = ",".join(policies)

    preview = db_task._api("GET", "/api/data-retention/preview", params=preview_params or None)
    print("Preview:")
    _print_response(preview)

    if not args.yes:
        print("")
        print("Dry safeguard: rerun with --yes to execute deletion through the API.", file=sys.stderr)
        return

    payload = {
        "policies": policies,
        "dry_run": False,
    }
    result = db_task._api("POST", "/api/data-retention/prune", data=payload)
    print("")
    print("Prune result:")
    _print_response(result)


def main():
    parser = argparse.ArgumentParser(
        description="db_data_retention: Preview and prune rows matched by configurable data-retention policies via the admin API.",
    )
    subparsers = parser.add_subparsers(dest="command")

    preview_p = subparsers.add_parser("preview", help="Preview how many rows the configured policies would delete")
    preview_p.add_argument("--policies", help="Comma-separated subset of configured policy names")

    prune_p = subparsers.add_parser("prune", help="Delete rows matched by the configured policies")
    prune_p.add_argument("--policies", help="Comma-separated subset of configured policy names")
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
