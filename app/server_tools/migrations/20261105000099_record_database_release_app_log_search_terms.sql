-- 20261105000099_record_database_release_app_log_search_terms.sql
-- Records the search-log privacy setting release after its default exists.
-- Connects migration completion to database compatibility admission.
-- Replay records exactly one release row.
-- VERSION_DB: 9.13.5

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.5', 'Visitor search terms excluded from application logs by default (WO151 K597)'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.5');
