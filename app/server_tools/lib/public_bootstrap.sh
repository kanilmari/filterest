#!/usr/bin/env bash
# public_bootstrap.sh
# Normalizes the public schema stream for a local PostgreSQL installation.
# Bridges Filterest's portable bootstrap files and hosts with or without PostGIS.
# Exists so public installation never depends on Easelect's private backup archives.

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
