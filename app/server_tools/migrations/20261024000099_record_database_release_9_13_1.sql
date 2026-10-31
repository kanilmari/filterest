-- 20261024000099_record_database_release_9_13_1.sql
-- Records the saved Home box database batch after its migration succeeds.
-- Connects Home query storage and explicit inheritance with database version admission.
-- One final owner claims this release; replay keeps one history row.
-- VERSION_DB: 9.13.1

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.1', 'DB 9.13.1 after 9.13.0: saved Home boxes: translated titles, category queries, stable identities and explicit scope inheritance'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.1');
