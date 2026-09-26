-- 20260926000002_record_system_foreign_key_release.sql
-- Records the database release that restores the system tables' own foreign keys.
-- Bridges the restoring migration with the startup database compatibility check.
-- Exists so an installation can prove the relationships were restored; a new
-- installation receives the same row from the bootstrap seed instead.
-- VERSION_DB: 9.9.0

INSERT INTO public.system_db_version (version, description)
SELECT '9.9.0',
       'Restored the twenty system-table foreign keys missing from the public install schema'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.9.0'
);
