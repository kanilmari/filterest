"""database_recovery_counts.py: compare a restored database with its archive.

Connect pg_restore's own TOC and COPY rendering to catalogue and exact row counts.
Read rows through a scanning pipe; never retain values or execute archive SQL.
Old authenticated packets need no new manifest or live-database snapshot.
"""
from __future__ import annotations

import json
import re

if __package__:
    from .database_recovery_archive_guard import exact_identity, inspect_entry, inspect_definitions, RESTORE_SCOPE_FLAGS
    from .database_recovery_packet_io import RecoveryError, private_file
else:
    from database_recovery_archive_guard import exact_identity, inspect_entry, inspect_definitions, RESTORE_SCOPE_FLAGS
    from database_recovery_packet_io import RecoveryError, private_file


KINDS = {"TABLE": "tables", "VIEW": "views", "MATERIALIZED VIEW": "views",
         "FUNCTION": "functions", "PROCEDURE": "functions", "AGGREGATE": "functions",
         "SEQUENCE": "sequences"}
DESCRIPTORS = sorted((*KINDS, "TABLE DATA", "TABLE ATTACH", "MATERIALIZED VIEW DATA", "FOREIGN TABLE",
                      "SEQUENCE SET", "SEQUENCE OWNED BY"), key=len, reverse=True)
# Data/attachment entries must win over their object-name prefixes: one
# materialized view has both a definition and a DATA entry, but one pg_class row.
# FORCE cannot remove subscriptions, prepared transactions or active logical
# slots. Only subscriptions are pg_dump TOC objects; transactions and slots are
# not archived. Publications are omitted by --no-publications.
DROP_BLOCKING_DESCRIPTORS = ("SUBSCRIPTION", "PREPARED TRANSACTION", "REPLICATION SLOT")
IDENTIFIER = r'(?:"(?:[^"\r\n]|"")+"|[A-Za-z_\u0080-\uffff][\w$]*)'
QUALIFIED = rf'({IDENTIFIER})\.({IDENTIFIER})'
CREATE = re.compile(rf'^CREATE (?:UNLOGGED )?TABLE {QUALIFIED} \(')
COPY = re.compile(rf'^COPY {QUALIFIED} \(.*\) FROM stdin;$')


class ArchiveRows:
    """Consume only selected TABLE/TABLE DATA entries, counting COPY records."""
    def __init__(self):
        self.pending = b""
        self.rows = {}
        self.tables = set()
        self.copies = set()
        self.current = None

    def write(self, chunk):
        self.pending += chunk
        lines = self.pending.split(b"\n")
        self.pending = lines.pop()
        for raw in lines:
            if self.current is not None:
                if raw == b"\\.":
                    self.current = None
                else:
                    self.rows[self.current] += 1
                continue
            line = raw.decode("utf-8")
            match = CREATE.match(line)
            if match:
                name = tuple(exact_identity([value])[0] for value in match.groups())
                if name in self.tables:
                    raise RecoveryError("Duplicate archive table definition")
                self.tables.add(name)
                self.rows.setdefault(name, 0)
            elif match := COPY.fullmatch(line):
                name = tuple(exact_identity([value])[0] for value in match.groups())
                if name in self.copies:
                    raise RecoveryError("Duplicate archive table data")
                self.copies.add(name)
                self.rows[name] = 0
                self.current = name
            elif line.startswith(("CREATE TABLE ", "CREATE UNLOGGED TABLE ", "COPY ", "INSERT INTO ")):
                raise RecoveryError("Unsupported archive table/data syntax; restore-check requires COPY-format data")
        return len(chunk)

    def finish(self, tables, copies):
        if self.pending.strip() or self.current is not None or len(self.tables) != tables or len(self.copies) != copies:
            raise RecoveryError("Incomplete archive table/row inventory; comparison refused")
        return [dict(schema=schema, table=table, rows=count,
                     **({"extension_data": True} if (schema, table) not in self.tables else {}))
                for (schema, table), count in sorted(self.rows.items())]


def archive_counts(database, dump):
    """Derive expectations from authenticated dump bytes, never a changing live DB."""
    with dump.open("rb") as source:
        listing = database.run(database.command("pg_restore", "--list"), source=source, sensitive=True).decode("utf-8")
    counts = dict.fromkeys(KINDS.values(), 0)
    selected, restore_entries, guarded_entries, copies, materialized_views = [], [], [], 0, 0
    for line in listing.splitlines():
        entry = re.fullmatch(r"\d+;\s+\d+\s+\d+\s+(.+)", line)
        if not entry:
            if line.strip() and not line.startswith(";"):
                raise RecoveryError("Unsupported archive listing; comparison refused")
            continue
        if any(entry[1].startswith(kind + " ") for kind in DROP_BLOCKING_DESCRIPTORS):
            raise RecoveryError("Archive contains subscriptions or other objects that prevent forced database disposal; restore-check refused before creation")
        guarded = inspect_entry(entry[1])
        if guarded is not None:
            guarded_entries.append(guarded)
        kind = next((kind for kind in DESCRIPTORS if entry[1].startswith(kind + " ")), None)
        if kind == "FOREIGN TABLE":
            raise RecoveryError("Foreign tables are not supported by restore-check")
        if kind in KINDS:
            counts[KINDS[kind]] += 1
        materialized_views += kind == "MATERIALIZED VIEW"
        # Restoring DATA refreshes the view and executes its saved query. Keep
        # the definition (WITH NO DATA) and every other restore entry intact.
        if kind != "MATERIALIZED VIEW DATA":
            restore_entries.append(line)
        if kind in ("TABLE", "TABLE DATA"):
            selected.append(line)
            copies += kind == "TABLE DATA"
    selection = database.folder / "restore-check-tables.list"
    with private_file(selection, key=database.key) as destination:
        destination.write(("\n".join(selected) + "\n").encode())
    restore_list = database.folder / "restore-check-restore.list"
    with private_file(restore_list, key=database.key) as destination:
        destination.write(("\n".join(restore_entries) + "\n").encode())
    with dump.open("rb") as source:
        # File rendering MUST omit --dbname, otherwise pg_restore executes SQL.
        # Render all definitions before creating any DB; omit no scope objects
        # here so the guard sees globals, event triggers and stored expressions.
        definitions = database.run(["pg_restore", "--schema-only", "--file=-",
                                    "--no-owner", "--no-privileges"], source=source, sensitive=True)
    inspect_definitions(definitions, guarded_entries)
    rows = ArchiveRows()
    with dump.open("rb") as source:
        # Native only: a file render MUST omit --dbname, otherwise pg_restore
        # executes the archive. The action refuses Docker before reaching here.
        database.run(["pg_restore", "--use-list=" + str(selection), "--file=-",
                      "--no-owner", "--no-privileges", *RESTORE_SCOPE_FLAGS], source=source, destination=rows, sensitive=True)
    return dict(objects=counts, rows=rows.finish(counts["tables"], copies),
                restore_list=restore_list, materialized_views=materialized_views)


OBJECTS_SQL = """WITH relations AS (
 SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
 AND d.objid=c.oid AND d.deptype='e'))
 SELECT jsonb_build_object('tables',(SELECT count(*) FROM relations WHERE relkind IN ('r','p')),
 'views',(SELECT count(*) FROM relations WHERE relkind IN ('v','m')),
 'sequences',(SELECT count(*) FROM relations WHERE relkind='S'),
 'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass
 AND d.objid=p.oid AND d.deptype IN ('e','i'))));
"""


def restored_counts(database, target, expected):
    objects = json.loads(database.sql(OBJECTS_SQL, database=target, sensitive=True))
    rows = []
    for table in expected["rows"]:
        # Names come from the dump, but remain data until quoted by PostgreSQL.
        sql = """SELECT format('SELECT count(*) FROM ONLY %I.%I;', :'schema', :'table')
\\gexec
"""
        if table.get("extension_data"):
            # Extension configuration dumps can include only a filtered subset
            # (e.g. user-added PostGIS reference rows). Use the installed
            # extension's own dump condition, never count its seed rows as lost.
            sql = """SELECT format('SELECT count(*) FROM ONLY %I.%I %s;', n.nspname, c.relname,
 COALESCE(e.extcondition[member.position],'')) FROM pg_extension e
 CROSS JOIN LATERAL unnest(e.extconfig) WITH ORDINALITY member(oid,position)
 JOIN pg_class c ON c.oid=member.oid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=:'schema' AND c.relname=:'table'
\\gexec
"""
        result = database.sql(sql, database=target,
                              variables={"schema": table["schema"], "table": table["table"]}, sensitive=True)
        rows.append(dict(schema=table["schema"], table=table["table"], rows=int(result.strip())))
    return dict(objects=objects, rows=rows)


def comparison(expected, actual):
    """Keep table identities private; expose totals and mismatch counts only."""
    expected_rows = {(row["schema"], row["table"]): row["rows"] for row in expected["rows"]}
    actual_rows = {(row["schema"], row["table"]): row["rows"] for row in actual["rows"]}
    return dict(objects={name: dict(expected=count, actual=actual["objects"].get(name),
                                   matched=count == actual["objects"].get(name))
                         for name, count in expected["objects"].items()},
                tables_checked=len(expected_rows), rows_expected=sum(expected_rows.values()),
                rows_actual=sum(actual_rows.values()),
                materialized_views_definition_only=expected.get("materialized_views", 0),
                materialized_view_row_counts_checked=False,
                tables_mismatched=sum(expected_rows.get(name) != actual_rows.get(name)
                                      for name in expected_rows.keys() | actual_rows.keys()))
