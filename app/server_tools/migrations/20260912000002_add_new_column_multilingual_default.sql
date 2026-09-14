-- 20260912000002_add_new_column_multilingual_default.sql
-- Stores a dataset default for newly added text columns, with per-column overrides.
-- Existing field values and explicit language flags remain unchanged.
-- VERSION_DB: 9.7.14
-- VERSION_DB_OWNER: 20260911000001_add_dataset_ui_visibility.sql

ALTER TABLE public.system_db_tables
    ADD COLUMN IF NOT EXISTS new_columns_multilingual BOOLEAN;

COMMENT ON COLUMN public.system_db_tables.new_columns_multilingual IS
    'Default for new text columns. NULL inherits whether existing columns are multilingual; explicit false remains false.';
