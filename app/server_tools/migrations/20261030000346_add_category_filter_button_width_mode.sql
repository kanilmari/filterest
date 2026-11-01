-- 20261030000346_add_category_filter_button_width_mode.sql
-- Adds the site-wide category button width setting with the fill-row default.
-- Connects upgraded sites and fresh bootstrap to the same text setting.
-- Replay preserves an administrator's existing choice without changing it.
-- VERSION_DB: 9.13.4
-- VERSION_DB_OWNER: 20261030000399_record_database_release_category_button_width.sql

INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
SELECT 'category_filter_button_width_mode', NULL, '{"value":"fill_row_with_centered_label"}'::jsonb, 'fill_row_with_centered_label', NULL,
    'Choose site-wide category buttons that fill each row with centred labels or fit their labels.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'category_filter_button_width_mode');
