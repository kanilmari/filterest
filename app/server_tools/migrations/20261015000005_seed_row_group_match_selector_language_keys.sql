-- 20261015000005_seed_row_group_match_selector_language_keys.sql
-- Seeds the category selector legend, direction tags and expandable help.
-- Connects upgrade and bootstrap copy to the owning category-card catalogue.
-- Replaces only exact old seed wording and keeps every other site translation.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql

-- 1. Withdraw only the exact superseded seed text, independently in each store.
WITH superseded_copy(lang_key, fi, en) AS (VALUES
    ('row_group_match_any', 'Vähintään yksi', 'At least one'),
    ('row_group_match_all', 'Kaikki valitut', 'All selected')
), withdrawn_translations AS (
    DELETE FROM public.system_lang_key_translations AS stored
    USING public.system_lang_keys AS keys, superseded_copy AS superseded
    WHERE keys.id = stored.lang_key_id AND keys.lang_key = superseded.lang_key
      AND ((stored.language_code = 'fi' AND stored.translation = superseded.fi)
        OR (stored.language_code = 'en' AND stored.translation = superseded.en))
    RETURNING stored.lang_key_id
)
UPDATE public.system_lang_keys AS keys
SET fi = CASE WHEN keys.fi = superseded.fi THEN NULL ELSE keys.fi END,
    en = CASE WHEN keys.en = superseded.en THEN NULL ELSE keys.en END,
    updated = now()
FROM superseded_copy AS superseded
WHERE keys.lang_key = superseded.lang_key
  AND (keys.fi = superseded.fi OR keys.en = superseded.en);

-- 2. Fill empty columns, retaining authored normalized-only copy, then mirror
-- the served Finnish/English values into missing or blank normalized rows.
WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('row_group_match_legend', 'Kun valitset useita', 'When you select several'),
    ('row_group_match_any_effect', 'Enemmän tuloksia', 'More results'),
    ('row_group_match_all_effect', 'Vähemmän tuloksia', 'Fewer results'),
    ('row_group_match_help_label', 'Selitä valintojen yhdistäminen', 'Explain how selections combine'),
    ('row_group_match_headings_hint', 'Eri otsikoiden valinnat rajaavat hakua aina yhdessä.', 'Selections under different headings always narrow the search together.'),
    ('row_group_match_any', 'Mikä tahansa käy', 'Accept any'),
    ('row_group_match_all', 'Kaikki vaaditaan', 'Require all')
), resolved AS (
    SELECT copy.lang_key,
        COALESCE(CASE WHEN NULLIF(btrim(keys.fi), '') IS NOT NULL THEN keys.fi END,
            CASE WHEN NULLIF(btrim(fi.translation), '') IS NOT NULL THEN fi.translation END, copy.fi) AS fi,
        COALESCE(CASE WHEN NULLIF(btrim(keys.en), '') IS NOT NULL THEN keys.en END,
            CASE WHEN NULLIF(btrim(en.translation), '') IS NOT NULL THEN en.translation END, copy.en) AS en
    FROM authored_keys copy
    LEFT JOIN public.system_lang_keys keys USING (lang_key)
    LEFT JOIN public.system_lang_key_translations fi ON fi.lang_key_id = keys.id AND fi.language_code = 'fi'
    LEFT JOIN public.system_lang_key_translations en ON en.lang_key_id = keys.id AND en.language_code = 'en'
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'Category match selector copy, owner decision K416 (WO26).' FROM resolved
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
    RETURNING id, lang_key, fi, en
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en FROM public.system_lang_keys k JOIN authored_keys USING (lang_key)
    WHERE k.id NOT IN (SELECT id FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s
CROSS JOIN LATERAL (VALUES ('fi', s.fi), ('en', s.en)) AS translated(language_code, translation)
JOIN public.system_languages language ON language.language_code = translated.language_code
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind, review_status = EXCLUDED.review_status
WHERE NULLIF(btrim(existing.translation), '') IS NULL;

-- 3. Give each key translation context; the module catalogue renews code use.
INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT keys.id, 'code', 'frontend/core_components/filterbar/filter_list/row_group_facet_card_builder.js',
    '', copy.usage_explanation, CURRENT_DATE
FROM public.system_lang_keys keys
JOIN (VALUES
    ('row_group_match_legend', 'Legend for combining several selected values under one category heading.'),
    ('row_group_match_any_effect', 'Fixed direction tag beside Accept any; gives at least as many results as Require all.'),
    ('row_group_match_all_effect', 'Fixed direction tag beside Require all; gives at most as many results as Accept any.'),
    ('row_group_match_help_label', 'Accessible name of the button that expands category matching explanations.'),
    ('row_group_match_headings_hint', 'Third help line: selections under different headings always combine together.'),
    ('row_group_match_any', 'Native radio label and help heading: accept any selected value under this heading.'),
    ('row_group_match_all', 'Native radio label and help heading: require every selected value under this heading.')
) copy(lang_key, usage_explanation) USING (lang_key)
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
