-- 20260914000006_add_article_section_initial_open.sql
-- Stores each dataset's initial disclosure states for its article presentations.
-- Connects the view settings editor to classic and image-first article openings.
-- Missing presentation/section keys keep the existing initially-open behavior.
-- VERSION_DB: 9.7.15
-- VERSION_DB_OWNER: 20260914000001_record_admin_agent_and_dataset_presentation_release.sql

ALTER TABLE public.system_db_tables
    ADD COLUMN IF NOT EXISTS article_section_initial_open JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.system_db_tables'::regclass
          AND conname = 'system_db_tables_article_section_initial_open_object'
    ) THEN
        ALTER TABLE public.system_db_tables
            ADD CONSTRAINT system_db_tables_article_section_initial_open_object
            CHECK (jsonb_typeof(article_section_initial_open) = 'object');
    END IF;
END;
$$;

COMMENT ON COLUMN public.system_db_tables.article_section_initial_open IS
    'Initial section-open defaults by article presentation; absent keys mean open. Runtime toggles do not overwrite defaults.';
