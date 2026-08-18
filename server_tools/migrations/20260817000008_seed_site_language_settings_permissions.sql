-- 20260817000008_seed_site_language_settings_permissions.sql
-- Registers the public locale catalogue and the administrator-owned site-language editor.
-- Seeds the editor's fixed copy so opening the settings view never triggers page-load AI translation.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

WITH desired_functions (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES
        ('lang.GetPublicUILanguagesHandler', 'lang', FALSE, '/api/ui-languages'),
        ('lang.AdminUILanguagesHandler', 'lang', FALSE, '/api/admin/ui-languages')
), missing_functions AS (
    SELECT
        desired.*,
        ROW_NUMBER() OVER (ORDER BY desired.name) AS id_offset
    FROM desired_functions AS desired
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_functions AS existing
        WHERE existing.name = desired.name
    )
), current_id AS (
    SELECT COALESCE(MAX(id), 0)::BIGINT AS max_id
    FROM public.system_functions
)
INSERT INTO public.system_functions (
    id,
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
    current_id.max_id + missing.id_offset,
    missing.name,
    FALSE,
    now(),
    now(),
    missing.package,
    missing.specific_table_related,
    'Filterest DB 9.0.0 site-language settings',
    200,
    20,
    missing.url_route_endpoint,
    FALSE
FROM missing_functions AS missing
CROSS JOIN current_id;

WITH desired_functions (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES
        ('lang.GetPublicUILanguagesHandler', 'lang', FALSE, '/api/ui-languages'),
        ('lang.AdminUILanguagesHandler', 'lang', FALSE, '/api/admin/ui-languages')
)
UPDATE public.system_functions AS target
SET disabled = FALSE,
    updated = now(),
    package = desired.package,
    specific_table_related = desired.specific_table_related,
    creation_spec = 'Filterest DB 9.0.0 site-language settings',
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = desired.url_route_endpoint,
    ui_only = FALSE
FROM desired_functions AS desired
WHERE target.name = desired.name;

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
    'Filterest DB 9.0.0 site-language settings',
    NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'lang.AdminUILanguagesHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
  );

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES
    ('site_settings', 'Sivustoasetukset', 'Site settings', '站点设置', '網站設定', 'Admin navigation group for site-wide settings.'),
    ('site_languages', 'Sivuston kielet', 'Site languages', '站点语言', '網站語言', 'Admin view for the canonical site-language registry.'),
    ('site_languages_description', 'Valitse sivuston kielet, yksi oletuskieli, selkeät varakielet ja julkisessa kielivalitsimessa näkyvät tarkistetut kielet.', 'Choose the site languages, one default, explicit fallbacks, and which reviewed languages may appear publicly.', '选择站点语言、一个默认语言、明确的后备语言，以及可在公共语言选择器中显示的已审核语言。', '選擇網站語言、一個預設語言、明確嘅後備語言，同埋可以喺公開語言選擇器顯示嘅已審核語言。', 'Explanation above the administrator-owned site-language registry.'),
    ('language', 'Kieli', 'Language', '语言', '語言', 'Column heading in the site-language registry.'),
    ('enabled', 'Käytössä', 'Enabled', '已启用', '已啟用', 'Whether a site language is enabled.'),
    ('default_language', 'Oletuskieli', 'Default language', '默认语言', '預設語言', 'The one root language used by the site.'),
    ('fallback_language', 'Varakieli', 'Fallback language', '后备语言', '後備語言', 'Explicit fallback used when a translation is unavailable.'),
    ('translation_coverage', 'Käännösten kattavuus', 'Translation coverage', '翻译覆盖率', '翻譯覆蓋程度', 'Coverage status shown in the site-language registry.'),
    ('review_status', 'Tarkistustila', 'Review status', '审核状态', '審核狀態', 'Review status shown in the site-language registry.'),
    ('public_selector', 'Julkinen kielivalitsin', 'Public language selector', '公共语言选择器', '公開語言選擇器', 'Whether an approved language may appear in the public selector.'),
    ('save', 'Tallenna', 'Save', '保存', '儲存', 'Shared save action.'),
    ('saving', 'Tallennetaan…', 'Saving…', '正在保存…', '儲存緊…', 'Progress copy while site-language settings are saved.'),
    ('settings_saved', 'Asetukset tallennettu.', 'Settings saved.', '设置已保存。', '設定已儲存。', 'Confirmation after settings are saved.'),
    ('save_failed', 'Tallennus epäonnistui.', 'Save failed.', '保存失败。', '儲存失敗。', 'Safe generic failure copy for a settings update.'),
    ('load_failed', 'Lataus epäonnistui.', 'Loading failed.', '加载失败。', '載入失敗。', 'Safe generic failure copy for a settings view load.')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH authored_translations AS (
    SELECT keys.id AS lang_key_id,
           values.language_code,
           values.translation,
           values.review_status
    FROM public.system_lang_keys AS keys
    CROSS JOIN LATERAL (
        VALUES
            ('en'::TEXT, keys.en, 'approved'::TEXT),
            ('fi'::TEXT, keys.fi, 'approved'::TEXT),
            ('zh-CN'::TEXT, keys.ch, 'needs_review'::TEXT)
    ) AS values(language_code, translation, review_status)
    WHERE keys.lang_key IN (
        'site_settings',
        'site_languages',
        'site_languages_description',
        'language',
        'enabled',
        'default_language',
        'fallback_language',
        'translation_coverage',
        'review_status',
        'public_selector',
        'save',
        'saving',
        'settings_saved',
        'save_failed',
        'load_failed'
    )
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id,
    language_code,
    translation,
    source_kind,
    review_status
)
SELECT
    authored.lang_key_id,
    authored.language_code,
    authored.translation,
    'manual',
    authored.review_status
FROM authored_translations AS authored
WHERE NULLIF(btrim(authored.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id,
    source_type,
    source_high,
    source_low,
    usage_explanation,
    last_seen
)
SELECT
    keys.id,
    'javascript',
    'frontend/core_components/admin_tools/site_language_settings_view.js',
    '',
    'Renders the canonical Admin → Site settings → Languages view without page-load AI translation.',
    CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'site_settings',
    'site_languages',
    'site_languages_description',
    'language',
    'enabled',
    'default_language',
    'fallback_language',
    'translation_coverage',
    'review_status',
    'public_selector',
    'save',
    'saving',
    'settings_saved',
    'save_failed',
    'load_failed'
)
ON CONFLICT DO NOTHING;
