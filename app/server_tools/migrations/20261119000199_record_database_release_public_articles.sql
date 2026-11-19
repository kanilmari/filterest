-- 20261119000199_record_database_release_public_articles.sql
-- Records the plain article pages' interface texts (WL175), a text-only database release.
-- Replay records exactly one release row.
-- VERSION_DB: 9.13.8

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.8', 'Plain article pages and the All articles link for search engines and visitors (WL175)'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.8');
