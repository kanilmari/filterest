#!/usr/bin/env python3
"""
db.py - Database query tool for Easelect instances

Automatically detects running Docker database instances and connects to them.
If multiple instances are running, requires --instance flag to specify which one.

Usage:
    ./db.py "SELECT * FROM users LIMIT 5"
    ./db.py --instance serlog.com "SELECT * FROM users LIMIT 5"
    ./db.py --list                    # List running instances
"""
import os
import sys
import subprocess
import psycopg2
import json
import argparse
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server_tools.lib.easelect_private_paths import resolve_easelect_private_paths

# ============================================================================
# SECURITY: Read-only SQL validation
# Enforces AGENTS.md rule: "Never run direct modifying SQL commands."
# ============================================================================
FORBIDDEN_KEYWORDS = [
    'UPDATE', 'INSERT', 'DELETE', 'DROP', 'ALTER', 'CREATE', 
    'TRUNCATE', 'GRANT', 'REVOKE', 'VACUUM', 'COPY', 'EXECUTE'
]

def validate_readonly_query(query):
    """
    Validates that the query is a read-only SELECT statement.
    
    Rules:
    1. Query must start with SELECT or WITH (case-insensitive)
    2. If query starts with WITH (CTE), it must also contain SELECT
    3. Query must not contain forbidden modification keywords
    
    Returns: (is_valid, error_message)
    """
    # Normalize: strip whitespace and convert to uppercase for checking
    normalized = query.strip().upper()
    
    # Remove SQL comments for validation (single-line and multi-line)
    # Single-line comments: -- ... until end of line
    normalized = re.sub(r'--[^\n]*', '', normalized)
    # Multi-line comments: /* ... */
    normalized = re.sub(r'/\*.*?\*/', '', normalized, flags=re.DOTALL)
    normalized = normalized.strip()
    
    # Check that query starts with SELECT or WITH
    if not (normalized.startswith('SELECT') or normalized.startswith('WITH')):
        return False, "Query must start with SELECT or WITH. Only read-only queries are allowed."
    
    # If starts with WITH (CTE), must contain SELECT somewhere
    if normalized.startswith('WITH'):
        if 'SELECT' not in normalized:
            return False, "WITH (CTE) queries must contain a SELECT statement."
    
    # Check for forbidden keywords (modification commands)
    # First, strip all string literals (single- and double-quoted) to avoid
    # false positives on values like '/api/create-folder' or 'Delete this?'
    stripped = re.sub(r"'[^']*'", "''", normalized)   # single-quoted strings
    stripped = re.sub(r'"[^"]*"', '""', stripped)      # double-quoted identifiers
    for keyword in FORBIDDEN_KEYWORDS:
        # Match keyword only when preceded by start-of-string or whitespace,
        # and followed by end-of-string or whitespace/punctuation.
        # This ensures e.g. column names like UPDATED_AT don't trigger,
        # and string contents are already stripped above.
        pattern = r'(?:^|(?<=\s))' + keyword + r'(?=\s|$|[;(])'
        if re.search(pattern, stripped):
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

def get_running_db_instances():
    """
    Get list of running Easelect database containers.
    Returns list of tuples: (instance_name, host_port)
    """
    try:
        result = subprocess.run(
            ['docker', 'ps', '--format', '{{.Names}}\t{{.Ports}}', '--filter', 'name=easelect-'],
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
            
            # Extract instance name: easelect-serlog.com-db -> serlog.com
            if container_name.startswith('easelect-') and container_name.endswith('-db'):
                instance_name = container_name[9:-3]  # Remove 'easelect-' and '-db'
                
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

def get_instance_env(instance_name, project_root):
    """Load environment from instance's .env file."""
    env_path = os.path.join(project_root, 'instances', instance_name, '.env')
    return load_env(env_path)

def main():
    parser = argparse.ArgumentParser(
        description='Query Easelect database instances',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    ./db.py "SELECT * FROM users LIMIT 5"
    ./db.py --instance serlog.com "SELECT COUNT(*) FROM datasets"
    ./db.py --local "SELECT * FROM system_db_tables LIMIT 5"
    ./db.py --list
        """
    )
    parser.add_argument('query', nargs='?', help='SQL query to execute')
    parser.add_argument('--instance', '-i', help='Specify instance name (e.g., serlog.com)')
    parser.add_argument('--local', '-L', action='store_true', help='Use the canonical native development DB target')
    parser.add_argument('--list', '-l', action='store_true', help='List running database instances')
    
    args = parser.parse_args()
    
    # Get project root (2 levels up from this script: server_tools/agent_tools/)
    project_root = str(PROJECT_ROOT)
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
        instance_env = get_instance_env(instance_name, project_root)
    elif len(running_instances) == 1:
        # Exactly one instance running - use it automatically
        instance_name, db_port = running_instances[0]
        instance_env = get_instance_env(instance_name, project_root)
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
        print(f"  ./server_tools/agent_tools/db.py --instance {example_instance} \"{query}\"", file=sys.stderr)
        sys.exit(1)
    
    # Get database connection parameters
    # IMPORTANT: AI agents must use READ-ONLY credentials to prevent accidental data modification.
    # This enforces the AGENTS.md rule: "Never run direct modifying SQL commands."
    # DO NOT change these to admin credentials.
    if args.instance:
        db_host = 'localhost'
    elif len(running_instances) == 1 and not args.local:
        db_host = 'localhost'
    else:
        db_host = locals().get('db_host', 'localhost')
    db_name = instance_env.get('DB_NAME', 'easelect')
    db_user = instance_env.get('DB_READONLY_USER', 'readeronly')
    db_pass = instance_env.get('DB_READONLY_PASSWORD', '')

    try:
        conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            dbname=db_name,
            user=db_user,
            password=db_pass
        )
        cur = conn.cursor()
        cur.execute(query)
        
        if cur.description:
            columns = [desc[0] for desc in cur.description]
            results = []
            for row in cur.fetchall():
                results.append(dict(zip(columns, row)))
            print(json.dumps(results, indent=2, default=str))
        else:
            conn.commit()
            print(json.dumps({"status": "success", "rows_affected": cur.rowcount}))

        conn.close()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
