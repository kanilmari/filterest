-- 20260908000004_add_article_view_and_field_settings.sql
-- Registers an independent article view and the clear field-settings route.
-- Bridges existing view assignments and permissions with compatible UI names.
-- Preserves existing card choices, legacy assignments, and administrator translations.
-- VERSION_DB: 9.7.7

-- Retain a legacy article dimension's identity and all FK-backed settings.
UPDATE public.system_table_views
SET view_key = 'article_view'
WHERE id = (
    SELECT id FROM public.system_table_views
    WHERE view_key IN ('article', 'big_card', 'row_article')
    ORDER BY CASE view_key WHEN 'article' THEN 0 WHEN 'big_card' THEN 1 ELSE 2 END, id
    LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM public.system_table_views WHERE view_key = 'article_view');

INSERT INTO public.system_table_views (name, view_key, status)
VALUES ('article_view', 'article_view', 'active')
ON CONFLICT (view_key) DO NOTHING;

-- If several old aliases existed, retain their records and fill only missing
-- canonical targets. Explicit article settings take precedence over aliases.
INSERT INTO public.system_view_field_set_assignments
    (user_id, group_id, table_uid, view_id, field_set_id, group_priority, created_by, created, updated)
SELECT old.user_id, old.group_id, old.table_uid, canonical.id,
       old.field_set_id, old.group_priority, old.created_by, old.created, old.updated
FROM public.system_view_field_set_assignments old
JOIN public.system_table_views legacy ON legacy.id = old.view_id
CROSS JOIN public.system_table_views canonical
WHERE legacy.view_key IN ('article', 'big_card', 'row_article')
  AND canonical.view_key = 'article_view'
ORDER BY CASE legacy.view_key WHEN 'article' THEN 0 WHEN 'big_card' THEN 1 ELSE 2 END, old.id
ON CONFLICT DO NOTHING;

WITH desired(name, route) AS (
    VALUES ('ui.view.article_view', '/ui/view/article_view'),
           ('ui.admin.view_field_settings', '/ui/admin/view_field_settings')
)
INSERT INTO public.system_functions
    (name, package, disabled, specific_table_related, url_route_endpoint, ui_only,
     rate_limit_amount, rate_limit_minutes, creation_spec)
SELECT name, 'frontend', FALSE, FALSE, route, TRUE, 200, 20,
       'Independent article presentation and compatible field-settings navigation.'
FROM desired
ON CONFLICT (name) DO NOTHING;

-- Preserve exactly the existing route audience, including target scoping.
-- Old routes remain available to saved bookmarks and permission integrations.
INSERT INTO public.system_group_table_func_rights
    (user_group_id, function_id, target_schema_name, target_table_uid, creation_spec)
SELECT rights.user_group_id, current_route.id, rights.target_schema_name,
       rights.target_table_uid, 'Preserved audience for the canonical article/settings route.'
FROM public.system_group_table_func_rights rights
JOIN public.system_functions old_route ON old_route.id = rights.function_id
JOIN public.system_functions current_route ON current_route.name = CASE old_route.name
    WHEN 'ui.view.card' THEN 'ui.view.article_view'
    WHEN 'ui.admin.view_field_assignments' THEN 'ui.admin.view_field_settings' END
WHERE old_route.name IN ('ui.view.card', 'ui.admin.view_field_assignments')
  AND NOT EXISTS (
      SELECT 1 FROM public.system_group_table_func_rights existing
      WHERE existing.user_group_id = rights.user_group_id
        AND existing.function_id = current_route.id
        AND existing.target_schema_name IS NOT DISTINCT FROM rights.target_schema_name
        AND existing.target_table_uid IS NOT DISTINCT FROM rights.target_table_uid
  )
ON CONFLICT DO NOTHING;

WITH authored(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES ('view_field_settings', 'Näkymien kenttäasetukset', 'View field settings',
            '视图字段设置', '檢視欄位設定', 'Canonical navigation title for per-view field settings.'),
           ('view_article', 'Artikkeli', 'Article', '文章', '文章',
            'Independent article presentation with its own field settings.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, creation_spec FROM authored
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    ch = CASE WHEN NULLIF(btrim(system_lang_keys.ch), '') IS NULL THEN EXCLUDED.ch ELSE system_lang_keys.ch END,
    yue = CASE WHEN NULLIF(btrim(system_lang_keys.yue), '') IS NULL THEN EXCLUDED.yue ELSE system_lang_keys.yue END
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.ch), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.yue), '') IS NULL;

INSERT INTO public.system_lang_key_translations
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys keys
-- Legacy ch/yue fields remain intact; they are not normalized language codes.
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en))
    AS copy(language_code, translation)
WHERE keys.lang_key IN ('view_field_settings', 'view_article')
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.7', 'Independent article view and compatible field settings naming'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.7.7');
