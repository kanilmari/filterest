-- 20260818000004_deduplicate_project_tab_order.sql
-- Removes repeated navigation entries from every project's stored tab order.
-- Keeps the first occurrence and its original position so existing custom order
-- remains stable while duplicate buttons, such as two Users entries, disappear.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

WITH expanded AS (
    SELECT
        folders.id AS folder_id,
        item.value AS tab_entry,
        item.ordinality,
        NULLIF(BTRIM(item.value ->> 'tab_id'), '') AS tab_id
    FROM public.system_table_folders AS folders
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(folders.tab_order_json) = 'array'
                THEN folders.tab_order_json
            ELSE '[]'::jsonb
        END
    )
        WITH ORDINALITY AS item(value, ordinality)
), ranked AS (
    SELECT
        expanded.*,
        CASE
            WHEN tab_id IS NULL THEN 1
            ELSE ROW_NUMBER() OVER (
                PARTITION BY folder_id, tab_id
                ORDER BY ordinality
            )
        END AS duplicate_rank
    FROM expanded
), rebuilt AS (
    SELECT
        folder_id,
        jsonb_agg(tab_entry ORDER BY ordinality) AS tab_order_json
    FROM ranked
    WHERE duplicate_rank = 1
    GROUP BY folder_id
)
UPDATE public.system_table_folders AS folders
SET tab_order_json = rebuilt.tab_order_json,
    updated = CURRENT_DATE
FROM rebuilt
WHERE folders.id = rebuilt.folder_id
  AND folders.tab_order_json IS DISTINCT FROM rebuilt.tab_order_json;
