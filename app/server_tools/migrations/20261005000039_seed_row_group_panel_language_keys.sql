-- 20261005000039_seed_row_group_panel_language_keys.sql
-- Seeds Finnish and English category-panel guidance and shared selected-tag actions.
-- Connects category disclosures and zero-result recovery to served translations.
-- Preserves reviewed site copy; this migration is source only until an authorized upgrade.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('row_group_categories_hint', 'Saman otsikon valinnat laajentavat hakua, eri otsikoiden valinnat rajaavat sitä.', 'Choices under one heading widen the search; choices under different headings narrow it.'),
        ('row_group_match_any_hint', 'Näytetään rivit, joissa on jokin valituista arvoista.', 'Shows rows that have any of the selected values.'),
        ('row_group_single_value_hint', 'Rivillä on tässä yksi arvo. Voit valita hakuun useita arvoja.', 'A row has one value here. You can select several values to search.'),
        ('row_group_selected_count', 'valittu', 'selected'),
        ('row_group_no_name_matches', 'Ei osumia.', 'No matches.'),
        ('row_group_selection_limit', 'Voit valita enintään 20 kategoria-arvoa. Poista valinta ennen uuden lisäämistä.', 'You can select up to 20 category values. Remove a selection before adding another.'),
        ('row_group_no_results_hint', 'Valinnoillasi ei löytynyt tuloksia. Poista jokin valinta tai tyhjennä kaikki.', 'No results match your selections. Remove a filter or clear all.'),
        ('selected_filters', 'Valitut:', 'Selected:'),
        ('clear_all', 'Tyhjennä kaikki', 'Clear all')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL103 S1/S2 category panel and selected filters copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
