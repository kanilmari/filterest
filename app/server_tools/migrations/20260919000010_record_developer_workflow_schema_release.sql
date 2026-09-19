-- 20260919000010_record_developer_workflow_schema_release.sql
-- Records the public database release that makes developer tools self-contained.
-- Bridges the ticket and workline migration set with database compatibility checks.
-- Exists so installations can prove the complete schema capability was applied.
-- VERSION_DB: 9.8.0

INSERT INTO public.system_db_version (version, description)
SELECT '9.8.0',
       'Added the public developer ticket, todo, workline, report, handover, and release-goal schema'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.8.0'
);
