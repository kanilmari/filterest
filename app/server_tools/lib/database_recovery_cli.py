"""database_recovery_cli.py: fixed command-line diagnostics before key loading.

Connects both recovery entrypoints to argparse without exposing supplied values.
Even the program name, usage and help are independent of the invocation path.
"""
from __future__ import annotations

import argparse
from argparse import REMAINDER
import sys


class RecoveryArgumentParser(argparse.ArgumentParser):
    """Refuse invalid input with fixed text and argparse's original status 2."""
    def __init__(self, *args, **kwargs):
        kwargs["prog"] = "Filterest recovery"
        super().__init__(*args, **kwargs)

    def error(self, message):
        # argparse's message includes rejected values, including before a root
        # or a safely readable key is known. Never render that message.
        self.exit(2, "unrecognized or invalid arguments; see --help\n")

    def exit(self, status=0, message=None):
        if message:
            # Only our fixed error text may pass this pre-authentication exit.
            sys.stderr.write("unrecognized or invalid arguments; see --help\n")
        raise SystemExit(status)


def database_parser(description):
    """Own the database command's fixed grammar beside its fixed diagnostics."""
    parser = RecoveryArgumentParser(description=description)
    parser.add_argument("action", choices=("backup", "verify", "restore", "restore-check", "preflight", "setup-key"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--profile", choices=("docker", "native"), required=True)
    parser.add_argument("--settings", action="append", default=[])
    parser.add_argument("--output")
    parser.add_argument("--backup")
    parser.add_argument("--archive")
    parser.add_argument("--target", help="restore-check only: auto creates and drops a generated disposable database")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--legacy", action="store_true", help="Explicitly permit an unauthenticated old packet")
    parser.add_argument("--allow-unauthenticated-restore", action="store_true", help="DANGER: skip packet authentication when the separately stored key is unavailable")
    parser.add_argument("--dump-options", nargs=REMAINDER, default=["--format=custom"])
    return parser


def validate_database_arguments(parser, args):
    """Keep destructive switches out of the disposable-check grammar."""
    if args.action == "backup" and not args.output or args.action in ("verify", "restore", "restore-check") and not args.backup:
        parser.error("backup requires --output; verify/restore/restore-check require --backup")
    if args.action != "restore" and (args.yes or args.legacy or args.allow_unauthenticated_restore):
        parser.error("--yes, --legacy and --allow-unauthenticated-restore apply only to restore")
    if args.action == "restore-check":
        if not args.target or args.output or args.archive or args.dump_options != ["--format=custom"]:
            parser.error("restore-check requires --target and accepts no output/archive/dump options")
    elif args.target is not None:
        parser.error("--target applies only to restore-check")
