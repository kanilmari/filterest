-- 20261009000074_seed_filterbar_style_language_key.sql
-- Seeds the filter-panel appearance title and phone search toggle in every UI language.
-- Connects filterbar disclosures and accessible controls to both translation stores.
-- Fills blank served translations while preserving installation-authored bytes.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql

WITH copy(lang_key, fi, en, ch, tw, yue) AS (VALUES
    ('filterbar_style_and_colors', 'Tyyli- ja väriasetukset', 'Style and color settings',
        '样式和颜色设置', '樣式與色彩設定', '樣式及顏色設定'),
    ('filterbar_show_search', 'Näytä haku', 'Show search', '显示搜索', '顯示搜尋', '顯示搜尋'),
    ('filterbar_hide_search', 'Piilota haku', 'Hide search', '隐藏搜索', '隱藏搜尋', '隱藏搜尋')
), written AS (
    INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, 'Tickets #901b/#902: filterbar appearance and phone search controls.'
    FROM copy
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys existing WHERE existing.lang_key = copy.lang_key)
    RETURNING id, lang_key, fi, en, ch, yue
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en, k.ch, k.yue
    FROM public.system_lang_keys k JOIN copy USING (lang_key)
    WHERE k.lang_key NOT IN (SELECT lang_key FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s JOIN copy USING (lang_key)
-- Trim only to detect blanks: space, tab, LF, CR, form feed and vertical tab.
-- Return the original nonblank value, including its surrounding whitespace.
CROSS JOIN LATERAL (VALUES
    ('fi', CASE WHEN NULLIF(btrim(s.fi, E' \t\n\r\f' || chr(11)), '') IS NULL THEN copy.fi ELSE s.fi END),
    ('en', CASE WHEN NULLIF(btrim(s.en, E' \t\n\r\f' || chr(11)), '') IS NULL THEN copy.en ELSE s.en END),
    ('ch', CASE WHEN NULLIF(btrim(s.ch, E' \t\n\r\f' || chr(11)), '') IS NULL THEN copy.ch ELSE s.ch END),
    ('yue', CASE WHEN NULLIF(btrim(s.yue, E' \t\n\r\f' || chr(11)), '') IS NULL THEN copy.yue ELSE s.yue END),
    ('zh-CN', CASE WHEN NULLIF(btrim(s.ch, E' \t\n\r\f' || chr(11)), '') IS NULL THEN copy.ch ELSE s.ch END),
    ('zh-TW', copy.tw),
    ('zh-HK', CASE WHEN NULLIF(btrim(s.yue, E' \t\n\r\f' || chr(11)), '') IS NULL THEN copy.yue ELSE s.yue END)
) AS translated(language_code, translation)
JOIN public.system_languages AS language ON language.language_code = translated.language_code
WHERE NULLIF(btrim(translated.translation, E' \t\n\r\f' || chr(11)), '') IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM public.system_lang_key_translations retained
    WHERE retained.lang_key_id = s.id AND retained.language_code = translated.language_code
    AND NULLIF(btrim(retained.translation, E' \t\n\r\f' || chr(11)), '') IS NOT NULL
)
ON CONFLICT (lang_key_id, language_code) DO UPDATE SET translation = EXCLUDED.translation
WHERE NULLIF(btrim(existing.translation, E' \t\n\r\f' || chr(11)), '') IS NULL;
