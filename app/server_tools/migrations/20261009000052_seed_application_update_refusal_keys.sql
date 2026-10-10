-- 20261009000052_seed_application_update_refusal_keys.sql
-- Seeds guarded update admission and decision refusals in all bundled languages.
-- Connects API reason keys to the existing multilingual translation services.
-- Preserves operator-authored translations when upgrading or replaying.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: wl157_application_update_refusal_keys
-- FINAL_CHECK: public.app_check_application_update_refusal_keys()
WITH authored(lang_key,fi,en,ch,yue) AS (VALUES
 ('error_application_update_invalid_request','Päivityspyyntö ei kelpaa.','The update request is invalid.','更新请求无效。','更新請求無效。'),
 ('error_application_update_executor_unavailable','Päivitysten suorittaja ei ole käytettävissä.','The update executor is unavailable.','更新执行器不可用。','更新執行器無法使用。'),
 ('error_application_update_preflight_refused','Päivityksen ennakkotarkistus ei hyväksynyt julkaisua.','Update preflight refused this release.','更新预检拒绝此版本。','更新預檢拒絕此版本。'),
 ('error_application_update_offer_conflict','Tarjottu julkaisu on muuttunut. Tarkista tiedot uudelleen.','The offered release changed. Review it again.','提供的版本已更改，请重新检查。','提供嘅版本已更改，請重新檢查。'),
 ('error_application_update_active_job_conflict','Toinen päivitys on jo käynnissä.','Another update job is already active.','另一个更新任务正在进行。','另一個更新工作已經進行緊。'),
 ('error_application_update_idempotency_conflict','Samaa pyyntötunnistetta käytettiin eri tiedoilla.','This request key was already used with different details.','此请求标识已用于不同的内容。','此請求識別碼已用於唔同內容。'),
 ('error_application_update_proof_replayed','Vahvistus ei kelpaa tälle toiminnolle tai se on jo käytetty.','The proof is invalid for this action or has already been used.','验证凭证不适用于此操作或已被使用。','驗證憑證唔適用於此操作或已經用過。'),
 ('error_application_update_proof_expired','Vahvistus on vanhentunut. Vahvista henkilöllisyytesi uudelleen.','The proof expired. Authenticate again.','验证凭证已过期，请重新验证身份。','驗證憑證已過期，請重新驗證身份。'),
 ('error_application_update_authorization_revoked','Päivitysoikeus tai kirjautuminen ei enää ole voimassa.','Update permission or sign-in is no longer valid.','更新权限或登录已失效。','更新權限或登入已失效。'),
 ('error_application_update_reauthentication_refused','Salasanan ja määritetyn lisävahvistuksen tarkistus epäonnistui.','Password and configured factor verification failed.','密码和配置的第二因素验证失败。','密碼同設定嘅第二因素驗證失敗。'),
 ('error_application_update_rate_limited','Liian monta vahvistusyritystä. Yritä myöhemmin uudelleen.','Too many authentication attempts. Try again later.','验证尝试过多，请稍后再试。','驗證嘗試過多，請稍後再試。'),
 ('error_application_update_stale_decision','Päivityksen hyväksymistiedot ovat muuttuneet tai vanhentuneet.','Update decision evidence changed or expired.','更新决定的证据已更改或过期。','更新決定嘅證據已更改或過期。'),
 ('error_application_update_decision_conflict','Tälle päivityksen tarkistukselle on jo odottava päätös.','A decision is already queued for this update evidence.','此更新证据已有排队的决定。','此更新證據已經有排隊嘅決定。'),
 ('error_application_update_queue_expired','Odottava pyyntö on vanhentunut. Vahvista uudelleen.','The queued request expired. Authenticate again.','排队的请求已过期，请重新验证身份。','排隊嘅請求已過期，請重新驗證身份。'),
 ('error_application_update_decision_replayed','Tämä päätös on jo käsitelty.','This decision was already consumed.','此决定已被处理。','此決定已經處理過。'),
 ('error_application_update_job_not_found','Päivitystyötä ei löytynyt.','The update job was not found.','未找到更新任务。','搵唔到更新工作。'),
 ('error_application_update_decision_not_found','Päivityspäätöstä ei löytynyt.','The update decision was not found.','未找到更新决定。','搵唔到更新決定。'),
 ('error_application_update_admission_unavailable','Päivityspyyntöä ei voitu tallentaa. Yritä myöhemmin uudelleen.','The update request could not be saved. Try again later.','无法保存更新请求，请稍后再试。','無法儲存更新請求，請稍後再試。'),
 ('error_application_update_self_grant','Et voi myöntää itsellesi sovelluksen päivitysoikeutta.','You cannot grant yourself application-update permission.','您不能为自己授予应用更新权限。','你唔可以畀自己應用更新權限。')), written AS (
 INSERT INTO public.system_lang_keys AS existing(lang_key,fi,en,ch,yue,creation_spec)
 SELECT lang_key,fi,en,ch,yue,'Guarded application-update admission refusals.' FROM authored
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

CREATE OR REPLACE FUNCTION public.app_check_application_update_refusal_keys()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $check$
    SELECT 'application-update refusal translation is missing: ' || expected.key || ':' || language.language_code
    FROM unnest(ARRAY['error_application_update_invalid_request','error_application_update_executor_unavailable','error_application_update_preflight_refused','error_application_update_offer_conflict','error_application_update_active_job_conflict','error_application_update_idempotency_conflict','error_application_update_proof_replayed','error_application_update_proof_expired','error_application_update_authorization_revoked','error_application_update_reauthentication_refused','error_application_update_rate_limited','error_application_update_stale_decision','error_application_update_decision_conflict','error_application_update_queue_expired','error_application_update_decision_replayed','error_application_update_job_not_found','error_application_update_decision_not_found','error_application_update_admission_unavailable','error_application_update_self_grant']) AS expected(key)
    CROSS JOIN public.system_languages language
    WHERE language.language_code IN ('fi','en','ch','yue')
    AND NOT EXISTS (SELECT 1 FROM public.system_lang_keys k JOIN public.system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key=expected.key AND t.language_code=language.language_code AND NULLIF(t.translation,'') IS NOT NULL);
$check$;
DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_application_update_refusal_keys() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'application-update translation final check refused: %', findings; END IF;
    INSERT INTO public.system_data_repair_records(migration,action)
    SELECT 'wl157_application_update_refusal_keys','completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='wl157_application_update_refusal_keys' AND action='completed');
END $acceptance$;
