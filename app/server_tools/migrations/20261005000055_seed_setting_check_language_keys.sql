-- 20261005000055_seed_setting_check_language_keys.sql
-- Seeds Finnish and English setting refusals and seven duration unit names.
-- Connects shared settings checks and the duration input to translated copy.
-- Exists to explain refused saves without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('error_setting_duration_invalid', 'Anna asetukselle sallittu aikayksikkö ja sen rajojen sisällä oleva kokonaisluku.', 'Enter an allowed time unit and a whole number within its limits.'),
        ('duration_unit_seconds', 'sekuntia', 'seconds'),
        ('duration_unit_minutes', 'minuuttia', 'minutes'),
        ('duration_unit_hours', 'tuntia', 'hours'),
        ('duration_unit_days', 'päivää', 'days'),
        ('duration_unit_weeks', 'viikkoa', 'weeks'),
        ('duration_unit_months', 'kuukautta', 'months'),
        ('duration_unit_years', 'vuotta', 'years')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL119 setting validation and duration input copy.' FROM authored_keys
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
