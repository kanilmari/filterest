-- 20260918000001_record_site_assistant_release.sql
-- Records the additive site assistant release identity.
-- Connects the public migration ledger to the single database release identity.
-- Every companion migration declares this file as its version-row owner.
-- VERSION_DB: 9.7.16

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.16', 'Site assistant chat copy for administrator approval of prepared changes'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.7.16');
