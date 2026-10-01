-- 20260929000001_seed_connect_two_fields_language_keys.sql
-- Seeds the copy of the links section of the dataset form and the column labels of the foreign-keys page.
-- Bridges the Connect two fields controls of the dataset form and the technical
-- foreign-keys page with the language keys of the installation.
-- Exists because the form showed copy that no language key held, and shared four
-- column labels with the technical page whose rows had Finnish and English only,
-- so a site showed the older technical wording in the form and English to a
-- reader of Chinese or Cantonese. The form now has keys of its own; the technical
-- page keeps the shared keys and their stored wording, and the four link messages
-- 20260919000005 wrote gain Chinese and Cantonese.
-- A nonempty translation is never overwritten. Running the file again changes
-- nothing. The public bootstrap runs this same file, so a new installation
-- receives the same rows.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales.
-- VERSION_DB: 9.9.1
-- VERSION_DB_OWNER: 20260929000003_record_database_release_9_9_1.sql

-- Add the missing keys, fill only empty columns, and mirror the served Finnish
-- and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        -- Dataset form, links to other datasets (dataset_form_translation_fallbacks.js).
        ('connect_two_fields',
         'Yhdistä kaksi kenttää',
         'Connect two fields',
         '连接两个字段',
         '連接兩個欄位',
         'Dataset form, links to other datasets: button that adds a link from a column of this dataset to a column of another dataset.'),
        ('connect_two_fields_explain',
         'Mitä kahden kentän yhdistäminen tarkoittaa?',
         'What does connecting two fields mean?',
         '连接两个字段是什么意思？',
         '連接兩個欄位係咩意思？',
         'Dataset form, links to other datasets: name of the information symbol that opens the explanation, read by keyboard and screen reader users.'),
        ('connect_two_fields_explanation',
         'Tämän aineiston rivi osoittaa toisen aineiston riviin, jolloin toisen rivin tiedot voidaan näyttää tässä ja arvo pysyy kelvollisena. Linkki kulkee tämän aineiston viittaavasta sarakkeesta toisen aineiston viitattavaan sarakkeeseen. Tunnetaan myös nimellä viiteavain.',
         'A row of this dataset points at a row of another dataset, so the other row''s information can be shown here and the value stays valid. The link runs from the referencing column of this dataset to the referenced column of the other one. Also known as a foreign key.',
         '本数据集中的一行指向另一个数据集中的一行，这样就能在这里显示另一行的信息，并且该值始终有效。链接从本数据集的引用列指向另一个数据集的被引用列。也称为外键。',
         '呢個資料集嘅一行會指向另一個資料集嘅一行，噉就可以喺呢度顯示嗰行嘅資料，個值亦會一直有效。連結由呢個資料集嘅引用欄位指向另一個資料集嘅被引用欄位。亦叫做外鍵。',
         'Dataset form, links to other datasets: explanation of what connecting two fields does, naming the referencing and the referenced column and the technical term foreign key.'),
        ('connect_two_fields_referencing_column',
         'Viittaava sarake',
         'Referencing column',
         '引用列',
         '引用欄位',
         'Dataset form, links to other datasets: label of the column of this dataset that points at the other dataset.'),
        ('connect_two_fields_referenced_dataset',
         'Viitattava aineisto',
         'Referenced dataset',
         '被引用的数据集',
         '被引用資料集',
         'Dataset form, links to other datasets: label of the dataset the link points at.'),
        ('connect_two_fields_referenced_column',
         'Viitattava sarake',
         'Referenced column',
         '被引用的列',
         '被引用欄位',
         'Dataset form, links to other datasets: label of the column of the other dataset the link points at.'),
        ('connect_two_fields_choose_column',
         'Valitse sarake',
         'Choose a column',
         '选择列',
         '選擇欄位',
         'Dataset form, links to other datasets: placeholder of a column selector.'),
        -- The link messages 20260919000005 wrote in Finnish and English, with its own description.
        ('dataset_foreign_keys_title',
         'Linkit toisiin aineistoihin',
         'Links to other datasets',
         '与其他数据集的链接',
         '同其他資料集嘅連結',
         'Dataset dimensions: heading of the links to other datasets.'),
        ('dataset_foreign_keys_none',
         'Tällä aineistolla ei ole vielä linkkejä.',
         'This dataset has no links yet.',
         '此数据集还没有链接。',
         '呢個資料集仲未有連結。',
         'Dataset dimensions: the dataset has no links to other datasets yet.'),
        ('dataset_foreign_keys_unavailable',
         'Linkkejä ei voitu lukea.',
         'The links could not be read.',
         '无法读取链接。',
         '讀取唔到連結。',
         'Dataset dimensions: the links to other datasets could not be read.'),
        ('dataset_foreign_key_save_failed',
         'Linkin lisääminen epäonnistui.',
         'The link could not be added.',
         '无法添加链接。',
         '加唔到連結。',
         'Dataset dimensions: adding a link to another dataset failed.'),
        -- Foreign-keys admin page (foreign_keys_translation_fallbacks.js), in the wording sites already store.
        ('referencing_column',
         'Viittaava sarake',
         'Referencing column',
         '引用列',
         '引用欄位',
         'Foreign-keys admin: label of the column that holds the reference.'),
        ('referenced_table',
         'Viitattu taulu',
         'Referenced table',
         '被引用的表',
         '被引用表',
         'Foreign-keys admin: label of the table the reference points at.'),
        ('referenced_column',
         'Viitattu sarake',
         'Referenced column',
         '被引用的列',
         '被引用欄位',
         'Foreign-keys admin: label of the column the reference points at.'),
        ('select_column',
         'Valitse sarake',
         'Select column',
         '选择列',
         '選擇欄位',
         'Foreign-keys admin and notification rules: placeholder of a column selector.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
