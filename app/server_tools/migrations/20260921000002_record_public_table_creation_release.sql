-- 20260921000002_record_public_table_creation_release.sql
-- Records the database release that leaves table creation to the application's role.
-- Bridges the privilege migration with the startup database compatibility check.
-- Exists so an installation can prove the withdrawal was applied; a new installation
-- receives the same row from the bootstrap seed instead.
-- VERSION_DB: 9.8.1

INSERT INTO public.system_db_version (version, description)
SELECT '9.8.1',
       'Withdrew PUBLIC''s CREATE on schema public; only the application role creates tables'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.8.1'
);
