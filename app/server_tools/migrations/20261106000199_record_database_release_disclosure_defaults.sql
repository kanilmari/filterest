-- 20261106000199_record_database_release_disclosure_defaults.sql
-- Records the transfer of disclosure defaults to dataset appearance.
-- VERSION_DB: 9.13.7

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.7', 'Article and filterbar disclosure defaults in dataset appearance'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.7');
