#!/usr/bin/env python3
# ==============================================================================
# server_tools/rotate_credentials.py
# Interactive credential rotation tool for Easelect.
# Scans the native external key root plus runtime-owned local .env files.
# Lets the user update passwords/keys without echoing credential material.
# Run: python3 server_tools/rotate_credentials.py
# ==============================================================================

import getpass
import os
import re
import secrets
import string
import sys
from pathlib import Path
from typing import Optional

# ── Paths ──────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
INSTANCES_ROOT = ROOT / "instances"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server_tools.lib.easelect_private_paths import resolve_easelect_private_paths
from server_tools.public_slice_export.publication_channel_reader import load_publication_channel


PRIVATE_PATHS = resolve_easelect_private_paths(ROOT)
PUBLICATION_CHANNEL = load_publication_channel()
FILTEREST_TARGET = (ROOT / PUBLICATION_CHANNEL.target_relative).resolve()
SEED_FILES = [PRIVATE_PATHS.runtime_env_file, PRIVATE_PATHS.development_env_file]

ADDITIONAL_SECRET_SCOPES = [
    (
        "development tool: embedding benchmark",
        [ROOT / "server_tools" / "devtest_embedding_benchmark" / ".env"],
    ),
    (
        "generated artifact: active Filterest local runtime",
        [FILTEREST_TARGET / ".env", FILTEREST_TARGET / "dev_env.txt"],
    ),
    (
        "generated preview: filterest-clean-preview local runtime",
        [
            ROOT.parent / "filterest-clean-preview" / ".env",
            ROOT.parent / "filterest-clean-preview" / "dev_env.txt",
        ],
    ),
]

# ── Credential categories ──────────────────────────────────────────────────────
# Keys that can be auto-generated with a random secure value.
AUTO_KEYS = {
    "DB_ADMIN_PASSWORD",
    "DB_PASSWORD",
    "DB_READONLY_PASSWORD",
    "DB_CONFIDENTIAL_PASSWORD",
    "DB_BASIC_PASSWORD",
    "DB_GUEST_PASSWORD",
    "SESSION_KEY",
    "SESSION_SECRET_KEY",
    "MCP_SERVICE_TOKEN",
    "REGFETCH_WORKER_SERVICE_TOKEN",
    "PAYMENT_CALLBACK_SECRET",
    "BACKUP_ZIP_PASSWORD",
}

# External service keys — user must enter manually (no auto-gen).
# Prefer POSTMARK_API_KEY, but keep the legacy Postmark token name available
# until existing untracked .env files have been renamed in production.
MANUAL_KEYS = {
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "ANTHROPIC_API_KEY",
    "HERE_API_KEY",
    "POSTMARK_API_KEY",
    "POSTMARK_SERVER_TOKEN",
    "NGROK_AUTHTOKEN",
    "MML_API_KEY",
}

ALL_ROTATABLE = AUTO_KEYS | MANUAL_KEYS
STRICT_PERMISSION_FILENAMES = {
    ".env",
    "dev_env.txt",
    "runtime_environment.env",
    "development_environment.env",
    "revolut.env",
    "environment_type.env",
}
STRICT_PERMISSION_MODE = 0o600

# Mapping from env key → PostgreSQL role name for SQL ALTER hints.
# Role names come from the _USER counterpart variables in .env.
DB_ROLE_MAP = {
    "DB_ADMIN_PASSWORD":       "admin_user",
    "DB_PASSWORD":             "postgres",
    "DB_READONLY_PASSWORD":    "readeronly",
    "DB_CONFIDENTIAL_PASSWORD":"limited_user",
    "DB_BASIC_PASSWORD":       "basic_user",
    "DB_GUEST_PASSWORD":       "guest_user",
}

# ── Terminal colors ────────────────────────────────────────────────────────────

COLORS = {
    "header": "\033[1;36m",
    "ok":     "\033[0;32m",
    "warn":   "\033[0;33m",
    "err":    "\033[0;31m",
    "dim":    "\033[0;90m",
    "bold":   "\033[1m",
    "reset":  "\033[0m",
}

def c(color: str, text: str) -> str:
    """Wrap text in an ANSI color code."""
    return f"{COLORS[color]}{text}{COLORS['reset']}"

# ── Generators ─────────────────────────────────────────────────────────────────

def generate_db_password(length: int = 32) -> str:
    """Alphanumeric password safe for SQL and shell."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))

def generate_session_key(length: int = 48) -> str:
    """URL-safe token suitable for session secrets."""
    return secrets.token_urlsafe(length)

def generate_for_key(key: str) -> str:
    """Pick the right generator for the given key name."""
    if key in DB_ROLE_MAP:
        return generate_db_password()
    return generate_session_key()

def mask(value: str) -> str:
    """Describe whether a value exists without exposing any of its characters."""
    return f"<set:{len(value)} chars>" if value else "<empty>"

# ── File I/O ───────────────────────────────────────────────────────────────────

def read_file(path: Path) -> str:
    """Read one credential-bearing environment file."""
    return path.read_text(encoding="utf-8")

def write_file(path: Path, content: str) -> None:
    """Write one credential-bearing environment file."""
    path.write_text(content, encoding="utf-8")

def requires_strict_permissions(path: Path) -> bool:
    """Whether this env-like file should use chmod 600."""
    return path.name in STRICT_PERMISSION_FILENAMES

def get_file_permissions(path: Path) -> int:
    """Return permission bits like 0o600 for the given path."""
    return path.stat().st_mode & 0o777

def format_permissions(mode: int) -> str:
    """Render permission bits in three-digit octal form."""
    return format(mode, "03o")

def display_path(path: Path) -> Path:
    """Use a repo-relative path when possible and retain valid sibling paths."""
    try:
        return path.relative_to(ROOT)
    except ValueError:
        return path

def warn_insecure_permissions(files: list[Path]) -> None:
    """Print non-destructive warnings for secret-bearing env files that are too open."""
    for path in files:
        if not path.exists() or not requires_strict_permissions(path):
            continue
        mode = get_file_permissions(path)
        if mode != STRICT_PERMISSION_MODE:
            print(
                f"  {c('warn', '⚠')} {display_path(path)} permissions are "
                f"{format_permissions(mode)} (expected 600)"
            )

def tighten_permissions(path: Path) -> bool:
    """Set chmod 600 on a secret file or its symlink target when needed."""
    if not path.exists() or not requires_strict_permissions(path):
        return False
    current_mode = get_file_permissions(path)
    if current_mode == STRICT_PERMISSION_MODE:
        return False
    path.chmod(STRICT_PERMISSION_MODE)
    return True

def get_key_value(content: str, key: str) -> Optional[str]:
    """Extract the current value of a KEY=VALUE line (non-commented, single-line)."""
    m = re.search(rf"^{re.escape(key)}=(.+)$", content, re.MULTILINE)
    return m.group(1).strip() if m else None

def set_key_value(content: str, key: str, new_value: str) -> tuple:
    """
    Replace KEY=<old> with KEY=<new> for the first non-commented occurrence.
    Returns (new_content, changed: bool).
    """
    pattern = rf"^({re.escape(key)})=(.*)$"
    new_content, n = re.subn(pattern, rf"\1={new_value}", content, flags=re.MULTILINE)
    return new_content, n > 0

# ── Key discovery ──────────────────────────────────────────────────────────────

def discover_keys(files: list) -> dict:
    """
    Scan files and return {key: [(Path, current_value), ...]} for all
    rotatable keys that actually exist (non-commented) in those files.
    """
    found = {}
    for path in files:
        if not path.exists():
            continue
        content = read_file(path)
        for key in ALL_ROTATABLE:
            value = get_key_value(content, key)
            if value is not None:
                found.setdefault(key, []).append((path, value))
    return found

# ── Interactive prompts ────────────────────────────────────────────────────────

def prompt_auto(key: str, locations: list) -> str:
    """
    Prompt for an auto-generatable key.
    Returns '__GENERATE__', '__SKIP__', or a user-entered string.
    """
    files_str = c("dim", ", ".join(p.name for p, _ in locations))
    current = mask(locations[0][1])
    print(f"\n  {c('bold', key)}")
    print(f"    Current: {c('dim', current)}   Files: {files_str}")
    raw = input("    (g)enerate / (m)anual entry / (s)kip [g]: ").strip().lower()
    if raw in ("", "g"):
        return "__GENERATE__"
    if raw == "s":
        return "__SKIP__"
    if raw == "m":
        val = getpass.getpass("    New value: ").strip()
        return val or "__SKIP__"
    return "__SKIP__"

def prompt_manual(key: str, locations: list) -> str:
    """
    Prompt for a manual-only API key.
    Returns the new value or '__SKIP__'.
    """
    files_str = c("dim", ", ".join(p.name for p, _ in locations))
    current = mask(locations[0][1])
    print(f"\n  {c('bold', key)}")
    print(f"    Current: {c('dim', current)}   Files: {files_str}")
    val = getpass.getpass("    New value (blank = skip): ").strip()
    return val or "__SKIP__"

# ── Apply changes to files ─────────────────────────────────────────────────────

def apply_changes(files: list, changes: dict) -> list[Path]:
    """
    Write all {key: new_value} changes into the given files.
    Returns list of relative paths that were actually written.
    """
    written: list[Path] = []
    for path in files:
        if not path.exists():
            continue
        content = read_file(path)
        file_changed = False
        for key, new_val in changes.items():
            content, did_change = set_key_value(content, key, new_val)
            if did_change:
                file_changed = True
        if file_changed:
            write_file(path, content)
            written.append(path)
    return written

# ── Scope handler ──────────────────────────────────────────────────────────────

def rotate_scope(scope_name: str, files: list) -> None:
    print(f"\n{c('header', '═' * 60)}")
    print(f"{c('header', f'  Scope: {scope_name}')}")
    print(c("dim", f"  Files: {', '.join(str(display_path(f)) for f in files if f.exists())}"))
    print(c("header", "═" * 60))

    found = discover_keys(files)
    if not found:
        print(c("warn", "  No rotatable keys found in these files. Skipping."))
        return

    warn_insecure_permissions(files)

    auto_found   = {k: v for k, v in found.items() if k in AUTO_KEYS}
    manual_found = {k: v for k, v in found.items() if k in MANUAL_KEYS}

    changes = {}     # key → new_value
    db_roles_to_update: set[str] = set()

    # ── Auto-generatable keys ─────────────────────────────────────────────────
    if auto_found:
        print(f"\n{c('bold', '[ Passwords & secrets ]')}  (can be auto-generated)\n")
        for key in sorted(auto_found):
            action = prompt_auto(key, auto_found[key])
            if action == "__SKIP__":
                print(f"    {c('dim', 'skipped')}")
                continue
            new_val = generate_for_key(key) if action == "__GENERATE__" else action
            changes[key] = new_val
            print(f"    {c('ok', '→')} {c('dim', mask(new_val))}")
            if key in DB_ROLE_MAP:
                db_roles_to_update.add(DB_ROLE_MAP[key])

    # ── External API keys ─────────────────────────────────────────────────────
    if manual_found:
        print(f"\n{c('bold', '[ External API keys ]')}  (enter manually)\n")
        for key in sorted(manual_found):
            action = prompt_manual(key, manual_found[key])
            if action == "__SKIP__":
                print(f"    {c('dim', 'skipped')}")
                continue
            changes[key] = action
            print(f"    {c('ok', '→')} {c('dim', mask(action))}")

    if not changes:
        print(c("dim", "\n  Nothing changed for this scope."))
        return

    # ── Confirm before writing ────────────────────────────────────────────────
    print(f"\n  {c('bold', f'About to write {len(changes)} change(s). Proceed?')}")
    confirm = input("  (y)es / (n)o [y]: ").strip().lower()
    if confirm not in ("", "y", "yes"):
        print(c("warn", "  Aborted — no files written."))
        return

    written = apply_changes(files, changes)
    for path in written:
        print(f"  {c('ok', '✓')} Written: {display_path(path)}")
        if tighten_permissions(path):
            print(f"  {c('ok', '✓')} Tightened permissions: {display_path(path)} → 600")

    # ── PostgreSQL role follow-up ─────────────────────────────────────────────
    if db_roles_to_update:
        print(f"\n  {c('warn', '⚠  DB passwords changed — update PostgreSQL roles safely:')}")
        db_port = _guess_db_port(files)
        print(c("dim", f"  (Connect: psql -U postgres -p {db_port} -d easelect)\n"))
        print(f"  Roles: {', '.join(sorted(db_roles_to_update))}")
        print("  Use the approved database-admin workflow; no password-bearing SQL is printed.")

def _guess_db_port(files: list) -> str:
    """Best-effort: read DB_PORT from one of the scope files."""
    for path in files:
        if path.exists():
            val = get_key_value(read_file(path), "DB_PORT")
            if val:
                return val
    return "5432"

def discover_instance_env_files(instances_root: Path = INSTANCES_ROOT) -> dict[str, Path]:
    """Return instance-name -> .env path for each instance directory under instances/."""
    if not instances_root.exists():
        return {}

    discovered = {}
    for entry in sorted(instances_root.iterdir(), key=lambda path: path.name):
        if not entry.is_dir() or entry.name.startswith(".") or entry.name == "template":
            continue
        discovered[entry.name] = entry / ".env"
    return discovered

# ── Scope menu ─────────────────────────────────────────────────────────────────

def build_scope_menu(
    seed_files: Optional[list[Path]] = None,
    instance_dirs: Optional[dict[str, Path]] = None,
    additional_scopes: Optional[list[tuple[str, list[Path]]]] = None,
) -> list:
    """Return ordered list of (display_name, files) tuples."""
    menu = [(
        "seed / native dev  (external runtime + development env)",
        seed_files or SEED_FILES,
    )]
    for name, path in (instance_dirs or discover_instance_env_files()).items():
        exists = path.exists()
        label = f"instance: {name}"
        if not exists:
            label += c("err", "  [file missing]")
        menu.append((label, [path]))
    menu.extend(ADDITIONAL_SECRET_SCOPES if additional_scopes is None else additional_scopes)
    return menu

# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    print(c("header", """
╔══════════════════════════════════════════════════════════════╗
║          Easelect Credential Rotation Tool                   ║
║   Passwords · Session secrets · API keys · SQL hints         ║
╚══════════════════════════════════════════════════════════════╝
"""))

    menu = build_scope_menu()

    print("Select scope to rotate:\n")
    print(f"  {c('bold', '0')}  All scopes")
    for i, (label, _) in enumerate(menu, start=1):
        print(f"  {c('bold', str(i))}  {label}")

    raw = input(f"\nChoice [0-{len(menu)}]: ").strip()

    if raw == "0":
        selected = list(range(len(menu)))
    elif raw.isdigit() and 1 <= int(raw) <= len(menu):
        selected = [int(raw) - 1]
    else:
        print(c("err", "Invalid choice. Exiting."))
        sys.exit(1)

    for idx in selected:
        label, files = menu[idx]
        # Derive a clean scope name for display (strip ANSI from label)
        scope_name = re.sub(r"\033\[[0-9;]*m", "", label).strip()
        rotate_scope(scope_name, files)

    # ── Admin password reminder ───────────────────────────────────────────────
    print(f"""
{c('warn', '━' * 62)}
{c('bold', '  ⚠  Remember: change the admin password in the browser UI')}
{c('warn', '━' * 62)}

  Application user passwords are stored in the database —
  this script does NOT update them. Change the password manually:

    1. Sign in to the app as the user whose password you want to change
    2. Open: /user
    3. Enter the current password, request the OTP, then save the new password

{c('dim', '  This script only updates .env files, not user records in the app database.')}

  Public TLS certificates stay in the host edge runbook. To verify the edge
  without changing certificate or proxy files, run:

    ./server_tools/check_edge_tls_readiness.sh --domain example.com
""")

if __name__ == "__main__":
    main()
