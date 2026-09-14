-- 20260914000001_record_admin_agent_and_dataset_presentation_release.sql
-- Records the additive administrator-agent and dataset-presentation release.
-- Connects the public migration ledger to the single database release identity.
-- Every companion migration declares this file as its version-row owner.
-- VERSION_DB: 9.7.15

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.15', 'Administrator coding-agent policy, API-only identities and dataset presentation settings'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.7.15');
