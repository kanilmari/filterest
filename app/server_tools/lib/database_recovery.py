"""database_recovery.py: authenticated packets and retained replacements.

Native and Docker callers share ctl's replacement creation, catalogue acceptance,
database properties/ACL replay and transactional swap. Failed tool diagnostics remain in
private logs; role SQL and verifiers never enter diagnostic output.
"""
from __future__ import annotations

# Direct commands get a fixed import refusal before any path-bearing traceback.
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

from datetime import datetime, timezone
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import signal
import stat
import sys
import tarfile

ROLES = "database.roles.sql"
SETTINGS = "database.settings.tar.gz"
PROPERTIES = "database.properties.json"
CHECKSUMS = "database.sha256"
RECORD = "database.backup.json"
PARTIAL = ".database-backup.partial."
LIBRARY = Path(__file__).resolve().parents[1] / "ctl/lib"


if __package__:
    from .database_recovery_cli import RecoveryArgumentParser, database_parser
    from .database_recovery_packet_io import (RecoveryError, Outcome, private_file, regular_file,
        private_folder, verify_packet_files, digest, stream_digest, publish_file, private_diagnostics, recovery_operation,
        snapshot_packet, snapshot_file, diagnostic_key, prime_diagnostic_key, print_diagnostic)
    from .database_recovery_role_selection import IDENT, role_name, installation_role_source
    from .recovery_key_safety import KEY_NAME as KEY, reject_key_name
    from .database_recovery_prerequisites import verify_restore_sql_inputs, validate_restore_properties
    from .database_recovery_tools import run_database_tool
    from .recovery_archives import create_settings_archive, verify_settings_sources, verify_settings_archive, logical_settings_path, resolve_archive_root, directory_descriptor, verify_root_link_policy
else:
    from database_recovery_cli import RecoveryArgumentParser, database_parser
    from database_recovery_packet_io import (RecoveryError, Outcome, private_file, regular_file,
        private_folder, verify_packet_files, digest, stream_digest, publish_file, private_diagnostics, recovery_operation,
        snapshot_packet, snapshot_file, diagnostic_key, prime_diagnostic_key, print_diagnostic)
    from database_recovery_role_selection import IDENT, role_name, installation_role_source
    from recovery_key_safety import KEY_NAME as KEY, reject_key_name
    from database_recovery_prerequisites import verify_restore_sql_inputs, validate_restore_properties
    from database_recovery_tools import run_database_tool
    from recovery_archives import create_settings_archive, verify_settings_sources, verify_settings_archive, logical_settings_path, resolve_archive_root, directory_descriptor, verify_root_link_policy


def setting_paths(root: Path, profile: str, supplied: list[str]) -> list[Path]:
    verify_root_link_policy(root, profile)
    if profile == "docker":
        return [root / "keys/docker.env", root / "keys/filterest_runtime/runtime_environment.env"]
    if not supplied:
        raise RecoveryError("Native recovery requires the installation's resolved settings paths")
    return [logical_settings_path(root, Path(path).absolute()) for path in supplied]


@recovery_operation
def settings_record(root: Path, paths: list[Path]) -> dict[str, str | None]:
    result = {}
    for path in paths:
        if path.name == KEY:
            raise RecoveryError("The authentication key must never be archived with protected settings")
        path = logical_settings_path(root, path)
        name = str(path.relative_to(root))
        if path.is_symlink():
            raise RecoveryError("Protected settings must be regular files")
        if path.is_file():
            regular_file(path, protected=True)
        result[name] = digest(path) if path.is_file() else None
    if not any(result.values()):
        raise RecoveryError("The installation's protected settings are missing")
    return result


def environment_values(paths: list[Path], profile: str) -> dict[str, str]:
    values = {}
    for path in paths:
        current = {}
        if path.is_file():
            for line in path.read_text().splitlines():
                match = re.fullmatch(r"\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)", line)
                if match:
                    value = match[2].strip()
                    if value[:1] in ('"', "'"):
                        value = value[1:].split(value[0], 1)[0]
                    else:
                        value = re.split(r"\s+#", value, 1)[0].rstrip()
                    current[match[1]] = value
        for key, value in current.items():
            if profile == "docker" or (value and key not in values):
                values[key] = value
    return values


def settings_binding(paths: list[Path], profile: str) -> str:
    # Provider/runtime preferences are archived, but do not decide DB access or identity.
    values = environment_values(paths, profile)
    identity = ("SESSION_KEY", "SESSION_SECRET_KEY", "SESSION_COOKIE_MODE", "SESSION_COOKIE_NAME",
                "SITE_SLUG", "FILTEREST_SITE_SLUG", "INSTANCE_NAME", "COMPOSE_PROJECT_NAME", "FILTEREST_INSTALLATION_ID")
    connection = ("DB_NAME", "DB_SSLMODE") + (("DB_HOST", "DB_PORT") if profile == "native" else ())
    bound = {key: value for key, value in values.items() if key in identity + connection
             or key.startswith("DB_") and key.endswith(("_USER", "_PASSWORD"))}
    return hashlib.sha256(canonical(bound)).hexdigest()


def key_path(root: Path, profile: str, paths: list[Path]) -> Path:
    return root / "keys" / KEY


@recovery_operation
def packet_key(root: Path, profile: str, paths: list[Path], *, create=False) -> bytes:
    verify_root_link_policy(root, profile)
    path = key_path(root, profile, paths)
    if create and not path.parent.exists() and not path.parent.is_symlink():
        path.parent.mkdir(mode=0o700, exist_ok=True)
    resolved = resolve_archive_root(root, "keys")
    path = resolved / KEY
    descriptor = directory_descriptor(resolved)
    try:
        if create:
            try:
                child = os.open(KEY, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
            except FileExistsError:
                pass
            else:
                with os.fdopen(child, "wb") as target:
                    os.fchmod(target.fileno(), 0o600)
                    target.write((secrets.token_hex(32) + "\n").encode())
                    target.flush()
                    os.fsync(target.fileno())
        try:
            child = os.open(KEY, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        except FileNotFoundError:
            raise RecoveryError(f"{path}: Recovery authentication key is missing from keys/; retrieve its separate safe backup, or explicitly use --allow-unauthenticated-restore") from None
        with os.fdopen(child, "r") as source:
            metadata = os.fstat(source.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
                raise RecoveryError(f"{path}: Recovery authentication key must be an owner-only regular file without links, owned by the operator")
            value = source.read(67).strip()
            if metadata.st_size > 66:
                raise RecoveryError(f"{path}: Invalid protected database recovery authentication key")
    finally:
        os.close(descriptor)
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise RecoveryError(f"{path}: Invalid protected database recovery authentication key")
    key = bytes.fromhex(value)
    diagnostic_key(key)
    return key


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def packet_mac(record: dict, key: bytes) -> str:
    # All completion metadata and all artifact digests are inside this canonical record.
    unsigned = {name: value for name, value in record.items() if name != "mac"}
    return hmac.new(key, b"filterest-database-packet-v2\0" + canonical(unsigned), hashlib.sha256).hexdigest()


def native_environment(paths: list[Path]) -> dict[str, str]:
    values = environment_values(paths, "native")
    if not values.get("DB_ADMIN_USER") or not values.get("DB_ADMIN_PASSWORD"):
        raise RecoveryError("Database administrator credentials are missing from protected settings")
    environment = dict(os.environ)
    environment.update(PGHOST=values.get("DB_HOST", "localhost"), PGPORT=values.get("DB_PORT", "5432"),
                       PGUSER=values["DB_ADMIN_USER"], PGPASSWORD=values["DB_ADMIN_PASSWORD"],
                       PGDATABASE=values.get("DB_NAME", "filterest"), PGSSLMODE=values.get("DB_SSLMODE", "prefer"))
    return environment


class Database:
    def __init__(self, root: Path, profile: str, paths: list[Path], folder: Path) -> None:
        self.root, self.profile, self.folder = root, profile, folder
        self.key = packet_key(root, profile, paths) if key_path(root, profile, paths).exists() else None
        self.values = environment_values(paths, profile)
        self.name = self.values.get("DB_NAME", "filterest")
        self.maintenance = "template1" if self.name == "postgres" else "postgres"
        self.environment = dict(os.environ) if profile == "docker" else native_environment(paths)
        self.compose = ["docker", "compose", "--project-directory", str(root), "--file", str(root / "compose.yml"),
                        "--env-file", str(root / "keys/docker.env")]
        self.hidden = [v for k, v in self.values.items() if v and re.search(r"PASSWORD|SECRET|TOKEN|API_KEY", k)]

    def run(self, command: list[str], *, source=None, destination=None, sensitive=False) -> bytes:
        return run_database_tool(self, command, source=source, destination=destination, sensitive=sensitive)

    def command(self, tool: str, *options: str, database: str | None = None) -> list[str]:
        target = database or (self.maintenance if tool == "psql" else self.name)
        list_only = tool == "pg_restore" and options == ("--list",)
        if self.profile != "docker":
            return [tool, *options, *([] if list_only or tool == "pg_dumpall" else ["--dbname=" + target])]
        if list_only:
            return [*self.compose, "exec", "-T", "db", tool, *options]
        suffix = ' --username="$POSTGRES_USER"'
        if tool != "pg_dumpall":
            suffix += ' --dbname="$1"'
        return [*self.compose, "exec", "-T", "db", "sh", "-c",
                'database="$1"; shift; PGPASSWORD="$POSTGRES_PASSWORD" exec "$@"' + suffix.replace('"$1"','"$database"'),
                "sh", target, tool, *options]

    def removal_command(self, kept: str) -> str:
        if self.profile == "docker":
            command = [*self.compose, "exec", "-T", "db", "sh", "-c",
                'PGPASSWORD="$POSTGRES_PASSWORD" exec dropdb --force --username="$POSTGRES_USER" --maintenance-db="$1" -- "$2"',
                "sh", self.maintenance, kept]
        else:
            command = ["dropdb", "--force", "--host=" + self.environment["PGHOST"], "--port=" + self.environment["PGPORT"],
                       "--username=" + self.environment["PGUSER"], "--maintenance-db=" + self.maintenance, "--", kept]
        return shlex.join(command)

    def sql(self, sql: str, *, database=None, variables=None, sensitive=False) -> str:
        options = ["-X", "-qAt", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=sqlstate", "--file=-"]
        for name, value in (variables or {}).items():
            options.extend(["--set", name + "=" + value])
        with io.BytesIO(sql.encode()) as source:
            return self.run(self.command("psql", *options, database=database), source=source, sensitive=sensitive).decode()

    def list_dump(self, path: Path) -> None:
        with path.open("rb") as source:
            self.run(self.command("pg_restore", "--list"), source=source)

    def stop_application(self) -> None:
        if self.profile == "docker":
            self.run([*self.compose, "stop", "app"])
            return
        nested = (self.root / "app").is_dir()
        marker = self.root / ("data/runtime" if nested else "runtime") / "filterest-setup-complete"
        profiles = re.findall(r"^profile=(.*)$", marker.read_text(), re.MULTILINE) if marker.is_file() else []
        if profiles == ["admin"]:
            self.run([str(self.root / ("app" if nested else "") / "server_tools/run_filterest_admin.sh"), "stop"])
        elif profiles == ["development"]:
            self.run([str(self.root / "ctl"), "--stop"])
        else:
            raise RecoveryError("A completed native installation with one known profile is required")


# This small grammar deliberately refuses unsupported dump syntax instead of running it.
# Each SQL statement is one line; identifiers/literals consume embedded semicolons safely.
STRING = r"'(?:[^'\\\n]|'')*'"
VALUE = rf'(?:{STRING}|{IDENT}|-?[0-9]+)'
ROLE_PATTERNS = [
    rf'CREATE ROLE ({IDENT});',
    rf'ALTER ROLE ({IDENT}) (?:WITH )?(?:(?:SUPERUSER|NOSUPERUSER|INHERIT|NOINHERIT|CREATEROLE|NOCREATEROLE|CREATEDB|NOCREATEDB|LOGIN|NOLOGIN|REPLICATION|NOREPLICATION|BYPASSRLS|NOBYPASSRLS)|CONNECTION LIMIT -?[0-9]+|PASSWORD (?:{STRING}|NULL)|VALID UNTIL {STRING})(?:\s+(?:(?:SUPERUSER|NOSUPERUSER|INHERIT|NOINHERIT|CREATEROLE|NOCREATEROLE|CREATEDB|NOCREATEDB|LOGIN|NOLOGIN|REPLICATION|NOREPLICATION|BYPASSRLS|NOBYPASSRLS)|CONNECTION LIMIT -?[0-9]+|PASSWORD (?:{STRING}|NULL)|VALID UNTIL {STRING}))*;',
    rf'ALTER ROLE ({IDENT}) SET {IDENT} TO {VALUE}(?:,\s*{VALUE})*;',
    rf'GRANT ({IDENT}) TO ({IDENT})(?: WITH (?:ADMIN|INHERIT|SET) (?:OPTION|TRUE|FALSE)(?:, (?:ADMIN|INHERIT|SET) (?:OPTION|TRUE|FALSE))*)?(?: GRANTED BY {IDENT})?;',
    rf'COMMENT ON ROLE ({IDENT}) IS (?:{STRING}|NULL);',
    rf'SECURITY LABEL(?: FOR {IDENT})? ON ROLE ({IDENT}) IS (?:{STRING}|NULL);',
]
SET_PATTERN = rf"SET (?:default_transaction_read_only|escape_string_warning|statement_timeout|lock_timeout|idle_in_transaction_session_timeout|transaction_timeout|client_encoding|standard_conforming_strings|search_path|check_function_bodies|client_min_messages|row_security|default_table_access_method) = {VALUE};"


def role_lines(source: str, *, require_guards=True) -> list[tuple[str, list[str]]]:
    parsed, guards = [], []
    complete = False
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith("--"):
            complete |= line == "-- PostgreSQL database cluster dump complete"
            continue
        guard = re.fullmatch(r"\\(unrestrict|restrict) ([A-Za-z0-9]+)", line)
        if guard:
            guards.append((guard[1], guard[2], len(parsed)))
            continue
        if "\\" in line:  # psql interprets backslash commands even within malformed SQL.
            raise RecoveryError("Unsafe or unsupported roles SQL; no application or database changes made")
        if re.fullmatch(SET_PATTERN, line, re.I):
            parsed.append((line, [])); continue
        for pattern in ROLE_PATTERNS:
            match = re.fullmatch(pattern, line)
            if match:
                parsed.append((line, [role_name(identifier) for identifier in match.groups()])); break
        else:
            raise RecoveryError("Unsafe or unsupported roles SQL; no application or database changes made")
    if require_guards or guards:
        if len(guards) != 2 or guards[0] != ('restrict', guards[0][1], 0) or guards[1] != ('unrestrict', guards[0][1], len(parsed)):
            raise RecoveryError("Roles SQL requires exactly one matching leading restrict and trailing unrestrict guard")
    if not complete or not any(line.startswith("CREATE ROLE ") for line, _ in parsed):
        # A bootstrap-only installation legitimately exports no mutable roles.
        if not complete or parsed and any(names for _, names in parsed):
            raise RecoveryError("The roles export is incomplete")
    return parsed


def validate_roles(path: Path, *, allowed=None, bootstrap=None, legacy=False) -> None:
    regular_file(path, protected=True)
    validate_role_source(path.read_text(), allowed=allowed, bootstrap=bootstrap, legacy=legacy)


def validate_role_source(source: str, *, allowed=None, bootstrap=None, legacy=False) -> None:
    for line, names in role_lines(source, require_guards=not legacy):
        # Built-in role memberships may grant privileges to an installation role;
        # their definitions and every bootstrap membership remain immutable.
        checked = names[1:] if (line.startswith("GRANT ") and names[0].startswith("pg_")) else names
        if bootstrap in names or any(name.startswith("pg_") for name in checked) or allowed is not None and any(name not in allowed for name in checked):
            raise RecoveryError("Roles packet contains a bootstrap or unrelated cluster role")


COUNTS_SQL = """SELECT jsonb_build_object('relations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')),
 'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')));"""
SCOPE_SQL = """WITH RECURSIVE roots AS (
 SELECT r.oid FROM pg_roles r WHERE r.rolname IN (SELECT jsonb_array_elements_text(:'configured'::jsonb))
 UNION SELECT refobjid FROM pg_shdepend WHERE (dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
 OR (dbid=0 AND classid='pg_database'::regclass AND objid=(SELECT oid FROM pg_database WHERE datname=current_database())))
 AND refclassid='pg_authid'::regclass
 UNION SELECT setrole FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole<>0), scope(oid) AS (
 SELECT r.oid FROM roots JOIN pg_roles r USING(oid) WHERE r.oid<>10 AND r.rolname !~ '^pg_'
 UNION SELECT next.oid FROM scope s JOIN pg_auth_members m ON (m.roleid=s.oid OR m.member=s.oid)
 CROSS JOIN LATERAL unnest(ARRAY[m.member,m.roleid,m.grantor]) next(oid) JOIN pg_roles r ON r.oid=next.oid
 WHERE m.roleid<>10 AND m.member<>10 AND next.oid<>10 AND r.rolname !~ '^pg_')
 SELECT jsonb_build_object('roles',COALESCE((SELECT jsonb_agg(r.rolname ORDER BY r.rolname) FROM scope s JOIN pg_roles r ON r.oid=s.oid
 WHERE r.rolname !~ '^pg_'),'[]'::jsonb),'bootstrap',(SELECT rolname FROM pg_roles WHERE oid=10));"""


def scoped_roles(database: Database) -> dict:
    configured = [v for k, v in database.values.items() if k.startswith("DB_") and k.endswith("_USER")]
    return json.loads(database.sql(SCOPE_SQL, database=database.name, variables={"configured": json.dumps(configured)}))


def export_roles(database: Database, scope: dict) -> str:
    # PG16 cannot exclude roles in pg_dumpall. Omit ALL verifiers there, filter
    # to this installation BEFORE strict validation, then read only its verifiers.
    raw = database.run(database.command("pg_dumpall", "--roles-only", "--no-role-passwords"), sensitive=True).decode()
    raw = raw.replace("SELECT pg_catalog.set_config('search_path', '', false);", "SET search_path = '';")
    source = installation_role_source(raw, scope)
    # Unsupported installation SQL must fail before reading passwords as well.
    validate_role_source(source, allowed=scope["roles"], bootstrap=scope["bootstrap"])
    passwords = database.sql("""SELECT format('ALTER ROLE %I PASSWORD %L;',rolname,rolpassword) FROM pg_authid
 WHERE oid<>10 AND rolname IN (SELECT jsonb_array_elements_text(:'roles'::jsonb)) ORDER BY rolname;""",
                             variables={"roles": json.dumps(scope["roles"])}, sensitive=True)
    source = source.replace("-- PostgreSQL database cluster dump complete\n", passwords + "-- PostgreSQL database cluster dump complete\n")
    validate_role_source(source, allowed=scope["roles"], bootstrap=scope["bootstrap"])
    return source


def legacy_manifest(folder: Path, root: Path, profile: str) -> None:
    if not folder.name.startswith("update_"):
        raise RecoveryError("Legacy recovery requires an update_* folder with this installation's profile manifest")
    regular_file(folder / "manifest.txt", protected=True)
    manifest = (folder / "manifest.txt").read_text()
    profiles = re.findall(r"^profile=(.*)$", manifest, re.M)
    expected = "docker"
    if profile == "native":
        marker = root / ("data/runtime" if (root / "app").is_dir() else "runtime") / "filterest-setup-complete"
        profiles_at_installation = re.findall(r"^profile=(.*)$", marker.read_text(), re.M)
        expected = profiles_at_installation[0] if len(profiles_at_installation) == 1 else "unknown"
        # The old native updater wrote release metadata and a dump, but no settings archive/profile.
        if not profiles and expected in ("admin", "development") and not (folder / "installation_settings.tar.gz").exists():
            fields = ("from_version", "to_version", "release_tag", "release_commit", "created_at")
            if all(len(re.findall(rf"^{field}=.+$", manifest, re.M)) == 1 for field in fields):
                return
    if profiles != [expected]:
        raise RecoveryError("Legacy update manifest does not name this installation's profile")


@recovery_operation
def verify_packet(folder: Path, root: Path, profile: str, paths: list[Path], *, allow_legacy=False, allow_unauthenticated=False, archive=None, match_settings=True) -> dict | None:
    key = packet_key(root, profile, paths) if key_path(root, profile, paths).exists() else None
    with private_diagnostics("verify", packet=folder, archive=archive, key=key) as logs:
        snapshot = snapshot_packet(folder, logs / ("update_snapshot" if folder.name.startswith("update_") else "packet_snapshot"), key)
        archive = snapshot_file(archive, logs / "external-settings.tar.gz", key) if archive else None
        return _verify_packet_snapshot(snapshot, root, profile, paths, allow_legacy=allow_legacy,
            allow_unauthenticated=allow_unauthenticated, archive=archive, match_settings=match_settings)


@recovery_operation
def _verify_packet_snapshot(folder: Path, root: Path, profile: str, paths: list[Path], *, allow_legacy=False, allow_unauthenticated=False, archive=None, match_settings=True) -> dict | None:
    """Validate only a private captured packet; callers keep it through consumption."""
    private_folder(folder, writable=False)
    if list(folder.glob(PARTIAL + "*")):
        raise RecoveryError("Backup folder is incomplete")
    record_path = folder / RECORD
    if not record_path.exists():
        if any((folder / name).exists() or (folder / name).is_symlink() for name in (RECORD, ROLES, SETTINGS, PROPERTIES, CHECKSUMS)):
            raise RecoveryError("Partial backup: the paired database recovery record is missing")
        if not allow_legacy:
            raise RecoveryError("Unauthenticated legacy backup requires explicit --legacy")
        legacy_manifest(folder, root, profile)
        regular_file(folder / "database.dump", protected=True)
        key = packet_key(root, profile, paths) if key_path(root, profile, paths).exists() else None
        verify_packet_files(folder, key)
        return None
    regular_file(record_path, protected=True)
    record = json.loads(record_path.read_text())
    if not isinstance(record, dict):
        raise RecoveryError("Backup completion record must be an object")
    version = record.get("format_version")
    if version not in (1, 2) or record.get("profile") != profile:
        raise RecoveryError("Backup format or installation profile does not match")
    key = packet_key(root, profile, paths) if key_path(root, profile, paths).exists() else None
    if version == 2 and not allow_unauthenticated:
        if not isinstance(record.get("mac"), str) or not hmac.compare_digest(record["mac"], packet_mac(record, packet_key(root, profile, paths))):
            raise RecoveryError("Backup authentication failed; no application or database changes made")
    elif version == 1 and not (allow_legacy or allow_unauthenticated):
        raise RecoveryError("Unauthenticated packet requires explicit --legacy")
    dump_name = record.get("dump")
    if not isinstance(dump_name, str) or Path(dump_name).name != dump_name or dump_name in (ROLES, SETTINGS, PROPERTIES, CHECKSUMS, RECORD):
        raise RecoveryError("Invalid database archive name in the backup record")
    files = record.get("files", {})
    required = {dump_name, ROLES, SETTINGS} | ({PROPERTIES} if version == 2 else set())
    if not isinstance(files, dict) or set(files) != required:
        raise RecoveryError("Partial backup: required database recovery files are missing")
    for name, checksum in files.items():
        reject_key_name(name, key)
        regular_file(folder / name, protected=True)
        if digest(folder / name) != checksum:
            raise RecoveryError(f"Backup checksum failed: {name}")
    regular_file(folder / CHECKSUMS, protected=True)
    if (folder / CHECKSUMS).read_text() != "".join(f"{files[name]}  {name}\n" for name in sorted(files)):
        raise RecoveryError("Backup checksum list does not match the recovery record")
    validate_roles(folder / ROLES, allowed=record.get("roles") if version == 2 else None,
                   bootstrap=record.get("bootstrap"), legacy=version == 1)
    if match_settings:
        require_matching_settings(record, root, paths)
    verify_packet_files(folder, key)
    verify_settings_archive(folder / SETTINGS, record["settings"], key=key)
    if archive is not None:
        verify_settings_archive(archive, record["settings"], key=key, full_installation=True)
    return record


def require_matching_settings(record: dict, root: Path, paths: list[Path]) -> None:
    matches = (record.get("binding") == settings_binding(paths, record["profile"])) if record.get("format_version") == 2 else record.get("settings") == settings_record(root, paths)
    if not matches:
        raise RecoveryError("Protected settings differ from this backup. Restore this installation's database access and identity settings together with its roles; no verifiers or data were imported")

@recovery_operation
def backup_preflight(root: Path, profile: str, paths: list[Path]) -> None:
    verify_root_link_policy(root, profile)
    settings_record(root, paths)  # Check portability before the updater stops the app.
    key = packet_key(root, profile, paths, create=True)
    verify_settings_sources(root, paths, key)
    verify_restore_sql_inputs(key, LIBRARY)
    if profile == "native":
        native_environment(paths)
    with private_diagnostics("preflight", key=key) as logs:
        database = Database(root, profile, paths, logs)
        export_roles(database, scoped_roles(database))


def create_backup(args, root: Path, paths: list[Path], outcome: Outcome) -> None:
    target = Path(args.output).absolute()
    folder = target.parent
    names = [target.name, ROLES, SETTINGS, PROPERTIES, CHECKSUMS, RECORD]
    if KEY in names or len(set(names)) != len(names) or any("\n" in name or "\\" in name for name in names):
        raise RecoveryError("Invalid database archive filename")
    private_folder(folder)
    if list(folder.glob(PARTIAL + "*")):
        raise RecoveryError("Backup folder contains an interrupted packet; use a new folder")
    if any((folder / name).exists() or (folder / name).is_symlink() for name in names):
        raise RecoveryError("Backup target already exists")
    backup_preflight(root, args.profile, paths)
    key = packet_key(root, args.profile, paths)
    database = Database(root, args.profile, paths, folder)
    for name in names:
        reject_key_name(name, key)
    verify_packet_files(folder, key)
    binding = settings_binding(paths, args.profile)
    if __package__:
        from .recovery_key_safety import private_temporary_path
    else:
        from recovery_key_safety import private_temporary_path
    stage = private_temporary_path(folder, key, prefix=PARTIAL, directory=True)
    published = []
    try:
        def dump():
            with private_file(stage / target.name, key=key) as destination:
                database.run(database.command("pg_dump", *args.dump_options), destination=destination)
            regular_file(stage / target.name, protected=True)
            database.list_dump(stage / target.name)
            properties = json.loads(database.sql((LIBRARY / "instance_restore_properties.sql").read_text() +
                "\nSELECT pg_temp.database_snapshot(:'target');", database=database.name, variables={"target": database.name}, sensitive=True))
            counts = json.loads(database.sql(COUNTS_SQL, database=database.name))
            with private_file(stage / PROPERTIES, key=key) as destination:
                destination.write(canonical({"database": properties, "counts": counts}) + b"\n")
        outcome.step(dump)
        scope = scoped_roles(database)
        def roles():
            with private_file(stage / ROLES, key=key) as destination:
                destination.write(export_roles(database, scope).encode())
            validate_roles(stage / ROLES, allowed=scope["roles"], bootstrap=scope["bootstrap"])
        outcome.step(roles)
        def seal():
            settings = create_settings_archive(root, paths, stage / SETTINGS, key)
            files = {name: digest(stage / name) for name in (target.name, ROLES, SETTINGS, PROPERTIES)}
            record = dict(format_version=2, profile=args.profile, dump=target.name, files=files, settings=settings,
                          binding=binding, roles=scope["roles"], bootstrap=scope["bootstrap"])
            record["mac"] = packet_mac(record, key)
            with private_file(stage / CHECKSUMS, key=key) as destination:
                destination.write("".join(f"{files[name]}  {name}\n" for name in sorted(files)).encode())
            with private_file(stage / RECORD, key=key) as destination:
                destination.write(canonical(record) + b"\n")
            verify_packet(stage, root, args.profile, paths)
            for name in names:  # Completion record last, partial directory survives SIGKILL.
                publish_file(stage / name, folder / name, key=key)
                published.append(folder / name)
        outcome.step(seal)
    except BaseException:
        for path in reversed(published):
            path.unlink()
        raise
    finally:
        shutil.rmtree(stage)
    outcome.finish(f"Database backup written and authenticated: {target}")


def roles_for_import(source: str) -> str:
    pattern = re.compile(r'^CREATE ROLE ("(?:[^"\n]|"")+"|[a-zA-Z_][a-zA-Z_0-9$]*);$', re.MULTILINE)
    def replace(match):
        identifier = match[1]
        literal = role_name(identifier).replace("'", "''")
        statement = ("CREATE ROLE " + identifier).replace("'", "''")
        delimiter = "$filterest_role_restore$"
        while delimiter in identifier:
            delimiter = delimiter[:-1] + "_$"
        return (f"DO {delimiter} BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '{literal}') THEN "
                f"EXECUTE '{statement}'; END IF; END; {delimiter};")
    result = pattern.sub(replace, source)
    if re.search(r"^CREATE ROLE ", result, re.MULTILINE):
        raise RecoveryError("The roles backup contains an unsupported role identifier")
    return result


def restore_backup(args, root: Path, paths: list[Path], outcome: Outcome) -> None:
    if not args.yes:
        raise RecoveryError("Restoring the database requires --yes; review the backup and restore its settings first")
    folder = Path(args.backup).absolute()
    with private_diagnostics("restore", packet=folder, key=packet_key(root, args.profile, paths) if key_path(root, args.profile, paths).exists() else None) as logs:
        database = Database(root, args.profile, paths, logs)
        folder = snapshot_packet(folder, logs / ("update_snapshot" if folder.name.startswith("update_") else "packet_snapshot"), database.key)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dt%H%M%S%fz")
        # PostgreSQL identifiers are limited to 63 bytes; retain an identifying prefix.
        prefix = database.name.encode()[:22].decode(errors="ignore")
        replacement, kept = f"{prefix}_restore_{stamp}", f"{prefix}_before_restore_{stamp}"
        variables = {"target": database.name, "replacement": replacement, "recovery": kept}
        def preflight():
            verify_restore_sql_inputs(database.key, LIBRARY)
            record = _verify_packet_snapshot(folder, root, args.profile, paths, allow_legacy=args.legacy,
                                   allow_unauthenticated=args.allow_unauthenticated_restore)
            if folder.name.startswith("update_"):
                regular_file(folder / "manifest.txt", protected=True)
            dump = folder / (record["dump"] if record else "database.dump")
            database.list_dump(dump)
            scope = scoped_roles(database)
            prepared = None
            if record:
                source = (folder / ROLES).read_text()
                if record["format_version"] == 2:
                    validate_role_source(source, allowed=record["roles"], bootstrap=scope["bootstrap"])
                else:
                    # Explicit legacy mode still never replays unrelated/bootstrap roles.
                    source_lines = role_lines(source, require_guards=False)
                    guard = secrets.token_hex(24)
                    source = f"\\restrict {guard}\n" + "\n".join(line for line, names in source_lines
                        if not names or all(name in scope["roles"] for name in names) or (line.startswith("GRANT ") and names[0].startswith("pg_")) and names[1] in scope["roles"]) + "\n-- PostgreSQL database cluster dump complete\n" + f"\\unrestrict {guard}\n"
                prepared = roles_for_import(source)
            properties = json.loads((folder / PROPERTIES).read_text()) if record and record["format_version"] == 2 else None
            if properties is not None:
                validate_restore_properties(properties)
            database.sql((LIBRARY / "instance_restore_preflight.sql").read_text(), variables=variables)
            return dump, prepared, record, properties
        dump, roles, record, properties = outcome.step(preflight)
        if args.allow_unauthenticated_restore or args.legacy and (record is None or record["format_version"] == 1):
            print_diagnostic("WARNING: UNAUTHENTICATED RESTORE AUTHORIZED. Checksums cannot prove who created this packet; forged database code or role privileges may execute.", file=sys.stderr)
        outcome.step(database.stop_application)
        def import_roles():
            if roles is None:
                print_diagnostic("Legacy backup: existing roles retained; restoring with --no-owner", flush=True)
                return
            require_matching_settings(record, root, paths)
            # Recheck the private snapshot, never the mutable packet folder.
            _verify_packet_snapshot(folder, root, args.profile, paths, allow_legacy=args.legacy,
                          allow_unauthenticated=args.allow_unauthenticated_restore)
            database.sql("BEGIN;\n" + roles + "\nCOMMIT;", sensitive=True)
        outcome.step(import_roles)
        swapping = False
        try:
            outcome.step(database.sql, (LIBRARY / "instance_restore_create.sql").read_text(), variables=variables)
            def import_data():
                options = ["--exit-on-error", "--single-transaction"]
                if roles is None:
                    options.append("--no-owner")
                with dump.open("rb") as source:
                    database.run(database.command("pg_restore", *options, database=replacement), source=source)
            outcome.step(import_data)
            def verify_replacement():
                database.sql((LIBRARY / "instance_restore_verify.sql").read_text(), database=replacement)
                counts = json.loads(database.sql(COUNTS_SQL, database=replacement))
                if properties and counts != properties["counts"]:
                    raise RecoveryError("Replacement object counts differ from the authenticated backup")
                if counts["relations"] < 4:
                    raise RecoveryError("Replacement has too few Filterest catalogue objects")
                sql = "BEGIN;\n" + (LIBRARY / "instance_restore_properties.sql").read_text() + (LIBRARY / "instance_restore_acl.sql").read_text()
                if properties:
                    snapshot = canonical(properties["database"]).decode().replace("'", "''")
                    sql += "\nSET standard_conforming_strings=on;\nCREATE TEMP TABLE restore_database_source AS SELECT '" + snapshot + "'::jsonb AS info;\n"
                    variables["connection_limit"] = str(int(properties["database"]["properties"]["datconnlimit"]))
                sql += (LIBRARY / "instance_restore_settings.sql").read_text() + "\nCOMMIT;"
                database.sql(sql, variables=variables, sensitive=True)
            outcome.step(verify_replacement)
            swapping = True
            outcome.step(database.sql, (LIBRARY / "instance_restore_swap.sql").read_text(), variables=variables)
        except BaseException:
            if swapping:
                print_diagnostic(f"Swap did not report success: inspect original names {database.name} / {kept} and replacement {replacement}. Application remains stopped.", file=sys.stderr)
            else:
                print_diagnostic(f"Restore failed: original database retained as {database.name}; inspect replacement {replacement}. Application remains stopped.", file=sys.stderr)
            raise
    outcome.finish(f"Database restored; application remains stopped. Original kept as {kept}. After verifying readiness, remove it with: {database.removal_command(kept)}")


def main() -> int:
    parser = database_parser(__doc__)
    args = parser.parse_args()
    if args.action == "backup" and not args.output or args.action in ("verify", "restore") and not args.backup:
        parser.error("backup requires --output; verify/restore require --backup")
    if args.action != "restore" and (args.yes or args.legacy or args.allow_unauthenticated_restore):
        parser.error("--yes, --legacy and --allow-unauthenticated-restore apply only to restore")
    steps = {"backup": ["Dump and read back the database", "Export and validate installation roles", "Authenticate and publish the packet"],
             "verify": ["Verify database recovery packet"], "preflight": ["Check portable recovery prerequisites"], "setup-key": ["Prepare protected recovery authentication key"],
             "restore": ["Authenticate backup and check protected settings", "Stop the application", "Import installation roles before data",
                         "Create replacement database", "Restore into replacement", "Verify catalogue, counts and database settings", "Retain original and swap names"]}
    outcome = Outcome(steps[args.action])
    try:
        root = Path(args.root).resolve()
        prime_diagnostic_key(root)
        paths = setting_paths(root, args.profile, args.settings)
        if args.action == "backup":
            create_backup(args, root, paths, outcome)
        elif args.action == "restore":
            restore_backup(args, root, paths, outcome)
        elif args.action == "preflight":
            outcome.step(backup_preflight, root, args.profile, paths)
            outcome.finish("Recovery prerequisites checked before shutdown.")
        elif args.action == "setup-key":
            outcome.step(packet_key, root, args.profile, paths, create=True)
            outcome.finish("Protected authentication key prepared.")
        else:
            def verify():
                folder = Path(args.backup).absolute()
                with private_diagnostics("verify", packet=folder, archive=Path(args.archive) if args.archive else None, key=packet_key(root, args.profile, paths) if key_path(root, args.profile, paths).exists() else None) as logs:
                    database = Database(root, args.profile, paths, logs)
                    folder = snapshot_packet(folder, logs / "packet_snapshot", database.key)
                    archive = snapshot_file(Path(args.archive), logs / "external-settings.tar.gz", database.key) if args.archive else None
                    record = _verify_packet_snapshot(folder, root, args.profile, paths, archive=archive)
                    database.list_dump(folder / record["dump"])
            outcome.step(verify)
            outcome.finish("Database recovery packet verified.")
        return 0
    except RecoveryError as error:
        outcome.fail(str(error))
    except InterruptedError:
        outcome.fail("Interrupted; operation not completed")
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError):
        outcome.fail("Backup or protected settings could not be read or validated; sensitive details withheld")
    return 1


def interrupted(signum, frame) -> None:
    # A shell may forward a signal already delivered to the process group.
    # Repeated interruption must not abort the staging cleanup itself.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    raise InterruptedError


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main())
