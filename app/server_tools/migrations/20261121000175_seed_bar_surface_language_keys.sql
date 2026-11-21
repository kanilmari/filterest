-- 20261121000175_seed_bar_surface_language_keys.sql
-- Seeds the label of the frosted-bars experiment switch in the menu's administration tools (WL182).
-- Preserve previously authored nonblank translations on update and replay.
-- VERSION_DB: 9.13.9
-- VERSION_DB_OWNER: 20261121000199_record_database_release_bar_surface.sql
WITH copy(lang_key, fi, en, ch, tw, yue) AS (VALUES
    ('bar_surface_frosted_experiment', 'Huurretut palkit (kokeilu)', 'Frosted bars (experiment)', '毛玻璃栏（实验）', '毛玻璃欄（實驗）', '毛玻璃欄（實驗）')
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, 'Menu administration tools: the switch that turns the frosted-bars experiment on in this browser (WL182).' FROM copy
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
    ('zh', s.ch), ('zh-CN', s.ch), ('zh-TW', copy.tw), ('zh-HK', s.yue)
) AS translated(language_code, translation)
JOIN public.system_languages language ON language.language_code = translated.language_code
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind, review_status = EXCLUDED.review_status
WHERE NULLIF(btrim(existing.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT keys.id, 'code', source.path, '', source.explanation, CURRENT_DATE
FROM public.system_lang_keys keys
JOIN (VALUES
    ('public_articles_all', 'backend/core_components/router/public_articles_page.go', 'Heading of the plain list of all published articles, and the link to it under a readable article.'),
    ('public_articles_all', 'frontend/core_components/navigation/navbar/navbar_all_articles_link.js', 'The menu link under the dataset tabs that opens the plain list of all published articles.'),
    ('public_articles_newest', 'backend/core_components/router/public_articles_page.go', 'Heading above a dataset''s newest articles on a plain page.'),
    ('public_articles_more', 'backend/core_components/router/public_articles_page.go', 'Link from the plain index to the full list of one dataset''s articles.'),
    ('public_articles_next_page', 'backend/core_components/router/public_articles_page.go', 'Link to the next page of a plain article list.'),
    ('public_articles_previous_page', 'backend/core_components/router/public_articles_page.go', 'Link to the previous page of a plain article list.'),
    ('public_articles_page_number', 'backend/core_components/router/public_articles_page.go', 'The page number of a plain article list; {page} is the number.'),
    ('public_articles_none', 'backend/core_components/router/public_articles_page.go', 'Shown on a plain article list when a visitor can read no article there.')
) AS source(lang_key, path, explanation) ON source.lang_key = keys.lang_key
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
