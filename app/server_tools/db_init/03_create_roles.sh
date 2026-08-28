#!/usr/bin/env bash
# 03_create_roles.sh
# Creates the configured Filterest runtime roles after the public schema import.
# Runs only when PostgreSQL initializes a new Docker data volume.

set -euo pipefail

DB_READONLY_USER="${DB_READONLY_USER:-filterest_readonly}"
DB_CONFIDENTIAL_USER="${DB_CONFIDENTIAL_USER:-filterest_confidential}"
DB_BASIC_USER="${DB_BASIC_USER:-filterest_basic}"
DB_GUEST_USER="${DB_GUEST_USER:-filterest_guest}"

for required_name in \
    POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
    DB_READONLY_USER DB_READONLY_PASSWORD \
    DB_CONFIDENTIAL_USER DB_CONFIDENTIAL_PASSWORD \
    DB_BASIC_USER DB_BASIC_PASSWORD \
    DB_GUEST_USER DB_GUEST_PASSWORD; do
    if [[ -z "${!required_name:-}" ]]; then
        printf 'Required Docker database setting is empty: %s\n' "$required_name" >&2
        exit 1
    fi
done

write_psql_secret_variable() {
    local variable_name="$1"
    local secret_value="$2"
    local encoded_value=""

    if [[ ! "$variable_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        printf 'Unsafe psql secret variable name\n' >&2
        return 1
    fi
    encoded_value="$(printf '%s' "$secret_value" | od -An -v -tx1 | tr -d ' \n')"
    printf "\\set %s '%s'\n" "$variable_name" "$encoded_value"
}

printf 'Creating configured Filterest database roles...\n'
{
    write_psql_secret_variable readonly_password_hex "$DB_READONLY_PASSWORD"
    write_psql_secret_variable confidential_password_hex "$DB_CONFIDENTIAL_PASSWORD"
    write_psql_secret_variable basic_password_hex "$DB_BASIC_PASSWORD"
    write_psql_secret_variable guest_password_hex "$DB_GUEST_PASSWORD"
    cat <<'SQL'
\o /dev/null
SELECT format(
    'CREATE ROLE %I WITH LOGIN PASSWORD %L',
    :'readonly_user',
    convert_from(decode(:'readonly_password_hex', 'hex'), 'UTF8')
)
WHERE :'readonly_user' <> current_user
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'readonly_user');
\gexec
SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L',
    :'readonly_user',
    convert_from(decode(:'readonly_password_hex', 'hex'), 'UTF8')
)
WHERE :'readonly_user' <> current_user;
\gexec

SELECT format(
    'CREATE ROLE %I WITH LOGIN PASSWORD %L',
    :'confidential_user',
    convert_from(decode(:'confidential_password_hex', 'hex'), 'UTF8')
)
WHERE :'confidential_user' <> current_user
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'confidential_user');
\gexec
SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L',
    :'confidential_user',
    convert_from(decode(:'confidential_password_hex', 'hex'), 'UTF8')
)
WHERE :'confidential_user' <> current_user;
\gexec

SELECT format(
    'CREATE ROLE %I WITH LOGIN PASSWORD %L',
    :'basic_user',
    convert_from(decode(:'basic_password_hex', 'hex'), 'UTF8')
)
WHERE :'basic_user' <> current_user
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'basic_user');
\gexec
SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L',
    :'basic_user',
    convert_from(decode(:'basic_password_hex', 'hex'), 'UTF8')
)
WHERE :'basic_user' <> current_user;
\gexec

SELECT format(
    'CREATE ROLE %I WITH LOGIN PASSWORD %L',
    :'guest_user',
    convert_from(decode(:'guest_password_hex', 'hex'), 'UTF8')
)
WHERE :'guest_user' <> current_user
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'guest_user');
\gexec
SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L',
    :'guest_user',
    convert_from(decode(:'guest_password_hex', 'hex'), 'UTF8')
)
WHERE :'guest_user' <> current_user;
\gexec

SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', current_database(), :'admin_user');
\gexec
SELECT format('GRANT ALL PRIVILEGES ON SCHEMA public TO %I', :'admin_user');
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'readonly_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'readonly_user');
\gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'readonly_user');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO %I', :'readonly_user');
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'confidential_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'confidential_user');
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO %I', :'confidential_user');
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'confidential_user');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO %I', :'confidential_user');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'confidential_user');
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'basic_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'basic_user');
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO %I', :'basic_user');
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'basic_user');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO %I', :'basic_user');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'basic_user');
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'guest_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'guest_user');
\gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'guest_user');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO %I', :'guest_user');
\gexec

SELECT format('GRANT USAGE ON SCHEMA restricted TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA restricted TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA restricted TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT USAGE, SELECT ON SEQUENCES TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
\o
SQL
} | psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --set=admin_user="$POSTGRES_USER" \
    --set=readonly_user="$DB_READONLY_USER" \
    --set=confidential_user="$DB_CONFIDENTIAL_USER" \
    --set=basic_user="$DB_BASIC_USER" \
    --set=guest_user="$DB_GUEST_USER"

printf 'Configured Filterest database roles created successfully.\n'
