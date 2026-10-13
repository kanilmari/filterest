-- 20261013000002_seed_card_and_filterbar_language_keys.sql
-- Seeds card and filterbar copy through the shared interface dictionaries.
-- Connects upgrades and fresh bootstrap to all four legacy UI language codes and canonical locales.
-- Preserves nonblank site copy, repairing only missing copy and exact English fallbacks in other languages.
-- VERSION_DB: 9.11.1
-- VERSION_DB_OWNER: 20261013000099_record_database_release_9_11_1.sql

-- Count labels have their own namespace: result/results may be site headings,
-- whose wording and grammatical form must survive this migration unchanged.
WITH copy(lang_key, fi, en, ch, tw, yue) AS (VALUES
    ('sort_newest', 'Uusimmat ensin', 'Newest first', '最新优先', '最新優先', '最新先'),
    ('sort_oldest', 'Vanhimmat ensin', 'Oldest first', '最旧优先', '最舊優先', '最舊先'),
    ('sort_updated_newest', 'Viimeksi päivitetyt ensin', 'Recently updated first', '最近更新优先', '最近更新優先', '最近更新先'),
    ('sort_updated_oldest', 'Vanhimmin päivitetyt ensin', 'Least recently updated first', '最早更新优先', '最早更新優先', '最耐冇更新先'),
    ('search_relevance', 'Hakurelevanssi', 'Search relevance', '搜索相关度', '搜尋相關度', '搜尋相關度'),
    ('sort_images_first', 'Kuvalliset ensin', 'Rows with images first', '有图片的行优先', '有圖片的資料列優先', '有圖片嘅資料列優先'),
    ('results_count_singular', 'tulos', 'result', '个结果', '個結果', '個結果'),
    ('results_count_plural', 'tulosta', 'results', '个结果', '個結果', '個結果'),
    ('results_count_text_search_singular', 'tulos tekstihaulla', 'result in text search', '个文本搜索结果', '個文字搜尋結果', '個文字搜尋結果'),
    ('results_count_text_search_plural', 'tulosta tekstihaulla', 'results in text search', '个文本搜索结果', '個文字搜尋結果', '個文字搜尋結果'),
    ('results_count_ai_search_singular', 'tulos tekoälyhaulla', 'result in AI search', '个人工智能搜索结果', '個人工智能搜尋結果', '個 AI 搜尋結果'),
    ('results_count_ai_search_plural', 'tulosta tekoälyhaulla', 'results in AI search', '个人工智能搜索结果', '個人工智能搜尋結果', '個 AI 搜尋結果'),
    ('edit_fields_view', 'Muokkaa kenttänäkymää', 'Edit fields view', '编辑字段视图', '編輯欄位檢視', '編輯欄位檢視'),
    ('add_row_to_dataset', 'Lisää rivi: $table_name', 'Add row: $table_name', '添加行：$table_name', '新增資料列：$table_name', '新增資料列：$table_name'),
    ('unknown', 'Tuntematon', 'Unknown', '未知', '未知', '未知道'),
    ('created_by_name', 'Luojan nimi', 'Created by name', '创建者姓名', '建立者姓名', '建立者姓名'),
    ('owner_name (ln)', 'Omistajan nimi', 'Owner name (ln)', '所有者姓名', '擁有者姓名', '擁有者姓名'),
    ('search_for_created_by_name', 'Hae luojan nimellä', 'Search for created by name', '按创建者姓名搜索', '按建立者姓名搜尋', '按建立者姓名搜尋'),
    ('search_for_owner_name (ln)', 'Hae omistajan nimellä', 'Search for owner name (ln)', '按所有者姓名搜索', '按擁有者姓名搜尋', '按擁有者姓名搜尋'),
    ('created_by_name_asc', 'Luojan nimi, nouseva', 'Created by name, ascending', '创建者姓名，升序', '建立者姓名，升序', '建立者姓名，升序'),
    ('created_by_name_desc', 'Luojan nimi, laskeva', 'Created by name, descending', '创建者姓名，降序', '建立者姓名，降序', '建立者姓名，降序'),
    ('owner_name (ln)_asc', 'Omistajan nimi, nouseva', 'Owner name (ln), ascending', '所有者姓名，升序', '擁有者姓名，升序', '擁有者姓名，升序'),
    ('owner_name (ln)_desc', 'Omistajan nimi, laskeva', 'Owner name (ln), descending', '所有者姓名，降序', '擁有者姓名，降序', '擁有者姓名，降序')
), written AS (
    INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, 'Owner-approved card/filterbar interface copy, 12 October 2026.'
    FROM copy
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys existing WHERE existing.lang_key = copy.lang_key)
    RETURNING id, lang_key, fi, en, ch, yue
), repaired AS (
    -- lang.go prefers nonblank legacy columns. Repair them too, and return their
    -- new values: sibling CTEs otherwise read the statement's pre-update snapshot.
    UPDATE public.system_lang_keys AS existing
    SET fi = CASE WHEN NULLIF(btrim(existing.fi, E' \t\n\r\f' || chr(11)), '') IS NULL
                   OR existing.fi COLLATE "C" = copy.en COLLATE "C" THEN copy.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en, E' \t\n\r\f' || chr(11)), '') IS NULL THEN copy.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch, E' \t\n\r\f' || chr(11)), '') IS NULL
                   OR existing.ch COLLATE "C" = copy.en COLLATE "C" THEN copy.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue, E' \t\n\r\f' || chr(11)), '') IS NULL
                    OR existing.yue COLLATE "C" = copy.en COLLATE "C" THEN copy.yue ELSE existing.yue END
    FROM copy
    WHERE existing.lang_key = copy.lang_key
      AND (NULLIF(btrim(existing.fi, E' \t\n\r\f' || chr(11)), '') IS NULL OR existing.fi COLLATE "C" = copy.en COLLATE "C"
        OR NULLIF(btrim(existing.en, E' \t\n\r\f' || chr(11)), '') IS NULL
        OR NULLIF(btrim(existing.ch, E' \t\n\r\f' || chr(11)), '') IS NULL OR existing.ch COLLATE "C" = copy.en COLLATE "C"
        OR NULLIF(btrim(existing.yue, E' \t\n\r\f' || chr(11)), '') IS NULL OR existing.yue COLLATE "C" = copy.en COLLATE "C")
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en, existing.ch, existing.yue
), served AS (
    SELECT * FROM written UNION ALL SELECT * FROM repaired UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en, k.ch, k.yue
    FROM public.system_lang_keys k JOIN copy USING (lang_key)
    WHERE k.id NOT IN (SELECT id FROM written UNION ALL SELECT id FROM repaired)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s JOIN copy USING (lang_key)
CROSS JOIN LATERAL (VALUES
    ('fi', s.fi),
    ('en', s.en),
    ('ch', s.ch),
    ('yue', s.yue),
    ('zh-CN', s.ch),
    ('zh-TW', copy.tw),
    ('zh-HK', s.yue)
 ) AS translated(language_code, translation)
JOIN public.system_languages AS language ON language.language_code = translated.language_code
WHERE NULLIF(btrim(translated.translation, E' \t\n\r\f' || chr(11)), '') IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM public.system_lang_key_translations retained
    WHERE retained.lang_key_id = s.id AND retained.language_code = translated.language_code
      AND NULLIF(btrim(retained.translation, E' \t\n\r\f' || chr(11)), '') IS NOT NULL
      AND NOT (retained.language_code <> 'en' AND retained.translation COLLATE "C" = copy.en COLLATE "C")
)
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
WHERE NULLIF(btrim(existing.translation, E' \t\n\r\f' || chr(11)), '') IS NULL
   OR (existing.language_code <> 'en' AND existing.translation COLLATE "C" = (
       SELECT copy.en FROM copy JOIN served USING (lang_key) WHERE served.id = existing.lang_key_id) COLLATE "C"
       AND existing.translation IS DISTINCT FROM EXCLUDED.translation);
