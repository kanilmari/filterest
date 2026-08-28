#!/usr/bin/env python3
# api_asset_linking.py
# Command-line asset-linking inspection tool backed by the Easelect HTTP API.
# Bridges shell usage and the shared MCP-ready EaselectAPIClient.
# Exists so demo media readiness checks can use API evidence instead of storage guesses.

import argparse
import json
from pathlib import Path
import sys

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY_ROOT))

try:
    from .easelect_api_client import DEFAULT_BASE_URL, EaselectAPIClient, EaselectAPIError
except ImportError:
    from server_tools.agent_tools.easelect_api_client import (
        DEFAULT_BASE_URL,
        EaselectAPIClient,
        EaselectAPIError,
    )


def print_json(payload):
    """Print structured payloads between API results and CLI output."""
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def make_client(args):
    """Create an Easelect API client between parsed CLI args and shared auth logic."""
    return EaselectAPIClient(base_url=args.base_url)


def command_status(args):
    """Fetch asset-linking status between CLI input and the read-only API route."""
    client = make_client(args)
    client.login()
    query = {}
    if args.table:
        query["table"] = args.table
    print_json(client.request("GET", "/api/asset-linking/status", query=query))


def build_parser():
    """Build the api_asset_linking parser between terminal commands and client methods."""
    parser = argparse.ArgumentParser(
        description="Inspect Filterest asset-linking configuration through application APIs."
    )
    parser.add_argument(
        "--base-url",
        help=f"Filterest base URL, default {DEFAULT_BASE_URL}",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="Read image/attachment asset-linking status")
    status_parser.add_argument("--table", help="Optional parent dataset/table to inspect")
    status_parser.set_defaults(func=command_status)

    return parser


def main(argv=None):
    """Run api_asset_linking between shell argv and the selected API command."""
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
