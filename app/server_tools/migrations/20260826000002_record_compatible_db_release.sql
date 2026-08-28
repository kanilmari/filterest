-- 20260826000002_record_compatible_db_release.sql
-- Records the shared compatibility head for the 9.6.6 database release.
-- Bridges private observatory schema work with generated Filterest instances needing no private tables.
-- Exists so private and public channels advance through one explicit system_db_version owner.
-- VERSION_DB: 9.6.6

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.6', 'Recorded the compatible 9.6.6 database release'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.6.6'
);
