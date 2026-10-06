-- 20261005000070_drop_column_label_value_layout.sql
-- Removes the unused per-column wrapping choice after WL52 made wrapping site-wide.
-- Bridges upgraded metadata and the fresh bootstrap with the column visibility API.
-- Keeps all label/value visibility columns and the site JSON setting unchanged (K234).
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl52_drop_column_label_value_layout

-- PostgreSQL also removes the column's CHECK constraint and comment. No CASCADE:
-- an unexpected external dependency must refuse the migration, not be erased.
ALTER TABLE IF EXISTS public.system_column_details
    DROP COLUMN IF EXISTS label_value_layout;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wl52_drop_column_label_value_layout', 'completed',
       jsonb_build_object('file', '20261005000070_drop_column_label_value_layout.sql')
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wl52_drop_column_label_value_layout' AND action = 'completed'
);
