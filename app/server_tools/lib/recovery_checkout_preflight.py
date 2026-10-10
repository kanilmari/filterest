"""recovery_checkout_preflight.py: refuse existing fast-forward obstructions.

Connect verified release metadata with read-only Git and filesystem inspection.
Do not run target code or change refs/index while the original application runs.
The actual merge remains responsible for concurrent changes and write failures.
"""
from __future__ import annotations

if __name__ == "__main__":
    try:
        import sys
        from recovery_process_boundary import python_entrypoint
        python_entrypoint(__file__)
    except SystemExit:
        raise
    except BaseException:
        sys.stderr.write("Recovery entrypoint unavailable; sensitive details withheld.\n")
        sys.exit(1)

import os
from pathlib import Path
import sys

from database_recovery_packet_io import prime_diagnostic_key, _diagnostic_key, RecoveryError, print_diagnostic
from database_recovery_tools import checked_tool_streams
from recovery_archives import verify_root_link_policy
from recovery_key_safety import reject_key_name


def check_git_state(git):
    """Inventory the updater's fetch and fast-forward writes, without taking locks.

    Merge writes the index, ORIG_HEAD, HEAD and its dereferenced branch; the ref
    locks also serialize their reflog appends (Git has no separate reflog lock).
    Fetch writes FETCH_HEAD, release/auto-followed tags, configured ref mappings
    and, for shallow repos, shallow metadata. Ref writes use the packed ref
    store too. The updater and its native installer/Docker runner do not write
    Git configuration.
    """
    def git_path(name):
        return Path(os.fsdecode(git("rev-parse", "--path-format=absolute", "--git-path", name,
                                   check="Git update destination resolution").removesuffix(b"\n")))

    branch = os.fsdecode(git("rev-parse", "--symbolic-full-name", "HEAD",
                            check="checked-out reference resolution").rstrip(b"\n"))
    # These labels are fixed source text, never resolved paths or branch names.
    writes = [(name, name + " lock") for name in ("index", "HEAD", "ORIG_HEAD", "packed-refs", "FETCH_HEAD", "shallow")]
    writes.append(("refs/heads/main", "main branch lock"))
    if branch.startswith("refs/"):
        writes.append((branch, "checked-out branch lock"))
    # Resolve the destination first: index may be selected by GIT_INDEX_FILE,
    # while refs/packed-refs may belong to Git's common metadata directory.
    paths = []
    for name, check in writes:
        destination = git_path(name)
        # Git's lockfile API follows destination symlinks. Keep the unresolved
        # refusal too, including the default index when another is selected.
        paths.extend(((Path(str(destination) + ".lock"), check),
                      (Path(str(destination.resolve()) + ".lock"), check)))
    paths.append((git_path("HEAD").parent / "index.lock", "default index lock"))
    paths.extend((git_path(name), name + " state") for name in ("MERGE_HEAD", "MERGE_AUTOSTASH", "CHERRY_PICK_HEAD", "REVERT_HEAD",
                                                               "rebase-apply", "rebase-merge", "sequencer", "BISECT_START"))
    # Fetch follows tags and applies configured ref mappings in addition to the
    # explicit release refspec. Refuse existing ref transactions throughout
    # that store, including locks whose corresponding loose ref is absent.
    paths.extend((path, "reference lock") for path in git_path("refs").rglob("*.lock"))
    for path, check in paths:
        if os.path.lexists(path):
            raise RecoveryError(f"Checkout has an existing lock or incomplete Git operation: {check}")


def check_checkout(root, target=None, profile="native"):
    root = Path(root)
    prime_diagnostic_key(root)
    key = _diagnostic_key.get()
    # Keep the archive policy's existing path-specific refusal before the
    # additional Docker destination checks, through its shared implementation.
    verify_root_link_policy(root, "docker" if profile == "docker" else "native")
    if not os.access(root, os.W_OK | os.X_OK):
        raise RecoveryError("Existing checkout root is not writable")
    def git(*arguments, check):
        # Some Git versions refresh diff's index even with optional locks off.
        # The command-local setting disables that write without editing config.
        try:
            status, output, _ = checked_tool_streams(["git", "-c", "diff.autoRefreshIndex=false", "-C", str(root), *arguments],
                                                     dict(os.environ, GIT_OPTIONAL_LOCKS="0"), None, None, key)
        except OSError:
            raise RecoveryError(f"Checkout preflight failed: {check}") from None
        if status:
            raise RecoveryError(f"Checkout preflight failed: {check}")
        return output
    check_git_state(git)
    if target is None:
        return
    tracked = set(git("ls-files", "-z", check="tracked path inventory").split(b"\0"))
    # Treat renames as delete/add so their new destination is checked too.
    for name in git("diff", "--no-renames", "--name-only", "-z", "--diff-filter=AMT", "HEAD", target,
                    check="release path comparison").split(b"\0"):
        if not name:
            continue
        path = root / os.fsdecode(name)
        reject_key_name(path, key)
        if name not in tracked and os.path.lexists(path):
            raise RecoveryError("Existing untracked path obstructs the release")
        for parent in path.parents:
            if parent == root:
                break
            relative = os.fsencode(parent.relative_to(root))
            if os.path.lexists(parent) and (parent.is_symlink() or not parent.is_dir()) and relative not in tracked:
                raise RecoveryError("Existing parent obstructs the release")
            if parent.is_dir() and not os.access(parent, os.W_OK | os.X_OK):
                raise RecoveryError("Existing checkout parent is not writable")
    for name in (".git", ".git/refs/heads", ".git/logs", ".git/logs/refs/heads"):
        path = root / name
        if path.exists() and (not path.is_dir() or not os.access(path, os.W_OK | os.X_OK)):
            raise RecoveryError("Git update destinations are not writable")


def main():
    try:
        from database_recovery_cli import RecoveryArgumentParser
        parser = RecoveryArgumentParser(description=__doc__)
        parser.add_argument("--root", required=True)
        operation = parser.add_mutually_exclusive_group(required=True)
        operation.add_argument("--target")
        operation.add_argument("--locks-only", action="store_const", dest="target", const=None)
        parser.add_argument("--profile", choices=("native", "admin", "development", "docker"), default="native")
        arguments = parser.parse_args()
        check_checkout(arguments.root, arguments.target, arguments.profile)
        return 0
    except RecoveryError as error:
        print_diagnostic(str(error), file=sys.stderr)
        sys.stderr.write("Recovery checkout preflight refused; resolve existing obstructions before update.\n")
        return 1
    except BaseException:
        sys.stderr.write("Checkout preflight failed: internal inspection; sensitive details withheld.\n")
        sys.stderr.write("Recovery checkout preflight refused; resolve existing obstructions before update.\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
