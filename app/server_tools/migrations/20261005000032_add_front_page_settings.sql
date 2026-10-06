-- 20261005000032_add_front_page_settings.sql
-- Adds the two site-wide front page switches, disabled by default.
-- Connects the public bootstrap and administrator settings editor to the same stored defaults.
-- Exists so new and upgraded sites preserve today's opening view until explicitly enabled.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH settings(key, description) AS (
    VALUES ('separate_front_page', 'Open the optional front page at the site root instead of the first dataset.'),
           ('front_page_button_shows_site_name', 'Use the configured site name on the Home button; an empty name uses the translated label.')
)
INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
SELECT key, false, '{"value":false}'::jsonb, 'false', 2, description FROM settings
WHERE NOT EXISTS (SELECT 1 FROM public.system_config existing WHERE existing.key = settings.key);
