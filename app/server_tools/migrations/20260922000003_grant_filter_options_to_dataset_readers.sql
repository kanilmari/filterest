-- 20260922000003_grant_filter_options_to_dataset_readers.sql
-- Grants the filter-options right to every group that already reads a dataset in full.
-- Bridges older datasets with the read rights new ones receive at creation
-- (readFuncNames in create_table_registration.go).
-- Exists because datasets created before that list included the filter-options
-- right still lack it for users and guests, so their filter lists stay empty
-- while a dataset created today gets it. 20260818000001 repaired the same gap
-- for administrators only.
-- A group qualifies on a dataset only when it holds every other right of that
-- list there, so a deliberately narrower set of rights stays narrow. Nothing
-- is revoked. Running the file again changes nothing.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

WITH other_reader_rights(name) AS (
    VALUES
        ('dtt_1_row_read.GetResultsHandlerWrapper'),
        ('dtt_1_row_read.GetIntelligentResultsHandlerWrapper'),
        ('dtt_1_row_read.GetRowCountHandlerWrapper'),
        ('dtt_1_row_read.GetDynamicChildItemsHandler'),
        ('dtt_1_row_read.GetResultsVector'),
        ('dtt_2_column_crud.GetTableColumnsHandler'),
        ('dtt_3_table_read.GetTableViewHandlerWrapper')
), installed_reader_rights AS (
    -- A right an installation does not have is not required.
    SELECT functions.id
    FROM public.system_functions AS functions
    JOIN other_reader_rights USING (name)
), full_readers AS (
    SELECT rights.user_group_id, rights.target_table_uid
    FROM public.system_group_table_func_rights AS rights
    WHERE rights.target_table_uid IS NOT NULL
      AND rights.function_id IN (SELECT id FROM installed_reader_rights)
    GROUP BY rights.user_group_id, rights.target_table_uid
    HAVING count(DISTINCT rights.function_id) = (SELECT count(*) FROM installed_reader_rights)
)
INSERT INTO public.system_group_table_func_rights (
    user_group_id,
    function_id,
    target_schema_name,
    creation_spec,
    target_table_uid
)
SELECT
    readers.user_group_id,
    filter_options.id,
    COALESCE(NULLIF(tables.schema_name, ''), 'public'),
    'Filterest DB 9.8.1 filter-options right for groups that read the dataset',
    readers.target_table_uid
FROM full_readers AS readers
JOIN public.system_db_tables AS tables
  ON tables.table_uid = readers.target_table_uid
JOIN public.system_functions AS filter_options
  ON filter_options.name = 'dtt_1_row_read.GetFilterOptionsHandler'
WHERE NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = readers.user_group_id
        AND existing.function_id = filter_options.id
        AND existing.target_table_uid = readers.target_table_uid
  );
