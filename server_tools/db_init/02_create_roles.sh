#!/bin/bash
# ==============================================================================
# 02_create_roles.sh: Create database roles for Easelect
# This script runs automatically when the database container starts
# Role names match the local development environment (.env file)
# ==============================================================================

set -e

echo "Creating Easelect database roles..."

# Create roles with appropriate permissions
# Role names must match .env: readeronly, limited_user, basic_user, guest_user
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Admin role (full access)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin_user') THEN
            CREATE ROLE admin_user WITH LOGIN PASSWORD '${POSTGRES_PASSWORD}';
            RAISE NOTICE 'Created admin_user role';
        END IF;
    END
    \$\$;
    GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO admin_user;
    GRANT ALL PRIVILEGES ON SCHEMA public TO admin_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO admin_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO admin_user;
    
    -- Readonly role (named 'readeronly' to match local environment)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'readeronly') THEN
            CREATE ROLE readeronly WITH LOGIN PASSWORD '${DB_READONLY_PASSWORD}';
            RAISE NOTICE 'Created readeronly role';
        END IF;
    END
    \$\$;
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO readeronly;
    GRANT USAGE ON SCHEMA public TO readeronly;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readeronly;
    
    -- Limited/Confidential role (named 'limited_user' to match local environment)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'limited_user') THEN
            CREATE ROLE limited_user WITH LOGIN PASSWORD '${DB_CONFIDENTIAL_PASSWORD}';
            RAISE NOTICE 'Created limited_user role';
        END IF;
    END
    \$\$;
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO limited_user;
    GRANT USAGE ON SCHEMA public TO limited_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO limited_user;
    DO \$\$
    BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'restricted') THEN
            GRANT USAGE ON SCHEMA restricted TO limited_user;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA restricted TO limited_user;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA restricted TO limited_user;
            ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO limited_user;
            ALTER DEFAULT PRIVILEGES IN SCHEMA restricted GRANT USAGE, SELECT ON SEQUENCES TO limited_user;
        END IF;
    END
    \$\$;
    
    -- Basic role
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'basic_user') THEN
            CREATE ROLE basic_user WITH LOGIN PASSWORD '${DB_BASIC_PASSWORD}';
            RAISE NOTICE 'Created basic_user role';
        END IF;
    END
    \$\$;
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO basic_user;
    GRANT USAGE ON SCHEMA public TO basic_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO basic_user;
    
    -- Guest role (limited access)
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'guest_user') THEN
            CREATE ROLE guest_user WITH LOGIN PASSWORD '${DB_GUEST_PASSWORD}';
            RAISE NOTICE 'Created guest_user role';
        END IF;
    END
    \$\$;
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO guest_user;
    GRANT USAGE ON SCHEMA public TO guest_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO guest_user;
    
    -- Verify roles
    SELECT rolname FROM pg_roles WHERE rolname IN ('admin_user', 'readeronly', 'limited_user', 'basic_user', 'guest_user');
EOSQL

echo "Database roles created successfully!"
