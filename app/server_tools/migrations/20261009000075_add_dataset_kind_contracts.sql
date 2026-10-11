-- 20261009000075_add_dataset_kind_contracts.sql
-- Adds versioned kind intent without converting historical schemas or rights.
-- Connects registry table_uid identities with the shared structural resolver.
-- Ordered after 70-74 and before the 20261009000099 release record.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: wl163_dataset_kind_contracts

DO $dataset_kinds$
BEGIN
    ALTER TABLE public.system_db_tables
        ADD COLUMN IF NOT EXISTS table_kind text NOT NULL DEFAULT 'ordinary',
        ADD COLUMN IF NOT EXISTS kind_version integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS kind_config jsonb NOT NULL DEFAULT '{}'::jsonb;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                   WHERE conrelid='public.system_db_tables'::regclass
                     AND conname='system_db_tables_kind_contract_check') THEN
        ALTER TABLE public.system_db_tables ADD CONSTRAINT system_db_tables_kind_contract_check CHECK (
            table_kind IN ('ordinary','embeddings','locations','chat_messages','chat_settings')
            AND kind_version IN (0,1)
            AND (table_kind NOT IN ('chat_messages','chat_settings') OR kind_version=1)
            AND jsonb_typeof(kind_config)='object'
        );
    END IF;

    COMMENT ON COLUMN public.system_db_tables.table_kind IS
        'Declared dataset kind. Legacy ordinary/version 0 is structurally classified by the shared resolver; names never grant Chat.';
    COMMENT ON COLUMN public.system_db_tables.kind_version IS
        '0: historical compatibility without conversion; 1: canonical contract. Unknown or drifting shapes retain generic browsing only.';
    COMMENT ON COLUMN public.system_db_tables.kind_config IS
        'Relationships use table_uid and typed FK columns; vector configuration declares model and dimensions. Structural support grants no permission.';

    INSERT INTO public.system_data_repair_records(migration,action)
    SELECT 'wl163_dataset_kind_contracts','completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                      WHERE migration='wl163_dataset_kind_contracts' AND action='completed');
END $dataset_kinds$;
