-- 20260817000001_add_dataset_embedding_policy_defaults.sql
-- Adds an admin-owned table switch and first-use defaults to the external
-- embedding source policy. Restricted-schema data remains ineligible in code.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

ALTER TABLE public.system_db_tables
    ADD COLUMN IF NOT EXISTS external_embedding_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS external_embedding_policy_configured BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.system_db_tables.external_embedding_enabled IS
    'Admin-owned switch allowing technically eligible selected fields from this public dataset to be sent to the configured external embedding provider.';

COMMENT ON COLUMN public.system_db_tables.external_embedding_policy_configured IS
    'True after an admin has saved the dataset embedding field selection; before that, eligible text fields are presented as selected by default.';

-- Preserve an already used field policy from the previous release. A dataset
-- with at least one selected field was necessarily configured under that API.
UPDATE public.system_db_tables AS tables
SET external_embedding_enabled = TRUE,
    external_embedding_policy_configured = TRUE,
    updated = now()
WHERE EXISTS (
    SELECT 1
    FROM public.system_column_details AS columns
    WHERE columns.table_uid = tables.table_uid
      AND columns.external_embedding_allowed IS TRUE
);

DO $$
DECLARE
    metadata_table_uid INTEGER;
BEGIN
    SELECT table_uid INTO metadata_table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_db_tables'
      AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
    LIMIT 1;

    IF metadata_table_uid IS NOT NULL THEN
        INSERT INTO public.system_column_details (
            table_uid, column_name, data_type, co_number, editable_in_ui, created, updated
        )
        SELECT
            metadata_table_uid,
            columns.column_name,
            columns.data_type,
            columns.ordinal_position,
            FALSE,
            now(),
            now()
        FROM information_schema.columns AS columns
        WHERE columns.table_schema = 'public'
          AND columns.table_name = 'system_db_tables'
          AND columns.column_name IN (
              'external_embedding_enabled',
              'external_embedding_policy_configured'
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.system_column_details AS existing
              WHERE existing.table_uid = metadata_table_uid
                AND existing.column_name = columns.column_name
          )
        ORDER BY columns.ordinal_position;
    END IF;
END $$;

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES
    (
        'embedding_enable_dataset',
        'Salli ulkoiset embeddingit tälle taululle',
        'Enable external embeddings for this table',
        '为此表启用外部嵌入',
        '為此資料表啟用外部嵌入',
        'Admin switch that allows selected, technically eligible public-schema fields from one table to be sent to the configured external embedding provider.'
    ),
    (
        'embedding_external_warning',
        'Kun taulu otetaan käyttöön, sen teknisesti sopivat tekstikentät ovat aluksi valittuina. Poista valinta kentistä, joita et halua lähettää määritetylle ulkoiselle embedding-palvelulle. Restricted-skeeman kenttiä ei voi valita tässä.',
        'When a table is enabled, its technically eligible text fields are initially selected. Clear any fields you do not want sent to the configured external embedding provider. Restricted-schema fields cannot be selected here.',
        '启用表后，技术上适用的文本字段将默认被选中。请取消选择不希望发送到已配置外部嵌入服务的字段。此处无法选择受限架构中的字段。',
        '啟用資料表後，技術上適用嘅文字欄位會預設揀選。請取消揀選唔想傳送到已設定外部嵌入服務嘅欄位。受限制綱要嘅欄位無法喺呢度揀選。',
        'Explanation beside the admin-owned table and field policy for external embedding generation.'
    )
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec;
