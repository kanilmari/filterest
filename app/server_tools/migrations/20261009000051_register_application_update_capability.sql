-- 20261009000051_register_application_update_capability.sql
-- Registers the explicit-only update capability and the guarded administrator APIs.
-- Connects existing group permission editing to durable admission and decisions.
-- Never grants the sensitive capability, including to the initial administrator.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: wl157_application_update_capability
-- FINAL_CHECK: public.app_check_application_update_capability()

INSERT INTO public.system_functions (name,"package",disabled,specific_table_related,url_route_endpoint,ui_only,rate_limit_amount,rate_limit_minutes,creation_spec)
VALUES ('capability.application_update','capability',FALSE,FALSE,'/capabilities/application-update',TRUE,5,5,
        'Explicit application-update right: excluded from every automatic grant and protected against self-granting.')
ON CONFLICT(name) DO NOTHING;

WITH desired(name,endpoint,amount) AS (VALUES
    ('application_updates.StatusHandler','/api/admin/application-update',60),
    ('application_updates.RequestHandler','/api/admin/application-update/requests',10),
    ('application_updates.JobHandler','/api/admin/application-update/jobs/{id}',60),
    ('application_updates.DecisionHandler','/api/admin/application-update/jobs/{id}/decisions',10),
    ('application_updates.ReauthenticationHandler','/api/admin/application-update/reauthentication',10)
)
INSERT INTO public.system_functions(name,"package",disabled,specific_table_related,url_route_endpoint,ui_only,rate_limit_amount,rate_limit_minutes,creation_spec)
SELECT name,'application_updates',FALSE,FALSE,endpoint,FALSE,amount,5,'Administrator update admission; mutations additionally require the separate explicit capability.' FROM desired
ON CONFLICT(name) DO NOTHING;

-- Ordinary API visibility is shared with all administrators; mutation handlers
-- additionally check the capability in their locked transaction.
INSERT INTO public.system_group_table_func_rights(user_group_id,function_id,target_schema_name,target_table_uid)
SELECT g.id,f.id,'public',NULL FROM public.system_user_groups g CROSS JOIN public.system_functions f
WHERE g.name='admins' AND f.name IN ('application_updates.StatusHandler','application_updates.RequestHandler',
    'application_updates.JobHandler','application_updates.DecisionHandler','application_updates.ReauthenticationHandler')
AND NOT EXISTS (SELECT 1 FROM public.system_group_table_func_rights r WHERE r.user_group_id=g.id AND r.function_id=f.id AND r.target_table_uid IS NULL AND r.target_schema_name='public');

CREATE OR REPLACE FUNCTION public.app_check_application_update_capability()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $check$
    SELECT 'application-update capability identity or scope is invalid'
    WHERE (SELECT count(*) FROM public.system_functions WHERE name='capability.application_update'
        AND url_route_endpoint='/capabilities/application-update' AND ui_only IS TRUE
        AND disabled IS FALSE AND specific_table_related IS FALSE) <> 1;
$check$;
DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_application_update_capability() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'application-update capability final check refused: %', findings; END IF;
    INSERT INTO public.system_data_repair_records(migration,action)
    SELECT 'wl157_application_update_capability','completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='wl157_application_update_capability' AND action='completed');
END $acceptance$;
