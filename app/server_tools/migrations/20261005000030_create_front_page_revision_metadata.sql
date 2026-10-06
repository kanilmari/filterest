-- 20261005000030_create_front_page_revision_metadata.sql
-- Keeps durable editor revisions in protected metadata instead of editable settings.
-- Connects front page optimistic saves with the account deletion transaction.
-- Exists so resetting a list retains conflicts without leaving deleted accounts behind.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: system_front_page_revisions_table

CREATE TABLE IF NOT EXISTS public.system_front_page_revisions (
    user_id bigint REFERENCES public.system_users(id) ON DELETE CASCADE,
    revision timestamptz NOT NULL,
    CONSTRAINT ck_system_front_page_revisions_not_visitor CHECK (user_id > 1),
    CONSTRAINT uq_system_front_page_revisions_scope UNIQUE NULLS NOT DISTINCT (user_id)
);
COMMENT ON TABLE public.system_front_page_revisions IS
    'Private front page editor revisions, retained on reset and removed with the account; never a registered dataset or setting.';
COMMENT ON COLUMN public.system_front_page_revisions.user_id IS
    'NULL identifies the common site list. Account scopes follow the account lifecycle.';
REVOKE ALL ON public.system_front_page_revisions FROM PUBLIC;

-- Preserve valid revisions from the unreleased development implementation. Skip
-- deleted accounts and malformed editable values, then retire every old setting.
-- Noncanonical keys can share a numeric scope; preserve its greatest revision.
INSERT INTO public.system_front_page_revisions (user_id, revision)
SELECT NULLIF(scope, 0), max(revision)
FROM (
    SELECT CASE WHEN pg_input_is_valid(substring(key FROM 26), 'bigint')
                THEN substring(key FROM 26)::bigint END AS scope,
           CASE WHEN pg_input_is_valid(text_value, 'timestamptz')
                THEN text_value::timestamptz END AS revision
    FROM public.system_config WHERE key ~ '^front_page_scope_version:[0-9]+$'
) legacy
WHERE revision IS NOT NULL AND (scope = 0 OR EXISTS (
    SELECT 1 FROM public.system_users WHERE id = scope AND id > 1))
GROUP BY scope
ON CONFLICT (user_id) DO UPDATE SET revision = GREATEST(
    public.system_front_page_revisions.revision, EXCLUDED.revision);
DELETE FROM public.system_config WHERE left(key, 25) = 'front_page_scope_version:';

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'system_front_page_revisions_table', 'completed',
       jsonb_build_object('file', '20261005000030_create_front_page_revision_metadata.sql')
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'system_front_page_revisions_table' AND action = 'completed');
