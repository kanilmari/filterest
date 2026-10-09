-- 20261009000003_create_system_dataset_appearance.sql
-- Stores sparse appearance overrides and durable revisions for each dataset.
-- Connects the immutable registry UID with validated per-tab settings persistence.
-- Keeps empty rows after reset; legacy card columns remain authoritative until WL160 slice 3.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: system_dataset_appearance_table
-- FINAL_CHECK: public.app_check_dataset_appearance_storage()

CREATE TABLE IF NOT EXISTS public.system_dataset_appearance (
    table_uid integer PRIMARY KEY REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    schema_version integer NOT NULL DEFAULT 1,
    overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
    revision bigint NOT NULL DEFAULT 1,
    CONSTRAINT ck_system_dataset_appearance_schema_version CHECK (schema_version = 1),
    CONSTRAINT ck_system_dataset_appearance_object CHECK (jsonb_typeof(overrides) = 'object'),
    CONSTRAINT ck_system_dataset_appearance_no_null CHECK (NOT jsonb_path_exists(overrides, '$.* ? (@ == null)')),
    CONSTRAINT ck_system_dataset_appearance_revision CHECK (revision > 0)
);
COMMENT ON TABLE public.system_dataset_appearance IS
    'Private per-dataset appearance overrides; never a registered dataset. Dedicated validated writes only; no rendering consumer until WL160 cutover.';
COMMENT ON COLUMN public.system_dataset_appearance.table_uid IS
    'Immutable dataset identity: renaming preserves the row; deleting the dataset cascades it.';
COMMENT ON COLUMN public.system_dataset_appearance.overrides IS
    'Sparse canonical-path map. Presence is an explicit override, including zero, false or equality with shared values. Null is invalid. Keep the row when this map becomes empty.';
COMMENT ON COLUMN public.system_dataset_appearance.revision IS
    'Positive monotonically increasing save revision; an empty map retains its last revision.';
REVOKE ALL ON public.system_dataset_appearance FROM PUBLIC;

-- The bootstrap runs this again after every seed before accepting its ledger.
-- Test physical protections rather than treating a completion marker as proof.
CREATE OR REPLACE FUNCTION public.app_check_dataset_appearance_storage()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $check$
    SELECT 'dataset appearance storage must have exactly four non-null columns'
     WHERE (SELECT count(*) FROM pg_attribute
             WHERE attrelid = 'public.system_dataset_appearance'::regclass
               AND attnum > 0 AND NOT attisdropped AND attnotnull) <> 4
        OR (SELECT count(*) FROM pg_attribute
             WHERE attrelid = 'public.system_dataset_appearance'::regclass
               AND attnum > 0 AND NOT attisdropped) <> 4
    UNION ALL
    SELECT 'dataset appearance storage requires its primary key, cascading UID and four validated checks'
     WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'public.system_dataset_appearance'::regclass AND contype = 'p'
                          AND pg_get_constraintdef(oid) = 'PRIMARY KEY (table_uid)')
        OR NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'public.system_dataset_appearance'::regclass AND contype = 'f'
                          AND confrelid = 'public.system_db_tables'::regclass AND confdeltype = 'c'
                          AND pg_get_constraintdef(oid) = 'FOREIGN KEY (table_uid) REFERENCES system_db_tables(table_uid) ON DELETE CASCADE')
        OR (SELECT count(*) FROM pg_constraint
             WHERE conrelid = 'public.system_dataset_appearance'::regclass AND contype = 'c' AND convalidated
               AND (conname, pg_get_constraintdef(oid)) IN (
                   ('ck_system_dataset_appearance_schema_version', 'CHECK ((schema_version = 1))'),
                   ('ck_system_dataset_appearance_object', 'CHECK ((jsonb_typeof(overrides) = ''object''::text))'),
                   ('ck_system_dataset_appearance_no_null',
                    'CHECK ((NOT jsonb_path_exists(overrides, ''$.*?(@ == null)''::jsonpath)))'),
                   ('ck_system_dataset_appearance_revision', 'CHECK ((revision > 0))'))) <> 4
    UNION ALL
    SELECT 'dataset appearance storage must not be registered for generic browsing'
     WHERE EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_name = 'system_dataset_appearance');
$check$;

-- An upgrade cannot rely on the bootstrap's repeated check: CREATE TABLE IF NOT EXISTS keeps a pre-existing table as
-- it is, so refuse here, before recording completion, inside the runner's transaction.
DO $acceptance$
DECLARE
    findings text;
BEGIN
    SELECT string_agg(finding, '; ') INTO findings
      FROM public.app_check_dataset_appearance_storage() AS finding;
    IF findings IS NOT NULL THEN
        RAISE EXCEPTION 'dataset appearance storage final check refused: %', findings;
    END IF;
END $acceptance$;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'system_dataset_appearance_table', 'completed',
       jsonb_build_object('file', '20261009000003_create_system_dataset_appearance.sql')
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'system_dataset_appearance_table' AND action = 'completed');
