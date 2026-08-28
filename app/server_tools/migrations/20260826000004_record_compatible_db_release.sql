-- 20260826000004_record_compatible_db_release.sql
-- Records the shared compatibility head for the 9.6.7 database release.
-- Bridges private workline attribution with instances where the private feature stays disabled.
-- Exists so the additive private schema patch has one explicit compatibility owner.
-- VERSION_DB: 9.6.7

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.7', 'Recorded the compatible 9.6.7 database release'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.6.7'
);
