-- 20261009000076_seed_dataset_kind_language_keys.sql
-- Labels kind metadata and evidence-read errors in every bundled language.
-- Connects registry inspection and API refusals to the existing translation stores.
-- Preserves authored site translations on upgrades and replay.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
WITH authored(lang_key,fi,en,ch,yue) AS (VALUES
 ('table_kind','Tietoaineiston laji','Dataset kind','数据集类型','資料集類型'),
 ('kind_version','Lajisopimuksen versio','Kind contract version','类型契约版本','類型契約版本'),
 ('kind_config','Lajin suhteet ja asetukset','Kind relationships and settings','类型关系与设置','類型關係與設定'),
 ('dataset_kind_evidence_unavailable','Tietoaineiston rakennetta ei voitu tarkistaa. Yritä uudelleen.','The dataset structure could not be checked. Try again.','无法检查数据集结构。请重试。','無法檢查資料集結構。請再試。')
), inserted AS (
 INSERT INTO public.system_lang_keys(lang_key,fi,en,ch,yue,creation_spec)
 SELECT lang_key,fi,en,ch,yue,'WL163 dataset kind contracts.' FROM authored
 WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys k WHERE k.lang_key=authored.lang_key)
 RETURNING id,lang_key,fi,en,ch,yue
), served AS (
 SELECT * FROM inserted UNION ALL
 SELECT k.id,k.lang_key,k.fi,k.en,k.ch,k.yue
 FROM public.system_lang_keys k JOIN authored a USING(lang_key)
 WHERE k.lang_key NOT IN (SELECT lang_key FROM inserted)
)
INSERT INTO public.system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
SELECT s.id,c.language_code,c.translation,'manual',c.review_status FROM served s
JOIN authored a USING(lang_key)
-- Like migration 74, trim only for blank detection; keep nonblank authored bytes.
-- Canonical Chinese candidates follow migrations 71/73's review states.
CROSS JOIN LATERAL(VALUES
 ('fi',CASE WHEN NULLIF(btrim(s.fi,E' \t\n\r\f' || chr(11)),'') IS NULL THEN a.fi ELSE s.fi END,'approved'),
 ('en',CASE WHEN NULLIF(btrim(s.en,E' \t\n\r\f' || chr(11)),'') IS NULL THEN a.en ELSE s.en END,'approved'),
 ('zh-CN',CASE WHEN NULLIF(btrim(s.ch,E' \t\n\r\f' || chr(11)),'') IS NULL THEN a.ch ELSE s.ch END,'needs_review'),
 ('zh-TW',CASE WHEN NULLIF(btrim(s.yue,E' \t\n\r\f' || chr(11)),'') IS NULL THEN a.yue ELSE s.yue END,'needs_review'),
 ('zh-HK',CASE WHEN NULLIF(btrim(s.yue,E' \t\n\r\f' || chr(11)),'') IS NULL THEN a.yue ELSE s.yue END,'needs_review')
) c(language_code,translation,review_status)
JOIN public.system_languages l ON l.language_code=c.language_code
WHERE NULLIF(btrim(c.translation,E' \t\n\r\f' || chr(11)),'') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM public.system_lang_key_translations t
                  WHERE t.lang_key_id=s.id AND t.language_code=c.language_code);
