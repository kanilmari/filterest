-- 20260914000003_add_coding_agent_dev_only.sql
-- Stores the coding-agent environment policy in the shared typed configuration.
-- Connects administrator-only coding requests to an explicit production opt-in.
-- New installations default to development only; existing operator choices survive.
-- VERSION_DB: 9.7.15
-- VERSION_DB_OWNER: 20260914000001_record_admin_agent_and_dataset_presentation_release.sql

INSERT INTO public.system_config (key, value_type, boolean_value, text_value, json_value)
VALUES ('coding_agent_dev_only', 2, TRUE, 'true', '{"value":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
