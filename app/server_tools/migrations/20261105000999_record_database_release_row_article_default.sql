-- 20261105000999_record_database_release_row_article_default.sql
-- Records the row presentation default after the appearance schema is in place.
-- VERSION_DB: 9.13.6

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.6', 'Site and dataset row-opening presentation'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version='9.13.6');
