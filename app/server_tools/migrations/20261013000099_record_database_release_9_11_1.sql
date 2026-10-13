-- 20261013000099_record_database_release_9_11_1.sql
-- Records translated card and filterbar interface copy.
-- Connects the final migration of this release to database compatibility checks.
-- Leaves the version unclaimed if a preceding migration fails.
-- VERSION_DB: 9.11.1

INSERT INTO public.system_db_version (version, description)
SELECT '9.11.1', 'Translated card and filterbar sort choices, result counts, field-view editor headings, add-row labels, empty-value labels and creator/owner reference names'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.11.1'
);
