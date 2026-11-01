-- 20261030000399_record_database_release_category_button_width.sql
-- Records the category button setting release after the default exists.
-- Connects migration completion to database compatibility admission.
-- Replay records exactly one release row.
-- VERSION_DB: 9.13.4

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.4', 'Site-wide category button width choice, default fill row (WO112 K543)'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.4');
