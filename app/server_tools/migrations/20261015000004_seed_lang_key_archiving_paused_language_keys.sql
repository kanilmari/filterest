-- 20261015000004_seed_lang_key_archiving_paused_language_keys.sql
-- Seeds Finnish/English copy for report-only language-key orphan maintenance.
-- Connects upgrades and the public bootstrap to the same translated pause notice.
-- Preserves nonblank site copy and leaves all other languages untouched (K175).
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql

WITH copy(lang_key, fi, en) AS (VALUES
    ('consistency_orphan_archiving_paused', 'Orpo kieliavain. Arkistointi on keskeytetty; avain on vain raportoitavana.', 'Orphan language key. Archiving is paused; this key is report-only.'),
    ('consistency_synthetic_key_archiving_paused', 'Synteettinen testiavain. Arkistointi on keskeytetty; avain on vain raportoitavana.', 'Synthetic test language key. Archiving is paused; this key is report-only.'),
    ('consistency_orphan_age_days', 'Orpona $count päivää.', 'Orphan for $count day(s).'),
    ('consistency_lang_key_counting_source', 'Avaimella on käytöksi laskettava lähde, joten se säilytetään.', 'This key has a counting source and is kept.')
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'Language-key archiving pause, owner decision K423 (WO-J35 B1).' FROM copy
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
    RETURNING id, lang_key, fi, en
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en FROM public.system_lang_keys k JOIN copy USING (lang_key)
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

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'backend/core_components/system_table_tools/lang_key_consistency_checks.go',
    '', 'Language-key archiving pause, owner decision K423 (WO-J35 B1).', CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('consistency_orphan_archiving_paused', 'consistency_synthetic_key_archiving_paused',
    'consistency_orphan_age_days', 'consistency_lang_key_counting_source')
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
