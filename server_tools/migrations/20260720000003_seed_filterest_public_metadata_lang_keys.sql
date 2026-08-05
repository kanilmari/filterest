-- 20260720000003_seed_filterest_public_metadata_lang_keys.sql
-- Seeds deterministic four-language labels for Filterest runtime metadata.
-- Bridges public dataset metadata and filter/page labels without repeated AI calls.
-- VERSION_DB: 8.0.54

DO $$
DECLARE
    v_instance_kind TEXT;
BEGIN
    SELECT text_value
    INTO v_instance_kind
    FROM public.system_config
    WHERE key = 'instance_kind'
    ORDER BY id
    LIMIT 1;

    IF v_instance_kind NOT IN ('filterest_sibling', 'filterest_domain') THEN
        RETURN;
    END IF;

    MERGE INTO public.system_lang_keys AS target
    USING (VALUES
('id', 'Tunniste', 'ID', 'ID', 'ID', 'public fixture metadata seed'),
  ('created', 'Luotu', 'Created', '创建时间', '建立時間', 'public fixture metadata seed'),
  ('updated', 'Päivitetty', 'Updated', '更新时间', '更新時間', 'public fixture metadata seed'),
  ('admin_access_allowed', 'Kelpaa ylläpitäjäksi', 'Admin eligible', '可担任管理员', '可擔任管理員', 'public fixture metadata seed'),
  ('admin_approved', 'Hyväksytty', 'Approved', '已批准', '已批准', 'public fixture metadata seed'),
  ('admin_user_id', 'Järjestelmänvalvojan käyttäjätunnus', 'Admin user ID', '管理员用户 ID', '管理員用戶 ID', 'public fixture metadata seed'),
  ('amount_cents', 'Summa (sentteinä)', 'Amount (cents)', '金额（分）', '金額（仙）', 'public fixture metadata seed'),
  ('applied_at', 'Käytetty', 'Applied at', '应用时间', '套用時間', 'public fixture metadata seed'),
  ('app_name', 'Sovelluksen nimi', 'App name', '应用名称', '應用程式名稱', 'public fixture metadata seed'),
  ('archived_at', 'Arkistoitu', 'Archived at', '归档时间', '封存時間', 'public fixture metadata seed'),
  ('auth_name', 'Auktoriteetin nimi', 'Authority name', '授权机构名称', '授權機構名稱', 'public fixture metadata seed'),
  ('auth_srid', 'Auktoriteetin SRID', 'Authority SRID', '授权机构 SRID', '授權機構 SRID', 'public fixture metadata seed'),
  ('bio_social_medias', 'Bio', 'Bio', '个人简介', '個人簡介', 'public fixture metadata seed'),
  ('boolean_value', 'Totuusarvo', 'Boolean value', '布尔值', '布林值', 'public fixture metadata seed'),
  ('bridging_col_a', 'Yhdistävä sarake A', 'Bridging column A', '桥接列 A', '橋接欄位 A', 'public fixture metadata seed'),
  ('bridging_col_b', 'Yhdistävä sarake B', 'Bridging column B', '桥接列 B', '橋接欄位 B', 'public fixture metadata seed'),
  ('bridging_table_name', 'Yhdistävän taulun nimi', 'Bridging table name', '桥接表名称', '橋接資料表名稱', 'public fixture metadata seed'),
  ('bridging_table_uid', 'Välitaulun UID', 'Bridging table UID', '桥接表 UID', '橋接資料表 UID', 'public fixture metadata seed'),
  ('cached_name_col_in_src', '@nimen sarake lähteessä', '@name column in source', '源表中的缓存名称列', '來源資料表嘅快取名稱欄位', 'public fixture metadata seed'),
  ('cached_oid', '@OID', 'Cached OID', '缓存 OID', '快取 OID', 'public fixture metadata seed'),
  ('card_detail_capitalization', 'Kortin yksityiskohdan kapitalisointi', 'Card detail capitalization', '卡片详情首字母大写', '卡片詳細資料首字母大寫', 'public fixture metadata seed'),
  ('card_detail_icon_key', 'Kortin yksityiskohdan kuvakeavain', 'Card detail icon key', '卡片详情图标键', '卡片詳細資料圖示鍵', 'public fixture metadata seed'),
  ('card_detail_icon_svg', 'Kortin yksityiskohdan kuvake SVG', 'Card detail icon SVG', '卡片详情图标 SVG', '卡片詳細資料圖示 SVG', 'public fixture metadata seed'),
  ('card_detail_label_mode', 'Kortin yksityiskohdan otsikon tila', 'Card detail label mode', '卡片详情标签模式', '卡片詳細資料標籤模式', 'public fixture metadata seed'),
  ('card_details_layout', 'Kortin tietojen asettelu', 'Card details layout', '卡片详情布局', '卡片詳細資料版面', 'public fixture metadata seed'),
  ('card_element', 'Kortin elementti', 'Card element', '卡片元素', '卡片元素', 'public fixture metadata seed'),
  ('card_style_variant', 'Kortin tyylivariantti', 'Card style variant', '卡片样式变体', '卡片樣式變體', 'public fixture metadata seed'),
  ('ch', 'Kiina', 'Chinese', '简体中文', '簡體中文', 'public fixture metadata seed'),
  ('column_label', 'Sarakkeen otsikko', 'Column label', '列标签', '欄位標籤', 'public fixture metadata seed'),
  ('column_name', 'Sarakkeen nimi', 'Column name', '列名', '欄位名稱', 'public fixture metadata seed'),
  ('column_uid', 'Sarakkeen UID', 'Column UID', '列 UID', '欄位 UID', 'public fixture metadata seed'),
  ('column_width_px', 'Sarakkeen leveys (px)', 'Column width (px)', '列宽（像素）', '欄位寬度（像素）', 'public fixture metadata seed'),
  ('co_number', 'CO-numero', 'CO number', 'CO 编号', 'CO 編號', 'public fixture metadata seed'),
  ('created_at', 'Luotu', 'Created at', '创建时间', '建立時間', 'public fixture metadata seed'),
  ('creation_spec', 'Tiedot luomisesta', 'Creation specification', '创建说明', '建立規格', 'public fixture metadata seed'),
  ('currency', 'Valuutta', 'Currency', '货币', '貨幣', 'public fixture metadata seed'),
  ('customer_email', 'Asiakkaan sähköposti', 'Customer email', '客户电子邮件', '客戶電郵', 'public fixture metadata seed'),
  ('dataset', 'Aineisto', 'Dataset', '数据集', '資料集', 'public fixture metadata seed'),
  ('data_type', 'Datatyyppi', 'Data type', '数据类型', '資料類型', 'public fixture metadata seed'),
  ('default_view_id', 'Näkymän oletustunnus', 'Default view ID', '默认视图 ID', '預設檢視 ID', 'public fixture metadata seed'),
  ('details', 'Tiedot', 'Details', '详细信息', '詳細資料', 'public fixture metadata seed'),
  ('disabled', 'Pois käytöstä', 'Disabled', '已禁用', '已停用', 'public fixture metadata seed'),
  ('display_name', 'Näyttönimi', 'Display name', '显示名称', '顯示名稱', 'public fixture metadata seed'),
  ('duration_ms', 'Kesto (ms)', 'Duration (ms)', '持续时间（毫秒）', '持續時間（毫秒）', 'public fixture metadata seed'),
  ('editable_in_ui', 'Muokattavissa käyttöliittymässä', 'Editable in UI', '可在界面中编辑', '可喺介面編輯', 'public fixture metadata seed'),
  ('en', 'Englanti', 'English', '英语', '英文', 'public fixture metadata seed'),
  ('enabled', 'Käytössä', 'Enabled', '已启用', '已啟用', 'public fixture metadata seed'),
  ('error_message', 'Virheilmoitus', 'Error message', '错误消息', '錯誤訊息', 'public fixture metadata seed'),
  ('external_order_id', 'Ulkoinen tilaus-ID', 'External order ID', '外部订单 ID', '外部訂單 ID', 'public fixture metadata seed'),
  ('fco_number', 'FCO-numero', 'FCO number', 'FCO 编号', 'FCO 編號', 'public fixture metadata seed'),
  ('fi', 'Suomi', 'Finnish', '芬兰语', '芬蘭文', 'public fixture metadata seed'),
  ('filename', 'Tiedostonimi', 'Filename', '文件名', '檔案名稱', 'public fixture metadata seed'),
  ('filterbar_visible_by_default', 'Suodatinpalkki oletuksena näkyvissä', 'Filter bar visible by default', '默认显示筛选栏', '預設顯示篩選列', 'public fixture metadata seed'),
  ('fk_display_column', 'Viiteavaimen näyttösarake', 'FK display column', '外键显示列', '外鍵顯示欄位', 'public fixture metadata seed'),
  ('folder_description', 'Kansion kuvaus', 'Folder description', '文件夹描述', '資料夾描述', 'public fixture metadata seed'),
  ('folder_id', 'Kansion tunnus', 'Folder ID', '文件夹 ID', '資料夾 ID', 'public fixture metadata seed'),
  ('folder_name', 'Kansion nimi', 'Folder name', '文件夹名称', '資料夾名稱', 'public fixture metadata seed'),
  ('full_name', 'Koko nimi', 'Full name', '全名', '全名', 'public fixture metadata seed'),
  ('function_id', 'Toiminnon tunniste', 'Function ID', '功能 ID', '功能 ID', 'public fixture metadata seed'),
  ('group_id', 'Ryhmä ID', 'Group ID', '用户组 ID', '群組 ID', 'public fixture metadata seed'),
  ('handler_name', 'Käsittelijän nimi', 'Handler name', '处理程序名称', '處理程式名稱', 'public fixture metadata seed'),
  ('hidden', 'Piilotettu', 'Hidden', '已隐藏', '已隱藏', 'public fixture metadata seed'),
  ('hide_everywhere', 'Piilota kaikkialla', 'Hide everywhere', '在所有位置隐藏', '喺所有位置隱藏', 'public fixture metadata seed'),
  ('hide_false_null_on_big_crd', 'Piilota epätosi/tyhjä isossa kortissa', 'Hide false/null on big card', '在文章视图中隐藏假值或空值', '喺文章檢視隱藏假值或空值', 'public fixture metadata seed'),
  ('hide_false_null_on_sml_crd', 'Piilota epätosi/tyhjä pienessä kortissa', 'Hide false/null on small card', '在小卡片中隐藏假值或空值', '喺細卡片隱藏假值或空值', 'public fixture metadata seed'),
  ('hide_in_filter_panel', 'Piilota suodatinpaneelissa', 'Hide in filter panel', '在筛选面板中隐藏', '喺篩選面板隱藏', 'public fixture metadata seed'),
  ('hide_on_bg_crd_if_not_own', 'Piilota isossa kortissa, jos ei oma', 'Hide on big card if not own', '非本人记录时在文章视图中隐藏', '唔係自己記錄時喺文章檢視隱藏', 'public fixture metadata seed'),
  ('hide_on_small_card', 'Piilota pienessä kortissa', 'Hide on small card', '在小卡片中隐藏', '喺細卡片隱藏', 'public fixture metadata seed'),
  ('http_method', 'HTTP-menetelmä', 'HTTP method', 'HTTP 方法', 'HTTP 方法', 'public fixture metadata seed'),
  ('icon_key', 'Kuvakkeen avain', 'Icon key', '图标键', '圖示鍵', 'public fixture metadata seed'),
  ('insertable', 'Lisättävä', 'Insertable', '可插入', '可新增', 'public fixture metadata seed'),
  ('insert_expln_langkey', 'Lisää selitys', 'Insert explanation', '插入说明', '新增說明', 'public fixture metadata seed'),
  ('insert_new_source_with_target', 'Lisää uusi lähde kohteella', 'Insert new source with target', '使用目标插入新来源', '使用目標新增來源', 'public fixture metadata seed'),
  ('insert_new_target_with_source', 'Lisää uusi kohde lähteellä', 'Insert new target with source', '使用来源插入新目标', '使用來源新增目標', 'public fixture metadata seed'),
  ('instance_id', 'Instanssin tunniste', 'Instance ID', '实例 ID', '執行個體 ID', 'public fixture metadata seed'),
  ('int_value', 'Kokonaisluku', 'Integer value', '整数值', '整數值', 'public fixture metadata seed'),
  ('ip_address', 'IP-osoite', 'IP address', 'IP 地址', 'IP 位址', 'public fixture metadata seed'),
  ('is_about_table', 'Onko tietoja-taulu', 'Is about table', '是信息表', '係資訊資料表', 'public fixture metadata seed'),
  ('is_current_project', 'On nykyinen projekti', 'Is current project', '是当前项目', '係目前專案', 'public fixture metadata seed'),
  ('is_default', 'On oletus', 'Is default', '是默认值', '係預設值', 'public fixture metadata seed'),
  ('is_hidden', 'On piilotettu', 'Is hidden', '已隐藏', '已隱藏', 'public fixture metadata seed'),
  ('is_main_table', 'Onko päätaulu', 'Is main table', '是主表', '係主要資料表', 'public fixture metadata seed'),
  ('is_multilingual', 'On monikielinen', 'Is multilingual', '支持多语言', '支援多語言', 'public fixture metadata seed'),
  ('is_removable', 'On poistettavissa', 'Is removable', '可删除', '可刪除', 'public fixture metadata seed'),
  ('json_value', 'JSON-arvo', 'JSON value', 'JSON 值', 'JSON 值', 'public fixture metadata seed'),
  ('key', 'Avain', 'Key', '键', '鍵', 'public fixture metadata seed'),
  ('lang_key', 'Avain', 'Key', '语言键', '語言鍵', 'public fixture metadata seed'),
  ('lang_key_id', 'Kieliavaimen tunniste', 'Language key ID', '语言键 ID', '語言鍵 ID', 'public fixture metadata seed'),
  ('lang_key_type', 'Kieliavaintyyppi', 'Language key type', '语言键类型', '語言鍵類型', 'public fixture metadata seed'),
  ('last_seen', 'Viimeksi nähty', 'Last seen', '最后出现时间', '最後出現時間', 'public fixture metadata seed'),
  ('main_group_id', 'Pääryhmän tunniste', 'Main group ID', '主用户组 ID', '主要群組 ID', 'public fixture metadata seed'),
  ('mandatory', 'Pakollinen', 'Mandatory', '必填', '必填', 'public fixture metadata seed'),
  ('messages', 'Viestit', 'Messages', '消息', '訊息', 'public fixture metadata seed'),
  ('metadata', 'Metatiedot', 'Metadata', '元数据', '中繼資料', 'public fixture metadata seed'),
  ('method', 'Menetelmä', 'Method', '方法', '方法', 'public fixture metadata seed'),
  ('multi_lang_embeddings', 'Monikieliset upotteet', 'Multilingual embeddings', '多语言嵌入', '多語言嵌入', 'public fixture metadata seed'),
  ('must_be_true_unless_own', 'Täytyy olla tosi, ellei oma', 'Must be true unless own', '除本人记录外必须为真', '除自己記錄外必須為真', 'public fixture metadata seed'),
  ('name_col_in_tgt', 'Nimisarake kohteessa', 'Name column in target', '目标中的名称列', '目標入面嘅名稱欄位', 'public fixture metadata seed'),
  ('operation_type', 'Toiminnon tyyppi', 'Operation type', '操作类型', '操作類型', 'public fixture metadata seed'),
  ('original_created', 'Alkuperäinen luontiaika', 'Original created', '原始创建时间', '原始建立時間', 'public fixture metadata seed'),
  ('original_id', 'Alkuperäinen ID', 'Original ID', '原始 ID', '原始 ID', 'public fixture metadata seed'),
  ('original_updated', 'Alkuperäinen päivitysaika', 'Original updated', '原始更新时间', '原始更新時間', 'public fixture metadata seed'),
  ('orphan_since', 'Orpo siitä lähtien', 'Orphan since', '成为孤立项的时间', '成為孤立項目嘅時間', 'public fixture metadata seed'),
  ('package', 'Paketti', 'Package', '包', '套件', 'public fixture metadata seed'),
  ('paid_at', 'Maksettu', 'Paid at', '付款时间', '付款時間', 'public fixture metadata seed'),
  ('parent_id', 'Vanhempi-ID', 'Parent ID', '父级 ID', '上層 ID', 'public fixture metadata seed'),
  ('parent_table', 'Päätaulu', 'Parent table', '父表', '上層資料表', 'public fixture metadata seed'),
  ('payment_token', 'Maksutunniste', 'Payment token', '支付令牌', '付款權杖', 'public fixture metadata seed'),
  ('predecessor_id', 'Edeltäjän ID', 'Predecessor ID', '前置项 ID', '前置項目 ID', 'public fixture metadata seed'),
  ('preview', 'Esikatselu', 'Preview', '预览', '預覽', 'public fixture metadata seed'),
  ('privileged', 'Etuoikeutettu', 'Privileged', '特权用户', '特權用戶', 'public fixture metadata seed'),
  ('proj4text', 'PROJ.4-teksti', 'PROJ.4 text', 'PROJ.4 文本', 'PROJ.4 文字', 'public fixture metadata seed'),
  ('rate_limit_amount', 'Rajoituksen määrä', 'Rate limit amount', '速率限制数量', '速率限制數量', 'public fixture metadata seed'),
  ('rate_limit_minutes', 'Rajoituksen minuutit', 'Rate limit minutes', '速率限制分钟数', '速率限制分鐘數', 'public fixture metadata seed'),
  ('reference_direction', 'Viittauksen suunta', 'Reference direction', '引用方向', '參照方向', 'public fixture metadata seed'),
  ('revolut_checkout_url', 'Revolut-kassan URL', 'Revolut checkout URL', 'Revolut 结账 URL', 'Revolut 結帳 URL', 'public fixture metadata seed'),
  ('revolut_order_id', 'Revolut-tilaus-ID', 'Revolut order ID', 'Revolut 订单 ID', 'Revolut 訂單 ID', 'public fixture metadata seed'),
  ('row_id', 'Rivitunnus', 'Row ID', '行 ID', '資料列 ID', 'public fixture metadata seed'),
  ('row_policy_owner_column', 'Rivipolitiikan omistajasarake', 'Row-policy owner column', '行策略所有者列', '資料列政策擁有者欄位', 'public fixture metadata seed'),
  ('schema_name', 'Skeeman nimi', 'Schema name', '模式名称', '結構描述名稱', 'public fixture metadata seed'),
  ('sco_number', 'SCO-numero', 'SCO number', 'SCO 编号', 'SCO 編號', 'public fixture metadata seed'),
  ('search_placeholder', 'Hakupaikkamerkki', 'Search placeholder', '搜索占位文本', '搜尋預留位置文字', 'public fixture metadata seed'),
  ('search_slogan', 'Hakuiskulause', 'Search slogan', '搜索提示语', '搜尋提示語', 'public fixture metadata seed'),
  ('search_vector_simple', 'Yksinkertainen hakuvektori', 'Simple search vector', '简单搜索向量', '簡單搜尋向量', 'public fixture metadata seed'),
  ('show_key_on_card', 'Näytä avain kortilla', 'Show key on card', '在卡片上显示键', '喺卡片顯示鍵', 'public fixture metadata seed'),
  ('show_value_on_card', 'Näytä arvo kortissa', 'Show value on card', '在卡片上显示值', '喺卡片顯示值', 'public fixture metadata seed'),
  ('sort_order', 'Lajittelujärjestys', 'Sort order', '排序顺序', '排序次序', 'public fixture metadata seed'),
  ('source_column_name', 'Lähdesarakkeen nimi', 'Source column name', '源列名称', '來源欄位名稱', 'public fixture metadata seed'),
  ('source_high', 'Lähde korkea', 'Source high', '高优先级来源', '高優先級來源', 'public fixture metadata seed'),
  ('source_insert_specs', 'Lähteen lisäyksen määrittelyt', 'Source insert specifications', '来源插入规范', '來源新增規格', 'public fixture metadata seed'),
  ('source_low', 'Lähde matala', 'Source low', '低优先级来源', '低優先級來源', 'public fixture metadata seed'),
  ('source_table_uid', 'Lähdetaulun UID', 'Source table UID', '源表 UID', '來源資料表 UID', 'public fixture metadata seed'),
  ('source_type', 'Lähteen tyyppi', 'Source type', '来源类型', '來源類型', 'public fixture metadata seed'),
  ('specific_table_related', 'Tiettyyn tauluun liittyvä', 'Specific table related', '与特定表相关', '同特定資料表相關', 'public fixture metadata seed'),
  ('sql_dump_policy', 'SQL dump -käytäntö', 'SQL dump policy', 'SQL 转储策略', 'SQL 傾印政策', 'public fixture metadata seed'),
  ('srid', 'SRID', 'SRID', 'SRID', 'SRID', 'public fixture metadata seed'),
  ('srtext', 'Paikkaviitteen määritelmä', 'Spatial reference text', '空间参考文本', '空間參照文字', 'public fixture metadata seed'),
  ('status', 'Tila', 'Status', '状态', '狀態', 'public fixture metadata seed'),
  ('success', 'Onnistui', 'Success', '成功', '成功', 'public fixture metadata seed'),
  ('tab_key', 'Välilehden avain', 'Tab key', '标签页键', '分頁鍵', 'public fixture metadata seed'),
  ('table_a_column', 'Taulun A sarake', 'Table A column', '表 A 的列', '資料表 A 嘅欄位', 'public fixture metadata seed'),
  ('table_a_uid', 'Taulun A UID', 'Table A UID', '表 A UID', '資料表 A UID', 'public fixture metadata seed'),
  ('table_b_column', 'Taulun B sarake', 'Table B column', '表 B 的列', '資料表 B 嘅欄位', 'public fixture metadata seed'),
  ('table_b_uid', 'Taulun B UID', 'Table B UID', '表 B UID', '資料表 B UID', 'public fixture metadata seed'),
  ('table_name', 'Taulun nimi', 'Table name', '表名', '資料表名稱', 'public fixture metadata seed'),
  ('table_uid', 'Taulun UID', 'Table UID', '表 UID', '資料表 UID', 'public fixture metadata seed'),
  ('tab_order', 'Välilehtien järjestys', 'Tab order', '标签页顺序', '分頁次序', 'public fixture metadata seed'),
  ('tab_order_json', 'Välilehtien järjestys JSON', 'Tab order JSON', '标签页顺序 JSON', '分頁次序 JSON', 'public fixture metadata seed'),
  ('target_column_name', 'Kohdesarakkeen nimi', 'Target column name', '目标列名称', '目標欄位名稱', 'public fixture metadata seed'),
  ('target_insert_specs', 'Kohteen lisäyksen määrittelyt', 'Target insert specifications', '目标插入规范', '目標新增規格', 'public fixture metadata seed'),
  ('target_schema_name', 'Kohdeskeeman nimi', 'Target schema name', '目标模式名称', '目標結構描述名稱', 'public fixture metadata seed'),
  ('target_table_uid', 'Kohdetaulun UID', 'Target table UID', '目标表 UID', '目標資料表 UID', 'public fixture metadata seed'),
  ('text_value', 'Tekstiarvo', 'Text value', '文本值', '文字值', 'public fixture metadata seed'),
  ('tiketti_id', 'Tiketin ID', 'Ticket ID', '工单 ID', '工單 ID', 'public fixture metadata seed'),
  ('title', 'Otsikko', 'Title', '标题', '標題', 'public fixture metadata seed'),
  ('ui_only', 'Vain käyttöliittymä', 'UI only', '仅限界面', '只限介面', 'public fixture metadata seed'),
  ('updated_at', 'Päivitetty', 'Updated at', '更新时间', '更新時間', 'public fixture metadata seed'),
  ('url_path', 'URL-polku', 'URL path', 'URL 路径', 'URL 路徑', 'public fixture metadata seed'),
  ('url_route_endpoint', 'URL-reitin päätepiste', 'URL route endpoint', 'URL 路由端点', 'URL 路由端點', 'public fixture metadata seed'),
  ('usage_explanation', 'Käyttöselite', 'Usage explanation', '使用说明', '使用說明', 'public fixture metadata seed'),
  ('user_group_id', 'Käyttäjäryhmän tunnus', 'User group ID', '用户组 ID', '用戶群組 ID', 'public fixture metadata seed'),
  ('username', 'Käyttäjätunnus', 'Username', '用户名', '用戶名稱', 'public fixture metadata seed'),
  ('value_type', 'Arvon tyyppi', 'Value type', '值类型', '值類型', 'public fixture metadata seed'),
  ('version', 'Versio', 'Version', '版本', '版本', 'public fixture metadata seed'),
  ('viewed_by_user_id', 'Katsottu käyttäjätunnuksella', 'Viewed by user ID', '查看者用户 ID', '檢視者用戶 ID', 'public fixture metadata seed'),
  ('visible', 'Näkyvä', 'Visible', '可见', '可見', 'public fixture metadata seed'),
  ('webhook_received_at', 'Webhook vastaanotettu', 'Webhook received at', '收到 Webhook 的时间', '收到 Webhook 嘅時間', 'public fixture metadata seed'),
  ('yue', 'Kantoninkiina', 'Cantonese', '粤语', '粵語', 'public fixture metadata seed')
    ) AS source(lang_key, fi, en, ch, yue, creation_spec)
    ON target.lang_key = source.lang_key
    WHEN MATCHED THEN
        UPDATE SET fi = source.fi,
                   en = source.en,
                   ch = source.ch,
                   yue = source.yue,
                   updated = NOW(),
                   creation_spec = source.creation_spec
    WHEN NOT MATCHED THEN
        INSERT (lang_key, fi, en, ch, yue, creation_spec)
        VALUES (
            source.lang_key,
            source.fi,
            source.en,
            source.ch,
            source.yue,
            source.creation_spec
        );

    INSERT INTO public.system_lang_keys (
        lang_key, fi, en, ch, yue, creation_spec
    )
    SELECT 'search_for_' || base.lang_key,
           'Hae: ' || base.fi,
           'Search: ' || base.en,
           '搜索：' || base.ch,
           '搜尋：' || base.yue,
           'public fixture metadata seed'
    FROM (
        SELECT DISTINCT COALESCE(
            NULLIF(details.lang_key, ''),
            details.column_name
        ) AS lang_key
        FROM public.system_column_details details
    ) required
    JOIN public.system_lang_keys base ON base.lang_key = required.lang_key
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_lang_keys existing
        WHERE existing.lang_key = 'search_for_' || base.lang_key
    );

    INSERT INTO public.system_lang_keys (
        lang_key, fi, en, ch, yue, creation_spec
    )
    SELECT derived.lang_key,
           derived.fi,
           derived.en,
           derived.ch,
           derived.yue,
           'public fixture metadata seed'
    FROM (
        SELECT 'search_for_' || tables.table_name AS lang_key,
               'Hae: ' || base.fi AS fi,
               'Search: ' || base.en AS en,
               '搜索：' || COALESCE(NULLIF(base.ch, ''), base.en) AS ch,
               '搜尋：' || COALESCE(
                   NULLIF(base.yue, ''),
                   NULLIF(base.ch, ''),
                   base.en
               ) AS yue
        FROM public.system_db_tables tables
        JOIN public.system_lang_keys base ON base.lang_key = tables.table_name
        UNION ALL
        SELECT tables.table_name || '_front_page' AS lang_key,
               base.fi || ' – etusivu' AS fi,
               base.en || ' front page' AS en,
               COALESCE(NULLIF(base.ch, ''), base.en) || '首页' AS ch,
               COALESCE(
                   NULLIF(base.yue, ''),
                   NULLIF(base.ch, ''),
                   base.en
               ) || '首頁' AS yue
        FROM public.system_db_tables tables
        JOIN public.system_lang_keys base ON base.lang_key = tables.table_name
    ) derived
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_lang_keys existing
        WHERE existing.lang_key = derived.lang_key
    );
END
$$;

INSERT INTO public.system_db_version (version, description)
SELECT '8.0.54',
       'Seeded complete Filterest runtime metadata labels in Finnish, English, Simplified Chinese, and Cantonese.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '8.0.54'
);
