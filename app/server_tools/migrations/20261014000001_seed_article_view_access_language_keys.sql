-- 20261014000001_seed_article_view_access_language_keys.sql
-- Seeds explanations for missing article routes and field-settings group warnings.
-- Connects upgrades and the public bootstrap to the same reviewed multilingual copy.
-- Preserves every nonblank site translation; does not change any permission.
-- VERSION_DB: 9.11.2
-- VERSION_DB_OWNER: 20261014000099_record_database_release_9_11_2.sql

WITH copy(lang_key, fi, en, ch, tw, yue) AS (VALUES
    ('article_view_permission_missing', 'Artikkelia ei voi avata, koska sinulta puuttuu artikkelinäkymän käyttöoikeus.', 'You cannot open this article because you do not have permission to use the article view.', '你没有文章视图的使用权限，无法打开此文章。', '你沒有文章視圖的使用權限，無法開啟此文章。', '你冇文章視圖嘅使用權限，無法開啟呢篇文章。'),
    ('view_group_permission_missing', 'Ryhmällä ei ole tämän näkymän käyttöoikeutta. Kenttien valinta ei anna käyttöoikeutta.', 'This group does not have permission to open this view. Field selection does not grant access.', '此用户组没有打开此视图的权限。选择字段不会授予访问权限。', '此使用者群組沒有開啟此視圖的權限。選擇欄位不會授予存取權限。', '呢個用戶群組冇開啟呢個檢視嘅權限。揀選欄位唔會授予存取權限。'),
    ('view_group_open_permissions', 'Avaa Käyttöoikeudet', 'Open Permissions', '打开权限管理', '開啟權限管理', '開啟權限管理'),
    ('view_group_permissions_unavailable', 'Näkymän käyttöoikeuksia ei voitu tarkistaa.', 'View permissions could not be checked.', '无法检查视图权限。', '無法檢查視圖權限。', '未能檢查檢視權限。')
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, 'Article-view permission explanations, owner decision K379.' FROM copy
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL OR NULLIF(btrim(existing.yue), '') IS NULL
    RETURNING id, lang_key, fi, en, ch, yue
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en, k.ch, k.yue FROM public.system_lang_keys k JOIN copy USING (lang_key)
    WHERE k.id NOT IN (SELECT id FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s JOIN copy USING (lang_key)
CROSS JOIN LATERAL (VALUES
    ('fi', s.fi), ('en', s.en), ('ch', s.ch), ('yue', s.yue),
    ('zh-CN', s.ch), ('zh-TW', copy.tw), ('zh-HK', s.yue)
) AS translated(language_code, translation)
JOIN public.system_languages language ON language.language_code = translated.language_code
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind, review_status = EXCLUDED.review_status
WHERE NULLIF(btrim(existing.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', CASE WHEN lang_key = 'article_view_permission_missing'
    THEN 'frontend/core_components/table_views/card_view/article_view_access.js'
    ELSE 'frontend/core_components/admin_tools/view_group_permission_warnings.js' END,
    '', 'Article-view permission explanations, owner decision K379.', CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('article_view_permission_missing', 'view_group_permission_missing', 'view_group_open_permissions', 'view_group_permissions_unavailable')
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
