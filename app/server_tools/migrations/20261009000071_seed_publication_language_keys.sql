-- 20261009000071_seed_publication_language_keys.sql
-- Seeds publication labels and validation copy in the canonical language stores.
-- Connects the Observatory and dedicated API with multilingual reader-facing terms.
-- Adds missing keys and translations while preserving installation-authored values.
-- VERSION_DB: 9.11.0
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql

WITH authored(lang_key,fi,en,ch,yue) AS (VALUES
 ('workline_publication_goal','Julkaisut','Publications','发布','發佈'),
 ('workline_publication_no_goal','Julkaisuja ei vielä ole','No publications yet','尚无发布','未有發佈'),
 ('workline_publication_release_target','Julkaisut','Publications','发布','發佈'),
 ('workline_publication_new_goal','Suunnittele seuraava julkaisu','Plan the next publication','规划下一次发布','計劃下一次發佈'),
 ('workline_publication_goal_key','Julkaisun tunniste','Publication identity','发布标识','發佈識別'),
 ('workline_publication_goal_revision','Sopimuksen versio','Contract revision','契约修订','契約修訂'),
 ('workline_publication_goal_title','Julkaisun nimi','Publication name','发布名称','發佈名稱'),
 ('workline_publication_goal_outcome','Tavoite ja suunnitelma','Outcome and plan','目标与计划','目標同計劃'),
 ('workline_publication_create_goal','Luo julkaisu','Create publication','创建发布','建立發佈'),
 ('workline_publication_lock_goal','Lukitse julkaisusopimus','Lock publication contract','锁定发布契约','鎖定發佈契約'),
 ('workline_publication_publication_version','Julkaistava versio','Publication version','发布版本','發佈版本'),
 ('workline_publication_target_date','Tavoitepäivä','Target date','目标日期','目標日期'),
 ('workline_publication_reader_description','Mitä julkaisu tuo lukijalle (desktop ja mobiili)','What readers gain (desktop and mobile)','读者获得的功能（桌面和移动端）','讀者得到嘅功能（桌面同手機）'),
 ('workline_publication_published','Julkaistu','Published','已发布','已發佈'),
 ('workline_publication_unpublished','Julkaisematon','Unpublished','未发布','未發佈'),
 ('workline_publication_published_at','Julkaisuhetki','Publication time','发布时间','發佈時間'),
 ('workline_publication_current_publication','Uusin julkaisematon','Newest unpublished','最新未发布计划','最新未發佈計劃'),
 ('workline_publication_publication_history','Valitse julkaisu','Choose publication','选择发布','揀選發佈'),
 ('workline_publication_save_publication','Tallenna julkaisu','Save publication','保存发布','儲存發佈'),
 ('workline_publication_publication_conflict','Julkaisu muuttui. Tarkista päivitetty tila ja yritä uudelleen.','This publication changed. Review the refreshed state and try again.','此发布已更改。请检查刷新后的状态并重试。','呢次發佈已經改咗。請檢查更新後嘅狀態再試。'),
 ('publication_revision_required','Julkaisun muutosversio puuttuu. Lataa julkaisut uudelleen.','Publication revision is required. Reload Publications.','发布修订号缺失。请重新加载发布列表。','發佈修訂號未填。請重新載入發佈清單。'),
 ('publication_revision_conflict','Julkaisu muuttui. Tarkista päivitetty tila ja yritä uudelleen.','This publication changed. Review the refreshed state and try again.','此发布已更改。请检查刷新后的状态并重试。','呢次發佈已經改咗。請檢查更新後嘅狀態再試。'),
 ('invalid_publication_details','Tarkista julkaisun versio ja kuvauksen pituus.','Check the publication version and description length.','请检查发布版本和说明长度。','請檢查發佈版本同說明長度。'),
 ('invalid_publication_target_date','Tavoitepäivän on oltava kelvollinen päivämäärä.','The target date must be a valid calendar date.','目标日期必须是有效的日历日期。','目標日期必須係有效嘅日曆日期。'),
 ('invalid_publication_time','Julkaisuhetki tarvitsee aikavyöhykkeen ja julkaistun tilan.','Publication time requires a timezone and published state.','发布时间需要时区及已发布状态。','發佈時間需要時區同已發佈狀態。')
), written AS (
 INSERT INTO public.system_lang_keys(lang_key,fi,en,ch,yue,creation_spec)
 SELECT lang_key,fi,en,ch,yue,'Publications in the Workline Observatory.' FROM authored
 WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys existing WHERE existing.lang_key=authored.lang_key)
 RETURNING id,lang_key,fi,en,ch,yue
), served AS (
 SELECT * FROM written UNION ALL
 SELECT k.id,k.lang_key,k.fi,k.en,k.ch,k.yue FROM public.system_lang_keys k JOIN authored USING(lang_key)
 WHERE k.lang_key NOT IN(SELECT lang_key FROM written)
)
INSERT INTO public.system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
SELECT s.id,c.language_code,c.translation,'manual',c.review_status FROM served s
JOIN authored a USING(lang_key)
-- Legacy Chinese and Cantonese columns map like the field-assignment seeds:
-- canonical Chinese locales are candidates needing review, never approved copy.
CROSS JOIN LATERAL(VALUES
 ('fi',CASE WHEN NULLIF(btrim(s.fi),'') IS NULL THEN a.fi ELSE s.fi END,'approved'),
 ('en',CASE WHEN NULLIF(btrim(s.en),'') IS NULL THEN a.en ELSE s.en END,'approved'),
 ('zh-CN',CASE WHEN NULLIF(btrim(s.ch),'') IS NULL THEN a.ch ELSE s.ch END,'needs_review'),
 ('zh-TW',CASE WHEN NULLIF(btrim(s.yue),'') IS NULL THEN a.yue ELSE s.yue END,'needs_review'),
 ('zh-HK',CASE WHEN NULLIF(btrim(s.yue),'') IS NULL THEN a.yue ELSE s.yue END,'needs_review')
) c(language_code,translation,review_status)
JOIN public.system_languages l ON l.language_code=c.language_code
WHERE NULLIF(btrim(c.translation),'') IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM public.system_lang_key_translations existing
 WHERE existing.lang_key_id=s.id AND existing.language_code=c.language_code
);
