-- 20261022000399_record_database_release_9_13_0.sql
-- Records the next normal database batch after its migrations have succeeded.
-- Connects phone Home search copy with database version admission.
-- One final owner claims this release; replay keeps one history row.
-- VERSION_DB: 9.13.0

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.0', 'Finnish and English phone Home search language keys (WO88 K477)'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.0');
