-- 20261015000099_record_database_release_9_12_0.sql
-- Records the next normal database batch after its migrations have succeeded.
-- Connects record-title metadata and UI copy with database version admission.
-- One final owner claims this release; replay keeps one history row.
-- VERSION_DB: 9.12.0

INSERT INTO public.system_db_version (version, description)
SELECT '9.12.0', 'Shared record titles, new-dataset card roles (ticket 962) and the dataset default-view control'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.12.0');
