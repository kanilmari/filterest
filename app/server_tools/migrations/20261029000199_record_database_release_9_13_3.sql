-- 20261029000199_record_database_release_9_13_3.sql
-- Records the Home top-bar setting release after its setting and copy exist.
-- Connects migration completion to database compatibility admission.
-- Replay records exactly one release row.
-- VERSION_DB: 9.13.3

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.3', 'Site-wide opt-in Home button on wide top bars, default false (WO109 K529)'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.3');
