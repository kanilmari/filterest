-- 20260922000002_create_missing_deletion_log.sql
-- Creates the deletion log where an installation lacks it, with the access its writers need.
-- Bridges the generic row delete path (deletion_log_writer.go) and log retention
-- with one table every installation has.
-- Exists because the table came from a migration of the private development shell
-- that no public migration or bootstrap carried, so sites installed from the public
-- release logged the error relation "deletion_log" does not exist on every row delete.
-- A site that already has the table keeps it, its rows and its comments. Running
-- the file again changes nothing. The public bootstrap runs this same file, so a
-- new installation receives the same table.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- Same shape as the original, so the columns and constraint names match
-- wherever the table already exists.
DO $$
BEGIN
    IF to_regclass('public.deletion_log') IS NULL THEN
        CREATE TABLE public.deletion_log (
            id              SERIAL PRIMARY KEY,
            table_name      TEXT NOT NULL,
            record_id       TEXT NOT NULL,
            deleted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_by      TEXT,
            reason          TEXT,
            UNIQUE (table_name, record_id)
        );
        COMMENT ON TABLE public.deletion_log IS
            'Intentional row deletions, so that copying data between environments does not restore deleted records. Written by the generic row delete path.';
        COMMENT ON COLUMN public.deletion_log.table_name IS 'Name of the table the row was deleted from';
        COMMENT ON COLUMN public.deletion_log.record_id IS 'Primary key (id) of the deleted row, stored as text for universality';
        COMMENT ON COLUMN public.deletion_log.deleted_by IS 'Username or system identifier that performed the deletion';
        COMMENT ON COLUMN public.deletion_log.reason IS 'Reason category: user_request, admin, gdpr, cleanup, etc.';
    END IF;
END $$;

-- The delete path writes the log inside the transaction of the deleting
-- request, on the pool of the administrator or of the signed-in user.
-- INSERT ... ON CONFLICT DO NOTHING also needs SELECT, and the serial id needs
-- its sequence. A role an installation does not have is skipped; the role setup
-- of a new installation grants the same access to every table and sequence.
DO $$
DECLARE
    writer TEXT;
BEGIN
    FOREACH writer IN ARRAY ARRAY['admin_user', 'basic_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = writer) THEN
            EXECUTE format('GRANT SELECT, INSERT ON TABLE public.deletion_log TO %I', writer);
            EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.deletion_log_id_seq TO %I', writer);
        END IF;
    END LOOP;
END $$;
