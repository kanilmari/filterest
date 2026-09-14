-- 20260913000001_inherit_site_card_style.sql
-- Gives datasets an explicit inherit state for the shared site card style.
-- Existing standard defaults start inheriting; explicit modern choices survive.
-- VERSION_DB: 9.7.14
-- VERSION_DB_OWNER: 20260911000001_add_dataset_ui_visibility.sql

ALTER TABLE public.system_db_tables
    ADD COLUMN IF NOT EXISTS card_style_variant VARCHAR;

ALTER TABLE public.system_db_tables
    ALTER COLUMN card_style_variant DROP NOT NULL;

-- Convert the old insert default once. Reapplying this migration must not
-- clear a standard override that was explicitly saved after the upgrade.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'system_db_tables'
          AND column_name = 'card_style_variant'
          AND column_default LIKE '''standard''::%'
    ) THEN
        UPDATE public.system_db_tables
        SET card_style_variant = NULL
        WHERE card_style_variant = 'standard';
    END IF;
END;
$$;

ALTER TABLE public.system_db_tables
    ALTER COLUMN card_style_variant DROP DEFAULT;

COMMENT ON COLUMN public.system_db_tables.card_style_variant IS
    'Card appearance override: NULL inherits the site style (modern by default); standard or modern is an explicit dataset choice.';
