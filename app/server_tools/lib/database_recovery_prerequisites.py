"""database_recovery_prerequisites.py: existing restore inputs before shutdown.

Connect the packet's captured metadata and maintained SQL with read-only checks.
Reject structural errors before changing services; replacement results stay live.
Use the same key scanner for every SQL source, with no parallel spelling rules.
"""
from __future__ import annotations

if __package__:
    from .database_recovery_packet_io import RecoveryError, regular_file
    from .recovery_key_safety import reject_key_bytes
else:
    from database_recovery_packet_io import RecoveryError, regular_file
    from recovery_key_safety import reject_key_bytes


def verify_restore_sql_inputs(key, library) -> None:
    for filename in ("properties", "create", "verify", "settings", "acl", "swap", "preflight"):
        path = library / f"instance_restore_{filename}.sql"
        regular_file(path)
        with path.open("rb") as source:
            reject_key_bytes(source, key)


def validate_restore_properties(properties) -> None:
    """Validate fields consumed later by Python; do not predict imported objects."""
    try:
        counts = properties["counts"]
        database = properties["database"]
        limit = database["properties"]["datconnlimit"]
        if (not isinstance(counts, dict) or set(counts) != {"relations", "functions"} or
                any(type(value) is not int or value < 0 for value in counts.values()) or
                counts["relations"] < 4 or type(limit) is not int or not -1 <= limit <= 2147483647):
            raise ValueError
        if (not isinstance(database["owner"], str) or not database["owner"] or
                not isinstance(database["tablespace"], str) or not database["tablespace"] or
                type(database["properties"]["datallowconn"]) is not bool or
                not isinstance(database["settings"], list) or not isinstance(database["acl"], list)):
            raise ValueError
        for setting in database["settings"]:
            if (not isinstance(setting, dict) or
                    setting["role"] is not None and not isinstance(setting["role"], str) or
                    not isinstance(setting["values"], list) or
                    any(not isinstance(value, str) or "=" not in value or not value.split("=", 1)[0]
                        for value in setting["values"])):
                raise ValueError
        for grant in database["acl"]:
            if (not isinstance(grant, dict) or any(not isinstance(grant[name], str) or not grant[name]
                    for name in ("grantor", "grantee", "privilege")) or type(grant["grantable"]) is not bool):
                raise ValueError
    except (KeyError, TypeError, ValueError):
        raise RecoveryError("Restore properties are incomplete or unsupported; application unchanged") from None
