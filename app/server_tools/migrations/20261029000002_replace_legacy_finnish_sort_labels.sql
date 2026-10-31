-- 20261029000002_replace_legacy_finnish_sort_labels.sql
-- Replaces four imported legacy Finnish sort labels with the reviewed hero sort wording.
-- Connects long-lived installations' Finnish dictionaries with the WO50 labels in both stores.
-- Exact matches only: site-authored Finnish, English and all other languages stay unchanged.
-- VERSION_DB: 9.13.2
-- VERSION_DB_OWNER: 20261029000099_record_database_release_9_13_2.sql
-- COMPLETION_MARKER: wo50_legacy_finnish_sort_labels

-- These exact texts are old imported product labels ("Lajittele ..." = "Sort ..."), never administrator copy;
-- fresh installations already ship the reviewed wording. Any other Finnish value is left alone.
WITH copy(lang_key, legacy_fi, fi) AS (VALUES
    ('sort_newest', 'Lajittele uusimmat', 'Uusimmat ensin'),
    ('sort_oldest', 'Lajittele vanhimmat', 'Vanhimmat ensin'),
    ('sort_updated_newest', 'Lajittele päivitetyt uusimmat', 'Viimeksi päivitetyt ensin'),
    ('sort_updated_oldest', 'Lajittele päivitetyt vanhimmat', 'Vanhimmin päivitetyt ensin')
), renamed AS (
    UPDATE public.system_lang_keys keys
    SET fi = copy.fi
    FROM copy
    WHERE keys.lang_key = copy.lang_key
        AND keys.fi COLLATE "C" = copy.legacy_fi COLLATE "C"
    RETURNING keys.id
)
UPDATE public.system_lang_key_translations translated
SET translation = copy.fi
FROM public.system_lang_keys keys, copy
WHERE translated.lang_key_id = keys.id AND keys.lang_key = copy.lang_key
    AND translated.language_code = 'fi'
    AND translated.translation COLLATE "C" = copy.legacy_fi COLLATE "C";

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wo50_legacy_finnish_sort_labels', 'completed', '{"file":"20261029000002_replace_legacy_finnish_sort_labels.sql"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wo50_legacy_finnish_sort_labels' AND action = 'completed');
