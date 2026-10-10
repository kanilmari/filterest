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
    parser.add_argument("action", choices=("backup", "verify", "restore", "preflight", "setup-key"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--profile", choices=("docker", "native"), required=True)
    parser.add_argument("--settings", action="append", default=[])
    parser.add_argument("--output")
    parser.add_argument("--backup")
    parser.add_argument("--archive")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--legacy", action="store_true", help="Explicitly permit an unauthenticated old packet")
    parser.add_argument("--allow-unauthenticated-restore", action="store_true", help="DANGER: skip packet authentication when the separately stored key is unavailable")
    parser.add_argument("--dump-options", nargs=REMAINDER, default=["--format=custom"])
    return parser
