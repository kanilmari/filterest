#!/bin/bash
# setup_database_grants.sh
# Supplies the native installer's initial pool grants and safe defaults.
# Uses its checked psql runner; application startup owns dataset reconciliation.
# Keeps the permissions step separate from the oversized installation script.

grant_local_database_permissions() {
    run_local_db_psql_stdin "Permission grants" \
        --set=admin_user="$DB_ADMIN_USER" \
        --set=confidential_user="${DB_CONFIDENTIAL_USER:-limited_user}" \
        --set=readonly_user="${DB_READONLY_USER:-readeronly}" \
        --set=basic_user="${DB_BASIC_USER:-basic_user}" \
        --set=guest_user="${DB_GUEST_USER:-guest_user}" <<'SQL'
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'admin_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA restricted TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA restricted TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA restricted TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT USAGE, SELECT ON SEQUENCES TO %I', :'confidential_user')
WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'readonly_user');
\gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'readonly_user');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO %I', :'readonly_user');
\gexec
-- Dataset and operational ACLs are reconciled by the application before readiness.
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'basic_user');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'guest_user');
\gexec
SQL
}
