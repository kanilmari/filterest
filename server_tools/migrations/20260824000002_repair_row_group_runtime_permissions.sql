-- 20260824000002_repair_row_group_runtime_permissions.sql
-- Repairs least-privilege read access for the standard runtime roles on generic row-group metadata.
-- Instance-specific generated role names are reconciled by the application startup hook.
-- Exists so upgraded guest/basic reads can calculate authorized facets without permission failures.
-- VERSION_DB: 9.6.3

DO $$
DECLARE
    role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['basic_user', 'guest_user', 'readeronly']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
                'GRANT USAGE ON SCHEMA public TO %I',
                role_name
            );
            EXECUTE format(
                'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.system_row_groups, public.system_row_group_memberships FROM %I',
                role_name
            );
            EXECUTE format(
                'REVOKE USAGE, UPDATE ON SEQUENCE public.system_row_groups_id_seq, public.system_row_group_memberships_id_seq FROM %I',
                role_name
            );
            EXECUTE format(
                'GRANT SELECT ON TABLE public.system_row_groups, public.system_row_group_memberships TO %I',
                role_name
            );
        END IF;
    END LOOP;
END $$;

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.3', 'Repaired least-privilege runtime reads for row-group facets and search filtering.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.6.3'
);
