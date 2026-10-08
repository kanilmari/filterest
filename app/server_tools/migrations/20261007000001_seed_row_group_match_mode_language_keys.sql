-- 20261007000001_seed_row_group_match_mode_language_keys.sql
-- Seeds category match controls and guidance for readable zero-hit vocabulary.
-- Connects ANY/ALL filtering and typed API refusals to Finnish/English translations.
-- Preserves reviewed copy; the new general hint has its own key for the changed meaning.
-- VERSION_DB: 9.10.1
-- VERSION_DB_OWNER: 20261007000099_record_database_release_9_10_1.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('row_group_match_mode', 'Hakutapa', 'Match mode'),
        ('row_group_match_any', 'Vähintään yksi', 'At least one'),
        ('row_group_match_all', 'Kaikki valitut', 'All selected'),
        ('row_group_match_all_hint', 'Näytetään rivit, joissa on kaikki valitut arvot. Luvut kertovat osumat, kun arvo lisätään valintoihin.', 'Shows rows that have all selected values. Counts show matches when the value is added to the selection.'),
        ('row_group_categories_modes_hint', 'Valitse otsikosta vähintään yksi tai kaikki valitut arvot. Eri otsikoiden valinnat rajaavat hakua yhdessä. Harmaalla näkyvät arvot voi valita, vaikka osumia ei nyt ole.', 'Match at least one or all selected values under a heading. Selections under different headings narrow the search together. Dimmed values remain selectable when they have no current matches.'),
        ('row_group_invalid_filters', 'Kategoriavalinnat eivät kelpaa.', 'Invalid category filters')
), inserted_keys AS (
    INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
    SELECT authored.lang_key, authored.fi, authored.en, 'WL103 slice 3a.1 category match controls and scoped zero-hit guidance.'
    FROM authored_keys AS authored
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys AS existing WHERE existing.lang_key = authored.lang_key)
    RETURNING id, lang_key, fi, en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM inserted_keys
    UNION ALL
    SELECT existing.id, existing.lang_key, existing.fi, existing.en FROM public.system_lang_keys AS existing
    JOIN authored_keys USING (lang_key)
), inserted_translations AS (
    INSERT INTO public.system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
    SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
    FROM served_keys AS served
    CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
    JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
    WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.system_lang_key_translations AS existing
          WHERE existing.lang_key_id = served.id AND existing.language_code = copy.language_code)
    RETURNING lang_key_id
)
SELECT count(*) FROM inserted_translations;
