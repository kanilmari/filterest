-- 20261009000099_record_database_release_9_10_2.sql
-- Records the new separate Home description and three-field editor language copy.
-- Connects the final migration of this release to database compatibility checks.
-- Leaves the version unclaimed if a preceding migration fails.
-- VERSION_DB: 9.10.2

INSERT INTO public.system_db_version (version, description)
SELECT '9.10.2', 'Separate Home title, slogan and description language keys and editor guidance'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.10.2'
);
