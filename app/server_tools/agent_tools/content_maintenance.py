#!/usr/bin/env python3
# content_maintenance.py
# Plans and applies small metadata-validated content batches through the existing HTTP API.
# Connects authored data, exact live snapshots, real backups, and durable write journals.
# Keeps retries and partial failures reviewable without direct SQL or bulk deletion.
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import getpass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

try:
    from .easelect_api_client import EaselectAPIClient, EaselectAPIError
except ImportError:
    from easelect_api_client import EaselectAPIClient, EaselectAPIError

FORMAT = 1
MAX_ROWS = 1000
MAX_AGE = 3600
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TEXT_TYPES = {"text", "character varying", "character"}
NUMBER_TYPES = {"smallint", "integer", "bigint", "numeric", "decimal", "real", "double precision"}


class Conflict(RuntimeError):
    """The exact reviewed content or safety boundary no longer holds."""


def digest(value):
    """Bind a reviewed JSON artifact without depending on whitespace or key order."""
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def origin(value):
    """Require an explicit HTTPS origin without credentials, paths, or redirects."""
    parsed = urlsplit(str(value))
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"}):
        raise Conflict("target must be one HTTPS origin without embedded credentials")
    port = parsed.port
    host = parsed.hostname.lower()
    if ":" in host:
        host = "[" + host + "]"
    return "https://" + host + (f":{port}" if port and port != 443 else "")


def load_json(path):
    """Read operator-selected JSON without accepting non-finite numeric values."""
    def invalid_constant(_):
        raise Conflict("non-finite JSON numbers are not supported")
    return json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=invalid_constant)


def write_json(path, value):
    """Atomically publish potentially private content with owner-only permissions."""
    path = Path(path)
    if not path.parent.is_dir():
        raise Conflict("output parent directory must already exist")
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def flatten_datasets(payload):
    """Read the registered dataset list and reject unsupported response shapes."""
    rows = payload.get("datasets") if isinstance(payload, dict) else payload
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise Conflict("registered dataset metadata is unavailable")
    return rows


def metadata(client, dataset):
    """Combine registered datasets, stable table UIDs, types, and editor boundaries."""
    if not IDENTIFIER.fullmatch(dataset):
        raise Conflict("dataset must be a plain registered identifier")
    client.login()
    matches = [row for row in flatten_datasets(client.request("GET", "/api/datasets"))
               if row.get("dataset_name") == dataset]
    if len(matches) != 1 or matches[0].get("can_read_rows") is not True:
        raise Conflict("target dataset is not uniquely readable")
    tree = client.request("GET", "/api/tree_data")
    detail_rows = [row for row in tree.get("column_details", [])
                   if row.get("table_name") == dataset and row.get("column_name")]
    table_uids = {row.get("table_uid") for row in detail_rows}
    if len(table_uids) != 1 or not all(type(uid) is int and uid > 0 for uid in table_uids):
        raise Conflict("stable table UID metadata is unavailable or ambiguous")
    table_uid = table_uids.pop()
    details = {row["column_name"]: row for row in detail_rows}
    if len(details) != len(detail_rows):
        raise Conflict("column visibility metadata is ambiguous")
    payload = client.request("GET", "/api/get-add-row-metadata", query={"table_uid": table_uid})
    result = {}
    for raw in payload.get("columns", []):
        name = raw.get("column_name", "")
        detail = details.get(name, {})
        if not name or name in result:
            raise Conflict("column metadata is ambiguous")
        result[name] = {
            "data_type": raw.get("data_type"),
            "nullable": raw.get("is_nullable") == "YES",
            "identity": raw.get("is_identity") == "YES",
            "generated": bool(raw.get("generation_expression")),
            "default": bool(raw.get("column_default")),
            "insertable": raw.get("insertable", {}),
            "editable": detail.get("editable_in_ui") is True,
            "hidden": detail.get("hide_everywhere") is True,
            "delivery": detail.get("client_delivery_mode", "include"),
            "multilingual": raw.get("is_multilingual") is True,
            "languages": sorted(row["language_code"] for row in (raw.get("multilingual_languages") or [])),
            "foreign_dataset": raw.get("foreign_dataset_name"),
            "foreign_column": raw.get("foreign_column_name"),
        }
    if "id" not in result:
        raise Conflict("the API row-id contract is not available")
    return {"table_uid": table_uid, "columns": result}


def decoded(value, column):
    """Compare multilingual text and JSON using their actual values, not serialization."""
    if (column["multilingual"] or column["data_type"] in {"json", "jsonb"}) and isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError as error:
            raise Conflict("existing JSON/localized content is malformed") from error
    return value


def validate_value(value, column, *, reference=False):
    """Reject unsupported field values before any write is attempted."""
    if reference and isinstance(value, dict) and set(value) == {"$ref"}:
        if column["data_type"] not in {"integer", "bigint", "smallint"}:
            raise Conflict("row references require an integer relationship field")
        return
    if value is None:
        if not column["nullable"]:
            raise Conflict("null supplied for a required field")
        return
    if column["multilingual"]:
        if (not isinstance(value, dict) or not value or not column["languages"]
                or not set(value) <= set(column["languages"])
                or not all(isinstance(item, str) for item in value.values())):
            raise Conflict("localized content must use the field's advertised language codes")
        return
    data_type = column["data_type"]
    valid = ((data_type in TEXT_TYPES and isinstance(value, str))
             or (data_type == "boolean" and isinstance(value, bool))
             or (data_type in NUMBER_TYPES and type(value) in {int, float} and math.isfinite(value))
             or (data_type in {"json", "jsonb"} and isinstance(value, (dict, list, str, int, float, bool))))
    if data_type in {"integer", "bigint", "smallint"} and type(value) is not int:
        valid = False
    if not valid:
        raise Conflict("value does not match a supported metadata type")


def validate_definition(definition, meta, dataset):
    """Validate one bounded declarative batch and its optional self-reference order."""
    if (not isinstance(definition, dict) or set(definition) - {"format", "rows", "order"}
            or definition.get("format") != FORMAT):
        raise Conflict("unsupported content definition")
    rows = definition.get("rows")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        raise Conflict("definition must contain 1 to 1000 rows")
    columns, refs, fields = meta["columns"], set(), set()
    for row in rows:
        if not isinstance(row, dict) or set(row) - {"ref", "match", "values", "create", "expect"}:
            raise Conflict("unsupported row definition")
        ref = row.get("ref", "")
        if not isinstance(ref, str) or not IDENTIFIER.fullmatch(ref) or ref in refs:
            raise Conflict("row references must be unique plain identifiers")
        refs.add(ref)
        if type(row.get("create", False)) is not bool:
            raise Conflict("create must be an explicit boolean")
        for section in ("match", "values", "expect"):
            values = row.get(section, {})
            if not isinstance(values, dict) or (section == "match" and not values):
                raise Conflict("row match must be a nonempty exact field map")
            for name, value in values.items():
                column = columns.get(name)
                if not column or column["hidden"] or column["delivery"] != "include":
                    raise Conflict("unknown, hidden, or server-only field")
                if section == "values" and (name == "id" or column["identity"]
                                           or column["generated"] or not column["editable"]):
                    raise Conflict("field is generated, an identity, or not editable")
                validate_value(value, column, reference=(section == "values"))
                if isinstance(value, dict) and set(value) == {"$ref"}:
                    if value["$ref"] not in refs - {ref}:
                        raise Conflict("row references must point to an earlier named row")
                    if column["foreign_dataset"] != dataset or column["foreign_column"] != "id":
                        raise Conflict("row reference must target this dataset's id")
                fields.add(name)
        if row.get("create") and "id" in row["match"]:
            raise Conflict("new rows must match a stable authored field, not an API id")
        if any(name in row.get("values", {}) and row["values"][name] != value
               for name, value in row["match"].items()):
            raise Conflict("stable matching values cannot change in the same batch")
    order = definition.get("order")
    if order:
        if set(order) != {"field", "refs"} or order["refs"] != [row["ref"] for row in rows]:
            raise Conflict("order must name every row once in definition order")
        column = columns.get(order["field"], {})
        if (column.get("foreign_dataset") != dataset or column.get("foreign_column") != "id"
                or not column.get("nullable") or not column.get("editable")
                or column.get("hidden") or column.get("delivery") != "include"
                or column.get("data_type") not in {"integer", "bigint", "smallint"}):
            raise Conflict("ordering requires an editable nullable self-reference field")
        if any(order["field"] in row.get("values", {}) or order["field"] in row["match"] for row in rows):
            raise Conflict("ordering field must not also be an authored value or matcher")
        fields.add(order["field"])
    return sorted(fields | {"id"})


def read_rows(client, dataset, fields, meta):
    """Read every visible row and refuse incomplete projections before hashing or writing."""
    rows = client.get_all_dataset_rows(dataset, sort_column="id", sort_order="ASC")
    if len(rows) > MAX_ROWS or len({row.get("id") for row in rows}) != len(rows):
        raise Conflict("dataset exceeds the bounded batch size or has ambiguous ids")
    projected = []
    for row in rows:
        if type(row.get("id")) is not int or row["id"] <= 0 or not set(fields) <= set(row):
            raise Conflict("rows are not fully readable for the requested fields")
        projected.append({name: decoded(row[name], meta["columns"][name]) for name in fields})
    return sorted(projected, key=lambda row: row["id"])


def matches(row, wanted, columns):
    """Match stable fields exactly, preserving additional locales on multilingual rows."""
    for name, value in wanted.items():
        actual = decoded(row.get(name), columns[name])
        if columns[name]["multilingual"] and isinstance(value, dict):
            if not isinstance(actual, dict) or any(actual.get(key) != item for key, item in value.items()):
                return False
        elif actual != value:
            return False
    return True


def resolve(definition, rows, meta, *, check_expect=False):
    """Resolve names to zero or one visible row and reject aliases of the same identity."""
    resolved, ids = {}, set()
    for item in definition["rows"]:
        found = [row for row in rows if matches(row, item["match"], meta["columns"])]
        if len(found) > 1 or (not found and not item.get("create")):
            raise Conflict("row matcher is ambiguous or its required row is missing")
        row = found[0] if found else None
        if row and row["id"] in ids:
            raise Conflict("two named rows resolve to the same API row")
        if check_expect and row and not matches(row, item.get("expect", {}), meta["columns"]):
            raise Conflict("recovery expectation changed; new review is required")
        if row:
            ids.add(row["id"])
        resolved[item["ref"]] = row
    return resolved


def desired(item, previous, resolved, meta, order_field=None):
    """Merge authored locale patches and resolve previously bound row references."""
    current = resolved[item["ref"]]
    values = {**(item["match"] if current is None else {}), **item.get("values", {})}
    if order_field:
        values[order_field] = previous
    for name, value in list(values.items()):
        column = meta["columns"][name]
        if isinstance(value, dict) and set(value) == {"$ref"}:
            target = resolved[value["$ref"]]
            if target is None:
                raise Conflict("referenced row has not been created")
            values[name] = target["id"]
        elif column["multilingual"] and value is not None:
            old = current.get(name) if current else {}
            if old is not None and not isinstance(old, dict):
                raise Conflict("existing multilingual value is not a language object")
            values[name] = {**(old or {}), **value}
    return values


def wire(values, meta):
    """Encode multilingual maps only for legacy text columns, as the existing API expects."""
    return {name: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            if meta["columns"][name]["multilingual"] and meta["columns"][name]["data_type"] in TEXT_TYPES
            and value is not None else value for name, value in values.items()}


def user_insertable(column):
    """Mirror the API's nullable insertability flag; reject malformed metadata."""
    value = column["insertable"]
    if type(value) is bool:
        return value
    return (isinstance(value, dict) and type(value.get("Valid")) is bool
            and type(value.get("Bool")) is bool and (not value["Valid"] or value["Bool"]))


def build_plan(client, base_url, dataset, definition):
    """Bind reviewed target, metadata, authored changes, and full relevant before-state."""
    meta = metadata(client, dataset)
    fields = validate_definition(definition, meta, dataset)
    rows = read_rows(client, dataset, fields, meta)
    resolved = resolve(definition, rows, meta, check_expect=True)
    for item in definition["rows"]:
        if resolved[item["ref"]] is not None:
            continue
        supplied = set(item["match"]) | set(item.get("values", {}))
        if definition.get("order"):
            supplied.add(definition["order"]["field"])
        for name, col in meta["columns"].items():
            allowed = user_insertable(col)
            if name in supplied and (name == "id" or col["identity"] or col["generated"]
                                     or not col["editable"] or not allowed):
                raise Conflict("new row contains a non-insertable field")
            if (allowed and col["editable"] and not col["nullable"] and not col["default"]
                    and not col["identity"] and not col["generated"] and name not in supplied):
                raise Conflict("new row omits a required metadata field")
    plan = {"format": FORMAT, "target": origin(base_url), "dataset": dataset,
            "definition": definition, "metadata": meta, "fields": fields, "before": rows,
            "before_sha256": digest(rows)}
    plan["plan_sha256"] = digest(plan)
    return plan


def verify_backup(receipt_path, plan, *, now=None):
    """Verify real backup bytes and review-bound provenance, not merely a claimed hash."""
    receipt = load_json(receipt_path)
    for key, expected in (("target", plan["target"]), ("dataset", plan["dataset"]),
                          ("plan_sha256", plan["plan_sha256"]), ("before_sha256", plan["before_sha256"])):
        if receipt.get(key) != expected:
            raise Conflict("backup receipt does not match this reviewed target and plan")
    if (receipt.get("provenance") != "operator-confirmed"
            or not str(receipt.get("database_name", "")).strip()
            or not str(receipt.get("instance_identity", "")).strip()):
        raise Conflict("backup requires operator-confirmed database and instance provenance")
    created = datetime.fromisoformat(receipt["created_at"].replace("Z", "+00:00"))
    if created.tzinfo is None:
        raise Conflict("backup timestamp must include its timezone")
    age = ((now or datetime.now(timezone.utc)) - created).total_seconds()
    if not -60 <= age <= MAX_AGE:
        raise Conflict("backup must be from the previous hour")
    artifacts = receipt.get("artifacts", [])
    if not artifacts or sum(item.get("kind") == "database" for item in artifacts) != 1:
        raise Conflict("backup receipt must identify one concrete database dump")
    for item in artifacts:
        path = Path(item["path"]).expanduser()
        if not path.is_absolute():
            path = Path(receipt_path).resolve().parent / path
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            raise Conflict("backup artifact is missing, empty, or a symlink")
        artifact_age = ((now or datetime.now(timezone.utc)).timestamp() - path.stat().st_mtime)
        if not -60 <= artifact_age <= MAX_AGE or path.stat().st_mtime < created.timestamp() - 300:
            raise Conflict("backup artifact is older than the declared recovery point")
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != item.get("sha256"):
            raise Conflict("backup artifact checksum changed")
        if item["kind"] == "database":
            with path.open("rb") as stream:
                if stream.read(5) != b"PGDMP":
                    raise Conflict("database backup must be a PostgreSQL custom dump")
            restore = shutil.which("pg_restore")
            if not restore:
                raise Conflict("pg_restore is required to validate the database dump")
            result = subprocess.run([restore, "--list", str(path)], capture_output=True)
            if result.returncode != 0:
                raise Conflict("database backup archive is not readable")
    return digest(receipt)


def all_desired(plan, rows):
    """Recognize a repeated completed apply before considering any new writes."""
    resolved = resolve(plan["definition"], rows, plan["metadata"])
    previous = None
    for item in plan["definition"]["rows"]:
        row = resolved[item["ref"]]
        if row is None:
            return False
        values = desired(item, previous, resolved, plan["metadata"],
                         plan["definition"].get("order", {}).get("field"))
        if any(row.get(name) != value for name, value in values.items()):
            return False
        previous = row["id"]
    return True


def apply_plan(client, plan, base_url, dataset, confirm_hash, receipt_path, journal_path):
    """Fail closed on drift, journal each write before sending, and verify every changed field."""
    if (plan.get("format") != FORMAT or plan.get("target") != origin(base_url)
            or plan.get("dataset") != dataset or plan.get("plan_sha256") != confirm_hash
            or digest({key: value for key, value in plan.items() if key != "plan_sha256"}) != confirm_hash):
        raise Conflict("apply requires the exact reviewed target, dataset, and plan hash")
    meta = metadata(client, dataset)
    fields = validate_definition(plan["definition"], meta, dataset)
    if meta != plan["metadata"] or fields != plan["fields"]:
        raise Conflict("metadata changed after the reviewed plan")
    current = read_rows(client, dataset, fields, meta)
    if all_desired(plan, current):
        if Path(journal_path).exists():
            prior = load_json(journal_path)
            if prior.get("plan_sha256") != confirm_hash or prior.get("target") != plan["target"]:
                raise Conflict("journal belongs to another reviewed plan")
            prior.update(state="complete", reconciled_readback_sha256=digest(current))
            if prior.get("pending"):
                prior["reconciled_pending"] = prior.pop("pending")
            write_json(journal_path, prior)
        return {"changed": False, "verified": True, "plan_sha256": confirm_hash}
    if Path(journal_path).exists():
        raise Conflict("an incomplete journal exists; reconcile it before another apply")
    if digest(current) != plan["before_sha256"]:
        raise Conflict("live content changed after the reviewed plan")
    backup_hash = verify_backup(receipt_path, plan)
    journal = {"format": FORMAT, "target": plan["target"], "dataset": dataset,
               "plan_sha256": confirm_hash, "backup_receipt_sha256": backup_hash,
               "state": "running", "metadata": meta, "before": current, "steps": [], "pending": None}
    write_json(journal_path, journal)
    resolved = resolve(plan["definition"], current, meta)

    def perform(ref, values):
        nonlocal current, resolved
        item = next(row for row in plan["definition"]["rows"] if row["ref"] == ref)
        row = resolved[ref]
        action = "update" if row else "create"
        if row and all(row.get(name) == value for name, value in values.items()):
            return
        live = read_rows(client, dataset, fields, meta)
        if live != current:
            raise Conflict("concurrent content change detected before write")
        if row is None:
            for name in values:
                col = meta["columns"][name]
                allowed = user_insertable(col)
                if name == "id" or col["identity"] or col["generated"] or not col["editable"] or not allowed:
                    raise Conflict("new row contains a non-insertable field")
        journal["pending"] = {"ref": ref, "action": action, "id": row["id"] if row else None,
                              "before": {name: row[name] for name in values} if row else None,
                              "values": values}
        write_json(journal_path, journal)
        if row:
            client.update_row(dataset, row["id"], wire(values, meta))
        else:
            client.add_row(dataset, wire(values, meta))
        after = read_rows(client, dataset, fields, meta)
        rebound = resolve(plan["definition"], after, meta)
        result = rebound[ref]
        if result is None or any(result.get(name) != value for name, value in values.items()):
            raise Conflict("written fields did not match API readback")
        expected = copy.deepcopy(current)
        if row:
            next(item for item in expected if item["id"] == row["id"]).update(values)
        else:
            expected.append(result)
            expected.sort(key=lambda item: item["id"])
        if expected != after:
            raise Conflict("unrequested fields or other rows changed during write")
        journal["steps"].append({**journal["pending"], "id": result["id"], "verified": True})
        journal["pending"] = None
        write_json(journal_path, journal)
        current, resolved = after, rebound

    try:
        order_field = plan["definition"].get("order", {}).get("field")
        if order_field:
            for item in plan["definition"]["rows"]:
                if resolved[item["ref"]]:
                    perform(item["ref"], {order_field: None})
        previous = None
        for item in plan["definition"]["rows"]:
            values = desired(item, previous, resolved, meta, order_field)
            perform(item["ref"], values)
            previous = resolved[item["ref"]]["id"]
        if not all_desired(plan, current):
            raise Conflict("final content or ordering differs from the reviewed definition")
        journal.update(state="complete", readback_sha256=digest(current))
        write_json(journal_path, journal)
        return {"changed": True, "verified": True, "plan_sha256": confirm_hash,
                "readback_sha256": digest(current), "writes": len(journal["steps"])}
    except Exception as error:
        journal.update(state="needs_reconciliation", failure_type=type(error).__name__)
        write_json(journal_path, journal)
        raise Conflict("apply stopped; the private journal records verified and uncertain writes") from error


def recovery_definition(journal):
    """Prepare update-only compensation with exact current-value expectations; never delete."""
    if journal.get("pending"):
        raise Conflict("uncertain write must be reconciled before generating compensation")
    existing, created = {}, []
    for step in journal.get("steps", []):
        if step["action"] == "create":
            created.append(step["id"])
        elif step["id"] not in created:
            row = existing.setdefault(step["id"], {"ref": "restore_" + str(step["id"]),
                                      "match": {"id": step["id"]}, "values": {}, "expect": {}})
            for field, value in step["before"].items():
                after = step["values"][field]
                if journal["metadata"]["columns"][field]["multilingual"] and isinstance(value, dict):
                    if not isinstance(after, dict) or set(after) - set(value):
                        raise Conflict("added locale requires explicit operator compensation")
                    changed = {code: old for code, old in value.items() if after.get(code) != old}
                    if changed:
                        row["values"].setdefault(field, {}).update(changed)
                        row["expect"].setdefault(field, {}).update({code: after[code] for code in changed})
                else:
                    row["values"].setdefault(field, value)
                    row["expect"][field] = after
    if created:
        raise Conflict("created rows require explicit operator review; no automatic delete is available")
    if not existing:
        raise Conflict("journal has no verified updates to compensate")
    return {"format": FORMAT, "rows": list(existing.values())}


def validate_artifact_paths(args):
    """Keep writable CLI artifacts separate from each other and their inputs.

    Resolve path aliases before authentication, lock creation, or API writes.
    Existing journals remain writable for apply, but are protected inputs when
    preparing recovery. This does not change backup validation or no-op retries.
    """
    outputs = [("output", Path(args.output))]
    inputs = []
    if args.action == "recovery-definition":
        inputs.append(("journal", Path(args.journal)))
    else:
        if args.credentials_file:
            inputs.append(("credentials", Path(args.credentials_file)))
        if args.action == "plan":
            inputs.append(("definition", Path(args.definition)))
        else:
            outputs.extend([("journal", Path(args.journal)),
                            ("journal lock", Path(args.journal + ".lock"))])
            inputs.extend([("plan", Path(args.plan)),
                           ("backup receipt", Path(args.backup_receipt))])
            # An already-completed apply does not require a readable receipt.
            # Inspect available artifact references without making a receipt
            # mandatory or replacing the strict pre-write backup validation.
            try:
                receipt = load_json(args.backup_receipt)
            except (OSError, ValueError, Conflict):
                receipt = {}
            artifacts = receipt.get("artifacts", []) if isinstance(receipt, dict) else []
            if isinstance(artifacts, list):
                for item in artifacts:
                    if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                        continue
                    artifact = Path(item["path"]).expanduser()
                    if not artifact.is_absolute():
                        artifact = Path(args.backup_receipt).resolve().parent / artifact
                    inputs.append(("backup artifact", artifact))

    def same_path(left, right):
        try:
            if left.resolve() == right.resolve():
                return True
            try:
                return left.samefile(right)
            except FileNotFoundError:
                return False
        except (OSError, RuntimeError) as error:
            raise Conflict("artifact paths cannot be resolved safely") from error

    for index, (label, path) in enumerate(outputs):
        for other_label, other in outputs[index + 1:] + inputs:
            if same_path(path, other):
                raise Conflict(f"{label} must not alias {other_label}")


def make_client(args):
    """Use protected native credentials or explicitly selected origin-bound remote credentials."""
    target = origin(args.base_url)
    client_kwargs = {"base_url": target, "environment": {}}
    if args.credentials_file:
        path = Path(args.credentials_file)
        if path.is_symlink() or (os.name == "posix" and path.stat().st_mode & 0o077):
            raise Conflict("credentials file must be owner-only and not a symlink")
        auth = load_json(path)
        if origin(auth.get("target")) != target:
            raise Conflict("credentials belong to a different origin")
        client_kwargs.update(username=auth["username"], password=auth["password"], otp_code=auth.get("otp_code"))
    elif args.prompt_credentials:
        if not sys.stdin.isatty():
            raise Conflict("credential prompts require a visible interactive terminal")
        print(f"Service: {target}\nTarget dataset: {args.dataset}\n"
              "Use the existing authorizing application account. A second-factor prompt may follow.",
              file=sys.stderr)
        username = input("Existing account username: ").strip()
        client_kwargs.update(username=username, password=getpass.getpass(f"Password for {username}: "),
                             verification_code_provider=lambda _: getpass.getpass("Account verification code: "))
    client = EaselectAPIClient(**client_kwargs)
    if not client.is_local_native_target and not (args.credentials_file or args.prompt_credentials):
        raise Conflict("remote targets require explicit origin-bound credentials or an interactive prompt")
    return client


def main(argv=None):
    """Expose reviewable plan/apply/recovery operations with concise, non-content stdout."""
    parser = argparse.ArgumentParser(description=__doc__ or "Metadata-driven content maintenance")
    parser.add_argument("action", choices=["plan", "apply", "recovery-definition"])
    parser.add_argument("--base-url")
    parser.add_argument("--dataset")
    parser.add_argument("--definition")
    parser.add_argument("--plan")
    parser.add_argument("--confirm-plan-sha256")
    parser.add_argument("--backup-receipt")
    parser.add_argument("--journal")
    parser.add_argument("--output", required=True)
    auth = parser.add_mutually_exclusive_group()
    auth.add_argument("--credentials-file")
    auth.add_argument("--prompt-credentials", action="store_true")
    args = parser.parse_args(argv)
    if args.action == "recovery-definition":
        if not args.journal:
            parser.error("--journal is required")
        validate_artifact_paths(args)
        definition = recovery_definition(load_json(args.journal))
        write_json(args.output, definition)
        print(json.dumps({"recovery_definition": args.output, "rows": len(definition["rows"])}))
        return 0
    if not args.base_url or not args.dataset:
        parser.error("--base-url and --dataset are required")
    if args.action == "plan" and not args.definition:
        parser.error("--definition is required")
    if args.action == "apply" and not all(
            [args.plan, args.confirm_plan_sha256, args.backup_receipt, args.journal]):
        parser.error("apply requires --plan, --confirm-plan-sha256, --backup-receipt, and --journal")
    validate_artifact_paths(args)
    client = make_client(args)
    if args.action == "plan":
        plan = build_plan(client, args.base_url, args.dataset, load_json(args.definition))
        write_json(args.output, plan)
        print(json.dumps({"plan": args.output, "plan_sha256": plan["plan_sha256"],
                          "before_sha256": plan["before_sha256"], "rows": len(plan["definition"]["rows"])}))
        return 0
    lock_path = Path(args.journal + ".lock")
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise Conflict("another apply owns this journal lock; inspect it before retrying") from error
    try:
        os.close(fd)
        result = apply_plan(client, load_json(args.plan), args.base_url, args.dataset,
                            args.confirm_plan_sha256, args.backup_receipt, args.journal)
        write_json(args.output, result)
        print(json.dumps(result))
    finally:
        lock_path.unlink()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (Conflict, EaselectAPIError, OSError, ValueError, KeyError, TypeError) as error:
        # API exception bodies may contain private data; never echo them.
        message = str(error) if isinstance(error, Conflict) else type(error).__name__
        print("Content maintenance stopped: " + message, file=sys.stderr)
        raise SystemExit(1)
