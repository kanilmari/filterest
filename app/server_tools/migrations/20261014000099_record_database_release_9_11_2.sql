-- 20261014000099_record_database_release_9_11_2.sql
-- Records missing article-view permission explanations and group field-setting warnings.
-- Connects the final migration of this release to database compatibility checks.
-- Leaves the version unclaimed if a preceding migration fails.
-- VERSION_DB: 9.11.2

INSERT INTO public.system_db_version (version, description)
SELECT '9.11.2', 'Missing article-view permission explanations and group field-setting warnings'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.11.2'
);
