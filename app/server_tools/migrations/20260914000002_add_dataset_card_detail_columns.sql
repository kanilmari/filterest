-- 20260914000002_add_dataset_card_detail_columns.sql
-- Adds a nullable dataset override for the shared card detail column count.
-- Connects dataset metadata to the existing site presentation default.
-- NULL inherits; a selected count remains bounded independently of viewport width.
-- VERSION_DB: 9.7.15
-- VERSION_DB_OWNER: 20260914000001_record_admin_agent_and_dataset_presentation_release.sql

ALTER TABLE public.system_db_tables ADD COLUMN IF NOT EXISTS card_detail_columns SMALLINT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.system_db_tables'::regclass
          AND conname = 'system_db_tables_card_detail_columns_range') THEN
        ALTER TABLE public.system_db_tables
            ADD CONSTRAINT system_db_tables_card_detail_columns_range
            CHECK (card_detail_columns BETWEEN 1 AND 4);
    END IF;
END;
$$;
COMMENT ON COLUMN public.system_db_tables.card_detail_columns IS
    'NULL inherits the site card detail column count; 1 through 4 is a dataset maximum, reduced when the card is narrow.';
