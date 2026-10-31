-- 20261024000001_add_saved_home_boxes.sql
-- Extends existing Home boxes with validated saved categories, sorting and translated titles.
-- Connects the dedicated Home API with stable box identities and explicit scope inheritance.
-- Preserves every existing box and keeps intentionally empty administrator lists empty.
-- VERSION_DB: 9.13.1
-- VERSION_DB_OWNER: 20261024000099_record_database_release_9_13_1.sql
-- COMPLETION_MARKER: saved_home_boxes

ALTER TABLE public.system_front_page_blocks
    ADD COLUMN IF NOT EXISTS title jsonb NULL,
    ADD COLUMN IF NOT EXISTS query jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS category_links smallint NOT NULL DEFAULT 3 CHECK (category_links BETWEEN 0 AND 3);
ALTER TABLE public.system_front_page_blocks DROP CONSTRAINT IF EXISTS uq_system_front_page_blocks_dataset;
ALTER TABLE public.system_front_page_blocks ALTER COLUMN result_limit SET DEFAULT 3;
COMMENT ON COLUMN public.system_front_page_blocks.result_limit IS 'Visible rows requested, from 1 to 20, default 3.';
COMMENT ON COLUMN public.system_front_page_blocks.title IS 'Optional plain-text title by registered UI language; NULL or an empty object uses the dataset name.';
COMMENT ON COLUMN public.system_front_page_blocks.query IS 'Dedicated API validated query: row_group (at most 19 unique enabled dataset slugs), sort_column and ASC/DESC sort_order. Empty means newest first.';
COMMENT ON COLUMN public.system_front_page_blocks.category_links IS 'Category links per heading, from 0 to 3; used by the Home category reader.';

-- Deferred checking lets the dedicated writer swap positions without replacing identities.
DO $position$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_front_page_blocks'::regclass
        AND conname='uq_system_front_page_blocks_position' AND NOT condeferrable) THEN
        ALTER TABLE public.system_front_page_blocks DROP CONSTRAINT uq_system_front_page_blocks_position;
        ALTER TABLE public.system_front_page_blocks ADD CONSTRAINT uq_system_front_page_blocks_position
            UNIQUE NULLS NOT DISTINCT (user_id, sort_order) DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END $position$;

ALTER TABLE public.system_front_page_revisions ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.system_front_page_revisions.is_custom IS 'True means use this saved list, including zero boxes; false means inherit common or computed defaults. Reset retains the revision.';
DO $inheritance$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='saved_home_boxes' AND action='completed') THEN
        INSERT INTO public.system_front_page_revisions(user_id, revision, is_custom)
        SELECT block.user_id, max(block.updated), true FROM public.system_front_page_blocks block
        WHERE NOT EXISTS (SELECT 1 FROM public.system_front_page_revisions revision
            WHERE revision.user_id IS NOT DISTINCT FROM block.user_id)
        GROUP BY block.user_id;
        UPDATE public.system_front_page_revisions revision SET is_custom=true
        WHERE EXISTS (SELECT 1 FROM public.system_front_page_blocks block
            WHERE block.user_id IS NOT DISTINCT FROM revision.user_id);
    END IF;
END $inheritance$;

-- BOOTSTRAP_AFTER_DATA_SEED
INSERT INTO public.system_column_details
    (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
SELECT registry.table_uid, col.column_name, col.data_type, col.ordinal_position, col.column_name, false, false
FROM information_schema.columns col JOIN public.system_db_tables registry
    ON registry.table_name=col.table_name AND COALESCE(NULLIF(registry.schema_name,''),'public')='public'
WHERE col.table_schema='public' AND col.table_name='system_front_page_blocks'
    AND col.column_name IN ('title','query','category_links')
    AND NOT EXISTS (SELECT 1 FROM public.system_column_details existing
        WHERE existing.table_uid=registry.table_uid AND existing.column_name=col.column_name);

INSERT INTO public.system_data_repair_records(migration, action, detail)
SELECT 'saved_home_boxes', 'completed', jsonb_build_object('file','20261024000001_add_saved_home_boxes.sql')
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='saved_home_boxes' AND action='completed');
