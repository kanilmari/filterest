-- 20261009000099_record_database_release_9_10_2.sql
-- Records Home/editor copy and private per-dataset appearance override storage and API/card cutover.
-- Connects the final migration of this release to database compatibility checks.
-- Leaves the version unclaimed if a preceding migration fails.
-- VERSION_DB: 9.10.2

INSERT INTO public.system_db_version (version, description)
SELECT '9.10.2', 'Separate Home title, slogan and description language keys, editor guidance and dataset appearance override storage and revision-protected API/card cutover'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.10.2'
);
