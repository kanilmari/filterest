-- dataset_rights.seed.sql
-- Grants the starter groups their read and structure rights on the seeded datasets.
-- Bridges the datasets several reviewed seed fragments create with the permission
-- rows that decide who may read, filter and change each of them.
-- Exists as its own fragment because a right names the dataset it is granted on:
-- it can only be seeded once that dataset row exists, and these grants reach
-- across fragments, so they are assembled last. The foreign key restored in
-- database version 9.9.0 turns that ordering from a convention into a rule.

INSERT INTO public.system_group_table_func_rights (
  user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT 1, functions.id, 'public', 'public fixture seed', table_uids.table_uid
FROM (VALUES (7), (8), (9), (10)) AS table_uids(table_uid)
JOIN public.system_functions functions
  ON functions.name IN (
    'dtt_crud_workflows.ModifyColumnsHandler',
    'dtt_3_table_delete.DropTableHandler'
  );

INSERT INTO public.system_group_table_func_rights (
  user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT group_ids.user_group_id, functions.id, 'public', 'public fixture seed', table_uids.table_uid
FROM (VALUES (1), (2), (3)) AS group_ids(user_group_id)
CROSS JOIN (VALUES
  (7), (8), (9), (10),
  (56), (74), (75), (76), (77), (105),
  (300), (301), (302), (303)
) AS table_uids(table_uid)
JOIN public.system_functions functions
  ON functions.name IN (
    'dtt_1_row_read.GetResultsHandlerWrapper',
    'dtt_1_row_read.GetRowCountHandlerWrapper',
    'dtt_1_row_read.GetFilterOptionsHandler',
    'dtt_1_row_read.GetIntelligentResultsHandlerWrapper',
    'dtt_1_row_read.GetResultsVector',
    'dtt_3_table_read.GetTableViewHandlerWrapper',
    'dtt_2_column_crud.GetTableColumnsHandler',
    'dtt_1_row_read.GetDynamicChildItemsHandler'
  );
