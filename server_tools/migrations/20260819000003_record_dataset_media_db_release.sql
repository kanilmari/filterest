-- 20260819000003_record_dataset_media_db_release.sql
-- Records the additive dataset-media capability as DB release 9.2.0.
-- Kept separate because the preceding migrations may already have run in a
-- development database before their accepted Phase 6 release was assembled.
-- VERSION_DB: 9.2.0

INSERT INTO public.system_db_version (version, description)
SELECT
    '9.2.0',
    'Added dataset-level cover and content-background media plus localized filter mode labels.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.2.0'
);
