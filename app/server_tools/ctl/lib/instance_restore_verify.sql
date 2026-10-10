-- Shared catalogue acceptance; packet callers additionally compare object counts.
DO $$ BEGIN
    IF to_regclass('public.system_db_tables') IS NULL
       OR to_regclass('public.system_db_version') IS NULL
       OR to_regclass('public.system_functions') IS NULL
       OR to_regclass('public.system_group_table_func_rights') IS NULL THEN
        RAISE EXCEPTION 'backup has no complete Filterest catalogue';
    END IF;
END $$;
