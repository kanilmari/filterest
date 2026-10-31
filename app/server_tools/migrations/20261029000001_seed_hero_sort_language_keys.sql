-- 20261029000001_seed_hero_sort_language_keys.sql
-- Replaces automatic English key-name defaults with reviewed hero sort labels.
-- Connects existing Finnish/English dictionaries to upgrades and fresh bootstrap.
-- Preserves administrator copy, blanks, whitespace and all other languages.
-- VERSION_DB: 9.13.2
-- VERSION_DB_OWNER: 20261029000099_record_database_release_9_13_2.sql
-- COMPLETION_MARKER: wo50_hero_sort_language_keys

-- The reviewed 9.11.1 seed already has this wording. Older installations may
-- retain automatically humanized key names in either store, including Finnish.
-- Match those exact defaults only; never strip a prefix from site-authored text.
WITH copy(lang_key, old_default, fi, en) AS (VALUES
    ('sort_newest', 'Sort newest', 'Uusimmat ensin', 'Newest first'),
    ('sort_oldest', 'Sort oldest', 'Vanhimmat ensin', 'Oldest first'),
    ('sort_updated_newest', 'Sort updated newest', 'Viimeksi päivitetyt ensin', 'Recently updated first'),
    ('sort_updated_oldest', 'Sort updated oldest', 'Vanhimmin päivitetyt ensin', 'Least recently updated first'),
    ('sort_images_first', 'Sort images first', 'Kuvalliset ensin', 'Rows with images first')
), renamed AS (
    UPDATE public.system_lang_keys keys
    SET fi = CASE WHEN keys.fi COLLATE "C" = copy.old_default COLLATE "C" THEN copy.fi ELSE keys.fi END,
        en = CASE WHEN keys.en COLLATE "C" = copy.old_default COLLATE "C" THEN copy.en ELSE keys.en END
    FROM copy
    WHERE keys.lang_key = copy.lang_key
        AND (keys.fi COLLATE "C" = copy.old_default COLLATE "C"
            OR keys.en COLLATE "C" = copy.old_default COLLATE "C")
    RETURNING keys.id
)
UPDATE public.system_lang_key_translations translated
SET translation = changed.value
FROM public.system_lang_keys keys, copy,
    LATERAL (VALUES ('fi', copy.fi), ('en', copy.en)) AS changed(language_code, value)
WHERE translated.lang_key_id = keys.id AND keys.lang_key = copy.lang_key
    AND translated.language_code = changed.language_code
    AND translated.translation COLLATE "C" = copy.old_default COLLATE "C";

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wo50_hero_sort_language_keys', 'completed', '{"file":"20261029000001_seed_hero_sort_language_keys.sql"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wo50_hero_sort_language_keys' AND action = 'completed');
