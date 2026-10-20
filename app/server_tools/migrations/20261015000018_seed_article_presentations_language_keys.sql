-- 20261015000018_seed_article_presentations_language_keys.sql
-- Seeds the combined editor and recovery outcomes without overwriting site copy.
-- Connects upgrades and bootstrap to the article-family adapter language keys.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
WITH copy(lang_key, fi, en, ch, tw, yue) AS (VALUES
    ('article_presentations_title', 'Artikkelin esitystavat', 'Article presentations', '文章展示方式', '文章展示方式', '文章展示方式'),
    ('article_presentations_article', 'Artikkeli', 'Article', '文章', '文章', '文章'),
    ('article_presentations_image', 'Kuvapainotteinen artikkeli (IFAV)', 'Image-first article (IFAV)', '图片优先文章 (IFAV)', '圖片優先文章 (IFAV)', '圖片優先文章 (IFAV)'),
    ('article_presentations_page', 'Sivukokoinen kuvapainotteinen artikkeli', 'Page-sized image-first article', '页面大小的图片优先文章', '頁面大小嘅圖片優先文章', '頁面大小嘅圖片優先文章'),
    ('article_presentations_select_all', 'Valitse kaikki', 'Select all', '全选', '全選', '全選'),
    ('article_presentations_visible', 'Näkyvissä', 'Visible', '可见', '顯示', '顯示'),
    ('article_presentations_open', 'Auki aluksi', 'Open at start', '初始展开', '初始展開', '初始展開'),
    ('article_presentations_fields', 'Kentät', 'Fields', '字段', '欄位', '欄位'),
    ('article_presentations_blocks', 'Avauslohkot', 'Opening blocks', '开篇区块', '開篇區塊', '開篇區塊'),
    ('article_presentations_identity', 'Kentän nimi ja UID', 'Field name and UID', '字段名称和 UID', '欄位名稱同 UID', '欄位名稱同 UID'),
    ('article_presentations_dash', '—', '—', '—', '—', '—'),
    ('article_presentations_unsupported', 'Ei tuettu tässä esitystavassa', 'Not supported in this presentation', '此展示方式不支持', '呢個展示方式唔支援', '呢個展示方式唔支援'),
    ('article_presentations_read_only', 'Aineiston yhteiset avauslohkot. Vain luku ryhmä- ja henkilökohtaisissa asetuksissa.', 'Dataset-wide opening blocks. Read-only in group and personal settings.', '数据集共用的开篇区块。在组和个人设置中只读。', '資料集共用嘅開篇區塊。喺群組同個人設定中唯讀。', '資料集共用嘅開篇區塊。喺群組同個人設定中唯讀。'),
    ('article_presentations_mixed', 'Valituilla kohteilla on eri arvot. Viiva säilyttää nykyiset arvot.', 'Selected targets have different values. A dash preserves each current value.', '所选目标的值不同。横线保留每个当前值。', '所選目標嘅值唔同。橫線會保留每個而家嘅值。', '所選目標嘅值唔同。橫線會保留每個而家嘅值。'),
    ('article_presentations_orders', 'Kohteilla on eri järjestykset. Vain kentän siirtäminen ottaa käyttöön yhteisen järjestyksen.', 'Targets have different orders. Only an explicit move adopts one shared order.', '目标顺序不同。只有明确移动才会采用统一顺序。', '目標嘅次序唔同。只有明確移動先會採用統一次序。', '目標嘅次序唔同。只有明確移動先會採用統一次序。'),
    ('article_presentations_unchanged', 'Ei muutosta', 'Unchanged', '不变', '唔更改', '唔更改'),
    ('article_presentations_position', '{name}: sijainti {position}/{count}', '{name}: position {position} of {count}', '{name}：第 {position} 项，共 {count} 项', '{name}：第 {position} 項，共 {count} 項', '{name}：第 {position} 項，共 {count} 項'),
    ('article_presentations_cell', '{group}, {name}, {presentation}, {target}: {meaning}', '{group}, {name}, {presentation}, {target}: {meaning}', '{group}，{name}，{presentation}，{target}：{meaning}', '{group}，{name}，{presentation}，{target}：{meaning}', '{group}，{name}，{presentation}，{target}：{meaning}'),
    ('article_presentations_up', 'Siirrä ylös', 'Move up', '上移', '上移', '上移'),
    ('article_presentations_down', 'Siirrä alas', 'Move down', '下移', '下移', '下移'),
    ('article_presentations_filtered', 'Tyhjennä haku ennen siirtämistä', 'Clear the search before moving fields', '移动字段前请清除搜索', '移動欄位前請清除搜尋', '移動欄位前請清除搜尋'),
    ('article_presentations_save', 'Tallenna', 'Save', '保存', '儲存', '儲存'),
    ('article_presentations_cancel', 'Peruuta', 'Cancel', '取消', '取消', '取消'),
    ('article_presentations_defaults', 'Palauta oletukset', 'Restore defaults', '恢复默认值', '還原預設值', '還原預設值'),
    ('article_presentations_saved', 'Artikkelin esitystavat tallennettu ja varmistettu.', 'Article presentations saved and verified.', '文章展示方式已保存并验证。', '文章展示方式已儲存並驗證。', '文章展示方式已儲存並驗證。'),
    ('article_presentations_failed', 'Tallennus epäonnistui. Luonnos säilytettiin.', 'Save failed. The draft was kept.', '保存失败。草稿已保留。', '儲存失敗。草稿已保留。', '儲存失敗。草稿已保留。'),
    ('article_presentations_verification', 'Tallennuksen tulosta ei voitu varmistaa. Luonnos säilytettiin. Lataa nykyinen tila uudelleen ennen uutta tallennusta.', 'The save result could not be verified. The draft was kept. Reload the current state before saving again.', '无法验证保存结果。草稿已保留。请重新加载当前状态后再保存。', '未能驗證儲存結果。草稿已保留。請重新載入而家嘅狀態再儲存。', '未能驗證儲存結果。草稿已保留。請重新載入而家嘅狀態再儲存。'),
    ('article_presentations_conflict', 'Asetukset ovat muuttuneet. Luonnosta ei toistettu. Lataa nykyinen tila uudelleen ja tarkista muutokset.', 'Settings changed. The draft was not replayed. Reload the current state and review the changes.', '设置已更改。未重放草稿。请重新加载当前状态并检查更改。', '設定已更改。草稿冇重播。請重新載入而家嘅狀態並檢查更改。', '設定已更改。草稿冇重播。請重新載入而家嘅狀態並檢查更改。'),
    ('article_presentations_recovered', 'Luonnos palautettu. Tarkista muutokset ennen tallentamista.', 'Draft recovered. Review the changes before saving.', '草稿已恢复。保存前请检查更改。', '草稿已還原。儲存前請檢查更改。', '草稿已還原。儲存前請檢查更改。'),
    ('article_presentations_recovery', 'Luonnosta ei voitu palauttaa tähän kohteeseen. Peruuta hylätäksesi luonnoksen.', 'The draft could not be recovered for this target. Cancel to discard it.', '无法为此目标恢复草稿。取消以丢弃草稿。', '未能為呢個目標還原草稿。取消以捨棄草稿。', '未能為呢個目標還原草稿。取消以捨棄草稿。'),
    ('article_presentations_loading', 'Ladataan artikkelin esitystapoja…', 'Loading article presentations…', '正在加载文章展示方式…', '載入緊文章展示方式…', '載入緊文章展示方式…'),
    ('article_presentations_details', 'Tiedot', 'Details', '详情', '詳情', '詳情'),
    ('article_presentations_images', 'Kuvat', 'Images', '图片', '圖片', '圖片'),
    ('article_presentations_attachments', 'Liitteet', 'Attachments', '附件', '附件', '附件'),
    ('article_presentations_related_rows', 'Liittyvät kohteet', 'Related items', '相关项目', '相關項目', '相關項目'),
    ('article_presentations_task_progress', 'Tehtävän eteneminen', 'Task progress', '任务进度', '工作進度', '工作進度'),
    ('article_presentations_target_site', 'Sivusto', 'Site', '站点', '網站', '網站'),
    ('article_presentations_target_group', 'Ryhmä', 'Group', '用户组', '用戶群組', '用戶群組'),
    ('article_presentations_target_personal', 'Henkilökohtainen', 'Personal', '个人', '個人', '個人')
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, 'Article presentations editor, K383.' FROM copy
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL OR NULLIF(btrim(existing.yue), '') IS NULL
    RETURNING id, lang_key, fi, en, ch, yue
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en, k.ch, k.yue FROM public.system_lang_keys k JOIN copy USING (lang_key)
    WHERE k.id NOT IN (SELECT id FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s JOIN copy USING (lang_key)
CROSS JOIN LATERAL (VALUES
    ('fi', s.fi), ('en', s.en), ('ch', s.ch), ('yue', s.yue),
    ('zh', s.ch), ('zh-CN', s.ch), ('zh-TW', copy.tw), ('zh-HK', s.yue)
) AS translated(language_code, translation)
JOIN public.system_languages language ON language.language_code = translated.language_code
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind, review_status = EXCLUDED.review_status
WHERE NULLIF(btrim(existing.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'frontend/core_components/admin_tools/article_presentations_copy.js',
    '', 'Article presentations editor, K383.', CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('article_presentations_title', 'article_presentations_article', 'article_presentations_image', 'article_presentations_page', 'article_presentations_select_all', 'article_presentations_visible', 'article_presentations_open', 'article_presentations_fields', 'article_presentations_blocks', 'article_presentations_identity', 'article_presentations_dash', 'article_presentations_unsupported', 'article_presentations_read_only', 'article_presentations_mixed', 'article_presentations_orders', 'article_presentations_unchanged', 'article_presentations_position', 'article_presentations_cell', 'article_presentations_up', 'article_presentations_down', 'article_presentations_filtered', 'article_presentations_save', 'article_presentations_cancel', 'article_presentations_defaults', 'article_presentations_saved', 'article_presentations_failed', 'article_presentations_verification', 'article_presentations_conflict', 'article_presentations_recovered', 'article_presentations_recovery', 'article_presentations_loading', 'article_presentations_details', 'article_presentations_images', 'article_presentations_attachments', 'article_presentations_related_rows', 'article_presentations_task_progress', 'article_presentations_target_site', 'article_presentations_target_group', 'article_presentations_target_personal')
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
