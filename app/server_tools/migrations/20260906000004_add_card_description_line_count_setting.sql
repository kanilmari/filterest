-- Adds the site-wide card-description row count to typed presentation settings.
-- Bridges the administrator palette, public settings API, and card rendering.
-- Preserves every existing theme value while giving upgraded sites the two-row default.
-- VERSION_DB: 9.7.3
-- VERSION_DB_OWNER: 20260906000002_add_column_view_support_matrix.sql

UPDATE public.system_config
SET json_value = jsonb_set(
        jsonb_set(
            COALESCE(NULLIF(json_value, 'null'::jsonb), '{}'::jsonb),
            '{shared}',
            COALESCE(NULLIF(json_value -> 'shared', 'null'::jsonb), '{}'::jsonb),
            TRUE
        ),
        '{shared,card_description_lines}',
        COALESCE(
            NULLIF(json_value #> '{shared,card_description_lines}', 'null'::jsonb),
            '2'::jsonb
        ),
        TRUE
    ),
    creation_spec = COALESCE(
        NULLIF(creation_spec, ''),
        'Admin-managed, theme-aware site presentation settings.'
    ),
    updated = NOW()
WHERE key = 'dataset_cover_theme_config';
