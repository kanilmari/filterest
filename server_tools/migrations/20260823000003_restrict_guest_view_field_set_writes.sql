-- 20260823000003_restrict_guest_view_field_set_writes.sql
-- Removes write privileges accidentally granted to the public guest role for view field collections.
-- Keeps guest reads available so public datasets can inherit administrator-managed site defaults.
-- Exists as a new immutable repair because the original 9.5.0 grant migration has already been applied.
-- VERSION_DB: 9.6.1

DO $$
BEGIN
    IF to_regclass('public.system_column_field_sets') IS NULL
       OR to_regclass('public.system_column_field_set_members') IS NULL
       OR to_regclass('public.system_view_field_set_assignments') IS NULL
       OR to_regclass('public.system_column_field_sets_id_seq') IS NULL
       OR to_regclass('public.system_view_field_set_assignments_id_seq') IS NULL THEN
        RAISE EXCEPTION 'view field collection tables or sequences are missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.system_column_field_sets WHERE owner_user_id = 1
    ) OR EXISTS (
        SELECT 1 FROM public.system_view_field_set_assignments WHERE user_id = 1
    ) THEN
        RAISE EXCEPTION 'guest-owned view field collection data must be reviewed before permission repair';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_system_column_field_sets_no_guest_owner'
          AND conrelid = 'public.system_column_field_sets'::regclass
    ) THEN
        ALTER TABLE public.system_column_field_sets
            ADD CONSTRAINT chk_system_column_field_sets_no_guest_owner
            CHECK (owner_user_id IS NULL OR owner_user_id <> 1);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_system_view_field_set_assignments_no_guest_user'
          AND conrelid = 'public.system_view_field_set_assignments'::regclass
    ) THEN
        ALTER TABLE public.system_view_field_set_assignments
            ADD CONSTRAINT chk_system_view_field_set_assignments_no_guest_user
            CHECK (user_id IS NULL OR user_id <> 1);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guest_user') THEN
        REVOKE ALL PRIVILEGES ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        FROM guest_user;

        GRANT SELECT ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO guest_user;

        REVOKE ALL PRIVILEGES ON SEQUENCE
            public.system_column_field_sets_id_seq,
            public.system_view_field_set_assignments_id_seq
        FROM guest_user;
    END IF;
END $$;

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.1', 'Restricted guest view field collection privileges to read-only access'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.6.1'
);
