#!/usr/bin/env python3
# api_lang.py
# Command-line language-key maintenance and verification tool backed by the Filterest HTTP API.
# Bridges authored JSON batches and the shared MCP-ready EaselectAPIClient.
# Exists so agents can add complete UI translations and prove readback without direct SQL.

import argparse
import json
import sys

try:
    from .easelect_api_client import DEFAULT_BASE_URL, EaselectAPIClient, EaselectAPIError
except ImportError:
    from easelect_api_client import DEFAULT_BASE_URL, EaselectAPIClient, EaselectAPIError


LANG_VALUE_FIELDS = ("fi", "en", "ch", "yue")
LANG_REQUIRED_FIELDS = (*LANG_VALUE_FIELDS, "usage_explanation")


def load_updates_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        invalid_keys = [key for key, value in data.items() if not isinstance(value, dict)]
        if invalid_keys:
            raise ValueError(
                "every language-key object value must be an object: "
                + ", ".join(str(key) for key in invalid_keys)
            )
        nested_identities = [
            key
            for key, value in data.items()
            if "lang_key" in value or "key" in value
        ]
        if nested_identities:
            raise ValueError(
                "object-form language-key entries must not repeat their identity: "
                + ", ".join(str(key) for key in nested_identities)
            )
        return [{**value, "lang_key": key} for key, value in data.items()]
    raise ValueError("updates file must contain a JSON array or object")


def validate_updates(updates, *, require_complete=False):
    """Reject ambiguous language-key batches before any API write or check."""
    if not updates:
        raise ValueError("updates file must contain at least one language key")

    normalized = []
    seen = set()
    allowed_fields = {"lang_key", "key", *LANG_REQUIRED_FIELDS}
    for index, raw_update in enumerate(updates, start=1):
        if not isinstance(raw_update, dict):
            raise ValueError(f"update {index} must be an object")
        update = dict(raw_update)
        unknown_fields = sorted(set(update) - allowed_fields)
        if unknown_fields:
            raise ValueError(
                f"update {index} has unknown field(s): {', '.join(unknown_fields)}"
            )
        raw_lang_key = update.get("lang_key") or update.get("key") or ""
        if not isinstance(raw_lang_key, str):
            raise ValueError(f"update {index} lang_key must be a string")
        lang_key = raw_lang_key.strip()
        if not lang_key:
            raise ValueError(f"update {index} is missing lang_key")
        if lang_key in seen:
            raise ValueError(f"duplicate lang_key in updates file: {lang_key}")
        seen.add(lang_key)
        update["lang_key"] = lang_key
        update.pop("key", None)

        invalid_value_fields = [
            field
            for field in LANG_REQUIRED_FIELDS
            if field in update and not isinstance(update[field], str)
        ]
        if invalid_value_fields:
            raise ValueError(
                f"{lang_key} field(s) must be strings: {', '.join(invalid_value_fields)}"
            )

        if require_complete:
            missing = [
                field
                for field in LANG_REQUIRED_FIELDS
                if not str(update.get(field) or "").strip()
            ]
            if missing:
                raise ValueError(
                    f"{lang_key} is missing required field(s): {', '.join(missing)}"
                )
        normalized.append(update)
    return normalized


def inspect_lang_key(lang_key, actual, *, expected=None, require_complete=True):
    """Return one deterministic existence, completeness, and readback verdict."""
    actual = actual if isinstance(actual, dict) else {}
    has_explicit_existence = isinstance(actual.get("exists"), bool)
    exists = (
        actual["exists"]
        if has_explicit_existence
        else any(str(actual.get(field) or "").strip() for field in LANG_REQUIRED_FIELDS)
    )
    missing_fields = []
    if require_complete:
        missing_fields = [
            field
            for field in LANG_REQUIRED_FIELDS
            if not str(actual.get(field) or "").strip()
        ]

    mismatches = {}
    for field in LANG_REQUIRED_FIELDS:
        if expected is None or field not in expected:
            continue
        wanted = str(expected.get(field) or "")
        found = str(actual.get(field) or "")
        if found != wanted:
            mismatches[field] = {"expected": wanted, "actual": found}

    return {
        "lang_key": lang_key,
        "exists": exists,
        "complete": exists and not missing_fields,
        "matches_expected": not mismatches,
        "ok": exists and not missing_fields and not mismatches,
        "missing_fields": missing_fields,
        "mismatches": mismatches,
        "values": {field: str(actual.get(field) or "") for field in LANG_REQUIRED_FIELDS},
    }


def print_result(result):
    marker = "DRY-RUN" if result["dry_run"] else "UPDATED"
    print(f"{marker} {result['lang_key']}")
    for field in ("fi", "en", "ch", "yue", "usage_explanation"):
        before = result["before"].get(field, "")
        after = result["after"].get(field, "")
        if before != after:
            print(f"  {field}: {before!r} -> {after!r}")


def print_check_result(result):
    if result["ok"]:
        print(f"OK {result['lang_key']}")
        return
    problems = []
    if not result["exists"]:
        problems.append("not registered")
    if result["missing_fields"]:
        problems.append(f"missing: {', '.join(result['missing_fields'])}")
    if result["mismatches"]:
        problems.append(f"readback mismatch: {', '.join(result['mismatches'])}")
    print(f"FAIL {result['lang_key']}: {'; '.join(problems)}")


def command_get(args):
    client = EaselectAPIClient(base_url=args.base_url)
    client.login()
    result = client.get_lang_key(args.lang_key)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(args.lang_key)
        inspected = inspect_lang_key(args.lang_key, result, require_complete=False)
        print(f"  exists: {inspected['exists']}")
        for field in ("fi", "en", "ch", "yue", "usage_explanation"):
            print(f"  {field}: {result.get(field, '')!r}")


def run_checks(client, updates, *, require_complete):
    results = []
    for update in updates:
        lang_key = update["lang_key"]
        actual = client.get_lang_key(lang_key)
        results.append(
            inspect_lang_key(
                lang_key,
                actual,
                expected=update.get("expected"),
                require_complete=require_complete,
            )
        )
    return results


def emit_check_results(results, *, as_json):
    if as_json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for result in results:
            print_check_result(result)
    return 0 if all(result["ok"] for result in results) else 1


def command_check(args):
    updates = [{"lang_key": lang_key} for lang_key in args.lang_keys]
    client = EaselectAPIClient(base_url=args.base_url)
    client.login()
    results = run_checks(client, updates, require_complete=not args.allow_partial)
    return emit_check_results(results, as_json=args.json)


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
    updates = validate_updates(
        load_updates_file(args.file),
        require_complete=args.require_complete,
    )
    client = EaselectAPIClient(base_url=args.base_url)
    results = client.upsert_lang_keys_many(updates, dry_run=args.dry_run)
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for result in results:
            print_result(result)


def command_check_many(args):
    updates = validate_updates(
        load_updates_file(args.file),
        require_complete=not args.allow_partial,
    )
    checks = [
        {"lang_key": update["lang_key"], "expected": update}
        for update in updates
    ]
    client = EaselectAPIClient(base_url=args.base_url)
    client.login()
    results = run_checks(client, checks, require_complete=not args.allow_partial)
    return emit_check_results(results, as_json=args.json)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Maintain Filterest language keys through the application API."
    )
    parser.add_argument(
        "--base-url",
        help=f"Filterest base URL, default {DEFAULT_BASE_URL}",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    get_parser = subparsers.add_parser("get", help="Fetch one language key")
    get_parser.add_argument("lang_key")
    get_parser.add_argument("--json", action="store_true")
    get_parser.set_defaults(func=command_get)

    check_parser = subparsers.add_parser(
        "check",
        help="Fail unless one or more language keys exist and are complete",
    )
    check_parser.add_argument("lang_keys", nargs="+")
    check_parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Check existence only; do not require all translations and usage context",
    )
    check_parser.add_argument("--json", action="store_true")
    check_parser.set_defaults(func=command_check)

    upsert_parser = subparsers.add_parser("upsert", help="Upsert one language key")
    upsert_parser.add_argument("lang_key")
    upsert_parser.add_argument("--fi")
    upsert_parser.add_argument("--en")
    upsert_parser.add_argument("--ch")
    upsert_parser.add_argument("--yue")
    upsert_parser.add_argument("--usage-explanation")
    upsert_parser.add_argument("--dry-run", action="store_true")
    upsert_parser.add_argument("--json", action="store_true")
    upsert_parser.set_defaults(func=command_upsert)

    many_parser = subparsers.add_parser("upsert-many", help="Upsert many language keys from JSON")
    many_parser.add_argument("--file", required=True, help="JSON array or object with lang-key updates")
    many_parser.add_argument(
        "--require-complete",
        action="store_true",
        help="Reject entries missing fi/en/ch/yue or usage_explanation before writing",
    )
    many_parser.add_argument("--dry-run", action="store_true")
    many_parser.add_argument("--json", action="store_true")
    many_parser.set_defaults(func=command_upsert_many)

    check_many_parser = subparsers.add_parser(
        "check-many",
        help="Verify complete database readback against a JSON updates file",
    )
    check_many_parser.add_argument("--file", required=True, help="JSON array or object with expected values")
    check_many_parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Allow partial files and compare only the values they provide",
    )
    check_many_parser.add_argument("--json", action="store_true")
    check_many_parser.set_defaults(func=command_check_many)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args) or 0
    except (EaselectAPIError, OSError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
