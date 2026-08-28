#!/usr/bin/env bash
# 02_import_public_bootstrap.sh
# Imports the reviewed public Filterest schema and harmless starter data.
# Runs only when PostgreSQL initializes a new Docker data volume.

set -euo pipefail

bootstrap_root="${FILTEREST_PUBLIC_BOOTSTRAP_DIR:-/filterest-public-bootstrap}"
schema_file="$bootstrap_root/schema.sql"
seed_file="$bootstrap_root/seed_data.sql"

for required_file in "$schema_file" "$seed_file"; do
    if [[ ! -r "$required_file" ]]; then
        printf 'Required Filterest bootstrap file is missing: %s\n' "$required_file" >&2
        exit 1
    fi
done

printf 'Importing the public Filterest schema...\n'
psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --file "$schema_file"

printf 'Importing the public Filterest starter data...\n'
psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --file "$seed_file"

printf 'Public Filterest database bootstrap imported successfully.\n'
