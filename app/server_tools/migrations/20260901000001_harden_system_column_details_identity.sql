-- 20260901000001_harden_system_column_details_identity.sql
-- Repairs ambiguous generic row identifiers without coupling them to column_uid.
-- Enforces one positive generic row id and one metadata row per physical column.
-- Exists so every create, import, and metadata-refresh path fails closed on ambiguity.
-- VERSION_DB: 9.6.8

LOCK TABLE public.system_column_details IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    id_sequence_name TEXT;
    sequence_last_value BIGINT;
    sequence_is_called BOOLEAN;
    highest_positive_id BIGINT;
    sequence_floor BIGINT;
    invalid_column_uid INTEGER;
    assigned_id BIGINT;
    affected_rows INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.system_column_details
        WHERE column_name IS NULL OR btrim(column_name) = ''
    ) THEN
        RAISE EXCEPTION
            'system_column_details identity hardening aborted: missing column_name';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.system_column_details
        GROUP BY table_uid, column_name
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'system_column_details identity hardening aborted: duplicate table_uid/column_name metadata';
    END IF;

    id_sequence_name := pg_get_serial_sequence(
        'public.system_column_details',
        'id'
    );
    IF id_sequence_name IS NULL THEN
        RAISE EXCEPTION
            'system_column_details identity hardening aborted: id has no owned sequence';
    END IF;

    EXECUTE format(
        'SELECT last_value, is_called FROM %s',
        id_sequence_name::regclass
    )
    INTO sequence_last_value, sequence_is_called;

    SELECT COALESCE(MAX(id) FILTER (WHERE id > 0), 0)
    INTO highest_positive_id
    FROM public.system_column_details;

    sequence_floor := GREATEST(
        highest_positive_id,
        CASE
            WHEN sequence_is_called THEN sequence_last_value
            ELSE sequence_last_value - 1
        END,
        0
    );

    IF sequence_floor = 0 THEN
        PERFORM setval(id_sequence_name::regclass, 1, FALSE);
    ELSE
        PERFORM setval(id_sequence_name::regclass, sequence_floor, TRUE);
    END IF;

    FOR invalid_column_uid IN
        WITH ranked_ids AS (
            SELECT column_uid,
                   id,
                   row_number() OVER (
                       PARTITION BY id
                       ORDER BY column_uid
                   ) AS id_occurrence
            FROM public.system_column_details
        )
        SELECT column_uid
        FROM ranked_ids
        WHERE id IS NULL
           OR id <= 0
           OR id_occurrence > 1
        ORDER BY column_uid
    LOOP
        assigned_id := nextval(id_sequence_name::regclass);
        UPDATE public.system_column_details
        SET id = assigned_id
        WHERE column_uid = invalid_column_uid;

        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows <> 1 THEN
            RAISE EXCEPTION
                'system_column_details identity hardening expected one row for column_uid %, updated %',
                invalid_column_uid,
                affected_rows;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM public.system_column_details
        WHERE id IS NULL OR id <= 0
    ) THEN
        RAISE EXCEPTION
            'system_column_details identity hardening left a null or non-positive id';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.system_column_details
        GROUP BY id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'system_column_details identity hardening left duplicate ids';
    END IF;
END $$;

ALTER TABLE public.system_column_details
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN column_name SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.system_column_details'::regclass
          AND conname = 'ck_system_column_details_positive_id'
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT ck_system_column_details_positive_id
            CHECK (id > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.system_column_details'::regclass
          AND conname = 'uq_system_column_details_id'
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT uq_system_column_details_id UNIQUE (id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.system_column_details'::regclass
          AND conname = 'uq_system_column_details_table_column_name'
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT uq_system_column_details_table_column_name
            UNIQUE (table_uid, column_name);
    END IF;
END $$;

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.8',
       'Hardened system column metadata generic row identities'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.6.8'
);
