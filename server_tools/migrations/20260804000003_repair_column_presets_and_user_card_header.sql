-- 20260804000003_repair_column_presets_and_user_card_header.sql
-- Restores the optional column-preset table omitted from an earlier Filterest
-- bootstrap and makes a user's full name the canonical Users-card heading.
-- Bridges existing Easelect databases, upgraded Filterest installations, and
-- the shared card metadata contract.
-- VERSION_DB: 8.0.59

CREATE TABLE IF NOT EXISTS public.system_column_view_presets (
    id serial PRIMARY KEY,
    table_name text NOT NULL,
    preset_name text NOT NULL,
    hidden_columns jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by integer REFERENCES public.system_users(id) ON DELETE SET NULL,
    created timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (table_name, preset_name)
);

WITH users_table AS (
    SELECT table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_users'
      AND COALESCE(schema_name, 'public') = 'public'
    ORDER BY id
    LIMIT 1
)
UPDATE public.system_column_details AS column_details
SET card_element = 'details'
FROM users_table
WHERE column_details.table_uid = users_table.table_uid
  AND column_details.column_name <> 'full_name'
  AND COALESCE(column_details.card_element, '') ILIKE '%header%';

WITH users_table AS (
    SELECT table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_users'
      AND COALESCE(schema_name, 'public') = 'public'
    ORDER BY id
    LIMIT 1
)
UPDATE public.system_column_details AS column_details
SET card_element = 'header',
    show_key_on_card = FALSE,
    show_value_on_card = TRUE,
    hide_on_small_card = FALSE,
    updated = now()
FROM users_table
WHERE column_details.table_uid = users_table.table_uid
  AND column_details.column_name = 'full_name';

UPDATE public.system_db_tables
SET fk_display_column = 'full_name',
    updated = now()
WHERE table_name = 'system_users'
  AND COALESCE(schema_name, 'public') = 'public';

INSERT INTO public.system_db_version (version, description)
SELECT '8.0.59', 'Repaired Filterest column presets and made full name the Users-card heading'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '8.0.59'
);
