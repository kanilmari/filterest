-- 20260820000004_add_site_presentation_settings.sql
-- Adds typed site-presentation settings plus public-read/admin-write API rights.
-- VERSION_DB: 9.2.4
-- VERSION_DB_OWNER: 20260820000003_seed_travel_dataset_presentation_defaults.sql

INSERT INTO public.system_config (
    key,
    json_value,
    text_value,
    creation_spec
)
VALUES
    (
        'dataset_cover_theme_config',
        '{
          "light": {
            "oval_enabled": true,
            "oval_width": 32,
            "oval_height": 67,
            "oval_position_y": 56,
            "center_opacity": 0.4,
            "mid_opacity": 0.7,
            "edge_opacity": 1,
            "center_stop": 39,
            "mid_stop": 55,
            "edge_stop": 80,
            "image_opacity": 1,
            "overlay_opacity": 0
          },
          "dark": {
            "oval_enabled": false,
            "oval_width": 32,
            "oval_height": 67,
            "oval_position_y": 56,
            "center_opacity": 0.4,
            "mid_opacity": 0.7,
            "edge_opacity": 1,
            "center_stop": 39,
            "mid_stop": 55,
            "edge_stop": 80,
            "image_opacity": 0.3,
            "overlay_opacity": 0
          },
          "shared": {
            "hero_extra_height": 40,
            "image_blur": 1
          }
        }'::jsonb,
        NULL::text,
        'Admin-managed, theme-aware dataset cover presentation settings.'
    ),
    (
        'row_article_timestamp_display_mode',
        '{"value":"date_time"}'::jsonb,
        'date_time',
        'Admin-managed row article timestamp display mode.'
    )
ON CONFLICT (key) DO UPDATE
SET creation_spec = COALESCE(
        NULLIF(public.system_config.creation_spec, ''),
        EXCLUDED.creation_spec
    ),
    updated = now();

WITH desired_functions (
    name,
    url_route_endpoint
) AS (
    VALUES
        (
            'system_table_tools.GetSitePresentationSettingsHandler',
            '/api/site-presentation-settings'
        ),
        (
            'system_table_tools.AdminSitePresentationSettingsHandler',
            '/api/admin/site-presentation-settings'
        )
), missing_functions AS (
    SELECT desired.*
    FROM desired_functions AS desired
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_functions AS existing
        WHERE existing.name = desired.name
    )
)
INSERT INTO public.system_functions (
    name,
    disabled,
    created,
    updated,
    package,
    specific_table_related,
    creation_spec,
    rate_limit_amount,
    rate_limit_minutes,
    url_route_endpoint,
    ui_only
)
SELECT
    missing.name,
    FALSE,
    now(),
    now(),
    'system_table_tools',
    FALSE,
    'Typed site presentation settings API',
    400,
    20,
    missing.url_route_endpoint,
    FALSE
FROM missing_functions AS missing;

UPDATE public.system_functions AS functions
SET disabled = FALSE,
    updated = now(),
    package = 'system_table_tools',
    specific_table_related = FALSE,
    creation_spec = 'Typed site presentation settings API',
    rate_limit_amount = 400,
    rate_limit_minutes = 20,
    url_route_endpoint = desired.url_route_endpoint,
    ui_only = FALSE
FROM (
    VALUES
        (
            'system_table_tools.GetSitePresentationSettingsHandler',
            '/api/site-presentation-settings'
        ),
        (
            'system_table_tools.AdminSitePresentationSettingsHandler',
            '/api/admin/site-presentation-settings'
        )
) AS desired(name, url_route_endpoint)
WHERE functions.name = desired.name;

INSERT INTO public.system_group_table_func_rights (
    user_group_id,
    function_id,
    target_schema_name,
    creation_spec,
    target_table_uid
)
SELECT
    groups.id,
    functions.id,
    'public',
    'Administrator site presentation settings write access',
    NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'system_table_tools.AdminSitePresentationSettingsHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

DELETE FROM public.system_group_table_func_rights AS rights
USING public.system_functions AS functions
WHERE functions.id = rights.function_id
  AND functions.name = 'system_table_tools.AdminSitePresentationSettingsHandler'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_user_groups AS groups
      WHERE groups.id = rights.user_group_id
        AND groups.name = 'admins'
  );
