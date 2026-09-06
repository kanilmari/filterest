-- 20260906000003_add_user_visual_preferences.sql
-- Adds account-owned, allowlisted visual preferences and localized theme labels.
-- Bridges the existing light/dark/system control with durable user identity.
-- Exists so signed-in appearance follows the account while guest choice stays device-local.
-- VERSION_DB: 9.7.3
-- VERSION_DB_OWNER: 20260906000002_add_column_view_support_matrix.sql

CREATE TABLE IF NOT EXISTS public.system_user_visual_preferences (
    user_id        INTEGER PRIMARY KEY
        REFERENCES public.system_users(id) ON DELETE CASCADE,
    theme_mode     TEXT,
    schema_version SMALLINT    NOT NULL DEFAULT 1,
    revision       BIGINT      NOT NULL DEFAULT 1,
    created        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_user_visual_preferences_theme_mode
        CHECK (theme_mode IS NULL OR theme_mode IN ('system', 'dark', 'light')),
    CONSTRAINT ck_system_user_visual_preferences_schema_version
        CHECK (schema_version = 1),
    CONSTRAINT ck_system_user_visual_preferences_revision
        CHECK (revision >= 1)
);

COMMENT ON TABLE public.system_user_visual_preferences IS
    'One allowlisted visual-preference row per authenticated user; arbitrary CSS is never stored.';
COMMENT ON COLUMN public.system_user_visual_preferences.theme_mode IS
    'Semantic application theme: system, dark, light, or NULL to inherit a later typed site default.';
COMMENT ON COLUMN public.system_user_visual_preferences.revision IS
    'Monotonic account-preference revision incremented by the self-scoped API.';

CREATE OR REPLACE FUNCTION public.set_system_user_visual_preferences_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_system_user_visual_preferences_timestamp'
          AND tgrelid = 'public.system_user_visual_preferences'::regclass
    ) THEN
        CREATE TRIGGER update_system_user_visual_preferences_timestamp
            BEFORE UPDATE ON public.system_user_visual_preferences
            FOR EACH ROW
            EXECUTE FUNCTION public.set_system_user_visual_preferences_updated_timestamp();
    END IF;
END $$;

INSERT INTO public.system_db_tables (
    table_name, description, cached_oid, folder_id, schema_name,
    fk_display_column, filterbar_visible_by_default, is_removable,
    display_name, sql_dump_policy
)
SELECT
    'system_user_visual_preferences',
    'Allowlisted account-owned visual preferences',
    classes.oid::INTEGER,
    (
        SELECT metadata.folder_id
        FROM public.system_db_tables AS metadata
        WHERE metadata.table_name = 'system_users'
          AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
        LIMIT 1
    ),
    'public',
    'theme_mode',
    FALSE,
    FALSE,
    'User Visual Preferences',
    'all'
FROM pg_class AS classes
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace
 AND schemas.nspname = 'public'
WHERE classes.relname = 'system_user_visual_preferences'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_db_tables AS existing
      WHERE existing.table_name = 'system_user_visual_preferences'
        AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
  );

UPDATE public.system_db_tables AS target
SET description = 'Allowlisted account-owned visual preferences',
    cached_oid = classes.oid::INTEGER,
    schema_name = 'public',
    fk_display_column = 'theme_mode',
    filterbar_visible_by_default = FALSE,
    is_removable = FALSE,
    display_name = 'User Visual Preferences',
    sql_dump_policy = 'all',
    updated = now()
FROM pg_class AS classes
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace
 AND schemas.nspname = 'public'
WHERE target.table_name = 'system_user_visual_preferences'
  AND COALESCE(NULLIF(target.schema_name, ''), 'public') = 'public'
  AND classes.relname = 'system_user_visual_preferences';

DO $$
DECLARE
    registered_table_uid INTEGER;
BEGIN
    SELECT table_uid
    INTO registered_table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_user_visual_preferences'
      AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
    LIMIT 1;

    IF registered_table_uid IS NOT NULL THEN
        INSERT INTO public.system_column_details (
            table_uid, column_name, data_type, co_number,
            editable_in_ui, created, updated
        )
        SELECT registered_table_uid,
               columns.column_name,
               columns.data_type,
               columns.ordinal_position,
               FALSE,
               now(),
               now()
        FROM information_schema.columns AS columns
        WHERE columns.table_schema = 'public'
          AND columns.table_name = 'system_user_visual_preferences'
          AND NOT EXISTS (
              SELECT 1
              FROM public.system_column_details AS existing
              WHERE existing.table_uid = registered_table_uid
                AND existing.column_name = columns.column_name
          )
        ORDER BY columns.ordinal_position;
    END IF;
END $$;

INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes,
    url_route_endpoint, ui_only
)
SELECT
    'auth.UserVisualPreferenceHandler',
    FALSE,
    now(),
    now(),
    'auth',
    FALSE,
    'Authenticated-user-owned allowlisted visual preferences.',
    240,
    20,
    '/api/user-visual-preference',
    FALSE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_functions
    WHERE name = 'auth.UserVisualPreferenceHandler'
);

UPDATE public.system_functions
SET disabled = FALSE,
    updated = now(),
    package = 'auth',
    specific_table_related = FALSE,
    creation_spec = 'Authenticated-user-owned allowlisted visual preferences.',
    rate_limit_amount = 240,
    rate_limit_minutes = 20,
    url_route_endpoint = '/api/user-visual-preference',
    ui_only = FALSE
WHERE name = 'auth.UserVisualPreferenceHandler';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basic_user') THEN
        GRANT SELECT, INSERT, UPDATE
            ON TABLE public.system_user_visual_preferences TO basic_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_user') THEN
        GRANT SELECT, INSERT, UPDATE
            ON TABLE public.system_user_visual_preferences TO admin_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guest_user') THEN
        REVOKE ALL PRIVILEGES
            ON TABLE public.system_user_visual_preferences FROM guest_user;
    END IF;
END $$;

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'system_user_visual_preferences',
            'Käyttäjän ulkoasuvalinnat',
            'User Visual Preferences',
            '用户视觉偏好',
            '用戶視覺偏好',
            'Static database-tree label for account-owned visual preferences.'
        ),
        (
            'theme_toggle_system',
            'Teema: järjestelmän mukaan',
            'Theme: system',
            '主题：跟随系统',
            '主題：跟隨系統',
            'Accessible label for the system theme state.'
        ),
        (
            'theme_toggle_dark',
            'Teema: tumma',
            'Theme: dark',
            '主题：深色',
            '主題：深色',
            'Accessible label for the dark theme state.'
        ),
        (
            'theme_toggle_light',
            'Teema: vaalea',
            'Theme: light',
            '主题：浅色',
            '主題：淺色',
            'Accessible label for the light theme state.'
        ),
        (
            'theme_toggle_locked_light',
            'Teema: lukittu vaaleaksi',
            'Theme: locked light',
            '主题：锁定浅色',
            '主題：鎖定淺色',
            'Accessible label for a site-locked light theme.'
        ),
        (
            'theme_toggle_locked_dark',
            'Teema: lukittu tummaksi',
            'Theme: locked dark',
            '主题：锁定深色',
            '主題：鎖定深色',
            'Accessible label for a site-locked dark theme.'
        )
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, creation_spec
FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH selected_keys AS (
    SELECT id, fi, en, ch, yue
    FROM public.system_lang_keys
    WHERE lang_key IN (
        'system_user_visual_preferences',
        'theme_toggle_system',
        'theme_toggle_dark',
        'theme_toggle_light',
        'theme_toggle_locked_light',
        'theme_toggle_locked_dark'
    )
), authored_translations AS (
    SELECT selected.id AS lang_key_id,
           translations.language_code,
           translations.translation,
           translations.review_status
    FROM selected_keys AS selected
    CROSS JOIN LATERAL (
        VALUES
            ('fi', selected.fi, 'approved'),
            ('en', selected.en, 'approved'),
            ('zh-CN', selected.ch, 'needs_review'),
            ('zh-TW', selected.yue, 'needs_review'),
            ('zh-HK', selected.yue, 'needs_review')
    ) AS translations(language_code, translation, review_status)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', review_status
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low,
    usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/theme.js',
       '',
       'Localized accessible theme-toggle states.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'theme_toggle_system',
    'theme_toggle_dark',
    'theme_toggle_light',
    'theme_toggle_locked_light',
    'theme_toggle_locked_dark'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
