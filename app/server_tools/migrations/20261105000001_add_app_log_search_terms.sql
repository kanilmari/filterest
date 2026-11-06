-- 20261105000001_add_app_log_search_terms.sql
-- Adds an explicit opt-in to visitor search terms in application diagnostics.
-- Connects upgrades and fresh bootstrap to the same privacy-preserving default.
-- Replay only inserts a missing setting and preserves every existing site choice.
-- VERSION_DB: 9.13.5
-- VERSION_DB_OWNER: 20261105000099_record_database_release_app_log_search_terms.sql

INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
SELECT 'app_log_search_terms', false, '{"value":false}'::jsonb, 'false', 2,
    'Include search terms and full request URLs in application diagnostics. Off by default; cached for up to five minutes.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'app_log_search_terms');
