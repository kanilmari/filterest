#!/usr/bin/env python3
"""
db.py - Database query tool for Filterest instances

A standalone installation queries its own configured database. A workspace
that runs several Docker instances declares their layout through
FILTEREST_DATABASE_INSTANCE_CONTAINER_PREFIX and FILTEREST_DATABASE_INSTANCES_DIR;
running instance databases are then detected, and --instance selects one when
several are running.

Read-only is enforced three times: the query must be one SELECT/WITH
statement without modifying keywords, it runs inside a read-only transaction
that is always rolled back, and it connects as the installation's read-only
database role.

Usage (the root ./db command is the same tool):
    ./filterest database "SELECT * FROM users LIMIT 5"
    ./filterest database --instance example.org "SELECT * FROM users LIMIT 5"
    ./filterest database --list                    # List running instances
"""
import os
import sys
import subprocess
import json
import argparse
import re
from pathlib import Path

CANONICAL_FILTEREST_ROOT = Path(__file__).resolve().parents[2]
if not __package__ and str(CANONICAL_FILTEREST_ROOT) not in sys.path:
    sys.path.insert(0, str(CANONICAL_FILTEREST_ROOT))

try:
    from ..lib.easelect_private_paths import (
        resolve_easelect_private_paths,
        resolve_embedded_project_root,
    )
except ImportError:
    from server_tools.lib.easelect_private_paths import (
        resolve_easelect_private_paths,
        resolve_embedded_project_root,
    )


try:
    import psycopg2
except ImportError:  # installed by the development setup, not by the host
    psycopg2 = None


PROJECT_ROOT = resolve_embedded_project_root(CANONICAL_FILTEREST_ROOT)

MISSING_DRIVER_MESSAGE = (
    "The PostgreSQL driver (psycopg2) is not installed for this Python. "
    "Install the development dependencies with: ./filterest setup --profile "
    "development (an existing installation adds --dependencies-only --yes)."
)

# A standalone installation's own defaults, as in app/docker/docker-compose.yml.
DEFAULT_DB_NAME = "filterest"
DEFAULT_READONLY_USER = "filterest_readonly"

# A workspace that runs several Docker instances names their database
# containers <prefix><instance>-db and keeps each instance's settings in
# <instances dir>/<instance>/.env. Standalone Filterest declares neither.
INSTANCE_CONTAINER_PREFIX_ENV = "FILTEREST_DATABASE_INSTANCE_CONTAINER_PREFIX"
INSTANCES_DIR_ENV = "FILTEREST_DATABASE_INSTANCES_DIR"

# ============================================================================
# SECURITY: Read-only SQL validation
# Enforces the AGENTS.md section "No direct SQL modifications".
# ============================================================================
FORBIDDEN_KEYWORDS = [
    'UPDATE', 'INSERT', 'DELETE', 'DROP', 'ALTER', 'CREATE',
    'TRUNCATE', 'GRANT', 'REVOKE', 'VACUUM', 'COPY', 'EXECUTE'
]

# A dollar quote opens with $$ or $tag$; $1-style parameters are not quotes.
_DOLLAR_QUOTE_TAG = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")


def _is_identifier_character(character):
    return character.isalnum() or character in "_$"


def executable_sql_text(query):
    """Return the query with comments removed and quoted contents blanked.

    Sits between the raw query text and the read-only checks: keywords and
    statement separators inside strings, quoted identifiers, dollar-quoted
    bodies and comments are data, not commands, while everything left over is
    what the server would execute. The scan is sequential, so a quote inside a
    comment or a comment marker inside a string cannot hide the text after it.

    Returns None when a string, quoted identifier, dollar quote or block
    comment is never closed, because a malformed query must not be trusted.
    """
    parts = []
    index = 0
    length = len(query)
    while index < length:
        character = query[index]
        if query.startswith("--", index):
            line_end = query.find("\n", index)
            index = length if line_end == -1 else line_end
            parts.append(" ")
            continue
        if query.startswith("/*", index):
            depth = 1
            index += 2
            while index < length and depth:
                if query.startswith("/*", index):
                    depth += 1
                    index += 2
                elif query.startswith("*/", index):
                    depth -= 1
                    index += 2
                else:
                    index += 1
            if depth:
                return None
            parts.append(" ")
            continue
        if character in ("'", '"'):
            # E'...' strings honour backslash escapes; every other quoted
            # text only escapes its own delimiter by doubling it.
            backslash_escapes = (
                character == "'"
                and index > 0
                and query[index - 1] in "eE"
                and (index < 2 or not _is_identifier_character(query[index - 2]))
            )
            index += 1
            while True:
                if index >= length:
                    return None
                if backslash_escapes and query[index] == "\\":
                    index += 2
                    continue
                if query[index] == character:
                    if query.startswith(character * 2, index):
                        index += 2
                        continue
                    index += 1
                    break
                index += 1
            parts.append(character * 2)
            continue
        if character == "$" and (
            index == 0 or not _is_identifier_character(query[index - 1])
        ):
            tag = _DOLLAR_QUOTE_TAG.match(query, index)
            if tag:
                closing = query.find(tag.group(0), tag.end())
                if closing == -1:
                    return None
                index = closing + len(tag.group(0))
                parts.append("''")
                continue
        parts.append(character)
        index += 1
    return "".join(parts)


def validate_readonly_query(query):
    """
    Validates that the query is a read-only SELECT statement.

    Rules:
    1. Query must start with SELECT or WITH (case-insensitive)
    2. If query starts with WITH (CTE), it must also contain SELECT
    3. Query must be exactly one statement (a trailing semicolon is allowed)
    4. Query must not contain forbidden modification keywords

    The read-only transaction in run_readonly_query() is the server-side
    guarantee; these rules refuse obvious write attempts before a connection
    is opened.

    Returns: (is_valid, error_message)
    """
    executable = executable_sql_text(query)
    if executable is None:
        return False, "Query has an unterminated string, quoted identifier or comment."
    normalized = executable.strip().upper()

    # Check that query starts with SELECT or WITH
    if not (normalized.startswith('SELECT') or normalized.startswith('WITH')):
        return False, "Query must start with SELECT or WITH. Only read-only queries are allowed."

    # If starts with WITH (CTE), must contain SELECT somewhere
    if normalized.startswith('WITH'):
        if 'SELECT' not in normalized:
            return False, "WITH (CTE) queries must contain a SELECT statement."

    # A second statement could end the read-only transaction or change its
    # mode before running, so only one statement is ever sent.
    if ';' in normalized.rstrip().rstrip(';'):
        return False, "Only one SQL statement is allowed per query."

    # Check for forbidden keywords (modification commands). Quoted contents
    # are already blanked, so values like '/api/create-folder' do not trigger.
    for keyword in FORBIDDEN_KEYWORDS:
        # Match the keyword as a whole word, so column names such as
        # UPDATED_AT or a qualified t.insert do not trigger, while a
        # data-modifying CTE "(DELETE" or a glued ";UPDATE" still does.
        pattern = r'(?<![A-Z0-9_$.])' + keyword + r'(?![A-Z0-9_$])'
        if re.search(pattern, normalized):
            return False, f"Forbidden keyword '{keyword}' detected. Only read-only queries are allowed."

    return True, None

def load_env(filepath):
    """Load environment variables from a file."""
    env = {}
    try:
        with open(filepath, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    if '=' in line:
                        key, value = line.split('=', 1)
                        env[key.strip()] = value.strip()
    except FileNotFoundError:
        pass
    return env

def load_env_chain(filepaths):
    """
    Merge env files left-to-right so later files override earlier ones.

    For native dev targets we mirror the backend's intent closely enough for
    tooling: the runtime env provides fallback secrets, then the development
    env overrides the canonical local/shared-dev DB target when present.
    """
    merged = {}
    for filepath in filepaths:
        merged.update(load_env(filepath))
    return merged

def get_running_db_instances(environment=None):
    """
    Get the running database containers of the declared Docker instances.
    Returns list of tuples: (instance_name, host_port); an empty list when
    this installation declares no instance container prefix.
    """
    source_environment = os.environ if environment is None else environment
    prefix = source_environment.get(INSTANCE_CONTAINER_PREFIX_ENV, "").strip()
    if not prefix:
        return []
    try:
        result = subprocess.run(
            ['docker', 'ps', '--format', '{{.Names}}\t{{.Ports}}', '--filter', f'name={prefix}'],
            capture_output=True, text=True, timeout=10
        )
        instances = []
        for line in result.stdout.strip().split('\n'):
            if not line or '-db' not in line:
                continue
            parts = line.split('\t')
            if len(parts) < 2:
                continue
            container_name = parts[0]
            ports = parts[1]
            
            # Extract instance name: <prefix>example.org-db -> example.org
            if container_name.startswith(prefix) and container_name.endswith('-db'):
                instance_name = container_name[len(prefix):-3]
                
                # Extract host port from ports like "0.0.0.0:5432->5432/tcp"
                host_port = '5432'  # default
                for port_mapping in ports.split(','):
                    if '->5432' in port_mapping:
                        # Extract port before ->
                        port_part = port_mapping.split('->')[0]
                        if ':' in port_part:
                            host_port = port_part.split(':')[-1]
                        break
                
                instances.append((instance_name, host_port))
        return instances
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

def get_instance_env(instance_name, environment=None):
    """Load one declared instance's settings from <instances dir>/<name>/.env."""
    source_environment = os.environ if environment is None else environment
    instances_dir = source_environment.get(INSTANCES_DIR_ENV, "").strip()
    if not instances_dir:
        return {}
    return load_env(os.path.join(instances_dir, instance_name, '.env'))

def run_readonly_query(query, *, connect=None, **connection_arguments):
    """Run one validated query in a read-only transaction and return its rows.

    Sits between the command line and PostgreSQL. The session default and the
    explicit transaction are both read-only, so the server itself refuses a
    write that slipped past validation; the transaction is always rolled back
    and never committed. The read-only role remains the outer boundary.
    """
    if connect is None:
        if psycopg2 is None:
            raise RuntimeError(MISSING_DRIVER_MESSAGE)
        connect = psycopg2.connect
    conn = connect(
        options="-c default_transaction_read_only=on",
        **connection_arguments,
    )
    try:
        conn.set_session(readonly=True, autocommit=False)
        cur = conn.cursor()
        cur.execute(query)
        rows = cur.fetchall()
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in rows]
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()


def main():
    display_command = os.environ.get(
        "FILTEREST_DATABASE_DISPLAY_COMMAND",
        "./filterest database",
    )
    parser = argparse.ArgumentParser(
        description='Query Filterest database instances',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Examples:
    {display_command} "SELECT * FROM users LIMIT 5"
    {display_command} --instance example.org "SELECT COUNT(*) FROM datasets"
    {display_command} --local "SELECT * FROM system_db_tables LIMIT 5"
    {display_command} --list
        """
    )
    parser.add_argument('query', nargs='?', help='SQL query to execute')
    parser.add_argument('--instance', '-i', help='Specify a declared Docker instance name (e.g., example.org)')
    parser.add_argument('--local', '-L', action='store_true', help='Use the canonical native development DB target')
    parser.add_argument('--list', '-l', action='store_true', help='List running database instances')
    
    args = parser.parse_args()
    
    # Get project root (2 levels up from this script: server_tools/agent_tools/)
    private_paths = resolve_easelect_private_paths(PROJECT_ROOT)
    
    # Get running instances
    running_instances = get_running_db_instances()
    
    # Handle --list flag
    if args.list:
        if not running_instances:
            print("No running database instances found.")
        else:
            print("Running database instances:")
            for name, port in running_instances:
                print(f"  - {name} (port {port})")
        sys.exit(0)
    
    # Require query if not listing
    if not args.query:
        parser.print_help()
        sys.exit(1)
    
    query = args.query
    
    # SECURITY: Validate that query is read-only
    is_valid, error_msg = validate_readonly_query(query)
    if not is_valid:
        print(json.dumps({"error": f"SECURITY: {error_msg}"}))
        sys.exit(1)
    
    # Determine which instance to use
    if args.local:
        # Use the canonical dev DB target from the local env chain.
        print("# Using canonical native development DB target", file=sys.stderr)
        instance_env = load_env_chain([
            private_paths.runtime_env_file,
            private_paths.development_env_file,
        ])
        db_host = instance_env.get('DB_HOST', 'localhost')
        db_port = instance_env.get('DB_PORT', '5432')
        instance_name = 'local'
    elif args.instance:
        # User specified instance
        instance_name = args.instance
        # Find the port for this instance
        matching = [(n, p) for n, p in running_instances if n == instance_name]
        if not matching:
            print(json.dumps({"error": f"Instance '{instance_name}' is not running. Use --list to see running instances."}))
            sys.exit(1)
        _, db_port = matching[0]
        instance_env = get_instance_env(instance_name)
    elif len(running_instances) == 1:
        # Exactly one instance running - use it automatically
        instance_name, db_port = running_instances[0]
        instance_env = get_instance_env(instance_name)
        db_host = 'localhost'
        print(f"# Using instance: {instance_name} (port {db_port})", file=sys.stderr)
    elif len(running_instances) == 0:
        # No Docker instances running - fall back to the canonical dev target.
        print("# No Docker instances running, using canonical native development DB target", file=sys.stderr)
        instance_env = load_env_chain([
            private_paths.runtime_env_file,
            private_paths.development_env_file,
        ])
        db_host = instance_env.get('DB_HOST', 'localhost')
        db_port = instance_env.get('DB_PORT', '5432')
    else:
        # Multiple instances running - require user to specify
        print("Error: Multiple database instances are running. Please specify which one to use.\n", file=sys.stderr)
        print("Running instances:", file=sys.stderr)
        for name, port in running_instances:
            print(f"  - {name} (port {port})", file=sys.stderr)
        print(f"\nExample command:", file=sys.stderr)
        example_instance = running_instances[0][0]
        print(f"  {display_command} --instance {example_instance} \"{query}\"", file=sys.stderr)
        sys.exit(1)
    
    # Get database connection parameters
    # IMPORTANT: AI agents must use READ-ONLY credentials to prevent accidental data modification.
    # This enforces the AGENTS.md section "No direct SQL modifications".
    # DO NOT change these to admin credentials.
    if args.instance:
        db_host = 'localhost'
    elif len(running_instances) == 1 and not args.local:
        db_host = 'localhost'
    else:
        db_host = locals().get('db_host', 'localhost')
    db_name = instance_env.get('DB_NAME', DEFAULT_DB_NAME)
    db_user = instance_env.get('DB_READONLY_USER', DEFAULT_READONLY_USER)
    db_pass = instance_env.get('DB_READONLY_PASSWORD', '')

    try:
        results = run_readonly_query(
            query,
            host=db_host,
            port=db_port,
            dbname=db_name,
            user=db_user,
            password=db_pass,
        )
        print(json.dumps(results, indent=2, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
