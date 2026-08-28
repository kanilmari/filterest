-- 20260822000002_add_site_favicon_setting.sql
-- Adds the optional administrator-selected favicon filename.
-- Bridges system configuration with the fixed public favicon asset directory.
-- Exists so a site can override name-based initial selection without storing arbitrary paths.
-- VERSION_DB: 9.3.0
-- VERSION_DB_OWNER: 20260822000001_create_system_row_groups.sql

INSERT INTO public.system_config (key, json_value, creation_spec, text_value)
SELECT
    'favicon',
    '{"value":""}'::jsonb,
    'Optional favicon PNG filename from frontend/icons/site_favicons; empty uses site-name initials and then Filterest F.',
    ''
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_config WHERE key = 'favicon'
);
