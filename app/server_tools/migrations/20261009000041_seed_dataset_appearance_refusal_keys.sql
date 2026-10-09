-- 20261009000041_seed_dataset_appearance_refusal_keys.sql
-- Seeds actionable appearance save refusals in every bundled language.
-- Connects administrator API reason keys with the canonical translation stores.
-- Preserves reviewed translations on upgrades and replay.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
WITH authored(lang_key,fi,en,ch,yue) AS (VALUES
 ('dataset_appearance_conflict','Ulkoasuasetukset ovat muuttuneet. Lataa asetukset uudelleen ja tarkista muutokset ennen tallentamista.','Appearance settings changed. Reload and review before saving.','外观设置已更改。请重新加载并检查后再保存。','外觀設定已更改。請重新載入並檢查後再儲存。'),
 ('dataset_appearance_invalid','Ulkoasuasetus ei kelpaa. Tarkista arvot ja niiden järjestys.','An appearance setting is invalid. Check the values and their order.','外观设置无效。请检查数值及其顺序。','外觀設定無效。請檢查數值同次序。'),
 ('dataset_appearance_not_found','Aineistoa ei enää ole.','The dataset no longer exists.','数据集已不存在。','資料集已不存在。')
), written AS (
 INSERT INTO public.system_lang_keys AS existing(lang_key,fi,en,ch,yue,creation_spec)
 SELECT lang_key,fi,en,ch,yue,'Revision-protected dataset appearance API refusals.' FROM authored
 ON CONFLICT(lang_key) DO UPDATE SET
 fi=COALESCE(NULLIF(existing.fi,''),EXCLUDED.fi),en=COALESCE(NULLIF(existing.en,''),EXCLUDED.en),
 ch=COALESCE(NULLIF(existing.ch,''),EXCLUDED.ch),yue=COALESCE(NULLIF(existing.yue,''),EXCLUDED.yue)
 RETURNING id,lang_key,fi,en,ch,yue
), served AS (
 SELECT * FROM written UNION ALL
 SELECT k.id,k.lang_key,k.fi,k.en,k.ch,k.yue FROM public.system_lang_keys k JOIN authored USING(lang_key)
 WHERE k.lang_key NOT IN(SELECT lang_key FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing(lang_key_id,language_code,translation,source_kind,review_status)
SELECT s.id,c.language_code,c.translation,'manual','approved' FROM served s
CROSS JOIN LATERAL(VALUES('fi',s.fi),('en',s.en),('ch',s.ch),('yue',s.yue)) c(language_code,translation)
JOIN public.system_languages l ON l.language_code=c.language_code
ON CONFLICT(lang_key_id,language_code) DO UPDATE SET translation=EXCLUDED.translation
WHERE NULLIF(existing.translation,'') IS NULL;
