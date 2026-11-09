"""Keep lifecycle tests on their local bare Git transport while presenting a public origin.

Only the exact fixture-owned origin's get-url result is translated. Changed or
multiple origins are passed through unchanged so production rejection is tested.
Git permits only file transport, even when production rejection regresses.
Network-looking addresses also rewrite to a local dead path as a second guard.
"""
from pathlib import Path
import shutil
import sys

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
from server_tools.lib.repository_details import load_repository_details


def install_repository_transport(fake_bin, remote, *, public=None):
    if public is None:
        public = load_repository_details().git_url
    real_git = shutil.which("git")
    script = f'''#!/usr/bin/env python3
import os, subprocess, sys
real_git = {real_git!r}
args = sys.argv[1:]
# Independent of the updater: no HTTP, SSH or external transport helpers.
os.environ["GIT_ALLOW_PROTOCOL"] = "file"
os.environ["GIT_TERMINAL_PROMPT"] = "0"
transport = ["-c", "protocol.allow=never", "-c", "protocol.file.allow=always"]
for scheme in ("https://", "http://", "ssh://", "git://", "git@"):
    transport += ["-c", "url." + {str(Path(remote).parent / 'unavailable-transport')!r} + "/.insteadOf=" + scheme]
for operation in ("fetch", "push", "ls-remote"):
    if operation in args and os.environ.get("FILTEREST_TEST_LOG"):
        with open(os.environ["FILTEREST_TEST_LOG"], "a") as log:
            log.write("git " + operation + "\\n")
if args[-4:] == ["remote", "get-url", "--all", "origin"]:
    # Observe real effective URLs (including test rewrites) for product validation.
    result = subprocess.run([real_git, *args], capture_output=True)
    if result.returncode == 0 and result.stdout.decode().strip() == {str(remote)!r}:
        print({public!r})
    else:
        sys.stdout.buffer.write(result.stdout)
        sys.stderr.buffer.write(result.stderr)
    sys.exit(result.returncode)
os.execv(real_git, [real_git, *transport, *args])
'''
    target = Path(fake_bin) / "git"
    target.write_text(script)
    target.chmod(0o755)
