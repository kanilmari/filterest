#!/usr/bin/env python3
"""Legacy md-ticket diff helper retired after DB-native task migration.

This script used to compare filesystem ticket markdown against dev_agent_tasks
rows via md-era provenance columns. Those dedicated legacy columns have now
been consolidated into task content and removed from the canonical schema.

Keep this file as a friendly handoff so old shell history or docs do not fail
with a confusing SQL error after the column drop.
"""

import sys


def main() -> int:
    print(
        "show_diffs.py is retired: dev_agent_tasks no longer stores md-era "
        "filename/original_path metadata as dedicated columns."
    )
    print(
        "If you need task history, inspect the `## Migrated Legacy Metadata` "
        "block inside task content instead."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
