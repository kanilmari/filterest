-- Expands the typed site-presentation contract with layout and navigation controls.
-- Preserves existing light/dark cover values while adding shared defaults.
-- Exists so administrators can tune these surfaces without source releases.
-- VERSION_DB: 9.2.5

INSERT INTO public.system_config (
    key,
    json_value,
    creation_spec
)
VALUES (
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
        "hero_bottom_fade": 48,
        "image_blur": 1,
        "card_image_width": 300,
        "active_tab_fade": 25,
        "active_tab_max_opacity": 1,
        "active_tab_glow_intensity": 0.3,
        "active_tab_glow_width": 1.5,
        "active_tab_glow_blur": 2,
        "brand_color": "#1a8fe6"
      }
    }'::jsonb,
    'Admin-managed, theme-aware dataset cover presentation settings.'
)
ON CONFLICT (key) DO UPDATE
SET json_value = jsonb_set(
        COALESCE(public.system_config.json_value, '{}'::jsonb),
        '{shared}',
        '{
          "hero_extra_height": 40,
          "hero_bottom_fade": 48,
          "image_blur": 1,
          "card_image_width": 300,
          "active_tab_fade": 25,
          "active_tab_max_opacity": 1,
          "active_tab_glow_intensity": 0.3,
          "active_tab_glow_width": 1.5,
          "active_tab_glow_blur": 2,
          "brand_color": "#1a8fe6"
        }'::jsonb || COALESCE(public.system_config.json_value -> 'shared', '{}'::jsonb),
        TRUE
    ),
    creation_spec = COALESCE(
        NULLIF(public.system_config.creation_spec, ''),
        EXCLUDED.creation_spec
    ),
    updated = now();

INSERT INTO public.system_db_version (version, description)
SELECT '9.2.5', 'Expanded persistent hero, card image, and active dataset-tab presentation controls'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.2.5'
);
