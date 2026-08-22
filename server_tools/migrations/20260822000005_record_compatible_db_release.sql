-- 20260822000005_record_compatible_db_release.sql
-- Records the shared compatibility head for the 9.4.0 database release.
-- Bridges private additive schema work with generated Filterest instances that need no matching table change.
-- Exists so both release channels advance through one explicit system_db_version owner.
-- VERSION_DB: 9.4.0

INSERT INTO public.system_db_version (version, description)
SELECT '9.4.0', 'Recorded the compatible 9.4.0 database release'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.4.0'
);
