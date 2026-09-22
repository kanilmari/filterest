-- 20260922000007_seed_embedding_refresh_and_dataset_header_language_keys.sql
-- Seeds the copy of the embedding refresh controls and of the dataset header settings.
-- Bridges the embedding administration page and the dataset header settings screen
-- with the language keys of the installation.
-- Exists because both screens showed hardcoded English or keys without Chinese
-- and Cantonese; the copy came after 20260922000005 was applied to the development
-- database, so it is seeded here. Shared keys these screens reuse gain the copy a
-- new installation already has, and wording generated from the name of a key or
-- left untranslated in a column gives way to it.
-- A nonempty translation is never overwritten; only the exact superseded wording
-- listed in step 1 gives way. Running the file again changes nothing. The public
-- bootstrap runs this same file, so a new installation receives the same rows.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales. $count is filled by the
-- page and stays literal.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- 1. Wording that is withdrawn where a site still holds exactly it: copy an
--    earlier seed wrote before it was rewritten, and wording generated from
--    the name of a key. It then counts as missing copy and is filled in step 2
--    like any empty value. Any other text, a reviewed translation included,
--    stays as it is. NULL matches nothing.
WITH superseded_copy(lang_key, fi, en, ch, yue) AS (
    VALUES
        -- Generated from the name of the key and its machine translation, never reviewed.
        ('dataset_header_config', 'Tietojoukon otsikon konfiguraatio', 'Dataset header config', NULL, NULL),
        -- Generated from the name of the key into the Finnish column.
        ('usage_explanation', 'Usage explanation', NULL, NULL, NULL),
        -- English left in the Chinese column.
        ('search', NULL, NULL, 'Search', NULL)
), withdrawn_translations AS (
    DELETE FROM public.system_lang_key_translations AS stored
    USING public.system_lang_keys AS keys, superseded_copy AS superseded
    WHERE keys.id = stored.lang_key_id
      AND keys.lang_key = superseded.lang_key
      AND ((stored.language_code = 'fi' AND stored.translation = superseded.fi)
        OR (stored.language_code = 'en' AND stored.translation = superseded.en))
    RETURNING stored.lang_key_id
)
UPDATE public.system_lang_keys AS keys
SET fi = CASE WHEN keys.fi = superseded.fi THEN NULL ELSE keys.fi END,
    en = CASE WHEN keys.en = superseded.en THEN NULL ELSE keys.en END,
    ch = CASE WHEN keys.ch = superseded.ch THEN NULL ELSE keys.ch END,
    yue = CASE WHEN keys.yue = superseded.yue THEN NULL ELSE keys.yue END,
    updated = now()
FROM superseded_copy AS superseded
WHERE keys.lang_key = superseded.lang_key
  AND (keys.fi = superseded.fi OR keys.en = superseded.en
    OR keys.ch = superseded.ch OR keys.yue = superseded.yue);

-- 2. Add the missing keys, fill only empty columns, and mirror the served
--    Finnish and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        -- Embedding administration: refresh controls (embedding_status_translation_fallbacks.js).
        ('embedding_refresh_rows_to_process',
         'Käsiteltäviä rivejä: $count',
         'Rows to process: $count',
         '待处理行数：$count',
         '待處理行數：$count',
         'Embedding administration, refresh controls: number of rows the refresh will process. $count is that number.'),
        ('embedding_refresh_loading',
         'Ladataan…',
         'Loading…',
         '正在加载…',
         '載入緊…',
         'Embedding administration, refresh controls: status while the refresh settings are read.'),
        ('embedding_refresh_field_policy_unavailable',
         'Kenttävalintaa ei voitu lukea',
         'The field selection could not be read',
         '无法读取字段选择',
         '讀取唔到欄位選擇',
         'Embedding administration, refresh controls: message when the field selection of a dataset could not be read.'),
        ('embedding_refresh_no_eligible_fields',
         'Ei sopivia tekstikenttiä',
         'No eligible text fields',
         '没有符合条件的文本字段',
         '冇合資格嘅文字欄位',
         'Embedding administration, refresh controls: message when a dataset has no text field that may be embedded.'),
        ('embedding_refresh_start',
         'Aloita upotus',
         'Start embedding',
         '开始嵌入',
         '開始嵌入',
         'Embedding administration, refresh controls: button that starts embedding.'),
        ('embedding_refresh_done',
         'Upotukset päivitetty',
         'Embeddings refreshed',
         '嵌入已刷新',
         '嵌入已更新',
         'Embedding administration, refresh controls: notice after the embeddings were refreshed.'),
        -- Dataset header settings screen (dataset_header_config_translation_fallbacks.js). Shared keys keep the fresh-install copy.
        ('dataset_header_config_intro',
         'Muokkaa tässä aineiston omia tekstejä: otsikkoa, iskulausetta ja hakukentän vihjetekstiä.',
         'Edit the dataset''s own texts here: its title, slogan and search placeholder.',
         '在此编辑数据集自己的文本：标题、标语和搜索占位文本。',
         '喺度編輯資料集自己嘅文字：標題、標語同搜尋預留位置文字。',
         'Dataset header settings: introduction of the screen.'),
        ('dataset_header_config_text_keys',
         'Aineiston tekstit',
         'Dataset texts',
         '数据集文本',
         '資料集文字',
         'Dataset header settings: heading of the dataset texts section.'),
        ('dataset_header_config_text_keys_hint',
         'Jokaisella tekstillä on valmis kieliavain, joka näkyy alla. Tallenna tänne käännökset ja tekoälylle tarkoitettu käyttöselite; aineistonäkymä käyttää näitä avaimia.',
         'Each text has a ready-made language key, shown below. Save its translations and the usage explanation for AI translation here; the dataset view keeps using these keys.',
         '每段文本都有现成的语言键，显示在下方。请在此保存其翻译以及供 AI 翻译使用的使用说明；数据集视图会继续使用这些键。',
         '每段文字都有現成嘅語言鍵，顯示喺下面。請喺度儲存佢嘅翻譯同埋畀 AI 翻譯用嘅使用說明；資料集檢視會繼續用呢啲鍵。',
         'Dataset header settings: explanation of the language keys of the dataset texts.'),
        ('dataset_header_config_slogan',
         'Iskulause',
         'Slogan',
         '标语',
         '標語',
         'Dataset header settings: label of the dataset slogan.'),
        ('dataset_header_config_usage_placeholder',
         'Kerro, mitä avain tarkoittaa ja missä sitä käytetään, jotta tekoäly osaa kääntää sen.',
         'Explain what this key means and where it is used, so AI translation gets it right.',
         '说明此键的含义和用途，以便 AI 正确翻译。',
         '講解呢個鍵嘅意思同用途，等 AI 翻譯得準確。',
         'Dataset header settings: placeholder of the usage explanation field for AI translation.'),
        ('dataset_header_config_cover_title',
         'Aineiston kansikuva',
         'Dataset cover image',
         '数据集封面图片',
         '資料集封面圖片',
         'Dataset header settings: heading of the dataset cover image section.'),
        ('dataset_header_config_cover_hint',
         'Näkyy aineiston otsikkoalueen taustalla. Kuva kuuluu vain valitulle aineistolle.',
         'Shown behind the dataset hero. The image belongs only to the selected dataset.',
         '显示在数据集标题区域的背景中。图片只属于所选数据集。',
         '顯示喺資料集標題區嘅背景。圖片只屬於所選資料集。',
         'Dataset header settings: explanation of the dataset cover image.'),
        ('dataset_header_config_background_title',
         'Aineiston sisällön tausta',
         'Dataset content background',
         '数据集内容背景',
         '資料集內容背景',
         'Dataset header settings: heading of the dataset content background section.'),
        ('dataset_header_config_background_hint',
         'Näkyy hienovaraisesti tulosmäärän ja aineiston sisällön takana, kansikuvasta riippumatta.',
         'Shown subtly behind the result count and dataset content, independently of the hero cover.',
         '淡淡地显示在结果数量和数据集内容后面，与封面图片无关。',
         '淡淡咁顯示喺結果數目同資料集內容後面，同封面圖片無關。',
         'Dataset header settings: explanation of the dataset content background.'),
        ('dataset_header_config_replace_image',
         'Vaihda kuva',
         'Replace image',
         '更换图片',
         '更換圖片',
         'Dataset header settings: button that replaces an image.'),
        ('dataset_header_config_remove_image',
         'Poista nykyinen kuva tallennettaessa',
         'Remove current image on save',
         '保存时删除当前图片',
         '儲存時刪除目前圖片',
         'Dataset header settings: option that removes the current image on save.'),
        ('dataset_header_config_no_image',
         'Kuvaa ei ole vielä ladattu.',
         'No image uploaded yet.',
         '尚未上传图片。',
         '仲未上載圖片。',
         'Dataset header settings: text when no image has been uploaded.'),
        ('dataset_header_config_no_datasets',
         'Asetettavia aineistoja ei ole.',
         'No datasets available for header configuration.',
         '没有可配置标题的数据集。',
         '冇可以設定標題嘅資料集。',
         'Dataset header settings: text when no dataset can be configured.'),
        ('dataset_header_config_not_loaded',
         'Tämän aineiston asetuksia ei saatu ladattua, joten tallennus on estetty, ettei toisen aineiston tekstejä tallennu sen päälle. Valitse aineisto uudelleen yrittääksesi uudestaan.',
         'This dataset''s settings did not load, so saving is off to keep another dataset''s texts from overwriting them. Choose the dataset again to retry.',
         '此数据集的设置未能加载，因此已停用保存，以免其他数据集的文本覆盖它们。请重新选择该数据集以重试。',
         '呢個資料集嘅設定載入唔到，所以已停用儲存，免得其他資料集嘅文字覆蓋佢哋。請重新揀選呢個資料集再試。',
         'Dataset header settings: warning that saving is off because the settings of the dataset did not load.'),
        ('dataset_header_config',
         'Tietojoukko-otsikoiden asetukset',
         'Dataset header configuration',
         '数据集标题配置',
         '資料集標題設定',
         'Admin tools: name of the dataset header settings screen.'),
        ('close',
         'Sulje',
         'Close',
         '关闭',
         '關閉',
         'Shared: button that closes a panel or dialog.'),
        ('saved',
         'Tallennettu',
         'Saved',
         '已保存',
         '已儲存',
         'Shared: status after changes were saved.'),
        ('unsaved_changes',
         'Tallentamattomat muutokset',
         'Unsaved changes',
         '未保存的更改',
         '未儲存嘅變更',
         'Shared: status when there are changes not yet saved.'),
        ('dataset',
         'Aineisto',
         'Dataset',
         '数据集',
         '資料集',
         'Shared: the word dataset, as a label.'),
        ('lang_key',
         'Avain',
         'Key',
         '语言键',
         '語言鍵',
         'Shared: label of a language key.'),
        ('title',
         'Otsikko',
         'Title',
         '标题',
         '標題',
         'Shared: label of a title.'),
        ('search_placeholder',
         'Hakupaikkamerkki',
         'Search placeholder',
         '搜索占位文本',
         '搜尋預留位置文字',
         'Shared: label of the placeholder text of a search field.'),
        ('usage_explanation',
         'Käyttöselite',
         'Usage explanation',
         '使用说明',
         '使用說明',
         'Shared: label of the usage explanation of a language key, used as context for AI translation.'),
        ('search',
         'Haku',
         'Search',
         '搜索',
         '搜尋',
         'Shared: label or button for search.'),
        ('fi',
         'Suomi',
         'Finnish',
         '芬兰语',
         '芬蘭文',
         'Language name: Finnish.'),
        ('en',
         'Englanti',
         'English',
         '英语',
         '英文',
         'Language name: English.'),
        ('ch',
         'Kiina',
         'Chinese',
         '简体中文',
         '簡體中文',
         'Language name: Chinese.')
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
