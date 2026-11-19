-- 20261119000175_seed_public_article_language_keys.sql
-- Seeds the words of the plain article pages and the menu's "All articles" link (WL175).
-- Preserve previously authored nonblank translations on update and replay.
-- VERSION_DB: 9.13.8
-- VERSION_DB_OWNER: 20261119000199_record_database_release_public_articles.sql
WITH copy(lang_key, fi, en, ch, tw, yue) AS (VALUES
    ('public_articles_all', 'Kaikki artikkelit', 'All articles', '全部文章', '全部文章', '全部文章'),
    ('public_articles_newest', 'Uusimmat artikkelit', 'Newest articles', '最新文章', '最新文章', '最新文章'),
    ('public_articles_more', 'Lisää artikkeleita', 'More articles', '更多文章', '更多文章', '更多文章'),
    ('public_articles_next_page', 'Seuraava sivu', 'Next page', '下一页', '下一頁', '下一頁'),
    ('public_articles_previous_page', 'Edellinen sivu', 'Previous page', '上一页', '上一頁', '上一頁'),
    ('public_articles_page_number', 'Sivu {page}', 'Page {page}', '第 {page} 页', '第 {page} 頁', '第 {page} 頁'),
    ('public_articles_none', 'Täällä ei ole vielä artikkeleita.', 'There are no articles here yet.', '这里还没有文章。', '這裡還沒有文章。', '呢度仲未有文章。')
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, 'Plain article pages and the All articles link (WL175).' FROM copy
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
