-- 20260902000001_add_group_view_field_set_assignments.sql
--
-- Extends reusable per-view field collections with administrator-managed group targets.
-- Keeps one presentation model for personal, group, and site-wide field ordering.
-- Exists so a site default can apply to everyone while selected groups receive narrower overrides.
-- VERSION_DB: 9.6.9

ALTER TABLE public.system_column_details
    ADD COLUMN IF NOT EXISTS client_delivery_mode VARCHAR(32) NOT NULL DEFAULT 'include';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_column_details_client_delivery_mode'
          AND conrelid = 'public.system_column_details'::regclass
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT ck_system_column_details_client_delivery_mode
            CHECK (client_delivery_mode IN ('include', 'server_only'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_column_details_id_client_delivery'
          AND conrelid = 'public.system_column_details'::regclass
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT ck_system_column_details_id_client_delivery
            CHECK (column_name <> 'id' OR client_delivery_mode <> 'server_only');
    END IF;
END $$;

-- Embeddings and full-text vectors remain available to server-side ranking and
-- filtering, but ordinary result projection must not serialize them to clients.
UPDATE public.system_column_details AS details
SET client_delivery_mode = 'server_only',
    updated = now()
FROM public.system_db_tables AS tables
JOIN information_schema.columns AS columns
  ON columns.table_schema = COALESCE(NULLIF(tables.schema_name, ''), 'public')
 AND columns.table_name = tables.table_name
WHERE details.table_uid = tables.table_uid
  AND details.column_name = columns.column_name
  AND details.column_name <> 'id'
  AND (
      columns.udt_name IN ('vector', 'tsvector')
      OR lower(details.column_name) ~ '(^|_)(embedding|embeddings|search_vector)(_|$)'
  );

COMMENT ON COLUMN public.system_column_details.client_delivery_mode IS
    'Client projection contract: include may reach authorized clients; server_only remains available only to backend operations.';

ALTER TABLE public.system_view_field_set_assignments
    ADD COLUMN IF NOT EXISTS group_id BIGINT
        REFERENCES public.system_user_groups(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS group_priority INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.system_view_field_set_assignments
    DROP CONSTRAINT IF EXISTS uq_system_view_field_set_assignment;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_view_field_set_assignment_principal'
          AND conrelid = 'public.system_view_field_set_assignments'::regclass
    ) THEN
        ALTER TABLE public.system_view_field_set_assignments
            ADD CONSTRAINT ck_system_view_field_set_assignment_principal
            CHECK (NOT (user_id IS NOT NULL AND group_id IS NOT NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_view_field_set_assignment_group_priority'
          AND conrelid = 'public.system_view_field_set_assignments'::regclass
    ) THEN
        ALTER TABLE public.system_view_field_set_assignments
            ADD CONSTRAINT ck_system_view_field_set_assignment_group_priority
            CHECK (group_priority BETWEEN -1000000 AND 1000000);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_system_view_field_set_assignment_principal'
          AND conrelid = 'public.system_view_field_set_assignments'::regclass
    ) THEN
        ALTER TABLE public.system_view_field_set_assignments
            ADD CONSTRAINT uq_system_view_field_set_assignment_principal
            UNIQUE NULLS NOT DISTINCT (user_id, group_id, table_uid, view_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_system_view_field_set_assignments_group_lookup
    ON public.system_view_field_set_assignments
        (table_uid, view_id, group_id, group_priority DESC);

COMMENT ON COLUMN public.system_view_field_set_assignments.group_id IS
    'Optional user-group target. NULL user_id and NULL group_id mark the site-wide default.';
COMMENT ON COLUMN public.system_view_field_set_assignments.group_priority IS
    'Deterministic precedence among matching group assignments; higher values win, then the smaller group id.';
COMMENT ON TABLE public.system_view_field_set_assignments IS
    'Active per-view field collection. Resolution order is personal, group, site default, then metadata.';

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('clear_text_search', 'Tyhjennä tekstihaku', 'Clear text search', '清除文本搜索', '清除文字搜尋', 'Accessible label and tooltip for the search-field clear control.'),
        ('client_delivery_mode', 'Toimitus selaimelle', 'Client delivery', '客户端传送', '用戶端傳送', 'Column-level client projection mode in the administration editor.'),
        ('client_delivery_include', 'Lähetä selaimelle', 'Include in client data', '包含在客户端数据中', '包含喺用戶端資料', 'Client delivery mode that permits normal authorized projection.'),
        ('client_delivery_server_only', 'Vain palvelimelle', 'Server only', '仅限服务器', '只限伺服器', 'Client delivery mode that keeps technical data on the backend.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, creation_spec
FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH authored_translations(lang_key, language_code, translation, review_status) AS (
    VALUES
        ('clear_text_search', 'fi', 'Tyhjennä tekstihaku', 'approved'),
        ('clear_text_search', 'en', 'Clear text search', 'approved'),
        ('clear_text_search', 'zh-CN', '清除文本搜索', 'needs_review'),
        ('clear_text_search', 'zh-TW', '清除文字搜尋', 'needs_review'),
        ('clear_text_search', 'zh-HK', '清除文字搜尋', 'needs_review'),
        ('client_delivery_mode', 'fi', 'Toimitus selaimelle', 'approved'),
        ('client_delivery_mode', 'en', 'Client delivery', 'approved'),
        ('client_delivery_mode', 'zh-CN', '客户端传送', 'needs_review'),
        ('client_delivery_mode', 'zh-TW', '用戶端傳送', 'needs_review'),
        ('client_delivery_mode', 'zh-HK', '用戶端傳送', 'needs_review'),
        ('client_delivery_include', 'fi', 'Lähetä selaimelle', 'approved'),
        ('client_delivery_include', 'en', 'Include in client data', 'approved'),
        ('client_delivery_include', 'zh-CN', '包含在客户端数据中', 'needs_review'),
        ('client_delivery_include', 'zh-TW', '包含在用戶端資料中', 'needs_review'),
        ('client_delivery_include', 'zh-HK', '包含喺用戶端資料', 'needs_review'),
        ('client_delivery_server_only', 'fi', 'Vain palvelimelle', 'approved'),
        ('client_delivery_server_only', 'en', 'Server only', 'approved'),
        ('client_delivery_server_only', 'zh-CN', '仅限服务器', 'needs_review'),
        ('client_delivery_server_only', 'zh-TW', '只限伺服器', 'needs_review'),
        ('client_delivery_server_only', 'zh-HK', '只限伺服器', 'needs_review')
), resolved AS (
    SELECT keys.id AS lang_key_id,
           authored.language_code,
           authored.translation,
           authored.review_status
    FROM authored_translations AS authored
    JOIN public.system_lang_keys AS keys ON keys.lang_key = authored.lang_key
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT resolved.lang_key_id,
       resolved.language_code,
       resolved.translation,
       'manual',
       resolved.review_status
FROM resolved
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       sources.source_high,
       '',
       sources.usage_explanation,
       CURRENT_DATE
FROM (
    VALUES
        ('clear_text_search', 'frontend/core_components/filterbar/text_search/dataset_search_component_builder.js', 'Accessible label and tooltip for the text-search clear control.'),
        ('client_delivery_mode', 'frontend/core_components/admin_tools/card_visibility_view.js', 'Column client-delivery mode in the administrator field editor.'),
        ('client_delivery_include', 'frontend/core_components/admin_tools/card_visibility_view.js', 'Client-delivery option that includes authorized field data.'),
        ('client_delivery_server_only', 'frontend/core_components/admin_tools/card_visibility_view.js', 'Client-delivery option that keeps technical field data on the backend.')
) AS sources(lang_key, source_high, usage_explanation)
JOIN public.system_lang_keys AS keys ON keys.lang_key = sources.lang_key
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.9', 'Added group-aware view fields and server-only client projection metadata.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.6.9'
);
