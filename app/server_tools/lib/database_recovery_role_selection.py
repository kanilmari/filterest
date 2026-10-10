"""database_recovery_role_selection.py: narrow cluster exports to installation roles.

Connects password-free pg_dumpall output with recovery's strict replay grammar.
Unrelated SQL is discarded without being trusted, replayed or echoed.
"""
from __future__ import annotations

import re
import secrets

if __package__:
    from .database_recovery_packet_io import RecoveryError
else:
    from database_recovery_packet_io import RecoveryError


IDENT = r'(?:"(?:[^"\n]|"")+"|[A-Za-z_][A-Za-z_0-9$]*)'


def role_name(identifier: str) -> str:
    return identifier[1:-1].replace('""', '"') if identifier.startswith('"') else identifier.lower()


def installation_role_source(raw: str, scope: dict) -> str:
    """Select untrusted dump lines by role identity; only strict validation trusts SQL.

    Unrelated definitions may use syntax or identifiers our replay grammar refuses.
    Never copy them, log them or broaden the replay grammar to accommodate them.
    Unknown statements mentioning an installation role remain for strict refusal.
    """
    selected = set(scope["roles"])
    lines, complete = [], False
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("--"):
            complete |= line == "-- PostgreSQL database cluster dump complete"
            continue
        if re.fullmatch(r"\\(?:unrestrict|restrict) [A-Za-z0-9]+", line):
            continue  # The selected export gets its own guards below.
        target = re.match(rf'^(?:CREATE ROLE|ALTER ROLE|COMMENT ON ROLE|SECURITY LABEL(?: FOR {IDENT})? ON ROLE) ({IDENT})(?=\s|;|$)', line)
        membership = re.match(rf'^GRANT ({IDENT}) TO ({IDENT})(?=\s|;|$)', line)
        if target:
            keep = role_name(target[1]) in selected
        elif membership:
            parent, member = (role_name(identifier) for identifier in membership.groups())
            keep = member in selected and (parent in selected or parent.startswith("pg_"))
        else:
            # Ignore literals when locating identities in unsupported statements,
            # e.g. GRANT SET ON PARAMETER ... TO an installation role.
            tokens = re.finditer(rf"{IDENT}|'(?:[^'\n]|'')*'", line)
            identifiers = [token[0] for token in tokens if not token[0].startswith("'")]
            keep = line.startswith(("SET ", "\\")) or any(role_name(name) in selected for name in identifiers)
        if keep:
            lines.append(line)
    if not complete:
        raise RecoveryError("The roles export is incomplete")
    guard = secrets.token_hex(24)
    return f"\\restrict {guard}\n" + "\n".join(lines) + "\n-- PostgreSQL database cluster dump complete\n" + f"\\unrestrict {guard}\n"
