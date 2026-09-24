#!/usr/bin/env python3
"""Refuse a release whose tracked browser bundle its own source no longer builds.

The minified files under app/frontend/dist are what production serves, and a
development machine that serves raw source never touches them. That is why a
stale bundle stays invisible until a release ships last month's interface with
this month's backend. This check rebuilds the frontend into a temporary
directory and compares it with the tracked files, so a release cut by hand is
refused exactly like one prepared by the tool.

It writes nothing: the rebuild lands outside the checkout and the tracked files
are only read. When the build cannot run at all it fails and says so, because
"could not check" must never be read as "checked and fine".
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
import tempfile

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
from server_tools.release import browser_bundle

DEFAULT_TARGET = APP_ROOT.parent


def audit_browser_bundle(target: Path) -> tuple[int, str]:
    """Return an exit status and the message explaining it for one checkout."""

    tracked = browser_bundle.tracked_bundle(target)
    with tempfile.TemporaryDirectory(prefix="filterest-bundle-check-") as directory:
        built = browser_bundle.build_browser_bundle(target, Path(directory) / "bundle")
    difference = browser_bundle.compare_bundle(tracked, built)
    if not any(difference.values()):
        return 0, (
            f"Browser bundle OK: {len(built)} tracked files match a build of this source."
        )
    if not tracked:
        headline = (
            f"The browser bundle is missing: {browser_bundle.BUNDLE_DIRECTORY} contains no "
            "files, but this source builds them."
        )
    else:
        headline = (
            "The tracked browser bundle is not what this source builds, so a release "
            "would ship a browser interface that does not match its own code."
        )
    return 1, "\n".join([
        headline,
        browser_bundle.describe_difference(difference),
        browser_bundle.REFRESH_ADVICE,
        "If you did not change the frontend, check that your Node and Vite versions match "
        "the ones declared in app/package.json and app/package-lock.json.",
    ])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET,
                        help="Filterest checkout to check (default: the one this tool belongs to)")
    args = parser.parse_args(argv)

    target = args.target.resolve()
    if not (target / "app/server_tools").is_dir():
        parser.error(f"not a Filterest checkout: {target}")
    try:
        status, message = audit_browser_bundle(target)
    except browser_bundle.BundleBuildError as error:
        print(f"The browser bundle check could not run: {error}", file=sys.stderr)
        return 1
    print(message, file=sys.stderr if status else sys.stdout)
    return status


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
