#!/usr/bin/env bash
# public_bootstrap.sh
# Normalizes the public schema stream for a local PostgreSQL installation, and
# imports a bootstrap package so that the first failed statement stops it.
# Bridges Filterest's portable bootstrap files and hosts with or without PostGIS.
# Exists so public installation never depends on Easelect's private backup archives,
# and so every import path follows one stop rule instead of its own.

# Stream a bootstrap schema in the form supported by the local cluster.
stream_bootstrap_schema_sql() {
    local schema_file="$1"
    local postgis_available="${2:-1}"

    if [[ "$postgis_available" == "1" ]]; then
        sed \
            -e 's/^CREATE SCHEMA postgis;$/CREATE SCHEMA IF NOT EXISTS postgis;/' \
            -e '/^\\restrict/d' \
            -e '/^\\unrestrict/d' \
            "$schema_file"
        return
    fi

    sed \
        -e 's/postgis\.geometry(Point,4326)/text/g' \
        -e '/^CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis;$/d' \
        -e '/^CREATE EXTENSION IF NOT EXISTS postgis;$/d' \
        -e '/^COMMENT ON EXTENSION postgis IS /d' \
        -e '/^\\restrict/d' \
        -e '/^\\unrestrict/d' \
        "$schema_file"
}

# Print the first error lines psql wrote, indented, for an import that failed.
bootstrap_import_first_errors() {
    local log_file="$1"
    if grep -qE "^(ERROR|psql:)" "$log_file"; then
        grep -E "^(ERROR|psql:)" "$log_file" | head -10 | sed 's/^/   /'
    else
        sed -n '1,10p' "$log_file" | sed 's/^/   /'
    fi
}

# Import a bootstrap package: its schema, then its seed, through one psql command,
# with ON_ERROR_STOP so the first failed statement of either file ends the import.
# A skipped schema error would leave the database looking installed while missing
# what the failed statement made; the seed's acceptance block then writes the
# migration ledger and version only after every completion marker and final check.
# Prints the first errors and returns non-zero on failure; the caller must not
# start the application then.
# Usage: import_bootstrap_package <schema.sql> <seed_data.sql> <postgis_available 0|1> <psql command...>
import_bootstrap_package() {
    local schema_file="$1"
    local seed_file="$2"
    local postgis_available="$3"
    shift 3
    local log_file=""
    local file=""

    for file in "$schema_file" "$seed_file"; do
        if [[ ! -f "$file" ]]; then
            echo "Bootstrap import failed: ${file} is missing." >&2
            return 1
        fi
    done
    log_file="$(mktemp)" || return 1
    if ! stream_bootstrap_schema_sql "$schema_file" "$postgis_available" |
        "$@" -v ON_ERROR_STOP=1 >"$log_file" 2>&1; then
        echo "Bootstrap schema import failed; first errors:" >&2
        bootstrap_import_first_errors "$log_file" >&2
        rm -f "$log_file"
        return 1
    fi
    if ! sed -e '/^\\restrict/d' -e '/^\\unrestrict/d' "$seed_file" |
        "$@" -v ON_ERROR_STOP=1 >"$log_file" 2>&1; then
        echo "Bootstrap seed import failed; first errors:" >&2
        bootstrap_import_first_errors "$log_file" >&2
        rm -f "$log_file"
        return 1
    fi
    rm -f "$log_file"
}
