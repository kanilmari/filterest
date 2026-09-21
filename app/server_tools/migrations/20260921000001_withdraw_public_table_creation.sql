-- 20260921000001_withdraw_public_table_creation.sql
-- Leaves table creation in the shared public schema to the application's own role.
-- Bridges databases first created before PostgreSQL 15 with that version's secure default.
-- Exists because every database role, the read-only one included, could create tables:
-- PUBLIC still held CREATE on schema public, carried forward by each dump and upgrade.
-- The public bootstrap runs this same file, so a new installation ends in this state too.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

DO $$
DECLARE
    read_role text;
BEGIN
    -- Migrations run as the role that creates datasets. Its configured name
    -- differs per installation, so it is addressed as the connected role. The
    -- grant makes its right explicit before the right shared by everyone goes.
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', current_user);

    -- PostgreSQL 15 and later create a database without this. An older database
    -- keeps it through pg_dump, restore and pg_upgrade, and so did every copy
    -- restored from one: through it every role could create a table.
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;

    -- A read-only role never needs a direct grant either. Only names known to
    -- be read-only are touched, and a role this installation lacks is skipped.
    FOR read_role IN
        SELECT rolname
          FROM pg_roles
         WHERE rolname IN ('readeronly', 'filterest_readonly', 'readonly_user')
    LOOP
        EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', read_role);
    END LOOP;

    -- Only the schema owner or a superuser can withdraw a right the owner
    -- granted; for any other role REVOKE only warns and changes nothing.
    -- Stop the update instead of recording a repair that did not happen.
    IF has_schema_privilege('public', 'public', 'CREATE') THEN
        RAISE EXCEPTION
            'PUBLIC still holds CREATE on schema public: role % can neither own the schema nor act as a superuser',
            current_user;
    END IF;

    -- Dataset creation must survive the change; roll it back if it would not.
    IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
        RAISE EXCEPTION
            'role % would lose CREATE on schema public and could no longer create datasets',
            current_user;
    END IF;
END
$$;
