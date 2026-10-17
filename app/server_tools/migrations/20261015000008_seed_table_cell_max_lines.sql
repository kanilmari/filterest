-- 20261015000008_seed_table_cell_max_lines.sql
-- Seeds the owner-approved three-line table-cell default and administrator copy.
-- Connects fresh installs and upgrades to one site-wide integer setting.
-- Preserves existing configured values and authored copy in both language stores.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql

-- Previously the CSS used 15; existing sites now start at the approved default 3.
INSERT INTO public.system_config (key, int_value, value_type, creation_spec)
SELECT 'table_cell_max_lines', 3, 1, 'Site-wide table cell line limit (1–30); longer cells scroll internally.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'table_cell_max_lines');

WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('table_view_settings', 'Taulukkonäkymän asetukset', 'Table view settings'),
    ('table_cell_max_lines_label', 'Taulukon solun rivimäärä', 'Table cell line limit'),
    ('table_cell_max_lines_help', 'Pidemmät solut vierivät solun sisällä.', 'Longer cells scroll inside the cell.'),
    ('table_cell_max_lines_invalid', 'Anna kokonaisluku väliltä 1–30.', 'Enter a whole number from 1 to 30.')
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
    SELECT lang_key, fi, en, 'Site-wide table cell line limit, owner-approved WO30.' FROM resolved
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

-- Keep context visible to startup language-key scanning.
INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', CASE WHEN lang_key = 'table_cell_max_lines_invalid'
    THEN 'backend/core_components/system_config_checks/system_config_checks.go'
    ELSE 'frontend/core_components/admin_tools/table_view_settings_view.js' END,
    '', 'Site-wide table view settings and integer range validation.', CURRENT_DATE
FROM public.system_lang_keys WHERE lang_key IN
    ('table_view_settings', 'table_cell_max_lines_label', 'table_cell_max_lines_help', 'table_cell_max_lines_invalid')
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
