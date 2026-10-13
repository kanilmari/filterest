-- 20261009000070_add_publication_fields_to_release_goals.sql
-- Extends existing release decisions into planned and published publications.
-- Connects reader-facing promises and scheduling with the existing locked contracts.
-- Preserves contract revisions and old rows; publication metadata has its own revision.
-- VERSION_DB: 9.11.0
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql
-- COMPLETION_MARKER: wl164_publication_fields
-- FINAL_CHECK: public.app_check_publications()

DO $publication_columns$
BEGIN
    ALTER TABLE public.dev_agent_release_goals
        ADD COLUMN IF NOT EXISTS publication_version text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS target_date date,
        ADD COLUMN IF NOT EXISTS reader_description text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS published_at timestamptz,
        ADD COLUMN IF NOT EXISTS publication_revision bigint NOT NULL DEFAULT 0;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                   WHERE conrelid = 'public.dev_agent_release_goals'::regclass
                     AND conname = 'ck_dev_agent_release_goals_publication') THEN
        ALTER TABLE public.dev_agent_release_goals
            ADD CONSTRAINT ck_dev_agent_release_goals_publication CHECK (
                char_length(publication_version) <= 80
                AND char_length(reader_description) <= 6000
                AND publication_revision >= 0
                AND (target_date IS NULL OR target_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
                AND ((NOT published AND published_at IS NULL)
                     OR (published AND published_at IS NOT NULL
                         AND char_length(btrim(publication_version)) > 0
                         AND published_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
                         AND published_at < TIMESTAMPTZ '10000-01-01 00:00:00+00'))
            );
    END IF;
END $publication_columns$;

-- Only NEW is written. The existing goal-lock trigger still owns scope identity
-- and classification completeness; scheduling and reader copy remain editable.
CREATE OR REPLACE FUNCTION public.set_dev_agent_publication_revision()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.publication_revision := 0;
    ELSIF ROW(NEW.publication_version, NEW.target_date, NEW.reader_description,
              NEW.published, NEW.published_at)
          IS DISTINCT FROM ROW(OLD.publication_version, OLD.target_date, OLD.reader_description,
                               OLD.published, OLD.published_at) THEN
        NEW.publication_revision := OLD.publication_revision + 1;
        NEW.updated := now();
    ELSE
        NEW.publication_revision := OLD.publication_revision;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_dev_agent_publication_revision ON public.dev_agent_release_goals;
CREATE TRIGGER set_dev_agent_publication_revision
    BEFORE INSERT OR UPDATE ON public.dev_agent_release_goals
    FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_publication_revision();

CREATE INDEX IF NOT EXISTS idx_dev_agent_release_goals_publications
    ON public.dev_agent_release_goals (published, created DESC, id DESC);

COMMENT ON TABLE public.dev_agent_release_goals IS
    'Publications: reader-facing plans and publication evidence, retaining versioned release decisions and workline contracts.';
COMMENT ON COLUMN public.dev_agent_release_goals.version IS
    'Existing release-contract revision; not the published software version.';
COMMENT ON COLUMN public.dev_agent_release_goals.publication_version IS
    'Planned software version as text. Published Git tags remain authoritative; this field creates no tag.';
COMMENT ON COLUMN public.dev_agent_release_goals.target_date IS
    'Planned publication date, independent of contract locking and actual publication time.';
COMMENT ON COLUMN public.dev_agent_release_goals.reader_description IS
    'What this publication brings readers on desktop and mobile; administrator-authored content.';
COMMENT ON COLUMN public.dev_agent_release_goals.published_at IS
    'Actual publication time; NULL while unpublished.';
COMMENT ON COLUMN public.dev_agent_release_goals.publication_revision IS
    'Optimistic revision for scheduling, reader description and publication state; independent of contract version.';

-- A pre-existing incompatible column must refuse, rather than being hidden by
-- ADD IF NOT EXISTS. Bootstrap runs this again before accepting its ledger.
CREATE OR REPLACE FUNCTION public.app_check_publications()
RETURNS SETOF text LANGUAGE sql STABLE AS $$
    SELECT 'publication column shape differs: ' || expected.column_name
    FROM (VALUES ('publication_version','text','NO'), ('target_date','date','YES'),
                 ('reader_description','text','NO'), ('published','boolean','NO'),
                 ('published_at','timestamp with time zone','YES'),
                 ('publication_revision','bigint','NO')) AS expected(column_name,data_type,is_nullable)
    LEFT JOIN information_schema.columns actual ON actual.table_schema='public'
        AND actual.table_name='dev_agent_release_goals' AND actual.column_name=expected.column_name
    WHERE actual.column_name IS NULL OR actual.data_type<>expected.data_type OR actual.is_nullable<>expected.is_nullable
    UNION ALL
    SELECT 'publication constraint missing or unvalidated'
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid='public.dev_agent_release_goals'::regclass
          AND conname='ck_dev_agent_release_goals_publication' AND convalidated)
    UNION ALL
    SELECT 'publication revision trigger missing or disabled'
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid='public.dev_agent_release_goals'::regclass
          AND tgname='set_dev_agent_publication_revision' AND tgenabled='O'
          AND tgfoid='public.set_dev_agent_publication_revision()'::regprocedure)
    UNION ALL
    SELECT 'publication ordering index missing or invalid'
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index
        WHERE indexrelid=to_regclass('public.idx_dev_agent_release_goals_publications') AND indisvalid);
$$;

DO $publication_acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding, '; ') INTO findings FROM public.app_check_publications() finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'publication migration refused: %', findings; END IF;
    INSERT INTO public.system_data_repair_records (migration, action)
    SELECT 'wl164_publication_fields', 'completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                      WHERE migration = 'wl164_publication_fields' AND action = 'completed');
END $publication_acceptance$;
