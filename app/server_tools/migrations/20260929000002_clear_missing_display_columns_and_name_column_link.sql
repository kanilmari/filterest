-- 20260929000002_clear_missing_display_columns_and_name_column_link.sql
-- Clears dataset display-column settings that name a column the dataset does
-- not have, and gives the column-metadata link its canonical name where an
-- installation received the name PostgreSQL generates.
-- Bridges the display-column setting of the dataset registry
-- (system_db_tables.fk_display_column) with the reader that picks the readable
-- column shown beside a reference (dtt_utils.ResolveFKDisplayColumn).
-- Exists because the public install seed gave system_table_views the setting
-- view_name, a column that table has never had. The reader ignores such a
-- setting and chooses by its ordinary rules, so clearing it changes no view:
-- it only stops the warning the reader writes to the log every time it looks.
-- The public install schema also declared the column-metadata link without a
-- name, so a site installed from it carries system_column_details_table_uid_fkey
-- where every other site carries fk_system_column_details_table_uid. The rule is
-- the same; only the name differs, and two databases reporting the same version
-- should not differ even in that. The install sources now state both correctly.
-- Running the file again changes nothing. A link of the generated name that
-- states a different rule stops the update instead of being renamed in silence.
-- VERSION_DB: 9.9.1
-- VERSION_DB_OWNER: 20260929000003_record_database_release_9_9_1.sql

DO $$
DECLARE
    cleared text;
BEGIN
    WITH stale AS (
        UPDATE public.system_db_tables AS registry
           SET fk_display_column = NULL,
               updated = now()
         WHERE COALESCE(registry.fk_display_column, '') <> ''
           AND to_regclass(format('%I.%I',
                   COALESCE(NULLIF(registry.schema_name, ''), 'public'),
                   registry.table_name)) IS NOT NULL
           AND NOT EXISTS (
                 SELECT 1
                   FROM pg_catalog.pg_attribute AS a
                  WHERE a.attrelid = to_regclass(format('%I.%I',
                            COALESCE(NULLIF(registry.schema_name, ''), 'public'),
                            registry.table_name))
                    AND a.attname = registry.fk_display_column
                    AND a.attnum > 0
                    AND NOT a.attisdropped)
        RETURNING registry.table_name
    )
    SELECT string_agg(table_name, ', ' ORDER BY table_name) INTO cleared FROM stale;
    RAISE NOTICE 'display-column settings naming a missing column cleared: %',
        COALESCE(cleared, 'none');
END
$$;

DO $$
DECLARE
    child  oid := to_regclass('public.system_column_details');
    parent oid := to_regclass('public.system_db_tables');
    child_attnum  smallint;
    parent_attnum smallint;
    generated record;
BEGIN
    IF child IS NULL OR parent IS NULL THEN
        RAISE EXCEPTION 'column-metadata link: public.system_column_details or public.system_db_tables is missing';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                WHERE conrelid = child AND conname = 'fk_system_column_details_table_uid') THEN
        RETURN;
    END IF;

    SELECT c.confrelid, c.conkey, c.confkey, c.confupdtype, c.confdeltype,
           c.confmatchtype, c.condeferrable, c.condeferred, c.convalidated,
           pg_catalog.pg_get_constraintdef(c.oid) AS definition
      INTO generated
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = child
       AND c.conname = 'system_column_details_table_uid_fkey'
       AND c.contype = 'f';
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT attnum INTO child_attnum FROM pg_catalog.pg_attribute
     WHERE attrelid = child AND attname = 'table_uid' AND attnum > 0 AND NOT attisdropped;
    SELECT attnum INTO parent_attnum FROM pg_catalog.pg_attribute
     WHERE attrelid = parent AND attname = 'table_uid' AND attnum > 0 AND NOT attisdropped;

    IF generated.confrelid = parent
       AND generated.conkey = ARRAY[child_attnum]
       AND generated.confkey = ARRAY[parent_attnum]
       AND generated.confupdtype = 'a'::"char"
       AND generated.confdeltype = 'c'::"char"
       AND generated.confmatchtype = 's'::"char"
       AND NOT generated.condeferrable
       AND NOT generated.condeferred
       AND generated.convalidated
    THEN
        ALTER TABLE public.system_column_details
            RENAME CONSTRAINT system_column_details_table_uid_fkey
            TO fk_system_column_details_table_uid;
        RAISE NOTICE 'column-metadata link renamed to fk_system_column_details_table_uid';
    ELSE
        RAISE EXCEPTION
            'system_column_details_table_uid_fkey states a different rule: %; this update expects FOREIGN KEY (table_uid) REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE',
            generated.definition;
    END IF;
END
$$;
