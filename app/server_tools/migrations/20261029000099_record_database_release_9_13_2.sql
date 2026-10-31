-- 20261029000099_record_database_release_9_13_2.sql
-- Records the next normal database batch after its migrations have succeeded.
-- Connects dataset hero sort labels with database version admission.
-- One final owner claims this release; replay keeps one history row.
-- VERSION_DB: 9.13.2

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.2', 'Dataset hero sort labels without "Sort" and four exact legacy Finnish sort labels'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.2');
