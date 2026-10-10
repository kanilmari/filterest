-- Generated from schema_info.csv by filterest/app/testing/essential/generate_dummy_test_database.py
-- This is a curated boot-focused schema skeleton, not a full production dump.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.system_user_groups (
    id bigint,
    name character varying,
    created timestamp with time zone,
    updated timestamp with time zone,
    creation_spec text
);

CREATE TABLE public.system_users (
    id bigint,
    username character varying,
    full_name character varying,
    created timestamp with time zone,
    updated timestamp with time zone,
    enabled boolean,
    privileged boolean,
    main_group_id integer,
    creation_spec text,
    bio_social_medias text,
    website character varying,
    search_vector_simple tsvector,
    admin_access_allowed boolean
);

CREATE TABLE public.system_user_group_memberships (
    user_id integer,
    group_id integer,
    created timestamp without time zone,
    updated timestamp without time zone,
    id bigint,
    creation_spec text,
    search_vector_simple tsvector
);

CREATE TABLE public.system_table_folders (
    id bigint,
    folder_name character varying,
    folder_description character varying,
    created date,
    updated date,
    parent_id integer,
    creation_spec text,
    is_current_project boolean,
    admin_user_id bigint,
    tab_order_json jsonb
);

CREATE TABLE public.system_db_tables (
    id bigint,
    table_name character varying,
    description character varying,
    table_uid integer NOT NULL,
    cached_oid integer,
    folder_id integer,
    created timestamp without time zone,
    updated timestamp without time zone,
    creation_spec text,
    default_view_id integer,
    schema_name character varying,
    search_vector_simple tsvector,
    multi_lang_embeddings boolean,
    is_default boolean,
    filterbar_visible_by_default boolean,
    is_removable boolean,
    ui_hidden boolean DEFAULT false NOT NULL,
    new_columns_multilingual boolean,
    is_main_table boolean,
    is_about_table boolean,
    fk_display_column character varying,
    icon_key character varying,
    display_name text,
    search_slogan text,
    search_placeholder text,
    sql_dump_policy character varying,
    card_details_layout character varying,
    card_style_variant character varying,
    card_detail_columns smallint CONSTRAINT system_db_tables_card_detail_columns_range CHECK (card_detail_columns BETWEEN 1 AND 4),
    article_section_initial_open jsonb DEFAULT '{}'::jsonb NOT NULL CONSTRAINT system_db_tables_article_section_initial_open_object CHECK (jsonb_typeof(article_section_initial_open) = 'object'),
    row_policy_owner_column character varying
);

CREATE TABLE public.system_functions (
    id bigint,
    name character varying,
    disabled boolean,
    created timestamp without time zone,
    updated timestamp without time zone,
    package character varying,
    specific_table_related boolean,
    creation_spec text,
    rate_limit_amount integer,
    rate_limit_minutes integer,
    url_route_endpoint character varying,
    ui_only boolean,
    search_vector_simple tsvector
);

CREATE TABLE public.system_config (
    id bigint,
    key character varying,
    json_value jsonb,
    created timestamp without time zone,
    updated timestamp without time zone,
    creation_spec text,
    boolean_value boolean,
    text_value text,
    int_value integer,
    value_type integer,
    search_vector_simple tsvector
);









-- Public runtime compatibility patch.
-- The essential fixture schema is deliberately small; these tables/defaults
-- let a generated Filterest checkout boot independently without private data.
CREATE SEQUENCE IF NOT EXISTS public.system_functions_id_seq START WITH 10000;
ALTER TABLE public.system_functions ALTER COLUMN id SET DEFAULT nextval('public.system_functions_id_seq'::regclass);
ALTER TABLE public.system_functions ADD CONSTRAINT system_functions_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS system_functions_name_key ON public.system_functions (name);

CREATE SEQUENCE IF NOT EXISTS public.system_users_id_seq START WITH 10000;
ALTER TABLE public.system_users ALTER COLUMN id SET DEFAULT nextval('public.system_users_id_seq'::regclass);
ALTER TABLE public.system_users ADD CONSTRAINT system_users_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS system_users_username_key ON public.system_users (username);

CREATE SCHEMA IF NOT EXISTS restricted;

CREATE TABLE IF NOT EXISTS restricted.users_restricted (
    id integer NOT NULL,
    login_name text NOT NULL,
    api_only boolean NOT NULL DEFAULT false,
    password text NOT NULL,
    email text NOT NULL,
    login_verification_method text NOT NULL DEFAULT 'email'
        CHECK (login_verification_method IN ('none', 'fixed_pin', 'totp', 'email')),
    fixed_pin_hash text,
    totp_secret text,
    CONSTRAINT user_data_pk PRIMARY KEY (id),
    CONSTRAINT uq_users_restricted_email UNIQUE (email),
    CONSTRAINT user_data_fk FOREIGN KEY (id) REFERENCES public.system_users(id) ON DELETE CASCADE,
    CONSTRAINT users_restricted_login_factor_shape_check CHECK (
        (login_verification_method = 'fixed_pin' AND fixed_pin_hash IS NOT NULL AND totp_secret IS NULL)
        OR (login_verification_method = 'totp' AND totp_secret IS NOT NULL AND fixed_pin_hash IS NULL)
        OR (login_verification_method IN ('none', 'email') AND fixed_pin_hash IS NULL AND totp_secret IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS restricted.verification_codes (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL,
    purpose character varying(50) NOT NULL,
    code_hash character varying(128) NOT NULL,
    target_email character varying(255) NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_codes_user_purpose
    ON restricted.verification_codes (user_id, purpose);

CREATE TABLE IF NOT EXISTS restricted.otp_send_events (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.system_users(id) ON DELETE CASCADE,
    purpose character varying(50) NOT NULL,
    requested_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_otp_send_events_user_purpose_requested
    ON restricted.otp_send_events (user_id, purpose, requested_at);

ALTER TABLE public.system_user_groups ADD CONSTRAINT system_user_groups_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS system_user_groups_name_key ON public.system_user_groups (name);

CREATE SEQUENCE IF NOT EXISTS public.system_user_group_memberships_id_seq START WITH 10000;
ALTER TABLE public.system_user_group_memberships ALTER COLUMN id SET DEFAULT nextval('public.system_user_group_memberships_id_seq'::regclass);
ALTER TABLE public.system_user_group_memberships ADD CONSTRAINT system_user_group_memberships_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS system_user_group_memberships_user_group_key
    ON public.system_user_group_memberships (user_id, group_id);

CREATE SEQUENCE IF NOT EXISTS public.system_config_id_seq START WITH 10000;
ALTER TABLE public.system_config ALTER COLUMN id SET DEFAULT nextval('public.system_config_id_seq'::regclass);
ALTER TABLE public.system_config ADD CONSTRAINT system_config_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS system_config_key_key ON public.system_config (key);

CREATE SEQUENCE IF NOT EXISTS public.system_db_tables_id_seq START WITH 10000;
ALTER TABLE public.system_db_tables ALTER COLUMN id SET DEFAULT nextval('public.system_db_tables_id_seq'::regclass);
CREATE SEQUENCE IF NOT EXISTS public.system_db_tables_table_uid_seq START WITH 10000;
ALTER TABLE public.system_db_tables ALTER COLUMN table_uid SET DEFAULT nextval('public.system_db_tables_table_uid_seq'::regclass);
ALTER TABLE public.system_db_tables ALTER COLUMN multi_lang_embeddings SET DEFAULT FALSE;
ALTER TABLE public.system_db_tables ALTER COLUMN is_default SET DEFAULT FALSE;
ALTER TABLE public.system_db_tables ALTER COLUMN is_default SET NOT NULL;
ALTER TABLE public.system_db_tables ALTER COLUMN filterbar_visible_by_default SET DEFAULT FALSE;
ALTER TABLE public.system_db_tables ALTER COLUMN filterbar_visible_by_default SET NOT NULL;
ALTER TABLE public.system_db_tables ALTER COLUMN is_removable SET DEFAULT TRUE;
ALTER TABLE public.system_db_tables ALTER COLUMN is_main_table SET DEFAULT FALSE;
ALTER TABLE public.system_db_tables ALTER COLUMN is_about_table SET DEFAULT FALSE;
ALTER TABLE public.system_db_tables ALTER COLUMN sql_dump_policy SET DEFAULT 'all';
ALTER TABLE public.system_db_tables ALTER COLUMN card_details_layout SET DEFAULT 'conditional_multiline';
-- NULL card style inherits the site presentation default.
ALTER TABLE public.system_db_tables ADD CONSTRAINT system_db_tables_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS system_db_tables_table_uid_key ON public.system_db_tables (table_uid);
CREATE UNIQUE INDEX IF NOT EXISTS system_db_tables_schema_table_key ON public.system_db_tables (schema_name, table_name);

CREATE SEQUENCE IF NOT EXISTS public.system_table_folders_id_seq START WITH 10000;
ALTER TABLE public.system_table_folders ALTER COLUMN id SET DEFAULT nextval('public.system_table_folders_id_seq'::regclass);
ALTER TABLE public.system_table_folders ADD CONSTRAINT system_table_folders_pkey PRIMARY KEY (id);
ALTER TABLE public.system_table_folders ALTER COLUMN folder_name SET NOT NULL;
ALTER TABLE public.system_table_folders ALTER COLUMN created SET DEFAULT CURRENT_DATE;
ALTER TABLE public.system_table_folders ALTER COLUMN created SET NOT NULL;
ALTER TABLE public.system_table_folders ALTER COLUMN updated SET DEFAULT CURRENT_DATE;
ALTER TABLE public.system_table_folders ALTER COLUMN updated SET NOT NULL;
ALTER TABLE public.system_table_folders ALTER COLUMN is_current_project SET DEFAULT FALSE;
ALTER TABLE public.system_table_folders ALTER COLUMN is_current_project SET NOT NULL;
ALTER TABLE public.system_table_folders ALTER COLUMN tab_order_json SET DEFAULT '[]'::jsonb;
ALTER TABLE public.system_table_folders ALTER COLUMN tab_order_json SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.system_lang_keys (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    fi text,
    en text,
    lang_key text UNIQUE,
    created timestamp without time zone DEFAULT now() NOT NULL,
    updated timestamp without time zone DEFAULT now() NOT NULL,
    creation_spec text,
    ch text,
    yue text,
    lang_key_type integer,
    search_vector_simple tsvector
);

CREATE TABLE IF NOT EXISTS public.system_lang_keys_archive (
    original_id bigint NOT NULL,
    lang_key text NOT NULL,
    fi text,
    en text,
    ch text,
    yue text,
    lang_key_type integer,
    creation_spec text,
    original_created timestamp,
    original_updated timestamp,
    archived_at timestamp with time zone DEFAULT now(),
    orphan_since date
);
CREATE INDEX IF NOT EXISTS idx_lang_keys_archive_key
    ON public.system_lang_keys_archive (lang_key);

CREATE TABLE IF NOT EXISTS public.system_lang_key_sources (
    source_type text NOT NULL,
    source_high text NOT NULL,
    source_low text DEFAULT ''::text,
    last_seen date,
    lang_key_id integer NOT NULL,
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    usage_explanation text DEFAULT ''::text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS system_lang_key_sources_unique_source
    ON public.system_lang_key_sources (lang_key_id, source_type, source_high);

CREATE TABLE IF NOT EXISTS public.system_group_table_func_rights (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_group_id integer NOT NULL,
    function_id integer NOT NULL,
    target_schema_name text DEFAULT 'public'::text,
    creation_spec text,
    target_table_uid integer,
    search_vector_simple tsvector
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_func_rights_group_func_table
    ON public.system_group_table_func_rights (user_group_id, function_id, COALESCE(target_table_uid, 0));

CREATE TABLE IF NOT EXISTS public.system_column_details (
    co_number integer,
    column_name text NOT NULL,
    column_uid integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id integer GENERATED BY DEFAULT AS IDENTITY,
    table_uid integer NOT NULL CONSTRAINT fk_system_column_details_table_uid REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    column_label text,
    editable_in_ui boolean DEFAULT true,
    created timestamp without time zone DEFAULT now() NOT NULL,
    updated timestamp without time zone DEFAULT now() NOT NULL,
    data_type character varying(255),
    card_element character varying(255) DEFAULT 'details',
    creation_spec text,
    show_key_on_card boolean,
    mandatory boolean,
    show_value_on_card boolean DEFAULT true,
    insert_expln_langkey character varying(128),
    lang_key character varying(128),
    insertable boolean,
    must_be_true_unless_own boolean,
    hide_everywhere boolean,
    hide_on_small_card boolean,
    hide_false_null_on_sml_crd boolean,
    hide_false_null_on_big_crd boolean,
    hide_on_bg_crd_if_not_own boolean,
    hide_in_filter_panel boolean,
    search_vector_simple tsvector,
    fco_number integer,
    sco_number integer,
    is_multilingual boolean DEFAULT false NOT NULL,
    card_detail_icon_svg text,
    card_detail_label_mode character varying(16) DEFAULT 'label' NOT NULL,
    card_detail_icon_key character varying(64),
    card_detail_capitalization boolean DEFAULT true,
    CONSTRAINT ck_system_column_details_positive_id CHECK (id > 0),
    CONSTRAINT uq_system_column_details_id UNIQUE (id),
    CONSTRAINT uq_system_column_details_table_column_name
        UNIQUE (table_uid, column_name)
);

CREATE TABLE IF NOT EXISTS public.system_column_control (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_uid integer,
    column_uid integer,
    visible boolean DEFAULT true,
    sort_order integer,
    created timestamp without time zone DEFAULT now(),
    updated timestamp without time zone DEFAULT now(),
    search_vector_simple tsvector
);

CREATE TABLE IF NOT EXISTS public.system_foreign_key_relations_1_m (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    target_column_name text,
    source_column_name text,
    reference_direction text,
    insert_new_source_with_target boolean DEFAULT true NOT NULL,
    created timestamp with time zone DEFAULT now() NOT NULL,
    updated timestamp with time zone DEFAULT now() NOT NULL,
    insert_new_target_with_source boolean,
    target_insert_specs jsonb,
    source_insert_specs jsonb,
    cached_name_col_in_src character varying,
    name_col_in_tgt character varying,
    source_table_uid integer,
    target_table_uid integer,
    search_vector_simple tsvector
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fk_1m_relation
    ON public.system_foreign_key_relations_1_m (source_table_uid, target_table_uid, source_column_name, target_column_name);

CREATE TABLE IF NOT EXISTS public.system_foreign_key_relations_m_m (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    bridging_table_name text,
    bridging_col_a text,
    bridging_col_b text,
    table_a_column text,
    table_b_column text,
    insert_new_source_with_target boolean DEFAULT false NOT NULL,
    table_a_uid integer,
    table_b_uid integer,
    bridging_table_uid integer,
    created timestamp without time zone DEFAULT now(),
    updated timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fk_mm_relation
    ON public.system_foreign_key_relations_m_m (table_a_uid, table_b_uid, bridging_table_uid);

CREATE TABLE IF NOT EXISTS public.system_table_row_view_counts (
    viewed_by_user_id integer NOT NULL,
    table_uid integer NOT NULL,
    row_id integer NOT NULL,
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    created timestamp with time zone DEFAULT now() NOT NULL,
    updated timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.system_transaction_log (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    method character varying(16) NOT NULL,
    user_id bigint,
    username character varying(64),
    success boolean NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector_simple tsvector,
    function_id integer
);
CREATE INDEX IF NOT EXISTS idx_system_transaction_log_success
    ON public.system_transaction_log (success);
CREATE INDEX IF NOT EXISTS idx_system_transaction_log_user_id
    ON public.system_transaction_log (user_id);

CREATE TABLE IF NOT EXISTS public.system_audit_log (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer,
    username text,
    handler_name text NOT NULL,
    http_method text NOT NULL,
    url_path text NOT NULL,
    table_name text,
    operation_type text,
    success boolean DEFAULT true NOT NULL,
    ip_address inet,
    duration_ms integer,
    details jsonb
);
-- runtime.schema.sql
-- Defines the public-safe tables required before Filterest serves its first authenticated page.
-- Bridges the reduced essential fixture schema and backend startup/browser runtime dependencies.
-- Exists so generated siblings fail during bootstrap instead of returning recurring HTTP 500 errors.

ALTER TABLE restricted.users_restricted
    ADD COLUMN IF NOT EXISTS authentication_generation bigint NOT NULL DEFAULT 1;

-- A generated bootstrap is already at the schema state represented by the
-- migration files shipped with it. The matching seed records that immutable
-- source-hashed bootstrap baseline so an unrestricted first startup executes
-- only newly added migrations. Baseline hashes never claim SQL execution.
-- The tracked evidence migration owns the outcome/provenance constraints.
CREATE TABLE IF NOT EXISTS public.system_schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamp with time zone DEFAULT now(),
    content_sha256 text,
    outcome text,
    provenance text
);

-- Account-owned appearance preferences are read during every authenticated
-- browser bootstrap. Keep this table in the baseline itself because the
-- matching migration is recorded as already applied on a fresh installation.
CREATE TABLE IF NOT EXISTS public.system_user_visual_preferences (
    user_id integer PRIMARY KEY
        REFERENCES public.system_users(id) ON DELETE CASCADE,
    theme_mode text,
    schema_version smallint NOT NULL DEFAULT 1,
    revision bigint NOT NULL DEFAULT 1,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_user_visual_preferences_theme_mode
        CHECK (theme_mode IS NULL OR theme_mode IN ('system', 'dark', 'light')),
    CONSTRAINT ck_system_user_visual_preferences_schema_version
        CHECK (schema_version = 1),
    CONSTRAINT ck_system_user_visual_preferences_revision
        CHECK (revision >= 1)
);

CREATE OR REPLACE FUNCTION public.set_system_user_visual_preferences_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_system_user_visual_preferences_timestamp
    ON public.system_user_visual_preferences;
CREATE TRIGGER update_system_user_visual_preferences_timestamp
BEFORE UPDATE ON public.system_user_visual_preferences
FOR EACH ROW EXECUTE FUNCTION public.set_system_user_visual_preferences_updated_timestamp();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_restricted_authentication_generation_positive'
          AND conrelid = 'restricted.users_restricted'::regclass
    ) THEN
        ALTER TABLE restricted.users_restricted
            ADD CONSTRAINT users_restricted_authentication_generation_positive
            CHECK (authentication_generation >= 1);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.system_table_views (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    kuvaus character varying(255),
    name character varying(128),
    status character varying(255),
    view_key text NOT NULL UNIQUE
        CHECK (view_key ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE TABLE IF NOT EXISTS public.system_child_tab_config (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    parent_table text NOT NULL,
    tab_key text NOT NULL,
    tab_order integer NOT NULL DEFAULT 0,
    hidden boolean NOT NULL DEFAULT false,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (parent_table, tab_key)
);

CREATE OR REPLACE FUNCTION public.set_system_child_tab_config_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_system_child_tab_config_timestamp
    ON public.system_child_tab_config;
CREATE TRIGGER update_system_child_tab_config_timestamp
BEFORE UPDATE ON public.system_child_tab_config
FOR EACH ROW EXECUTE FUNCTION public.set_system_child_tab_config_updated_timestamp();

CREATE TABLE IF NOT EXISTS public.system_comments (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_name text NOT NULL,
    row_id integer NOT NULL,
    comment_text text NOT NULL
        CHECK (char_length(comment_text) BETWEEN 1 AND 5000),
    created_by integer REFERENCES public.system_users(id) ON DELETE SET NULL,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_comments_lookup
    ON public.system_comments (table_name, row_id, created DESC);

CREATE OR REPLACE FUNCTION public.set_system_comments_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_system_comments_timestamp
    ON public.system_comments;
CREATE TRIGGER update_system_comments_timestamp
BEFORE UPDATE ON public.system_comments
FOR EACH ROW EXECUTE FUNCTION public.set_system_comments_updated_timestamp();

CREATE TABLE IF NOT EXISTS public.system_row_groups (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    title jsonb NOT NULL CHECK (jsonb_typeof(title) = 'object' AND title <> '{}'::jsonb),
    description jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(description) = 'object'),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -100000 AND 100000),
    enabled boolean NOT NULL DEFAULT true,
    created_by bigint REFERENCES public.system_users(id) ON DELETE SET NULL,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_row_group_memberships (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    group_id bigint NOT NULL REFERENCES public.system_row_groups(id) ON DELETE CASCADE,
    table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    row_id bigint NOT NULL CHECK (row_id > 0),
    target_stable_key text,
    created_by bigint REFERENCES public.system_users(id) ON DELETE SET NULL,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT uq_system_row_group_membership UNIQUE (group_id, table_uid, row_id),
    CONSTRAINT ck_system_row_group_memberships_stable_key
        CHECK (target_stable_key IS NULL OR char_length(btrim(target_stable_key)) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_system_row_group_memberships_row
    ON public.system_row_group_memberships (table_uid, row_id, group_id);
CREATE INDEX IF NOT EXISTS idx_system_row_group_memberships_stable_key
    ON public.system_row_group_memberships (table_uid, target_stable_key)
    WHERE target_stable_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_row_group_memberships_stable_key
    ON public.system_row_group_memberships (group_id, table_uid, target_stable_key)
    WHERE target_stable_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_system_row_groups_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_system_row_group_memberships_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_system_row_groups_timestamp
    ON public.system_row_groups;
CREATE TRIGGER update_system_row_groups_timestamp
BEFORE UPDATE ON public.system_row_groups
FOR EACH ROW EXECUTE FUNCTION public.set_system_row_groups_updated_timestamp();

DROP TRIGGER IF EXISTS update_system_row_group_memberships_timestamp
    ON public.system_row_group_memberships;
CREATE TRIGGER update_system_row_group_memberships_timestamp
BEFORE UPDATE ON public.system_row_group_memberships
FOR EACH ROW EXECUTE FUNCTION public.set_system_row_group_memberships_updated_timestamp();

CREATE TABLE IF NOT EXISTS public.system_column_field_sets (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    owner_user_id bigint REFERENCES public.system_users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 128),
    created_by bigint REFERENCES public.system_users(id) ON DELETE SET NULL,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT chk_system_column_field_sets_no_guest_owner
        CHECK (owner_user_id IS NULL OR owner_user_id <> 1),
    CONSTRAINT uq_system_column_field_sets_owner_name
        UNIQUE NULLS NOT DISTINCT (table_uid, owner_user_id, name),
    CONSTRAINT uq_system_column_field_sets_id_table UNIQUE (id, table_uid)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_column_details_table_column
    ON public.system_column_details (table_uid, column_uid);

CREATE TABLE IF NOT EXISTS public.system_column_field_set_members (
    field_set_id bigint NOT NULL,
    table_uid integer NOT NULL,
    column_uid integer NOT NULL,
    sort_order integer NOT NULL CHECK (sort_order > 0),
    column_width_px integer CHECK (column_width_px IS NULL OR column_width_px >= 0),
    PRIMARY KEY (field_set_id, column_uid),
    CONSTRAINT uq_system_column_field_set_member_order UNIQUE (field_set_id, sort_order),
    CONSTRAINT fk_system_column_field_set_members_set
        FOREIGN KEY (field_set_id, table_uid)
        REFERENCES public.system_column_field_sets(id, table_uid) ON DELETE CASCADE,
    CONSTRAINT fk_system_column_field_set_members_column
        FOREIGN KEY (table_uid, column_uid)
        REFERENCES public.system_column_details(table_uid, column_uid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.system_view_field_set_assignments (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id bigint REFERENCES public.system_users(id) ON DELETE CASCADE,
    table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    view_id integer NOT NULL REFERENCES public.system_table_views(id) ON DELETE CASCADE,
    field_set_id bigint NOT NULL,
    created_by bigint REFERENCES public.system_users(id) ON DELETE SET NULL,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT chk_system_view_field_set_assignments_no_guest_user
        CHECK (user_id IS NULL OR user_id <> 1),
    CONSTRAINT uq_system_view_field_set_assignment
        UNIQUE NULLS NOT DISTINCT (user_id, table_uid, view_id),
    CONSTRAINT fk_system_view_field_set_assignment_set
        FOREIGN KEY (field_set_id, table_uid)
        REFERENCES public.system_column_field_sets(id, table_uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_system_column_field_sets_table_owner
    ON public.system_column_field_sets (table_uid, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_system_view_field_set_assignments_lookup
    ON public.system_view_field_set_assignments (table_uid, view_id, user_id);

CREATE TABLE IF NOT EXISTS public.system_dataset_sort_defaults (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    user_id integer REFERENCES public.system_users(id) ON DELETE CASCADE,
    sort_column text NOT NULL CHECK (btrim(sort_column) <> ''),
    sort_direction text NOT NULL CHECK (sort_direction IN ('ASC', 'DESC')),
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (table_uid, user_id)
);

CREATE INDEX IF NOT EXISTS idx_system_dataset_sort_defaults_user
    ON public.system_dataset_sort_defaults (user_id, table_uid)
    WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_system_dataset_sort_defaults_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_system_dataset_sort_defaults_timestamp
    ON public.system_dataset_sort_defaults;
CREATE TRIGGER update_system_dataset_sort_defaults_timestamp
BEFORE UPDATE ON public.system_dataset_sort_defaults
FOR EACH ROW EXECUTE FUNCTION public.set_system_dataset_sort_defaults_updated_timestamp();

CREATE TABLE IF NOT EXISTS public.system_dataset_media (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    media_role text NOT NULL CHECK (media_role IN ('cover', 'background')),
    storage_key text NOT NULL CHECK (btrim(storage_key) <> '' AND storage_key !~ '(^|/)\.\.(/|$)'),
    original_name text NOT NULL,
    mime_type text NOT NULL,
    alt_text jsonb NOT NULL DEFAULT '{}'::jsonb,
    focal_x numeric(5, 4) NOT NULL DEFAULT 0.5000 CHECK (focal_x BETWEEN 0 AND 1),
    focal_y numeric(5, 4) NOT NULL DEFAULT 0.5000 CHECK (focal_y BETWEEN 0 AND 1),
    variants jsonb NOT NULL DEFAULT '{}'::jsonb,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (table_uid, media_role)
);

-- The full upgrade migration also registers the column and its language keys,
-- so it runs with the seed after the dataset registry exists.
ALTER TABLE public.system_dataset_media
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.system_dataset_media.hidden IS
    'Suppresses presentation loading without removing the stored image or its link. Admin previews remain visible.';

CREATE INDEX IF NOT EXISTS idx_system_dataset_media_table_uid
    ON public.system_dataset_media (table_uid);

CREATE OR REPLACE FUNCTION public.set_system_dataset_media_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_system_dataset_media_timestamp
    ON public.system_dataset_media;
CREATE TRIGGER update_system_dataset_media_timestamp
BEFORE UPDATE ON public.system_dataset_media
FOR EACH ROW EXECUTE FUNCTION public.set_system_dataset_media_updated_timestamp();

CREATE TABLE IF NOT EXISTS public.system_db_table_aliases (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    alias_slug text NOT NULL UNIQUE,
    is_primary boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_db_table_aliases_table_uid
    ON public.system_db_table_aliases (table_uid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_db_table_aliases_one_primary_alias_per_table
    ON public.system_db_table_aliases (table_uid)
    WHERE is_primary IS TRUE AND is_active IS TRUE;

CREATE OR REPLACE FUNCTION public.set_system_db_table_aliases_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'set_system_db_table_aliases_updated'
    ) THEN
        CREATE TRIGGER set_system_db_table_aliases_updated
            BEFORE UPDATE ON public.system_db_table_aliases
            FOR EACH ROW EXECUTE FUNCTION public.set_system_db_table_aliases_updated_timestamp();
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        GRANT SELECT ON TABLE public.system_db_table_aliases TO readeronly;
    END IF;
END $$;

-- External embedding work is opt-in per dataset. The queue contains only row
-- identifiers and scheduling state; the worker reads field content later
-- through the administrator-owned allowlist.
ALTER TABLE public.system_column_details
    ADD COLUMN IF NOT EXISTS external_embedding_allowed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.system_db_tables
    ADD COLUMN IF NOT EXISTS external_embedding_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS external_embedding_policy_configured BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.system_embedding_refresh_jobs (
    id               BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_uid        INTEGER NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    row_id           BIGINT NOT NULL,
    generation       BIGINT NOT NULL DEFAULT 1,
    attempt_count    INTEGER NOT NULL DEFAULT 0,
    available_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_token      TEXT NOT NULL DEFAULT '',
    lease_expires_at TIMESTAMPTZ,
    last_error_code  TEXT NOT NULL DEFAULT '',
    created          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_system_embedding_refresh_jobs_row UNIQUE (table_uid, row_id),
    CONSTRAINT ck_system_embedding_refresh_jobs_generation CHECK (generation >= 1),
    CONSTRAINT ck_system_embedding_refresh_jobs_attempt_count CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_system_embedding_refresh_jobs_claim
    ON public.system_embedding_refresh_jobs (available_at, lease_expires_at, id);

-- Keep fresh public installations on the same canonical UI-language model as
-- an existing database upgraded through 20260817000002. Runtime readers still
-- use the legacy wide columns during the compatibility phase; these tables are
-- the durable per-locale contract for the later runtime cutover.
CREATE TABLE IF NOT EXISTS public.system_languages (
    id                       BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    language_code            TEXT        NOT NULL UNIQUE,
    english_name             TEXT        NOT NULL,
    native_name              TEXT        NOT NULL,
    script_code              TEXT        NOT NULL,
    region_code              TEXT,
    is_enabled               BOOLEAN     NOT NULL DEFAULT FALSE,
    is_default               BOOLEAN     NOT NULL DEFAULT FALSE,
    fallback_language_code   TEXT        REFERENCES public.system_languages(language_code) ON DELETE RESTRICT,
    coverage_status          TEXT        NOT NULL DEFAULT 'not_started',
    review_status            TEXT        NOT NULL DEFAULT 'unreviewed',
    public_selector_ready    BOOLEAN     NOT NULL DEFAULT FALSE,
    sort_order               INTEGER     NOT NULL DEFAULT 100,
    created                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_languages_code
        CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    CONSTRAINT ck_system_languages_script
        CHECK (script_code ~ '^[A-Z][a-z]{3}$'),
    CONSTRAINT ck_system_languages_region
        CHECK (region_code IS NULL OR region_code ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_system_languages_code_region_match
        CHECK (
            (region_code IS NULL AND language_code !~ '-')
            OR language_code = split_part(language_code, '-', 1) || '-' || region_code
        ),
    CONSTRAINT ck_system_languages_coverage
        CHECK (coverage_status IN ('not_started', 'partial', 'complete')),
    CONSTRAINT ck_system_languages_review
        CHECK (review_status IN ('unreviewed', 'needs_review', 'approved')),
    CONSTRAINT ck_system_languages_default_enabled
        CHECK (is_default IS FALSE OR is_enabled IS TRUE),
    CONSTRAINT ck_system_languages_fallback
        CHECK (
            (is_default IS TRUE AND fallback_language_code IS NULL)
            OR
            (
                is_default IS FALSE
                AND fallback_language_code IS NOT NULL
                AND fallback_language_code <> language_code
            )
        ),
    CONSTRAINT ck_system_languages_public_selector_gate
        CHECK (
            public_selector_ready IS FALSE
            OR (
                is_enabled IS TRUE
                AND coverage_status = 'complete'
                AND review_status = 'approved'
            )
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_languages_one_default
    ON public.system_languages (is_default)
    WHERE is_default IS TRUE;

CREATE TABLE IF NOT EXISTS public.system_lang_key_translations (
    id                BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    lang_key_id       BIGINT      NOT NULL REFERENCES public.system_lang_keys(id) ON DELETE CASCADE,
    language_code     TEXT        NOT NULL REFERENCES public.system_languages(language_code) ON DELETE RESTRICT,
    translation       TEXT        NOT NULL CHECK (btrim(translation) <> ''),
    source_kind       TEXT        NOT NULL,
    review_status     TEXT        NOT NULL DEFAULT 'unreviewed',
    created           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_system_lang_key_translations_key_language
        UNIQUE (lang_key_id, language_code),
    CONSTRAINT ck_system_lang_key_translations_source
        CHECK (source_kind IN ('legacy_en', 'legacy_fi', 'legacy_ch', 'manual', 'import')),
    CONSTRAINT ck_system_lang_key_translations_review
        CHECK (review_status IN ('unreviewed', 'needs_review', 'approved'))
);

CREATE INDEX IF NOT EXISTS idx_system_lang_key_translations_language
    ON public.system_lang_key_translations (language_code, lang_key_id);

CREATE OR REPLACE FUNCTION public.set_system_languages_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_system_lang_key_translations_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_system_languages_timestamp'
          AND tgrelid = 'public.system_languages'::regclass
    ) THEN
        CREATE TRIGGER update_system_languages_timestamp
            BEFORE UPDATE ON public.system_languages
            FOR EACH ROW EXECUTE FUNCTION public.set_system_languages_updated_timestamp();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_system_lang_key_translations_timestamp'
          AND tgrelid = 'public.system_lang_key_translations'::regclass
    ) THEN
        CREATE TRIGGER update_system_lang_key_translations_timestamp
            BEFORE UPDATE ON public.system_lang_key_translations
            FOR EACH ROW EXECUTE FUNCTION public.set_system_lang_key_translations_updated_timestamp();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.system_about (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    title character varying,
    description text,
    predecessor_id integer,
    cached_image text,
    search_vector_simple tsvector,
    admin_approved boolean
);

CREATE TABLE IF NOT EXISTS public.ai_chat_conversations (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.system_users(id) ON DELETE CASCADE,
    dataset character varying(255) NOT NULL,
    preview text NOT NULL DEFAULT '',
    messages jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_chat_conversations_user_dataset
    ON public.ai_chat_conversations (user_id, dataset);
CREATE INDEX IF NOT EXISTS idx_ai_chat_conversations_user_id
    ON public.ai_chat_conversations (user_id);

CREATE TABLE IF NOT EXISTS public.system_db_version (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    version character varying(20) NOT NULL,
    applied_at timestamp with time zone DEFAULT now(),
    description text,
    instance_id character varying(12) NOT NULL DEFAULT SUBSTRING(md5(random()::text) FROM 1 FOR 12)
);
-- db_9_7_0.schema.sql
-- Defines the DB 9.7.0 group field-assignment and exact-row access-control schema.
-- Bridges the base runtime schema with accepted administrator workflows #874 and #879.
-- Exists so a fresh public installation receives the real contract instead of only its version label.

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

CREATE TABLE IF NOT EXISTS public.system_permission_categories (
    id              BIGSERIAL PRIMARY KEY,
    category_key    VARCHAR(64)  NOT NULL UNIQUE,
    label_lang_key  VARCHAR(128) NOT NULL,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_permission_categories_key
        CHECK (category_key ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE TABLE IF NOT EXISTS public.system_permission_actions (
    id              BIGSERIAL PRIMARY KEY,
    category_id     BIGINT       NOT NULL REFERENCES public.system_permission_categories(id),
    action_key      VARCHAR(64)  NOT NULL UNIQUE,
    scope_type      VARCHAR(32)  NOT NULL,
    label_lang_key  VARCHAR(128) NOT NULL,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_permission_actions_key
        CHECK (action_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_system_permission_actions_scope
        CHECK (scope_type IN ('dataset', 'row', 'system'))
);

CREATE TABLE IF NOT EXISTS public.system_row_access_rules (
    id              BIGSERIAL PRIMARY KEY,
    table_uid       INTEGER      NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    row_id          BIGINT       NOT NULL,
    user_id         BIGINT       REFERENCES public.system_users(id) ON DELETE CASCADE,
    group_id        BIGINT       REFERENCES public.system_user_groups(id) ON DELETE CASCADE,
    action_id       BIGINT       NOT NULL REFERENCES public.system_permission_actions(id),
    effect          VARCHAR(16)  NOT NULL,
    reason          TEXT,
    valid_from      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    valid_until     TIMESTAMPTZ,
    created_by      BIGINT       REFERENCES public.system_users(id) ON DELETE SET NULL,
    updated_by      BIGINT       REFERENCES public.system_users(id) ON DELETE SET NULL,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_row_access_rules_row_id CHECK (row_id > 0),
    CONSTRAINT ck_system_row_access_rules_principal
        CHECK ((user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1),
    CONSTRAINT ck_system_row_access_rules_effect CHECK (effect IN ('allow', 'deny')),
    CONSTRAINT ck_system_row_access_rules_validity
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT uq_system_row_access_rules_target
        UNIQUE NULLS NOT DISTINCT (table_uid, row_id, user_id, group_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_evaluation
    ON public.system_row_access_rules (table_uid, row_id, action_id, effect);
CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_user
    ON public.system_row_access_rules (user_id, table_uid, row_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_group
    ON public.system_row_access_rules (group_id, table_uid, row_id)
    WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.system_row_access_rule_events (
    id                  BIGSERIAL PRIMARY KEY,
    change_set_id       VARCHAR(36) NOT NULL,
    actor_user_id       BIGINT      REFERENCES public.system_users(id) ON DELETE SET NULL,
    table_uid           INTEGER     NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    principal_type      VARCHAR(16) NOT NULL,
    principal_id        BIGINT      NOT NULL,
    row_ids             BIGINT[]    NOT NULL,
    changes             JSONB       NOT NULL,
    reason              TEXT,
    affected_rule_count INTEGER     NOT NULL DEFAULT 0,
    created             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_row_access_rule_events_change_set
        CHECK (change_set_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT ck_system_row_access_rule_events_principal
        CHECK (principal_type IN ('user', 'group') AND principal_id > 0),
    CONSTRAINT ck_system_row_access_rule_events_rows
        CHECK (cardinality(row_ids) BETWEEN 1 AND 200),
    CONSTRAINT ck_system_row_access_rule_events_changes
        CHECK (jsonb_typeof(changes) = 'object'),
    CONSTRAINT ck_system_row_access_rule_events_count
        CHECK (affected_rule_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_system_row_access_rule_events_target
    ON public.system_row_access_rule_events (table_uid, created DESC);
CREATE INDEX IF NOT EXISTS idx_system_row_access_rule_events_actor
    ON public.system_row_access_rule_events (actor_user_id, created DESC);

CREATE OR REPLACE FUNCTION public.set_row_access_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_system_permission_categories_timestamp
    ON public.system_permission_categories;
CREATE TRIGGER update_system_permission_categories_timestamp
BEFORE UPDATE ON public.system_permission_categories
FOR EACH ROW EXECUTE FUNCTION public.set_row_access_updated_timestamp();

DROP TRIGGER IF EXISTS update_system_permission_actions_timestamp
    ON public.system_permission_actions;
CREATE TRIGGER update_system_permission_actions_timestamp
BEFORE UPDATE ON public.system_permission_actions
FOR EACH ROW EXECUTE FUNCTION public.set_row_access_updated_timestamp();

DROP TRIGGER IF EXISTS update_system_row_access_rules_timestamp
    ON public.system_row_access_rules;
CREATE TRIGGER update_system_row_access_rules_timestamp
BEFORE UPDATE ON public.system_row_access_rules
FOR EACH ROW EXECUTE FUNCTION public.set_row_access_updated_timestamp();

CREATE OR REPLACE FUNCTION public.resolve_effective_row_access(
    target_table_name TEXT,
    target_row_id BIGINT,
    actor_user_id BIGINT,
    requested_action TEXT,
    broader_policy_allows BOOLEAN,
    actor_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT CASE
        WHEN actor_is_admin THEN TRUE
        ELSE COALESCE((
            SELECT CASE
                WHEN bool_or(rules.effect = 'deny') THEN FALSE
                WHEN bool_or(rules.effect = 'allow') THEN TRUE
                ELSE NULL
            END
            FROM public.system_row_access_rules AS rules
            JOIN public.system_permission_actions AS actions
              ON actions.id = rules.action_id
             AND actions.enabled IS TRUE
             AND actions.scope_type = 'row'
            JOIN public.system_db_tables AS tables
              ON tables.table_uid = rules.table_uid
            WHERE tables.table_name = target_table_name
              AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
              AND rules.row_id = target_row_id
              AND actions.action_key = requested_action
              AND rules.valid_from <= now()
              AND (rules.valid_until IS NULL OR rules.valid_until > now())
              AND (
                  rules.user_id = actor_user_id
                  OR rules.group_id IN (
                      SELECT memberships.group_id
                      FROM public.system_user_group_memberships AS memberships
                      WHERE memberships.user_id = actor_user_id
                  )
              )
        ), COALESCE(broader_policy_allows, FALSE))
    END;
$$;

COMMENT ON TABLE public.system_permission_categories IS
    'Translatable UI grouping for normalized permission actions; categories never change enforcement semantics.';
COMMENT ON TABLE public.system_permission_actions IS
    'Stable permission-action registry. Existing-row editing uses only enabled actions whose scope_type is row.';
COMMENT ON TABLE public.system_row_access_rules IS
    'Exact-row user/group allow or deny exceptions layered over broader dataset and legacy row policies; deny wins.';
COMMENT ON TABLE public.system_row_access_rule_events IS
    'Append-only principal audit rows; every multi-principal transaction shares one change_set_id.';
COMMENT ON FUNCTION public.resolve_effective_row_access(TEXT, BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN) IS
    'Resolves one row action: admin bypass, explicit deny, explicit allow, then the broader application policy. The RLS backend feature flag never bypasses this layer.';
-- Filterest public bootstrap: the established four-table mock workspace.
-- These names intentionally match the long-lived synthetic demo datasets in
-- the long-lived private source workspace. They remain synthetic public fixtures, separate from private
-- production service and development-task datasets.

CREATE TABLE IF NOT EXISTS public.palvelukatalogi (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    cached_username character varying,
    palvelu text NOT NULL,
    kuvaus text NOT NULL,
    omistava_tiimi text NOT NULL,
    palvelutaso text NOT NULL,
    tila text NOT NULL,
    vastuuhenkilo text NOT NULL,
    cached_image text,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.riskienhallinta (
    vaikutus text NOT NULL,
    riskitaso text NOT NULL,
    kuvaus text NOT NULL,
    tila text NOT NULL,
    riski text NOT NULL,
    omistava_tiimi text NOT NULL,
    todennakoisyys text NOT NULL,
    alentamistoimet text NOT NULL,
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    cached_username character varying,
    palvelu_id integer REFERENCES public.palvelukatalogi(id) ON UPDATE CASCADE ON DELETE SET NULL,
    cached_image text,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dokumentaatio (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    cached_username character varying,
    palvelu_id integer REFERENCES public.palvelukatalogi(id) ON UPDATE CASCADE ON DELETE SET NULL,
    otsikko text NOT NULL,
    kohdetiimi text NOT NULL,
    ohje text NOT NULL,
    paivitetty date DEFAULT CURRENT_DATE,
    voimassaolo text NOT NULL,
    kuva text,
    cached_image text,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tiketit (
    otsikko text NOT NULL,
    vastuutiimi text NOT NULL,
    maarapaiva date,
    tila text NOT NULL,
    riski_id integer REFERENCES public.riskienhallinta(id) ON UPDATE CASCADE ON DELETE SET NULL,
    prioriteetti text NOT NULL,
    pyyntotyyppi text NOT NULL,
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    cached_username character varying,
    kuvaus text NOT NULL,
    palvelu_id integer REFERENCES public.palvelukatalogi(id) ON UPDATE CASCADE ON DELETE SET NULL,
    dokumentaatio_id integer REFERENCES public.dokumentaatio(id) ON UPDATE CASCADE ON DELETE SET NULL,
    kuva text,
    cached_image text,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now()
);

-- Each example dataset uses the same shared asset child-table contract as
-- datasets configured through the Asset linking admin tool. Keeping the four
-- tables explicit makes image uploads available immediately after First Run.
CREATE TABLE IF NOT EXISTS public.palvelukatalogi_assets (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    palvelukatalogi_id integer NOT NULL REFERENCES public.palvelukatalogi(id) ON DELETE CASCADE,
    asset_kind text NOT NULL DEFAULT 'image',
    filename text,
    original_name text,
    mime_type text,
    size_bytes bigint,
    title text,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_primary boolean NOT NULL DEFAULT false,
    metadata_json jsonb,
    created timestamp with time zone DEFAULT now(),
    updated timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_palvelukatalogi_assets_parent
    ON public.palvelukatalogi_assets (palvelukatalogi_id);
CREATE INDEX IF NOT EXISTS idx_palvelukatalogi_assets_kind
    ON public.palvelukatalogi_assets (asset_kind);
CREATE INDEX IF NOT EXISTS idx_palvelukatalogi_assets_primary
    ON public.palvelukatalogi_assets (palvelukatalogi_id, is_primary, sort_order);

CREATE TABLE IF NOT EXISTS public.riskienhallinta_assets (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    riskienhallinta_id integer NOT NULL REFERENCES public.riskienhallinta(id) ON DELETE CASCADE,
    asset_kind text NOT NULL DEFAULT 'image',
    filename text,
    original_name text,
    mime_type text,
    size_bytes bigint,
    title text,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_primary boolean NOT NULL DEFAULT false,
    metadata_json jsonb,
    created timestamp with time zone DEFAULT now(),
    updated timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_riskienhallinta_assets_parent
    ON public.riskienhallinta_assets (riskienhallinta_id);
CREATE INDEX IF NOT EXISTS idx_riskienhallinta_assets_kind
    ON public.riskienhallinta_assets (asset_kind);
CREATE INDEX IF NOT EXISTS idx_riskienhallinta_assets_primary
    ON public.riskienhallinta_assets (riskienhallinta_id, is_primary, sort_order);

CREATE TABLE IF NOT EXISTS public.dokumentaatio_assets (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    dokumentaatio_id integer NOT NULL REFERENCES public.dokumentaatio(id) ON DELETE CASCADE,
    asset_kind text NOT NULL DEFAULT 'image',
    filename text,
    original_name text,
    mime_type text,
    size_bytes bigint,
    title text,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_primary boolean NOT NULL DEFAULT false,
    metadata_json jsonb,
    created timestamp with time zone DEFAULT now(),
    updated timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dokumentaatio_assets_parent
    ON public.dokumentaatio_assets (dokumentaatio_id);
CREATE INDEX IF NOT EXISTS idx_dokumentaatio_assets_kind
    ON public.dokumentaatio_assets (asset_kind);
CREATE INDEX IF NOT EXISTS idx_dokumentaatio_assets_primary
    ON public.dokumentaatio_assets (dokumentaatio_id, is_primary, sort_order);

CREATE TABLE IF NOT EXISTS public.tiketit_assets (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    tiketit_id integer NOT NULL REFERENCES public.tiketit(id) ON DELETE CASCADE,
    asset_kind text NOT NULL DEFAULT 'image',
    filename text,
    original_name text,
    mime_type text,
    size_bytes bigint,
    title text,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_primary boolean NOT NULL DEFAULT false,
    metadata_json jsonb,
    created timestamp with time zone DEFAULT now(),
    updated timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tiketit_assets_parent
    ON public.tiketit_assets (tiketit_id);
CREATE INDEX IF NOT EXISTS idx_tiketit_assets_kind
    ON public.tiketit_assets (asset_kind);
CREATE INDEX IF NOT EXISTS idx_tiketit_assets_primary
    ON public.tiketit_assets (tiketit_id, is_primary, sort_order);

CREATE OR REPLACE FUNCTION public.set_domain_workspace_updated_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_palvelukatalogi_updated ON public.palvelukatalogi;
CREATE TRIGGER set_palvelukatalogi_updated
BEFORE UPDATE ON public.palvelukatalogi
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

DROP TRIGGER IF EXISTS set_riskienhallinta_updated ON public.riskienhallinta;
CREATE TRIGGER set_riskienhallinta_updated
BEFORE UPDATE ON public.riskienhallinta
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

DROP TRIGGER IF EXISTS set_dokumentaatio_updated ON public.dokumentaatio;
CREATE TRIGGER set_dokumentaatio_updated
BEFORE UPDATE ON public.dokumentaatio
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

DROP TRIGGER IF EXISTS set_tiketit_updated ON public.tiketit;
CREATE TRIGGER set_tiketit_updated
BEFORE UPDATE ON public.tiketit
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

CREATE TABLE IF NOT EXISTS public.palvelukatalogi_riskienhallinta_relation (
    palvelu_id integer NOT NULL REFERENCES public.palvelukatalogi(id) ON DELETE CASCADE,
    riski_id integer NOT NULL REFERENCES public.riskienhallinta(id) ON DELETE CASCADE,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (palvelu_id, riski_id)
);

CREATE TABLE IF NOT EXISTS public.palvelukatalogi_dokumentaatio_relation (
    palvelu_id integer NOT NULL REFERENCES public.palvelukatalogi(id) ON DELETE CASCADE,
    dokumentaatio_id integer NOT NULL REFERENCES public.dokumentaatio(id) ON DELETE CASCADE,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (palvelu_id, dokumentaatio_id)
);

CREATE TABLE IF NOT EXISTS public.palvelukatalogi_tiketit_relation (
    palvelu_id integer NOT NULL REFERENCES public.palvelukatalogi(id) ON DELETE CASCADE,
    tiketti_id integer NOT NULL REFERENCES public.tiketit(id) ON DELETE CASCADE,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (palvelu_id, tiketti_id)
);

CREATE TABLE IF NOT EXISTS public.riskienhallinta_dokumentaatio_relation (
    riski_id integer NOT NULL REFERENCES public.riskienhallinta(id) ON DELETE CASCADE,
    dokumentaatio_id integer NOT NULL REFERENCES public.dokumentaatio(id) ON DELETE CASCADE,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (riski_id, dokumentaatio_id)
);

CREATE TABLE IF NOT EXISTS public.riskienhallinta_tiketit_relation (
    riski_id integer NOT NULL REFERENCES public.riskienhallinta(id) ON DELETE CASCADE,
    tiketti_id integer NOT NULL REFERENCES public.tiketit(id) ON DELETE CASCADE,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (riski_id, tiketti_id)
);

CREATE TABLE IF NOT EXISTS public.dokumentaatio_tiketit_relation (
    dokumentaatio_id integer NOT NULL REFERENCES public.dokumentaatio(id) ON DELETE CASCADE,
    tiketti_id integer NOT NULL REFERENCES public.tiketit(id) ON DELETE CASCADE,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (dokumentaatio_id, tiketti_id)
);

CREATE INDEX IF NOT EXISTS idx_palvelukatalogi_riskienhallinta_relation_riski_id
    ON public.palvelukatalogi_riskienhallinta_relation (riski_id);
CREATE INDEX IF NOT EXISTS idx_palvelukatalogi_dokumentaatio_relation_dokumentaatio_id
    ON public.palvelukatalogi_dokumentaatio_relation (dokumentaatio_id);
CREATE INDEX IF NOT EXISTS idx_palvelukatalogi_tiketit_relation_tiketti_id
    ON public.palvelukatalogi_tiketit_relation (tiketti_id);
CREATE INDEX IF NOT EXISTS idx_riskienhallinta_dokumentaatio_relation_dokumentaatio_id
    ON public.riskienhallinta_dokumentaatio_relation (dokumentaatio_id);
CREATE INDEX IF NOT EXISTS idx_riskienhallinta_tiketit_relation_tiketti_id
    ON public.riskienhallinta_tiketit_relation (tiketti_id);
CREATE INDEX IF NOT EXISTS idx_dokumentaatio_tiketit_relation_tiketti_id
    ON public.dokumentaatio_tiketit_relation (tiketti_id);

DROP TRIGGER IF EXISTS set_palvelukatalogi_riskienhallinta_relation_updated ON public.palvelukatalogi_riskienhallinta_relation;
CREATE TRIGGER set_palvelukatalogi_riskienhallinta_relation_updated
BEFORE UPDATE ON public.palvelukatalogi_riskienhallinta_relation
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

DROP TRIGGER IF EXISTS set_palvelukatalogi_dokumentaatio_relation_updated ON public.palvelukatalogi_dokumentaatio_relation;
CREATE TRIGGER set_palvelukatalogi_dokumentaatio_relation_updated
BEFORE UPDATE ON public.palvelukatalogi_dokumentaatio_relation
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

DROP TRIGGER IF EXISTS set_palvelukatalogi_tiketit_relation_updated ON public.palvelukatalogi_tiketit_relation;
CREATE TRIGGER set_palvelukatalogi_tiketit_relation_updated
BEFORE UPDATE ON public.palvelukatalogi_tiketit_relation
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

DROP TRIGGER IF EXISTS set_riskienhallinta_dokumentaatio_relation_updated ON public.riskienhallinta_dokumentaatio_relation;
CREATE TRIGGER set_riskienhallinta_dokumentaatio_relation_updated
BEFORE UPDATE ON public.riskienhallinta_dokumentaatio_relation
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

DROP TRIGGER IF EXISTS set_riskienhallinta_tiketit_relation_updated ON public.riskienhallinta_tiketit_relation;
CREATE TRIGGER set_riskienhallinta_tiketit_relation_updated
BEFORE UPDATE ON public.riskienhallinta_tiketit_relation
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();

DROP TRIGGER IF EXISTS set_dokumentaatio_tiketit_relation_updated ON public.dokumentaatio_tiketit_relation;
CREATE TRIGGER set_dokumentaatio_tiketit_relation_updated
BEFORE UPDATE ON public.dokumentaatio_tiketit_relation
FOR EACH ROW EXECUTE FUNCTION public.set_domain_workspace_updated_timestamp();
-- column_supported_views.schema.sql
-- Includes reviewed public feature metadata in a fresh installation.
-- Mirrors the corresponding incremental migration without importing runtime data.
-- Keeps clean installs and upgraded databases on the same feature contract.

-- Shared runtime policy for raw NULL label visibility; explicit overrides always win.
CREATE OR REPLACE FUNCTION public.resolve_card_label_visibility(label_override BOOLEAN, card_role TEXT)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
AS $policy$
    SELECT CASE
        WHEN label_override IS NOT NULL THEN label_override
        ELSE COALESCE((
            SELECT CASE
                WHEN bool_or(token ~ '^(header|description[0-9]*|keywords)([[:space:]]*\+[[:space:]]*lang[-_]key)?$') THEN FALSE
                ELSE bool_or(token ~ '^details(_link)?[0-9]*([[:space:]]*\+[[:space:]]*lang[-_]key)?$')
            END
            FROM (
                SELECT regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g') AS token
                FROM unnest(string_to_array(COALESCE(card_role, ''), ',')) AS token_values(value)
            ) AS roles
        ), FALSE)
    END;
$policy$;

CREATE OR REPLACE VIEW public.system_column_supported_views AS
SELECT
    details.column_uid::BIGINT * 2147483648::BIGINT + views.id::BIGINT AS id,
    details.table_uid,
    tables.table_name,
    details.column_uid,
    details.column_name,
    views.id AS view_id,
    views.view_key,
    views.name AS view_name,
    views.status AS view_status,
    CASE
        WHEN COALESCE(details.client_delivery_mode, 'include') = 'server_only' THEN FALSE
        WHEN COALESCE(details.hide_everywhere, FALSE) THEN FALSE
        WHEN views.view_key IN ('card', 'product_card')
             AND COALESCE(details.hide_on_small_card, FALSE) THEN FALSE
        ELSE TRUE
    END AS is_supported,
    CASE
        WHEN COALESCE(details.client_delivery_mode, 'include') = 'server_only' THEN 'server_only'
        WHEN COALESCE(details.hide_everywhere, FALSE) THEN 'hidden_everywhere'
        WHEN views.view_key IN ('card', 'product_card')
             AND COALESCE(details.hide_on_small_card, FALSE) THEN 'hidden_on_card'
        ELSE 'supported'
    END AS support_state,
    details.data_type,
    COALESCE(details.editable_in_ui, TRUE) AS editable_in_ui,
    COALESCE(details.is_multilingual, FALSE) AS is_multilingual,
    (
        COALESCE(details.client_delivery_mode, 'include') = 'include'
        AND NOT COALESCE(details.hide_everywhere, FALSE)
        AND NOT COALESCE(details.hide_in_filter_panel, FALSE)
    ) AS is_filterable,
    COALESCE(details.client_delivery_mode, 'include') AS client_delivery_mode,
    COALESCE(details.hide_everywhere, FALSE) AS hide_everywhere,
    COALESCE(details.hide_on_small_card, FALSE) AS hide_on_small_card,
    COALESCE(details.hide_in_filter_panel, FALSE) AS hide_in_filter_panel,
    COALESCE(details.card_element, '') AS card_element,
    public.resolve_card_label_visibility(details.show_key_on_card, details.card_element) AS show_key_on_card,
    COALESCE(details.show_value_on_card, TRUE) AS show_value_on_card
FROM public.system_column_details AS details
JOIN public.system_db_tables AS tables
  ON tables.table_uid = details.table_uid
CROSS JOIN public.system_table_views AS views;

COMMENT ON VIEW public.system_column_supported_views IS
    'Read-only column-by-view support matrix. Global metadata determines support; personal, group, and site field assignments remain separate presentation preferences.';
COMMENT ON COLUMN public.system_column_supported_views.is_supported IS
    'Deterministic effective support: false for server_only, globally hidden, or card-hidden columns; true otherwise.';
COMMENT ON COLUMN public.system_column_supported_views.client_delivery_mode IS
    'Client projection mode is include or server_only. It is data minimization, not field authorization.';
-- media_assets.schema.sql
-- Includes reviewed public feature metadata in a fresh installation.
-- Mirrors the corresponding incremental migration without importing runtime data.
-- Keeps clean installs and upgraded databases on the same feature contract.

CREATE TABLE IF NOT EXISTS public.system_media_assets (
 id UUID PRIMARY KEY,
 relation_id BIGINT NOT NULL,
 parent_table_uid BIGINT NOT NULL,
 child_table_uid BIGINT NOT NULL,
 foreign_key_column TEXT NOT NULL,
 filename_column TEXT NOT NULL,
 source_row_id BIGINT NOT NULL CHECK (source_row_id>0),
 source_reference TEXT NOT NULL,
 filename TEXT NOT NULL CHECK (filename ~ '^image\.(png|jpg|jpeg|webp|gif)$'),
 original_sha256 CHAR(64) NOT NULL CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
 default_caption JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_by BIGINT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(relation_id,source_row_id,source_reference,original_sha256)
);
CREATE TABLE IF NOT EXISTS public.system_media_asset_usages (
 asset_id UUID NOT NULL REFERENCES public.system_media_assets(id) ON DELETE RESTRICT,
 relation_id BIGINT NOT NULL,
 parent_row_id BIGINT NOT NULL CHECK(parent_row_id>0),
 child_row_id BIGINT NOT NULL CHECK(child_row_id>0),
 created TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(asset_id,relation_id,parent_row_id),
 UNIQUE(relation_id,child_row_id)
);
COMMENT ON TABLE public.system_media_assets IS
 'Physical images copied out of parent-owned folders; dedicated API only, no automatic garbage collection.';
COMMENT ON TABLE public.system_media_asset_usages IS
 'Bounded references to ordinary asset-child rows. Authorization rechecks each live row and current audience.';
-- BEGIN exact media registry role policy.
REVOKE ALL ON public.system_media_assets, public.system_media_asset_usages FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles
  WHERE rolname IN ('admin_user','basic_user','confidential_user','readonly_user','readeronly','guest_user') LOOP
  -- Default ACLs may have granted direct CRUD before this explicit table policy.
  EXECUTE format('REVOKE ALL ON public.system_media_assets, public.system_media_asset_usages FROM %I', role_name);
  EXECUTE format('GRANT SELECT ON public.system_media_assets, public.system_media_asset_usages TO %I', role_name);
  IF role_name IN ('admin_user','basic_user','confidential_user') THEN
   EXECUTE format('GRANT INSERT, DELETE ON public.system_media_assets, public.system_media_asset_usages TO %I', role_name);
  END IF;
 END LOOP;
END $$;
-- END exact media registry role policy.
-- 20260919000007_create_developer_ticket_schema.sql
-- Creates the current developer-ticket tables without importing installation records.
-- Bridges the shipped db_task command and ticket UI with their public database contract.
-- Exists so a standalone Filterest checkout can use its own development task tools.
-- VERSION_DB: 9.8.0
-- VERSION_DB_OWNER: 20260919000010_record_developer_workflow_schema_release.sql

CREATE TABLE IF NOT EXISTS public.dev_agent_task_statuses (
    id           SERIAL PRIMARY KEY,
    slug         TEXT        NOT NULL UNIQUE,
    lang_key     TEXT        NOT NULL UNIQUE,
    title        TEXT        NOT NULL,
    description  TEXT,
    sort_order   INTEGER     NOT NULL DEFAULT 0,
    is_active    BOOLEAN     NOT NULL DEFAULT FALSE,
    is_terminal  BOOLEAN     NOT NULL DEFAULT FALSE,
    is_claimable BOOLEAN     NOT NULL DEFAULT FALSE,
    created      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_todo_statuses (
    id                   SERIAL PRIMARY KEY,
    slug                 TEXT        NOT NULL UNIQUE,
    lang_key             TEXT        NOT NULL UNIQUE,
    title                TEXT        NOT NULL,
    description          TEXT,
    sort_order           INTEGER     NOT NULL DEFAULT 0,
    is_completion_status BOOLEAN     NOT NULL DEFAULT FALSE,
    is_terminal          BOOLEAN     NOT NULL DEFAULT FALSE,
    created              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_queues (
    updated     TIMESTAMPTZ NOT NULL DEFAULT now(),
    name        VARCHAR(50),
    description VARCHAR(4000),
    id          SERIAL PRIMARY KEY,
    created     TIMESTAMPTZ NOT NULL DEFAULT now(),
    slug        TEXT        NOT NULL,
    title       TEXT        NOT NULL,
    sort_order  INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_groups (
    id          SERIAL PRIMARY KEY,
    slug        TEXT        NOT NULL UNIQUE,
    title       TEXT        NOT NULL,
    description TEXT,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    created     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.agent_tasks_id_seq AS INTEGER;

CREATE TABLE IF NOT EXISTS public.dev_agent_tasks (
    id           INTEGER     NOT NULL DEFAULT nextval('public.agent_tasks_id_seq'::regclass),
    title        TEXT        NOT NULL,
    status       TEXT        NOT NULL,
    created      TIMESTAMPTZ NOT NULL DEFAULT now(),
    content      TEXT        NOT NULL,
    updated      TIMESTAMPTZ NOT NULL DEFAULT now(),
    priority     TEXT        NOT NULL DEFAULT 'normal',
    tags         TEXT[]      DEFAULT '{}'::TEXT[],
    parent_id    INTEGER     REFERENCES public.dev_agent_tasks(id) ON DELETE SET NULL,
    assigned_to  TEXT,
    issue_type   TEXT        NOT NULL DEFAULT 'task',
    cached_image TEXT,
    queue_id     INTEGER,
    CONSTRAINT agent_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT chk_dev_agent_tasks_issue_type
        CHECK (issue_type IN ('task', 'incident', 'bug', 'epic')),
    CONSTRAINT fk_dev_agent_tasks_queue_id
        FOREIGN KEY (queue_id) REFERENCES public.dev_agent_task_queues(id) ON DELETE SET NULL,
    CONSTRAINT fk_dev_agent_tasks_status
        FOREIGN KEY (status) REFERENCES public.dev_agent_task_statuses(slug) ON UPDATE CASCADE
);

-- Older composed installations may already own the base task table. Add only
-- fields introduced by its private migration history and retain any legacy
-- columns rather than discarding installation data.
ALTER TABLE public.dev_agent_tasks
    ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS parent_id INTEGER,
    ADD COLUMN IF NOT EXISTS assigned_to TEXT,
    ADD COLUMN IF NOT EXISTS issue_type TEXT NOT NULL DEFAULT 'task',
    ADD COLUMN IF NOT EXISTS cached_image TEXT,
    ADD COLUMN IF NOT EXISTS queue_id INTEGER;

ALTER TABLE public.dev_agent_tasks
    ALTER COLUMN id SET DEFAULT nextval('public.agent_tasks_id_seq'::regclass);
ALTER SEQUENCE public.agent_tasks_id_seq OWNED BY public.dev_agent_tasks.id;

CREATE TABLE IF NOT EXISTS public.dev_agent_task_runs (
    id                 BIGSERIAL PRIMARY KEY,
    run_id             TEXT        NOT NULL UNIQUE,
    task_id            INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    triggered_by       TEXT        NOT NULL,
    worker_backend     TEXT,
    status             TEXT        NOT NULL DEFAULT 'queued',
    summary_relpath    TEXT,
    progress_relpath   TEXT,
    log_relpath        TEXT,
    prompt_relpath     TEXT,
    run_status_relpath TEXT,
    exit_code          INTEGER,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at        TIMESTAMPTZ,
    reviewed_at        TIMESTAMPTZ,
    review_notes       TEXT,
    CONSTRAINT chk_dev_agent_task_runs_status
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'awaiting_review', 'canceled')),
    CONSTRAINT chk_dev_agent_task_runs_triggered_by
        CHECK (triggered_by IN ('queen', 'human', 'routine', 'manual'))
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_group_relations (
    id       SERIAL PRIMARY KEY,
    task_id  INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    group_id INTEGER     NOT NULL REFERENCES public.dev_agent_task_groups(id) ON DELETE CASCADE,
    created  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, group_id)
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_todos (
    id             BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    task_id        INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    parent_todo_id BIGINT      REFERENCES public.dev_agent_task_todos(id) ON DELETE CASCADE,
    todo_text      TEXT        NOT NULL CHECK (char_length(todo_text) BETWEEN 1 AND 5000),
    status         TEXT        NOT NULL DEFAULT 'todo',
    sort_order     INTEGER     NOT NULL DEFAULT 0,
    created_by     INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    completed_by   INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    created        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed      TIMESTAMPTZ,
    CONSTRAINT ck_dev_agent_task_todos_parent_not_self
        CHECK (parent_todo_id IS NULL OR parent_todo_id <> id),
    CONSTRAINT fk_dev_agent_task_todos_status
        FOREIGN KEY (status) REFERENCES public.dev_agent_task_todo_statuses(slug) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS public.dev_agent_tasks_assets (
    id                 SERIAL PRIMARY KEY,
    dev_agent_tasks_id INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    asset_kind         TEXT        NOT NULL DEFAULT 'image',
    filename           TEXT,
    original_name      TEXT,
    mime_type          TEXT,
    size_bytes         BIGINT,
    title              TEXT,
    description        TEXT,
    sort_order         INTEGER     NOT NULL DEFAULT 0,
    is_primary         BOOLEAN     NOT NULL DEFAULT FALSE,
    metadata_json      JSONB,
    created            TIMESTAMPTZ DEFAULT now(),
    updated            TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_agent_task_queues_slug
    ON public.dev_agent_task_queues (slug);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status
    ON public.dev_agent_tasks (status);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_issue_type_status
    ON public.dev_agent_tasks (issue_type, status);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_parent_id
    ON public.dev_agent_tasks (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_queue_id_status
    ON public.dev_agent_tasks (queue_id, status);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_status_priority
    ON public.dev_agent_tasks (status, priority);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_runs_task_id_started
    ON public.dev_agent_task_runs (task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_runs_status_started
    ON public.dev_agent_task_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_group_relations_group_id
    ON public.dev_agent_task_group_relations (group_id);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_statuses_sort_order_slug
    ON public.dev_agent_task_statuses (sort_order, slug);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_todo_statuses_sort_order_slug
    ON public.dev_agent_task_todo_statuses (sort_order, slug);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_todos_task_tree
    ON public.dev_agent_task_todos (task_id, parent_todo_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_todos_status
    ON public.dev_agent_task_todos (task_id, status);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_todos_parent
    ON public.dev_agent_task_todos (parent_todo_id) WHERE parent_todo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_assets_parent
    ON public.dev_agent_tasks_assets (dev_agent_tasks_id);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_assets_kind
    ON public.dev_agent_tasks_assets (asset_kind);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_assets_primary
    ON public.dev_agent_tasks_assets (dev_agent_tasks_id, is_primary, sort_order);

CREATE OR REPLACE FUNCTION public.set_dev_agent_tasks_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_queues_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_groups_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_statuses_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_todo_statuses_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.validate_dev_agent_task_todo_parent()
RETURNS TRIGGER AS $$
DECLARE
    parent_task_id INTEGER;
    parent_parent_id BIGINT;
BEGIN
    IF NEW.parent_todo_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT task_id, parent_todo_id
      INTO parent_task_id, parent_parent_id
      FROM public.dev_agent_task_todos
     WHERE id = NEW.parent_todo_id;

    IF parent_task_id IS NULL THEN
        RAISE EXCEPTION 'parent_todo_id % does not exist', NEW.parent_todo_id;
    END IF;
    IF parent_task_id <> NEW.task_id THEN
        RAISE EXCEPTION 'parent_todo_id % belongs to another task', NEW.parent_todo_id;
    END IF;
    IF parent_parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'dev_agent_task_todos supports only two levels';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_todos_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    IF NEW.status = 'done' THEN
        NEW.completed = COALESCE(NEW.completed, now());
    ELSE
        NEW.completed = NULL;
        NEW.completed_by = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_dev_agent_tasks_timestamp' AND tgrelid = 'public.dev_agent_tasks'::regclass) THEN
        CREATE TRIGGER update_dev_agent_tasks_timestamp
            BEFORE UPDATE ON public.dev_agent_tasks
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_tasks_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_queues_updated' AND tgrelid = 'public.dev_agent_task_queues'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_queues_updated
            BEFORE UPDATE ON public.dev_agent_task_queues
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_queues_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_groups_updated' AND tgrelid = 'public.dev_agent_task_groups'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_groups_updated
            BEFORE UPDATE ON public.dev_agent_task_groups
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_groups_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_statuses_updated' AND tgrelid = 'public.dev_agent_task_statuses'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_statuses_updated
            BEFORE UPDATE ON public.dev_agent_task_statuses
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_statuses_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_todo_statuses_updated' AND tgrelid = 'public.dev_agent_task_todo_statuses'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_todo_statuses_updated
            BEFORE UPDATE ON public.dev_agent_task_todo_statuses
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_todo_statuses_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'validate_dev_agent_task_todo_parent' AND tgrelid = 'public.dev_agent_task_todos'::regclass) THEN
        CREATE TRIGGER validate_dev_agent_task_todo_parent
            BEFORE INSERT OR UPDATE ON public.dev_agent_task_todos
            FOR EACH ROW EXECUTE FUNCTION public.validate_dev_agent_task_todo_parent();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_todos_updated' AND tgrelid = 'public.dev_agent_task_todos'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_todos_updated
            BEFORE INSERT OR UPDATE ON public.dev_agent_task_todos
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_todos_timestamps();
    END IF;
END $$;

COMMENT ON TABLE public.dev_agent_tasks IS
    'Database-backed development tickets used by the shipped agent tools.';
COMMENT ON TABLE public.dev_agent_task_runs IS
    'Execution history linking development tickets to local worker artifacts.';
COMMENT ON TABLE public.dev_agent_task_todos IS
    'Structured, independently completable checklist rows for development tickets.';
-- 20260919000008_create_developer_workline_schema.sql
-- Creates the current workline, report, handover, and release-goal tables.
-- Bridges the shipped db_report command and Workline Observatory with public storage.
-- Exists so workline continuity no longer depends on a private composition database.
-- VERSION_DB: 9.8.0
-- VERSION_DB_OWNER: 20260919000010_record_developer_workflow_schema_release.sql

CREATE TABLE IF NOT EXISTS public.dev_agent_worklines (
    id                  BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    title               TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    status              TEXT        NOT NULL DEFAULT 'active',
    tags                TEXT[]      NOT NULL DEFAULT '{}'::TEXT[],
    created_by          INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    created             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated             TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_changed_by   INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    status_changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_change_source TEXT       NOT NULL DEFAULT 'legacy',
    status_revision     BIGINT      NOT NULL DEFAULT 0,
    priority            TEXT        NOT NULL DEFAULT 'normal',
    priority_revision   BIGINT      NOT NULL DEFAULT 0,
    priority_changed_by INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    priority_changed_at TIMESTAMPTZ,
    CONSTRAINT ck_dev_agent_worklines_status
        CHECK (status IN ('active', 'paused', 'closed', 'archived')),
    CONSTRAINT ck_dev_agent_worklines_status_change_source
        CHECK (status_change_source IN ('legacy', 'creation', 'agent_tools_api', 'report_sync', 'observatory_ui')),
    CONSTRAINT ck_dev_agent_worklines_status_revision CHECK (status_revision >= 0),
    CONSTRAINT ck_dev_agent_worklines_priority
        CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    CONSTRAINT ck_dev_agent_worklines_priority_revision CHECK (priority_revision >= 0)
);

ALTER TABLE public.dev_agent_worklines
    ADD COLUMN IF NOT EXISTS status_changed_by INTEGER REFERENCES public.system_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS status_change_source TEXT NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS status_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS priority_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS priority_changed_by INTEGER REFERENCES public.system_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS priority_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.dev_agent_workline_reports (
    id                         BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    workline_id                BIGINT      NOT NULL REFERENCES public.dev_agent_worklines(id) ON DELETE CASCADE,
    title                      TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    report_type                TEXT        NOT NULL DEFAULT 'completion',
    outcome                    TEXT        NOT NULL DEFAULT 'completed',
    state                      TEXT        NOT NULL DEFAULT 'final',
    content                    TEXT        NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 20000),
    source_kind                TEXT        NOT NULL DEFAULT 'codex',
    source_ref                 TEXT        CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 500),
    tags                       TEXT[]      NOT NULL DEFAULT '{}'::TEXT[],
    metadata_json              JSONB       NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata_json) = 'object'),
    content_hash               TEXT        NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    supersedes_report_id       BIGINT      REFERENCES public.dev_agent_workline_reports(id) ON DELETE RESTRICT,
    redaction_reason           TEXT        CHECK (redaction_reason IS NULL OR char_length(btrim(redaction_reason)) BETWEEN 3 AND 500),
    created_by                 INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    created                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    state_changed              TIMESTAMPTZ NOT NULL DEFAULT now(),
    format_version             SMALLINT    NOT NULL DEFAULT 1,
    phase_gate                 TEXT,
    workline_status_snapshot   TEXT,
    changed_this_turn          BOOLEAN,
    context_text               TEXT,
    plain_language_text        TEXT,
    technical_text             TEXT,
    next_step_text             TEXT,
    snapshot_json              JSONB       NOT NULL DEFAULT '{}'::JSONB,
    git_head_commit            TEXT,
    git_worktree_state         TEXT,
    git_has_other_changes      BOOLEAN,
    git_workline_changed_paths TEXT[]      NOT NULL DEFAULT '{}'::TEXT[],
    current_phase              SMALLINT    NOT NULL DEFAULT 0,
    CONSTRAINT ck_dev_agent_workline_reports_type
        CHECK (report_type IN ('completion', 'progress', 'decision', 'closure')),
    CONSTRAINT ck_dev_agent_workline_reports_outcome
        CHECK (outcome IN ('completed', 'partial', 'blocked', 'no_change', 'decision')),
    CONSTRAINT ck_dev_agent_workline_reports_state
        CHECK (state IN ('final', 'superseded', 'redacted', 'archived')),
    CONSTRAINT ck_dev_agent_workline_reports_source_kind
        CHECK (source_kind ~ '^[a-z][a-z0-9_-]{0,39}$'),
    CONSTRAINT ck_dev_agent_workline_reports_not_self_superseding
        CHECK (supersedes_report_id IS NULL OR supersedes_report_id <> id),
    CONSTRAINT ck_dev_agent_workline_reports_format_version
        CHECK (format_version IN (1, 2)),
    CONSTRAINT ck_dev_agent_workline_reports_phase_gate
        CHECK (phase_gate IS NULL OR phase_gate IN ('2', '3-4', '5-6')),
    CONSTRAINT ck_dev_agent_workline_reports_status_snapshot
        CHECK (workline_status_snapshot IS NULL OR workline_status_snapshot IN ('active', 'paused', 'closed', 'archived')),
    CONSTRAINT ck_dev_agent_workline_reports_snapshot_json
        CHECK (jsonb_typeof(snapshot_json) = 'object'),
    CONSTRAINT ck_dev_agent_workline_reports_git_head
        CHECK (git_head_commit IS NULL OR git_head_commit ~ '^[a-f0-9]{7,64}$'),
    CONSTRAINT ck_dev_agent_workline_reports_git_state
        CHECK (git_worktree_state IS NULL OR git_worktree_state IN ('clean', 'dirty', 'unknown')),
    CONSTRAINT ck_dev_agent_workline_reports_git_scope
        CHECK (
            git_has_other_changes IS NULL
            OR (git_worktree_state = 'clean' AND git_has_other_changes = FALSE
                AND cardinality(git_workline_changed_paths) = 0)
            OR (git_worktree_state = 'dirty'
                AND (git_has_other_changes = TRUE OR cardinality(git_workline_changed_paths) > 0))
        ),
    CONSTRAINT ck_dev_agent_workline_reports_current_phase
        CHECK (current_phase BETWEEN 0 AND 6),
    CONSTRAINT ck_dev_agent_workline_reports_structured_shape
        CHECK (
            format_version = 1
            OR state = 'redacted'
            OR (
                phase_gate IS NOT NULL
                AND workline_status_snapshot IS NOT NULL
                AND changed_this_turn IS NOT NULL
                AND context_text IS NOT NULL
                AND char_length(btrim(context_text)) BETWEEN 1 AND 4000
                AND plain_language_text IS NOT NULL
                AND char_length(btrim(plain_language_text)) BETWEEN 1 AND 6000
                AND technical_text IS NOT NULL
                AND char_length(btrim(technical_text)) BETWEEN 1 AND 8000
                AND jsonb_typeof(snapshot_json) = 'object'
                AND git_head_commit IS NOT NULL
                AND git_worktree_state IS NOT NULL
                AND git_has_other_changes IS NOT NULL
                AND (
                    (workline_status_snapshot IN ('active', 'paused')
                        AND next_step_text IS NOT NULL
                        AND char_length(btrim(next_step_text)) BETWEEN 1 AND 4000)
                    OR (workline_status_snapshot IN ('closed', 'archived')
                        AND next_step_text IS NULL)
                )
            )
        )
);

ALTER TABLE public.dev_agent_workline_reports
    ADD COLUMN IF NOT EXISTS format_version SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS phase_gate TEXT,
    ADD COLUMN IF NOT EXISTS workline_status_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS changed_this_turn BOOLEAN,
    ADD COLUMN IF NOT EXISTS context_text TEXT,
    ADD COLUMN IF NOT EXISTS plain_language_text TEXT,
    ADD COLUMN IF NOT EXISTS technical_text TEXT,
    ADD COLUMN IF NOT EXISTS next_step_text TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS git_head_commit TEXT,
    ADD COLUMN IF NOT EXISTS git_worktree_state TEXT,
    ADD COLUMN IF NOT EXISTS git_has_other_changes BOOLEAN,
    ADD COLUMN IF NOT EXISTS git_workline_changed_paths TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS current_phase SMALLINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.dev_agent_workline_tasks (
    id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    workline_id BIGINT      NOT NULL REFERENCES public.dev_agent_worklines(id) ON DELETE CASCADE,
    task_id     INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    created_by  INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    created     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dev_agent_workline_tasks UNIQUE (workline_id, task_id)
);

CREATE TABLE IF NOT EXISTS public.dev_agent_handover_reports (
    id                     BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    title                  TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    state                  TEXT        NOT NULL DEFAULT 'final',
    source_kind            TEXT        NOT NULL DEFAULT 'codex',
    source_ref             TEXT        CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 500),
    tags                   TEXT[]      NOT NULL DEFAULT '{}'::TEXT[],
    metadata_json          JSONB       NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata_json) = 'object'),
    membership_hash        TEXT        NOT NULL CHECK (membership_hash ~ '^[a-f0-9]{64}$'),
    supersedes_handover_id BIGINT      REFERENCES public.dev_agent_handover_reports(id) ON DELETE RESTRICT,
    created_by             INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    created                TIMESTAMPTZ NOT NULL DEFAULT now(),
    state_changed          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_dev_agent_handover_reports_state
        CHECK (state IN ('final', 'superseded', 'archived')),
    CONSTRAINT ck_dev_agent_handover_reports_source_kind
        CHECK (source_kind ~ '^[a-z][a-z0-9_-]{0,39}$'),
    CONSTRAINT ck_dev_agent_handover_reports_not_self_superseding
        CHECK (supersedes_handover_id IS NULL OR supersedes_handover_id <> id)
);

CREATE TABLE IF NOT EXISTS public.dev_agent_handover_report_items (
    id                 BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    handover_report_id BIGINT      NOT NULL REFERENCES public.dev_agent_handover_reports(id) ON DELETE RESTRICT,
    workline_id        BIGINT      NOT NULL REFERENCES public.dev_agent_worklines(id) ON DELETE RESTRICT,
    workline_report_id BIGINT      NOT NULL REFERENCES public.dev_agent_workline_reports(id) ON DELETE RESTRICT,
    sort_order         INTEGER     NOT NULL CHECK (sort_order BETWEEN 1 AND 200),
    created            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dev_agent_handover_report_items_workline UNIQUE (handover_report_id, workline_id),
    CONSTRAINT uq_dev_agent_handover_report_items_report UNIQUE (handover_report_id, workline_report_id),
    CONSTRAINT uq_dev_agent_handover_report_items_order UNIQUE (handover_report_id, sort_order)
);

CREATE TABLE IF NOT EXISTS public.dev_agent_release_goals (
    id             BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    identity_key   TEXT        NOT NULL CHECK (identity_key ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
    version        INTEGER     NOT NULL CHECK (version >= 1),
    title          TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    outcome        TEXT        NOT NULL CHECK (char_length(btrim(outcome)) BETWEEN 1 AND 2000),
    decision_state TEXT        NOT NULL DEFAULT 'draft',
    is_selected    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_by     INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    locked_by      INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    created        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated        TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at      TIMESTAMPTZ,
    CONSTRAINT uq_dev_agent_release_goals_identity_version UNIQUE (identity_key, version),
    CONSTRAINT ck_dev_agent_release_goals_state CHECK (decision_state IN ('draft', 'locked')),
    CONSTRAINT ck_dev_agent_release_goals_lock_shape CHECK (
        (decision_state = 'draft' AND locked_at IS NULL)
        OR (decision_state = 'locked' AND locked_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS public.dev_agent_release_goal_contracts (
    id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    release_goal_id BIGINT      NOT NULL REFERENCES public.dev_agent_release_goals(id) ON DELETE RESTRICT,
    workline_id     BIGINT      NOT NULL REFERENCES public.dev_agent_worklines(id) ON DELETE RESTRICT,
    completion_rule TEXT        NOT NULL,
    target_phase    SMALLINT,
    created_by      INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    created         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dev_agent_release_goal_contracts_workline UNIQUE (release_goal_id, workline_id),
    CONSTRAINT ck_dev_agent_release_goal_contracts_rule CHECK (
        completion_rule IN ('must_complete', 'must_remain_incomplete', 'must_be_in_phase', 'must_not_start', 'outside_release')
    ),
    CONSTRAINT ck_dev_agent_release_goal_contracts_target_phase CHECK (
        (target_phase IS NULL OR target_phase BETWEEN 0 AND 6)
        AND (completion_rule <> 'must_be_in_phase' OR target_phase IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_dev_agent_worklines_status_updated
    ON public.dev_agent_worklines (status, updated DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_worklines_tags
    ON public.dev_agent_worklines USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_dev_agent_worklines_status_changed
    ON public.dev_agent_worklines (status_changed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_workline_reports_workline_created
    ON public.dev_agent_workline_reports (workline_id, created DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_workline_reports_state_created
    ON public.dev_agent_workline_reports (state, created DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_workline_reports_tags
    ON public.dev_agent_workline_reports USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_dev_agent_workline_tasks_task
    ON public.dev_agent_workline_tasks (task_id, workline_id);
CREATE INDEX IF NOT EXISTS idx_dev_agent_handover_reports_state_created
    ON public.dev_agent_handover_reports (state, created DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_handover_report_items_workline
    ON public.dev_agent_handover_report_items (workline_id, handover_report_id DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_handover_report_items_report
    ON public.dev_agent_handover_report_items (workline_report_id, handover_report_id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_agent_release_goals_selected
    ON public.dev_agent_release_goals (is_selected) WHERE is_selected = TRUE;
CREATE INDEX IF NOT EXISTS idx_dev_agent_release_goal_contracts_workline
    ON public.dev_agent_release_goal_contracts (workline_id, release_goal_id);

CREATE OR REPLACE FUNCTION public.set_dev_agent_worklines_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.protect_dev_agent_workline_report_history()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.state = 'redacted' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'redacted workline reports are terminal';
    END IF;

    IF NEW.state = 'redacted' AND OLD.state <> 'redacted' THEN
        IF NEW.title <> 'Redacted report'
           OR NEW.content <> '[redacted]'
           OR NEW.source_ref IS NOT NULL
           OR NEW.tags <> '{}'::TEXT[]
           OR NEW.metadata_json <> '{}'::JSONB
           OR NEW.context_text IS NOT NULL
           OR NEW.plain_language_text IS NOT NULL
           OR NEW.technical_text IS NOT NULL
           OR NEW.next_step_text IS NOT NULL
           OR NEW.snapshot_json <> '{}'::JSONB
           OR NEW.git_workline_changed_paths <> '{}'::TEXT[]
           OR NEW.redaction_reason IS NULL THEN
            RAISE EXCEPTION 'workline report redaction must remove all free-form fields';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.workline_id IS DISTINCT FROM OLD.workline_id
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.report_type IS DISTINCT FROM OLD.report_type
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
       OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.metadata_json IS DISTINCT FROM OLD.metadata_json
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.supersedes_report_id IS DISTINCT FROM OLD.supersedes_report_id
       OR NEW.redaction_reason IS DISTINCT FROM OLD.redaction_reason
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created IS DISTINCT FROM OLD.created
       OR NEW.format_version IS DISTINCT FROM OLD.format_version
       OR NEW.phase_gate IS DISTINCT FROM OLD.phase_gate
       OR NEW.current_phase IS DISTINCT FROM OLD.current_phase
       OR NEW.workline_status_snapshot IS DISTINCT FROM OLD.workline_status_snapshot
       OR NEW.changed_this_turn IS DISTINCT FROM OLD.changed_this_turn
       OR NEW.context_text IS DISTINCT FROM OLD.context_text
       OR NEW.plain_language_text IS DISTINCT FROM OLD.plain_language_text
       OR NEW.technical_text IS DISTINCT FROM OLD.technical_text
       OR NEW.next_step_text IS DISTINCT FROM OLD.next_step_text
       OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json
       OR NEW.git_head_commit IS DISTINCT FROM OLD.git_head_commit
       OR NEW.git_worktree_state IS DISTINCT FROM OLD.git_worktree_state
       OR NEW.git_has_other_changes IS DISTINCT FROM OLD.git_has_other_changes
       OR NEW.git_workline_changed_paths IS DISTINCT FROM OLD.git_workline_changed_paths THEN
        RAISE EXCEPTION 'workline report bodies are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.protect_dev_agent_handover_report_history()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
       OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.metadata_json IS DISTINCT FROM OLD.metadata_json
       OR NEW.membership_hash IS DISTINCT FROM OLD.membership_hash
       OR NEW.supersedes_handover_id IS DISTINCT FROM OLD.supersedes_handover_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created IS DISTINCT FROM OLD.created THEN
        RAISE EXCEPTION 'handover report manifests are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.protect_dev_agent_release_goal_contracts()
RETURNS TRIGGER AS $$
DECLARE
    resolved_goal_id BIGINT;
    resolved_state TEXT;
BEGIN
    resolved_goal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.release_goal_id ELSE NEW.release_goal_id END;
    SELECT decision_state INTO resolved_state
      FROM public.dev_agent_release_goals
     WHERE id = resolved_goal_id;
    IF resolved_state = 'locked' THEN
        RAISE EXCEPTION 'locked release goal contracts are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.protect_dev_agent_release_goal_lock()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.decision_state = 'locked' THEN
        IF NEW.identity_key IS DISTINCT FROM OLD.identity_key
           OR NEW.version IS DISTINCT FROM OLD.version
           OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.outcome IS DISTINCT FROM OLD.outcome
           OR NEW.decision_state IS DISTINCT FROM OLD.decision_state
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
           OR NEW.created IS DISTINCT FROM OLD.created
           OR NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
            RAISE EXCEPTION 'locked release goal identity is immutable';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.decision_state = 'locked' THEN
        IF EXISTS (
            SELECT 1
              FROM public.dev_agent_worklines AS worklines
             WHERE worklines.status = 'active'
               AND NOT EXISTS (
                    SELECT 1
                      FROM public.dev_agent_release_goal_contracts AS contracts
                     WHERE contracts.release_goal_id = NEW.id
                       AND contracts.workline_id = worklines.id
               )
        ) THEN
            RAISE EXCEPTION 'every active workline must be classified before locking a release goal';
        END IF;
        NEW.locked_at := COALESCE(NEW.locked_at, now());
    END IF;
    NEW.updated := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_dev_agent_worklines_updated ON public.dev_agent_worklines;
CREATE TRIGGER set_dev_agent_worklines_updated
    BEFORE UPDATE ON public.dev_agent_worklines
    FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_worklines_updated_timestamp();
DROP TRIGGER IF EXISTS protect_dev_agent_workline_report_history ON public.dev_agent_workline_reports;
CREATE TRIGGER protect_dev_agent_workline_report_history
    BEFORE UPDATE ON public.dev_agent_workline_reports
    FOR EACH ROW EXECUTE FUNCTION public.protect_dev_agent_workline_report_history();
DROP TRIGGER IF EXISTS protect_dev_agent_handover_report_history ON public.dev_agent_handover_reports;
CREATE TRIGGER protect_dev_agent_handover_report_history
    BEFORE UPDATE ON public.dev_agent_handover_reports
    FOR EACH ROW EXECUTE FUNCTION public.protect_dev_agent_handover_report_history();
DROP TRIGGER IF EXISTS protect_dev_agent_release_goal_contracts ON public.dev_agent_release_goal_contracts;
CREATE TRIGGER protect_dev_agent_release_goal_contracts
    BEFORE INSERT OR UPDATE OR DELETE ON public.dev_agent_release_goal_contracts
    FOR EACH ROW EXECUTE FUNCTION public.protect_dev_agent_release_goal_contracts();
DROP TRIGGER IF EXISTS protect_dev_agent_release_goal_lock ON public.dev_agent_release_goals;
CREATE TRIGGER protect_dev_agent_release_goal_lock
    BEFORE UPDATE ON public.dev_agent_release_goals
    FOR EACH ROW EXECUTE FUNCTION public.protect_dev_agent_release_goal_lock();

COMMENT ON TABLE public.dev_agent_worklines IS
    'Stable development work identities shared by reports and optional ticket links.';
COMMENT ON TABLE public.dev_agent_workline_reports IS
    'Append-first workline reports whose body is immutable after creation.';
COMMENT ON TABLE public.dev_agent_handover_reports IS
    'Immutable handover manifests referencing exact workline report versions.';
COMMENT ON TABLE public.dev_agent_release_goals IS
    'Versioned release decisions and their explicit workline completion contracts.';
-- 20260922000002_create_missing_deletion_log.sql
-- Creates the deletion log where an installation lacks it, with the access its writers need.
-- Bridges the generic row delete path (deletion_log_writer.go) and log retention
-- with one table every installation has.
-- Exists because the table came from a migration of the private development shell
-- that no public migration or bootstrap carried, so sites installed from the public
-- release logged the error relation "deletion_log" does not exist on every row delete.
-- A site that already has the table keeps it, its rows and its comments. Running
-- the file again changes nothing. The public bootstrap runs this same file, so a
-- new installation receives the same table.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- Same shape as the original, so the columns and constraint names match
-- wherever the table already exists.
DO $$
BEGIN
    IF to_regclass('public.deletion_log') IS NULL THEN
        CREATE TABLE public.deletion_log (
            id              SERIAL PRIMARY KEY,
            table_name      TEXT NOT NULL,
            record_id       TEXT NOT NULL,
            deleted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_by      TEXT,
            reason          TEXT,
            UNIQUE (table_name, record_id)
        );
        COMMENT ON TABLE public.deletion_log IS
            'Intentional row deletions, so that copying data between environments does not restore deleted records. Written by the generic row delete path.';
        COMMENT ON COLUMN public.deletion_log.table_name IS 'Name of the table the row was deleted from';
        COMMENT ON COLUMN public.deletion_log.record_id IS 'Primary key (id) of the deleted row, stored as text for universality';
        COMMENT ON COLUMN public.deletion_log.deleted_by IS 'Username or system identifier that performed the deletion';
        COMMENT ON COLUMN public.deletion_log.reason IS 'Reason category: user_request, admin, gdpr, cleanup, etc.';
    END IF;
END $$;

-- The delete path writes the log inside the transaction of the deleting
-- request, on the pool of the administrator or of the signed-in user.
-- INSERT ... ON CONFLICT DO NOTHING also needs SELECT, and the serial id needs
-- its sequence. A role an installation does not have is skipped; the role setup
-- of a new installation grants the same access to every table and sequence.
DO $$
DECLARE
    writer TEXT;
BEGIN
    FOREACH writer IN ARRAY ARRAY['admin_user', 'basic_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = writer) THEN
            EXECUTE format('GRANT SELECT, INSERT ON TABLE public.deletion_log TO %I', writer);
            EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.deletion_log_id_seq TO %I', writer);
        END IF;
    END LOOP;
END $$;
-- 20260926000001_restore_system_foreign_keys.sql
-- Restores the twenty system-table foreign keys some installations never received.
-- Bridges the system tables' own relationships with the row reader that turns a
-- foreign key into a readable companion column, and with the delete rules that keep
-- dependent system rows from outliving what they point at.
-- Exists because the public install schema shipped these tables without their
-- relationships, so a site installed from it can store a group right, a folder link
-- or a relation row whose target has gone, and shows a bare number where a site
-- that does have them shows a name.
-- The names and delete actions are the ones read from a site that has them, so a
-- repaired database and one that was already correct end up with the same schema.
-- A site that already has a constraint keeps it, running the file again changes
-- nothing, and a same-named constraint that states a different rule stops the
-- update instead of being skipped in silence.
-- The public bootstrap runs this same file, so a new installation is born with them.
-- VERSION_DB: 9.9.0
-- VERSION_DB_OWNER: 20260926000002_record_system_foreign_key_release.sql

DO $$
DECLARE
    -- One row per relationship: child table, constraint name, child column, parent
    -- table, parent column, and the delete rule as PostgreSQL stores it
    -- ('a' = NO ACTION, 'c' = CASCADE, 'n' = SET NULL). Fifteen cascade, three clear
    -- the column, two refuse the delete. The rules differ on purpose: a group right
    -- or a relation row means nothing once its target is gone, while a folder or a
    -- default view is a link whose loss must not take the dataset with it.
    intended CONSTANT text[][] := ARRAY[
        ['system_column_control',            'fk_system_column_control_column_uid',                'column_uid',         'system_column_details', 'column_uid', 'c'],
        ['system_column_control',            'fk_system_column_control_table_uid',                 'table_uid',          'system_db_tables',      'table_uid',  'c'],
        ['system_db_tables',                 'fk_system_db_tables_default_view_id',                'default_view_id',    'system_table_views',    'id',         'n'],
        ['system_db_tables',                 'fk_system_db_tables_folder_id',                      'folder_id',          'system_table_folders',  'id',         'a'],
        ['system_foreign_key_relations_1_m', 'fk_rel_1m_source_uid_fk',                            'source_table_uid',   'system_db_tables',      'table_uid',  'c'],
        ['system_foreign_key_relations_1_m', 'fk_rel_1m_target_uid_fk',                            'target_table_uid',   'system_db_tables',      'table_uid',  'c'],
        ['system_foreign_key_relations_m_m', 'fk_rel_mm_bridge_uid_fk',                            'bridging_table_uid', 'system_db_tables',      'table_uid',  'c'],
        ['system_foreign_key_relations_m_m', 'fk_rel_mm_table_a_uid_fk',                           'table_a_uid',        'system_db_tables',      'table_uid',  'c'],
        ['system_foreign_key_relations_m_m', 'fk_rel_mm_table_b_uid_fk',                           'table_b_uid',        'system_db_tables',      'table_uid',  'c'],
        ['system_group_table_func_rights',   'auth_group_func_rights_auth_user_group_id_fkey',     'user_group_id',      'system_user_groups',    'id',         'c'],
        ['system_group_table_func_rights',   'auth_group_func_rights_function_id_fkey',            'function_id',        'system_functions',      'id',         'c'],
        ['system_group_table_func_rights',   'auth_group_table_func_rights_target_table_uid_fkey', 'target_table_uid',   'system_db_tables',      'table_uid',  'c'],
        ['system_lang_key_sources',          'system_lang_key_sources_lang_key_id_fkey',           'lang_key_id',        'system_lang_keys',      'id',         'c'],
        ['system_table_folders',             'fk_table_folders_parent_id',                         'parent_id',          'system_table_folders',  'id',         'a'],
        ['system_table_folders',             'system_table_folders_admin_user_id_fkey',            'admin_user_id',      'system_users',          'id',         'n'],
        ['system_table_row_view_counts',     'fk_table_row_views_table_uid',                       'table_uid',          'system_db_tables',      'table_uid',  'c'],
        ['system_table_row_view_counts',     'fk_table_row_views_viewed_by_user_id',               'viewed_by_user_id',  'system_users',          'id',         'c'],
        ['system_transaction_log',           'fk_system_transaction_log_function_id',              'function_id',        'system_functions',      'id',         'n'],
        ['system_user_group_memberships',    'user_group_assignments_group_id_fkey',               'group_id',           'system_user_groups',    'id',         'c'],
        ['system_user_group_memberships',    'user_group_assignments_user_id_fkey',                'user_id',            'system_users',          'id',         'c']
    ];
    row_index integer;
    child_table text;
    constraint_name text;
    child_column text;
    parent_table text;
    parent_column text;
    delete_action "char";
    delete_clause text;
    child_relation oid;
    parent_relation oid;
    child_attnum smallint;
    parent_attnum smallint;
    present record;
    equivalent text;
    added integer := 0;
    kept integer := 0;
BEGIN
    FOR row_index IN 1 .. array_length(intended, 1) LOOP
        child_table     := intended[row_index][1];
        constraint_name := intended[row_index][2];
        child_column    := intended[row_index][3];
        parent_table    := intended[row_index][4];
        parent_column   := intended[row_index][5];
        delete_action   := intended[row_index][6]::"char";
        delete_clause   := CASE delete_action
                               WHEN 'c' THEN ' ON DELETE CASCADE'
                               WHEN 'n' THEN ' ON DELETE SET NULL'
                               ELSE ''
                           END;

        child_relation  := to_regclass(format('public.%I', child_table));
        parent_relation := to_regclass(format('public.%I', parent_table));
        IF child_relation IS NULL THEN
            RAISE EXCEPTION 'cannot restore %: this installation has no table public.%',
                constraint_name, child_table;
        END IF;
        IF parent_relation IS NULL THEN
            RAISE EXCEPTION 'cannot restore %: this installation has no table public.%',
                constraint_name, parent_table;
        END IF;

        SELECT a.attnum INTO child_attnum
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = child_relation AND a.attname = child_column
           AND a.attnum > 0 AND NOT a.attisdropped;
        SELECT a.attnum INTO parent_attnum
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = parent_relation AND a.attname = parent_column
           AND a.attnum > 0 AND NOT a.attisdropped;
        IF child_attnum IS NULL OR parent_attnum IS NULL THEN
            RAISE EXCEPTION 'cannot restore %: public.%.% or public.%.% is missing',
                constraint_name, child_table, child_column, parent_table, parent_column;
        END IF;

        -- A constraint of this name is already on this table. Accept it only when
        -- it states the same rule. Anything else is a name this installation gave
        -- to a different relationship, and adopting or skipping it in silence would
        -- leave two databases that report the same version but do not match.
        SELECT c.confrelid, c.conkey, c.confkey, c.confupdtype, c.confdeltype,
               c.confmatchtype, c.condeferrable, c.condeferred, c.convalidated,
               pg_catalog.pg_get_constraintdef(c.oid) AS definition
          INTO present
          FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = child_relation
           AND c.conname = constraint_name
           AND c.contype = 'f';
        IF FOUND THEN
            IF present.confrelid = parent_relation
               AND present.conkey = ARRAY[child_attnum]
               AND present.confkey = ARRAY[parent_attnum]
               AND present.confupdtype = 'a'::"char"
               AND present.confdeltype = delete_action
               AND present.confmatchtype = 's'::"char"
               AND NOT present.condeferrable
               AND NOT present.condeferred
               AND present.convalidated
            THEN
                kept := kept + 1;
                CONTINUE;
            END IF;
            RAISE EXCEPTION
                'constraint % on public.% states a different rule: % — this update expects FOREIGN KEY (%) REFERENCES public.%(%)%',
                constraint_name, child_table, present.definition,
                child_column, parent_table, parent_column, delete_clause;
        END IF;

        -- The same relationship under another name, for example the name PostgreSQL
        -- invents for an unnamed REFERENCES clause. The rule is already enforced and
        -- the interface already reads it, so a second copy would only make every
        -- insert on this table do the same check twice.
        SELECT c.conname INTO equivalent
          FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = child_relation
           AND c.contype = 'f'
           AND c.confrelid = parent_relation
           AND c.conkey = ARRAY[child_attnum]
         LIMIT 1;
        IF FOUND THEN
            RAISE NOTICE
                'public.%.% already references public.% under the name %; % was not added',
                child_table, child_column, parent_table, equivalent, constraint_name;
            kept := kept + 1;
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I)%s',
            child_table, constraint_name, child_column, parent_table, parent_column,
            delete_clause
        );
        added := added + 1;
    END LOOP;

    RAISE NOTICE 'system foreign keys: % added, % already present', added, kept;
END
$$;
-- 20260926000003_create_revoked_sign_in_store.sql
-- Creates the short list of sign-ins that have been signed out and must be refused.
-- Bridges the sign-out handler, which writes one row, and the authentication
-- boundary, which reads one row per request of a signed-in person.
-- Exists because a sign-in lives entirely in cookies: signing out expired them in
-- the browser and the server kept no record, so a request that was already in
-- flight wrote all three back and the person was signed in again without knowing.
-- One row refuses one browser's sign-in. Signing out on a phone must not sign the
-- same person out of their desktop, so nothing here names a user or an account.
-- A site that already has the table keeps it and its rows; running the file again
-- changes nothing. The public bootstrap runs this same file, so a new installation
-- is born with it.
-- VERSION_DB: 9.9.0
-- VERSION_DB_OWNER: 20260926000002_record_system_foreign_key_release.sql

DO $$
BEGIN
    IF to_regclass('public.system_revoked_sign_ins') IS NULL THEN
        CREATE TABLE public.system_revoked_sign_ins (
            -- The sign-in's own identity, minted at sign-in and carried inside the
            -- signed session cookie. It is the only thing stored about the sign-in:
            -- the record has to answer one question and must not become a log of
            -- who signed out from where.
            sign_in_id TEXT PRIMARY KEY,
            revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- When this record stops refusing. It is written as the sign-in
            -- lifetime the application states in
            -- backend/core_components/sessions/auth_cookie_identity.go, counted
            -- from the database's own clock, so the record always outlives the
            -- cookies it refuses.
            expires_at TIMESTAMPTZ NOT NULL
        );
        COMMENT ON TABLE public.system_revoked_sign_ins IS
            'Sign-ins that have been signed out and must be refused until they would have run out anyway. One row per signed-out browser session; carries no user, address or browser data.';
        COMMENT ON COLUMN public.system_revoked_sign_ins.sign_in_id IS
            'Opaque per-sign-in identity from the signed session cookie';
        COMMENT ON COLUMN public.system_revoked_sign_ins.revoked_at IS
            'When the person signed out';
        COMMENT ON COLUMN public.system_revoked_sign_ins.expires_at IS
            'When this record stops refusing; the row is removed by the next sign-out';
    END IF;
END $$;

-- Both things done to this table are bounded by time: the check reads only
-- records that are still current, and each sign-out removes the ones that are not.
CREATE INDEX IF NOT EXISTS idx_system_revoked_sign_ins_expires_at
    ON public.system_revoked_sign_ins (expires_at);

-- The application writes and reads this table on the role that runs migrations,
-- which owns it and needs no grant. A read-only role is given the same look at it
-- as at every other system table, so an operator can see why a sign-in is being
-- refused. A role an installation does not have is skipped.
DO $$
DECLARE
    read_role TEXT;
BEGIN
    FOR read_role IN
        SELECT rolname
          FROM pg_catalog.pg_roles
         WHERE rolname IN ('readeronly', 'filterest_readonly', 'readonly_user')
    LOOP
        EXECUTE format('GRANT SELECT ON TABLE public.system_revoked_sign_ins TO %I', read_role);
    END LOOP;
END $$;
-- 20261005000001_add_row_actor_support.sql
-- Creates the support every content dataset's creator and owner columns rest on: the
-- actor marks that name those columns for good, the repair record every data step of
-- this release writes, the functions that add, constrain, register, read and check the
-- columns, and the triggers that keep the two internal tables writable only by their
-- owner role. Nothing in the application uses them yet.
-- Bridges the release's data file (000004), dataset creation and the public bootstrap
-- with one definition of an actor column, so the three cannot drift apart.
-- Exists because a column called owner_id says nothing by itself: the marks are the
-- lasting answer to which column holds a row's creator and owner, every protection
-- reads them, and the registry's owner setting is bound to them.
-- The file is schema only. Its one row is its own completion marker, which the public
-- bootstrap's acceptance block requires. Running it again changes nothing. WL58 stage 2
-- plan v14 (v13 sections 1.3-1.7 and 3.7) describes every part.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl58_row_actor_support

-- 1. The repair record: what each data step changed, by identifier only, never a name.
-- No foreign keys, so the history survives a user's deletion.
CREATE TABLE IF NOT EXISTS public.system_data_repair_records (
    id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    migration   text        NOT NULL,
    table_name  text,
    row_id      text,
    column_name text,
    old_value   text,
    new_value   text,
    action      text        NOT NULL,
    detail      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_data_repair_records_migration_action
    ON public.system_data_repair_records (migration, action, table_name);
COMMENT ON TABLE public.system_data_repair_records IS
    'Immutable record of what data migrations changed, by identifier only; visible to the table owner role alone.';

-- 2. The actor marks: which column holds each marked dataset's creator and owner.
-- Keyed by the registry id, which survives a dataset's rename; deleting the registry
-- row takes its marks with it, so a new dataset of the same name never inherits them.
CREATE TABLE IF NOT EXISTS public.system_row_actor_columns (
    table_id    bigint      NOT NULL REFERENCES public.system_db_tables(id) ON DELETE CASCADE,
    actor_role  text        NOT NULL CHECK (actor_role IN ('creator', 'owner')),
    column_name text        NOT NULL,
    marked_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (table_id, actor_role)
);
COMMENT ON TABLE public.system_row_actor_columns IS
    'Permanent marks naming each marked dataset''s creator and owner columns; written only by the table owner role.';

-- 3. Writes only by the owner role. The installation's roles may hold write rights on
-- every public table and their names vary, so the guard is a trigger, not a privilege:
-- only the table's owner, a member of it or a superuser passes. It runs with the
-- caller's rights. A registry deletion's cascade runs as the marks table's owner.
CREATE OR REPLACE FUNCTION public.app_owner_only_writes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT pg_has_role(current_user,
         (SELECT relowner FROM pg_catalog.pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
        RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege',
            MESSAGE = format('only the owner role of %s may write it', TG_TABLE_NAME);
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS owner_only_writes ON public.system_row_actor_columns;
CREATE TRIGGER owner_only_writes
    BEFORE INSERT OR UPDATE OR DELETE ON public.system_row_actor_columns
    FOR EACH ROW EXECUTE FUNCTION public.app_owner_only_writes();
DROP TRIGGER IF EXISTS owner_only_truncate ON public.system_row_actor_columns;
CREATE TRIGGER owner_only_truncate
    BEFORE TRUNCATE ON public.system_row_actor_columns
    FOR EACH STATEMENT EXECUTE FUNCTION public.app_owner_only_writes();
DROP TRIGGER IF EXISTS owner_only_writes ON public.system_data_repair_records;
CREATE TRIGGER owner_only_writes
    BEFORE INSERT OR UPDATE OR DELETE ON public.system_data_repair_records
    FOR EACH ROW EXECUTE FUNCTION public.app_owner_only_writes();
DROP TRIGGER IF EXISTS owner_only_truncate ON public.system_data_repair_records;
CREATE TRIGGER owner_only_truncate
    BEFORE TRUNCATE ON public.system_data_repair_records
    FOR EACH STATEMENT EXECUTE FUNCTION public.app_owner_only_writes();

-- The repair record is read by administrators through the administrator connection
-- only. Row security hides its rows from every other role, whatever rights the
-- installation gave them; the start-up refuses a runtime role that bypasses it.
ALTER TABLE public.system_data_repair_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS repair_records_owner_role ON public.system_data_repair_records;
CREATE POLICY repair_records_owner_role ON public.system_data_repair_records
    USING (pg_has_role(current_user, (SELECT relowner FROM pg_catalog.pg_class
                                      WHERE oid = 'public.system_data_repair_records'::regclass), 'MEMBER'))
    WITH CHECK (pg_has_role(current_user, (SELECT relowner FROM pg_catalog.pg_class
                                           WHERE oid = 'public.system_data_repair_records'::regclass), 'MEMBER'));

-- 4. The registry's owner setting stays the marked owner column. The setting is the
-- compatibility copy stage 1's resolver and the card visibility read; the mark decides.
CREATE OR REPLACE FUNCTION public.protect_row_owner_setting() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.system_row_actor_columns AS marked
               WHERE marked.table_id = OLD.id AND marked.actor_role = 'owner'
                 AND marked.column_name IS DISTINCT FROM NEW.row_policy_owner_column) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'row_owner_setting_fixed',
            MESSAGE = 'row owner setting is fixed to the marked owner column';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_row_owner_setting ON public.system_db_tables;
CREATE TRIGGER protect_row_owner_setting
    BEFORE UPDATE OF row_policy_owner_column ON public.system_db_tables
    FOR EACH ROW EXECUTE FUNCTION public.protect_row_owner_setting();

-- 5. The person behind the current request, set per transaction by the application
-- (dbutils.ApplyRequestActorToTx). A visitor ('1') and any connection without a
-- request give NULL, so a default built on it never invents an author.
CREATE OR REPLACE FUNCTION public.app_request_actor_id() RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN s ~ '^[0-9]{1,18}$' AND s::bigint > 1 THEN s::bigint END
    FROM (SELECT current_setting('app.user_id', true) AS s) AS actor
$$;

-- 6. Deleting a user empties the references to that user (ON DELETE SET NULL) and
-- nothing else. These two helpers recognise exactly that change.
CREATE OR REPLACE FUNCTION public.app_user_reference_cleared(old_value bigint, new_value bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT old_value IS NOT NULL AND new_value IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.system_users WHERE id = old_value)
$$;

CREATE OR REPLACE FUNCTION public.app_only_deleted_user_references_cleared(
    old_row jsonb, new_row jsonb, reference_columns text[])
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT (old_row - reference_columns - 'updated') = (new_row - reference_columns - 'updated')
       AND EXISTS (
           SELECT 1 FROM unnest(reference_columns) AS reference(name)
           WHERE (old_row ->> reference.name) IS DISTINCT FROM (new_row ->> reference.name))
       AND NOT EXISTS (
           SELECT 1 FROM unnest(reference_columns) AS reference(name)
           WHERE (old_row ->> reference.name) IS DISTINCT FROM (new_row ->> reference.name)
             AND NOT public.app_user_reference_cleared((old_row ->> reference.name)::bigint,
                                                       (new_row ->> reference.name)::bigint))
$$;

-- A row's creator never changes, except that deleting the creator's account empties it.
CREATE OR REPLACE FUNCTION public.protect_row_creator() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by
       AND NOT public.app_user_reference_cleared(OLD.created_by, NEW.created_by) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'row_creator_immutable',
            MESSAGE = 'row creator is immutable';
    END IF;
    RETURN NEW;
END $$;

-- 7. Turn a table's own triggers off for the duration of a data step and back to
-- exactly the state each had: a data step must not stamp old rows as modified, and a
-- history guard must not refuse the step. The list's shape ([{"name", "state"}]) is
-- shared with every caller. A trigger that was already off stays off.
CREATE OR REPLACE FUNCTION public.app_suspend_row_triggers(target regclass)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    saved jsonb := '[]'::jsonb;
    t record;
BEGIN
    FOR t IN SELECT tgname, tgenabled FROM pg_catalog.pg_trigger
             WHERE tgrelid = target AND NOT tgisinternal AND tgenabled <> 'D'
             ORDER BY tgname LOOP
        saved := saved || jsonb_build_object('name', t.tgname, 'state', t.tgenabled::text);
        EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', target, t.tgname);
    END LOOP;
    RETURN saved;
END $$;

CREATE OR REPLACE FUNCTION public.app_restore_row_triggers(target regclass, saved jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    item jsonb;
BEGIN
    FOR item IN SELECT value FROM jsonb_array_elements(saved) LOOP
        EXECUTE format('ALTER TABLE %s %s TRIGGER %I', target,
            CASE item->>'state' WHEN 'O' THEN 'ENABLE' WHEN 'R' THEN 'ENABLE REPLICA'
                                WHEN 'A' THEN 'ENABLE ALWAYS' END,
            item->>'name');
    END LOOP;
END $$;

-- 8. Object names: prefix_table_column, shortened with a stable digest past
-- PostgreSQL's 63-byte limit, so a rerun finds what an earlier run created.
CREATE OR REPLACE FUNCTION public.app_row_actor_object_name(prefix text, table_name text, column_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    full_name text := prefix || '_' || table_name || '_' || column_name;
    kept text;
BEGIN
    IF octet_length(full_name) <= 63 THEN
        RETURN full_name;
    END IF;
    kept := full_name;
    WHILE octet_length(kept) > 52 LOOP
        kept := left(kept, char_length(kept) - 1);
    END LOOP;
    RETURN kept || '_' || substr(md5(full_name), 1, 10);
END $$;

-- 9. Tables whose name says they are not content (rules R1-R5): their rows are system
-- records, attachments, embeddings, links or history, so they get no actor columns.
-- Both this release's data file and dataset creation ask here; the structural rules
-- (R4's link-table shape, R6-R8) need an existing table and live in the data file.
CREATE OR REPLACE FUNCTION public.app_row_actor_side_table_reason(table_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN lower(table_name) LIKE 'system\_%' AND lower(table_name) <> 'system_about'
            THEN 'R1: system table'
        WHEN lower(table_name) LIKE '%\_assets' THEN 'R2: attachment table'
        WHEN lower(table_name) LIKE '%\_lang\_embeddings' THEN 'R3: language embedding table'
        WHEN lower(table_name) ~ '_relations?$' THEN 'R4: link table'
        WHEN lower(table_name) ~ '_(log|logs|audit|audit_log|events|history|runs)$'
            THEN 'R5: log or history table'
    END
$$;

-- 10. The columns themselves: created_by always, and owner_id when the owner column is
-- owner_id. An existing column must be integer or bigint and not generated; a missing
-- one is added as a nullable bigint without a default, which rewrites nothing.
CREATE OR REPLACE FUNCTION public.app_ensure_row_actor_columns(target regclass, owner_column text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    changes jsonb := '[]'::jsonb;
    actor_column text;
    existing record;
BEGIN
    IF owner_column IS NULL OR owner_column = '' OR owner_column = 'created_by' THEN
        RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value',
            MESSAGE = format('%s: the owner column must be named and differ from created_by', target);
    END IF;
    FOREACH actor_column IN ARRAY ARRAY['created_by', owner_column] LOOP
        SELECT attribute.atttypid, attribute.attgenerated INTO existing
          FROM pg_catalog.pg_attribute AS attribute
         WHERE attribute.attrelid = target AND attribute.attname = actor_column
           AND attribute.attnum > 0 AND NOT attribute.attisdropped;
        IF FOUND THEN
            IF existing.atttypid NOT IN ('integer'::regtype, 'bigint'::regtype) OR existing.attgenerated <> '' THEN
                RAISE EXCEPTION USING ERRCODE = 'datatype_mismatch',
                    MESSAGE = format('%s.%s must be an integer or bigint column that is not generated',
                                     target, actor_column);
            END IF;
        ELSIF actor_column IN ('created_by', 'owner_id') THEN
            EXECUTE format('ALTER TABLE %s ADD COLUMN %I bigint', target, actor_column);
            changes := changes || jsonb_build_object('action', 'column_added', 'column', actor_column);
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'undefined_column',
                MESSAGE = format('%s: the kept owner column %s does not exist', target, actor_column);
        END IF;
    END LOOP;
    RETURN changes;
END $$;

-- 11. Each actor column's foreign key, index, default and, for the creator, its guard
-- trigger. Only what is missing is made, so the function can always run again.
CREATE OR REPLACE FUNCTION public.app_ensure_row_actor_constraints(target regclass, owner_column text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    changes jsonb := '[]'::jsonb;
    table_name text := (SELECT relname FROM pg_catalog.pg_class WHERE oid = target);
    actor_column text;
    column_number smallint;
    users_id_number smallint := (SELECT attnum FROM pg_catalog.pg_attribute
                                 WHERE attrelid = 'public.system_users'::regclass AND attname = 'id');
    reference record;
    reference_count integer;
    other_reference_count integer;
    wanted_name text;
    existing_index record;
    default_expression text;
    trigger_name text := public.app_row_actor_object_name('protect', table_name, 'creator');
    existing_trigger record;
BEGIN
    FOREACH actor_column IN ARRAY ARRAY['created_by', owner_column] LOOP
        SELECT attnum INTO column_number FROM pg_catalog.pg_attribute
         WHERE attrelid = target AND attname = actor_column AND attnum > 0 AND NOT attisdropped;
        IF column_number IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'undefined_column',
                MESSAGE = format('%s.%s does not exist', target, actor_column);
        END IF;

        -- Foreign key: one to system_users(id), ON DELETE SET NULL, simple, not deferrable.
        SELECT count(*) FILTER (WHERE confrelid = 'public.system_users'::regclass
                                  AND confkey = ARRAY[users_id_number]),
               count(*) FILTER (WHERE NOT (confrelid = 'public.system_users'::regclass
                                           AND confkey = ARRAY[users_id_number]))
          INTO reference_count, other_reference_count
          FROM pg_catalog.pg_constraint
         WHERE conrelid = target AND contype = 'f' AND column_number = ANY(conkey);
        IF other_reference_count > 0 OR reference_count > 1 THEN
            RAISE EXCEPTION USING ERRCODE = 'invalid_foreign_key',
                MESSAGE = format('%s.%s must reference only system_users(id), once', target, actor_column);
        END IF;
        IF reference_count = 1 THEN
            SELECT oid, conname, confdeltype, confmatchtype, condeferrable, convalidated,
                   pg_get_constraintdef(oid) AS definition
              INTO reference
              FROM pg_catalog.pg_constraint
             WHERE conrelid = target AND contype = 'f' AND conkey = ARRAY[column_number];
            IF reference.oid IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'invalid_foreign_key',
                    MESSAGE = format('%s.%s: its foreign key also covers other columns', target, actor_column);
            END IF;
            IF reference.confdeltype <> 'n' OR reference.confmatchtype <> 's' OR reference.condeferrable THEN
                RAISE EXCEPTION USING ERRCODE = 'invalid_foreign_key',
                    MESSAGE = format('%s.%s: foreign key %s must be ON DELETE SET NULL, simple and not deferrable: %s',
                                     target, actor_column, reference.conname, reference.definition);
            END IF;
            IF NOT reference.convalidated THEN
                EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', target, reference.conname);
                changes := changes || jsonb_build_object('action', 'fk_validated', 'column', actor_column,
                                                         'constraint', reference.conname);
            END IF;
        ELSE
            wanted_name := public.app_row_actor_object_name('fk', table_name, actor_column);
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = target AND conname = wanted_name) THEN
                RAISE EXCEPTION USING ERRCODE = 'duplicate_object',
                    MESSAGE = format('%s: constraint %s already exists with another definition', target, wanted_name);
            END IF;
            EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) '
                           'REFERENCES public.system_users(id) ON DELETE SET NULL NOT VALID',
                           target, wanted_name, actor_column);
            EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', target, wanted_name);
            changes := changes || jsonb_build_object('action', 'fk_added', 'column', actor_column,
                                                     'constraint', wanted_name);
        END IF;

        -- Index: a valid, ready, non-partial btree whose first key is the column itself.
        -- Only an invalid index (a failed concurrent build) under the wanted name is
        -- replaced. A valid index that does not qualify, such as a partial unique one,
        -- keeps its rule untouched, and the helper index gets another name.
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_index AS index_row
            JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_row.indexrelid
            JOIN pg_catalog.pg_am AS method ON method.oid = index_class.relam
            WHERE index_row.indrelid = target AND method.amname = 'btree'
              AND index_row.indisvalid AND index_row.indisready AND index_row.indpred IS NULL
              AND index_row.indkey[0] = column_number) THEN
            wanted_name := public.app_row_actor_object_name('idx', table_name, actor_column);
            SELECT index_class.oid, index_row.indrelid, index_row.indisvalid INTO existing_index
              FROM pg_catalog.pg_class AS index_class
              JOIN pg_catalog.pg_index AS index_row ON index_row.indexrelid = index_class.oid
             WHERE index_class.relname = wanted_name
               AND index_class.relnamespace = (SELECT relnamespace FROM pg_catalog.pg_class WHERE oid = target);
            IF FOUND AND existing_index.indrelid = target AND NOT existing_index.indisvalid THEN
                EXECUTE format('DROP INDEX %s', existing_index.oid::regclass);
                changes := changes || jsonb_build_object('action', 'invalid_index_replaced', 'column', actor_column,
                                                         'index', wanted_name);
            ELSIF FOUND THEN
                wanted_name := public.app_row_actor_object_name('idx', table_name, actor_column || '_actor');
                IF to_regclass(format('%I.%I',
                       (SELECT nspname FROM pg_catalog.pg_namespace
                         WHERE oid = (SELECT relnamespace FROM pg_catalog.pg_class WHERE oid = target)),
                       wanted_name)) IS NOT NULL THEN
                    RAISE EXCEPTION USING ERRCODE = 'duplicate_object',
                        MESSAGE = format('%s: index names for %s are taken by other indexes', target, actor_column);
                END IF;
            END IF;
            changes := changes || COALESCE((
                SELECT jsonb_agg(jsonb_build_object('action', 'index_not_qualifying', 'column', actor_column,
                                                    'index', index_class.relname) ORDER BY index_class.relname)
                  FROM pg_catalog.pg_index AS index_row
                  JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_row.indexrelid
                 WHERE index_row.indrelid = target AND column_number = ANY(index_row.indkey)), '[]'::jsonb);
            EXECUTE format('CREATE INDEX %I ON %s (%I)', wanted_name, target, actor_column);
            changes := changes || jsonb_build_object('action', 'index_added', 'column', actor_column,
                                                     'index', wanted_name);
        END IF;

        -- Default: the request's actor. A kept site owner column keeps a default of its own.
        SELECT pg_get_expr(column_default.adbin, column_default.adrelid) INTO default_expression
          FROM pg_catalog.pg_attrdef AS column_default
         WHERE column_default.adrelid = target AND column_default.adnum = column_number;
        IF default_expression IS NULL
           OR (actor_column IN ('created_by', 'owner_id')
               AND default_expression NOT IN ('app_request_actor_id()', 'public.app_request_actor_id()')) THEN
            EXECUTE format('ALTER TABLE %s ALTER COLUMN %I SET DEFAULT public.app_request_actor_id()',
                           target, actor_column);
            changes := changes || jsonb_build_object('action', 'default_added', 'column', actor_column,
                                                     'old_value', default_expression);
        END IF;
        default_expression := NULL;
        column_number := NULL;
    END LOOP;

    -- The creator's guard: created_by never changes, except when its user is deleted.
    SELECT trigger_row.tgenabled, trigger_row.tgfoid INTO existing_trigger
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = target AND trigger_row.tgname = trigger_name AND NOT trigger_row.tgisinternal;
    IF NOT FOUND THEN
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF created_by ON %s '
                       'FOR EACH ROW EXECUTE FUNCTION public.protect_row_creator()', trigger_name, target);
        changes := changes || jsonb_build_object('action', 'creator_trigger_added', 'trigger', trigger_name);
    ELSIF existing_trigger.tgfoid <> 'public.protect_row_creator()'::regprocedure THEN
        RAISE EXCEPTION USING ERRCODE = 'duplicate_object',
            MESSAGE = format('%s: trigger %s exists with another function', target, trigger_name);
    END IF;
    RETURN changes;
END $$;

-- 12. Registration: the columns' metadata, the actor marks with the registry setting,
-- and the relation rows of the two foreign keys. The marks and the setting are written
-- once, marks first; after that the setting follows the mark and nothing here rewrites
-- either. A metadata row the generic synchronisation already made keeps the role an
-- administrator chose; only insert and edit are closed on it.
CREATE OR REPLACE FUNCTION public.app_register_row_actor_columns(registry_id bigint, owner_column text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    changes jsonb := '[]'::jsonb;
    registry record;
    target regclass;
    users_table_uid integer;
    actor record;
    previous_flag boolean;
BEGIN
    SELECT id, table_uid, table_name, COALESCE(schema_name, 'public') AS schema_name, row_policy_owner_column
      INTO registry
      FROM public.system_db_tables WHERE id = registry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'no_data_found',
            MESSAGE = format('registry row %s does not exist', registry_id);
    END IF;
    target := format('%I.%I', registry.schema_name, registry.table_name)::regclass;

    FOR actor IN
        SELECT * FROM (VALUES ('creator', 'created_by', 'WL58 row creator'),
                              ('owner', owner_column, 'WL58 row owner')) AS wanted (role, column_name, spec)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM public.system_column_details
                       WHERE table_uid = registry.table_uid AND column_name = actor.column_name) THEN
            INSERT INTO public.system_column_details
                (table_uid, column_name, data_type, co_number, lang_key, card_element, insertable,
                 editable_in_ui, hide_in_filter_panel, show_value_on_card, creation_spec)
            SELECT registry.table_uid, actor.column_name, format_type(attribute.atttypid, attribute.atttypmod),
                   attribute.attnum, actor.column_name, 'hidden', FALSE, FALSE, TRUE, TRUE, actor.spec
              FROM pg_catalog.pg_attribute AS attribute
             WHERE attribute.attrelid = target AND attribute.attname = actor.column_name;
            changes := changes || jsonb_build_object('action', 'column_metadata_added', 'column', actor.column_name);
        ELSE
            UPDATE public.system_column_details
               SET insertable = FALSE, editable_in_ui = FALSE, updated = now()
             WHERE table_uid = registry.table_uid AND column_name = actor.column_name
               AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
            IF FOUND THEN
                changes := changes || jsonb_build_object('action', 'column_metadata_locked', 'column', actor.column_name);
            END IF;
        END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.system_row_actor_columns
                   WHERE table_id = registry.id AND actor_role = 'owner') THEN
        INSERT INTO public.system_row_actor_columns (table_id, actor_role, column_name)
        VALUES (registry.id, 'creator', 'created_by')
        ON CONFLICT (table_id, actor_role) DO NOTHING;
        INSERT INTO public.system_row_actor_columns (table_id, actor_role, column_name)
        VALUES (registry.id, 'owner', owner_column);
        changes := changes || jsonb_build_object('action', 'actor_columns_marked',
                                                 'creator', 'created_by', 'owner', owner_column);
        IF registry.row_policy_owner_column IS DISTINCT FROM owner_column THEN
            UPDATE public.system_db_tables SET row_policy_owner_column = owner_column, updated = now()
             WHERE id = registry.id;
            changes := changes || jsonb_build_object('action', 'registry_owner_moved',
                                                     'old_value', registry.row_policy_owner_column,
                                                     'new_value', owner_column);
        END IF;
    END IF;

    -- A relation row lets the generic synchronisation recognise the two keys; a new
    -- source row must never be inserted with its user, so the flag is FALSE.
    SELECT table_uid INTO users_table_uid FROM public.system_db_tables
     WHERE COALESCE(schema_name, 'public') = 'public' AND table_name = 'system_users';
    IF users_table_uid IS NOT NULL THEN
        FOR actor IN SELECT unnest(ARRAY['created_by', owner_column]) AS column_name LOOP
            SELECT insert_new_source_with_target INTO previous_flag
              FROM public.system_foreign_key_relations_1_m
             WHERE source_table_uid = registry.table_uid AND target_table_uid = users_table_uid
               AND source_column_name = actor.column_name AND target_column_name = 'id';
            IF NOT FOUND THEN
                INSERT INTO public.system_foreign_key_relations_1_m
                    (source_table_uid, source_column_name, target_table_uid, target_column_name,
                     reference_direction, insert_new_source_with_target, source_insert_specs)
                VALUES (registry.table_uid, actor.column_name, users_table_uid, 'id',
                        registry.table_name || '->system_users', FALSE, '{}'::jsonb);
            ELSIF previous_flag IS DISTINCT FROM FALSE THEN
                UPDATE public.system_foreign_key_relations_1_m
                   SET insert_new_source_with_target = FALSE, updated = now()
                 WHERE source_table_uid = registry.table_uid AND target_table_uid = users_table_uid
                   AND source_column_name = actor.column_name AND target_column_name = 'id';
                changes := changes || jsonb_build_object('action', 'relation_flag_changed',
                                                         'column', actor.column_name, 'old_value', previous_flag);
            END IF;
        END LOOP;
    END IF;
    RETURN changes;
END $$;

-- 13. Reading the marks: the creator or owner column of a table, or NULL when the table
-- has no such mark. Never assume a column name (user_id, owner_id) instead.
CREATE OR REPLACE FUNCTION public.app_row_actor_column(target regclass, actor_role text)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT marked.column_name
      FROM public.system_row_actor_columns AS marked
      JOIN public.system_db_tables AS registry ON registry.id = marked.table_id
      JOIN pg_catalog.pg_class AS relation ON relation.oid = target
      JOIN pg_catalog.pg_namespace AS relation_schema ON relation_schema.oid = relation.relnamespace
     WHERE COALESCE(registry.schema_name, 'public') = relation_schema.nspname
       AND registry.table_name = relation.relname
       AND marked.actor_role = app_row_actor_column.actor_role
$$;

-- 14. The final check every structural file of this release ends with, and the public
-- bootstrap's acceptance block runs: each line is one contradiction, none means sound.
-- It checks meaning, not names: the setting against the mark, the columns' types,
-- one validated SET NULL key to system_users(id), the creator's enabled guard, and the
-- guards of the two internal tables and of the registry.
CREATE OR REPLACE FUNCTION public.app_check_row_actor_marks()
RETURNS SETOF text LANGUAGE plpgsql STABLE AS $$
DECLARE
    marked record;
    target regclass;
    column_row record;
    users_id_number smallint := (SELECT attnum FROM pg_catalog.pg_attribute
                                 WHERE attrelid = 'public.system_users'::regclass AND attname = 'id');
    guard record;
BEGIN
    -- A guard counts only when it fires on ordinary writes ('O' origin or 'A' always,
    -- not 'R' replica-only) and runs its own function.
    FOR guard IN
        SELECT * FROM (VALUES ('public.system_row_actor_columns', 'owner_only_writes', 'public.app_owner_only_writes()'),
                              ('public.system_row_actor_columns', 'owner_only_truncate', 'public.app_owner_only_writes()'),
                              ('public.system_data_repair_records', 'owner_only_writes', 'public.app_owner_only_writes()'),
                              ('public.system_data_repair_records', 'owner_only_truncate', 'public.app_owner_only_writes()'),
                              ('public.system_db_tables', 'protect_row_owner_setting', 'public.protect_row_owner_setting()'))
                 AS wanted (table_name, trigger_name, function_name)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                       WHERE tgrelid = guard.table_name::regclass AND tgname = guard.trigger_name
                         AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                         AND tgfoid = guard.function_name::regprocedure) THEN
            RETURN NEXT format('%s: guard trigger %s is missing, not firing on ordinary writes or not running %s',
                               guard.table_name, guard.trigger_name, guard.function_name);
        END IF;
    END LOOP;
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.system_data_repair_records'::regclass) THEN
        RETURN NEXT 'public.system_data_repair_records: row security is off';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                   WHERE polrelid = 'public.system_data_repair_records'::regclass
                     AND polname = 'repair_records_owner_role') THEN
        RETURN NEXT 'public.system_data_repair_records: policy repair_records_owner_role is missing';
    END IF;

    FOR marked IN
        SELECT registry.id AS table_id, registry.table_name, COALESCE(registry.schema_name, 'public') AS schema_name,
               registry.row_policy_owner_column,
               max(mark.column_name) FILTER (WHERE mark.actor_role = 'creator') AS creator_column,
               max(mark.column_name) FILTER (WHERE mark.actor_role = 'owner') AS owner_column
          FROM public.system_row_actor_columns AS mark
          JOIN public.system_db_tables AS registry ON registry.id = mark.table_id
         GROUP BY registry.id, registry.table_name, registry.schema_name, registry.row_policy_owner_column
         ORDER BY registry.table_name
    LOOP
        target := to_regclass(format('%I.%I', marked.schema_name, marked.table_name));
        IF target IS NULL THEN
            RETURN NEXT format('%s: marked table does not exist', marked.table_name);
            CONTINUE;
        END IF;
        IF marked.creator_column IS NULL OR marked.owner_column IS NULL THEN
            RETURN NEXT format('%s: needs both a creator and an owner mark', marked.table_name);
        END IF;
        IF marked.owner_column IS DISTINCT FROM marked.row_policy_owner_column THEN
            RETURN NEXT format('%s: registry owner setting %s differs from the owner mark %s',
                               marked.table_name, COALESCE(marked.row_policy_owner_column, '(empty)'),
                               COALESCE(marked.owner_column, '(none)'));
        END IF;
        FOR column_row IN
            SELECT wanted.role, wanted.column_name, attribute.attnum, attribute.atttypid
              FROM (VALUES ('creator', marked.creator_column), ('owner', marked.owner_column))
                   AS wanted (role, column_name)
              LEFT JOIN pg_catalog.pg_attribute AS attribute
                ON attribute.attrelid = target AND attribute.attname = wanted.column_name
               AND attribute.attnum > 0 AND NOT attribute.attisdropped
             WHERE wanted.column_name IS NOT NULL
        LOOP
            IF column_row.attnum IS NULL THEN
                RETURN NEXT format('%s.%s: marked %s column does not exist',
                                   marked.table_name, column_row.column_name, column_row.role);
                CONTINUE;
            END IF;
            IF column_row.atttypid NOT IN ('integer'::regtype, 'bigint'::regtype) THEN
                RETURN NEXT format('%s.%s: marked %s column is %s, not integer or bigint', marked.table_name,
                                   column_row.column_name, column_row.role, format_type(column_row.atttypid, NULL));
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = target AND contype = 'f' AND conkey = ARRAY[column_row.attnum]
                   AND confrelid = 'public.system_users'::regclass AND confkey = ARRAY[users_id_number]
                   AND convalidated AND confdeltype = 'n' AND confmatchtype = 's' AND NOT condeferrable) THEN
                RETURN NEXT format('%s.%s: no validated ON DELETE SET NULL foreign key to system_users(id)',
                                   marked.table_name, column_row.column_name);
            END IF;
            IF (SELECT count(*) FROM pg_catalog.pg_constraint
                 WHERE conrelid = target AND contype = 'f' AND column_row.attnum = ANY(conkey)) > 1 THEN
                RETURN NEXT format('%s.%s: has more than one foreign key', marked.table_name, column_row.column_name);
            END IF;
            IF column_row.role = 'creator' AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_trigger
                 WHERE tgrelid = target AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                   AND tgfoid = 'public.protect_row_creator()'::regprocedure) THEN
                RETURN NEXT format('%s: the creator guard trigger is missing or not firing on ordinary writes',
                                   marked.table_name);
            END IF;
        END LOOP;
    END LOOP;
    RETURN;
END $$;

-- 15. The developer history guards: deleting a user may empty that user's references
-- in otherwise immutable history (creator, owner, locker), and nothing else. Each guard
-- below is its original body (20260919000008) with that one exception first.
CREATE OR REPLACE FUNCTION public.protect_dev_agent_workline_report_history()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND public.app_only_deleted_user_references_cleared(
           to_jsonb(OLD), to_jsonb(NEW), ARRAY['created_by', 'owner_id']) THEN
        RETURN NEW;
    END IF;

    IF OLD.state = 'redacted' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'redacted workline reports are terminal';
    END IF;

    IF NEW.state = 'redacted' AND OLD.state <> 'redacted' THEN
        IF NEW.title <> 'Redacted report'
           OR NEW.content <> '[redacted]'
           OR NEW.source_ref IS NOT NULL
           OR NEW.tags <> '{}'::TEXT[]
           OR NEW.metadata_json <> '{}'::JSONB
           OR NEW.context_text IS NOT NULL
           OR NEW.plain_language_text IS NOT NULL
           OR NEW.technical_text IS NOT NULL
           OR NEW.next_step_text IS NOT NULL
           OR NEW.snapshot_json <> '{}'::JSONB
           OR NEW.git_workline_changed_paths <> '{}'::TEXT[]
           OR NEW.redaction_reason IS NULL THEN
            RAISE EXCEPTION 'workline report redaction must remove all free-form fields';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.workline_id IS DISTINCT FROM OLD.workline_id
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.report_type IS DISTINCT FROM OLD.report_type
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
       OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.metadata_json IS DISTINCT FROM OLD.metadata_json
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.supersedes_report_id IS DISTINCT FROM OLD.supersedes_report_id
       OR NEW.redaction_reason IS DISTINCT FROM OLD.redaction_reason
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created IS DISTINCT FROM OLD.created
       OR NEW.format_version IS DISTINCT FROM OLD.format_version
       OR NEW.phase_gate IS DISTINCT FROM OLD.phase_gate
       OR NEW.current_phase IS DISTINCT FROM OLD.current_phase
       OR NEW.workline_status_snapshot IS DISTINCT FROM OLD.workline_status_snapshot
       OR NEW.changed_this_turn IS DISTINCT FROM OLD.changed_this_turn
       OR NEW.context_text IS DISTINCT FROM OLD.context_text
       OR NEW.plain_language_text IS DISTINCT FROM OLD.plain_language_text
       OR NEW.technical_text IS DISTINCT FROM OLD.technical_text
       OR NEW.next_step_text IS DISTINCT FROM OLD.next_step_text
       OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json
       OR NEW.git_head_commit IS DISTINCT FROM OLD.git_head_commit
       OR NEW.git_worktree_state IS DISTINCT FROM OLD.git_worktree_state
       OR NEW.git_has_other_changes IS DISTINCT FROM OLD.git_has_other_changes
       OR NEW.git_workline_changed_paths IS DISTINCT FROM OLD.git_workline_changed_paths THEN
        RAISE EXCEPTION 'workline report bodies are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.protect_dev_agent_handover_report_history()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND public.app_only_deleted_user_references_cleared(
           to_jsonb(OLD), to_jsonb(NEW), ARRAY['created_by', 'owner_id']) THEN
        RETURN NEW;
    END IF;

    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
       OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.metadata_json IS DISTINCT FROM OLD.metadata_json
       OR NEW.membership_hash IS DISTINCT FROM OLD.membership_hash
       OR NEW.supersedes_handover_id IS DISTINCT FROM OLD.supersedes_handover_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created IS DISTINCT FROM OLD.created THEN
        RAISE EXCEPTION 'handover report manifests are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.protect_dev_agent_release_goal_contracts()
RETURNS TRIGGER AS $$
DECLARE
    resolved_goal_id BIGINT;
    resolved_state TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND public.app_only_deleted_user_references_cleared(
           to_jsonb(OLD), to_jsonb(NEW), ARRAY['created_by', 'owner_id']) THEN
        RETURN NEW;
    END IF;

    resolved_goal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.release_goal_id ELSE NEW.release_goal_id END;
    SELECT decision_state INTO resolved_state
      FROM public.dev_agent_release_goals
     WHERE id = resolved_goal_id;
    IF resolved_state = 'locked' THEN
        RAISE EXCEPTION 'locked release goal contracts are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.protect_dev_agent_release_goal_lock()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND public.app_only_deleted_user_references_cleared(
           to_jsonb(OLD), to_jsonb(NEW), ARRAY['created_by', 'owner_id', 'locked_by']) THEN
        RETURN NEW;
    END IF;

    IF OLD.decision_state = 'locked' THEN
        IF NEW.identity_key IS DISTINCT FROM OLD.identity_key
           OR NEW.version IS DISTINCT FROM OLD.version
           OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.outcome IS DISTINCT FROM OLD.outcome
           OR NEW.decision_state IS DISTINCT FROM OLD.decision_state
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
           OR NEW.created IS DISTINCT FROM OLD.created
           OR NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
            RAISE EXCEPTION 'locked release goal identity is immutable';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.decision_state = 'locked' THEN
        IF EXISTS (
            SELECT 1
              FROM public.dev_agent_worklines AS worklines
             WHERE worklines.status = 'active'
               AND NOT EXISTS (
                    SELECT 1
                      FROM public.dev_agent_release_goal_contracts AS contracts
                     WHERE contracts.release_goal_id = NEW.id
                       AND contracts.workline_id = worklines.id
               )
        ) THEN
            RAISE EXCEPTION 'every active workline must be classified before locking a release goal';
        END IF;
        NEW.locked_at := COALESCE(NEW.locked_at, now());
    END IF;
    NEW.updated := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 16. The file's own completion marker, the one row it writes.
INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wl58_row_actor_support', 'completed',
       jsonb_build_object('file', '20261005000001_add_row_actor_support.sql')
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wl58_row_actor_support' AND action = 'completed'
);
-- 20261005000002_key_row_actor_marks_by_table_uid.sql
-- Keys the actor marks by the registry's table_uid, the key every other reference to
-- system_db_tables already uses, and moves the functions that read and write the
-- marks to it. Marks that exist keep their columns.
-- Bridges 000001, which keyed the marks by the registry id, and every later reader and
-- writer (the release's data file 000004, dataset creation, the final check).
-- Exists because two keys for one registry let a join on the wrong one silently answer
-- for another dataset: on a long-lived database id and table_uid differ on every row
-- and many values collide, while a new installation starts with them equal, so tests
-- would not notice (owner decision K211, 5.10.2026). 000001 was already public when
-- this was found, and a migration that may have run is never edited, so this file
-- converts. It is schema only; its one row is its own completion marker. Running it
-- again changes nothing.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl58_row_actor_marks_by_table_uid
-- FINAL_CHECK: public.app_check_row_actor_marks()

-- 1. The marks table: table_uid replaces the registry id, as key and as foreign key.
-- Each existing mark takes its registry row's table_uid. A mark whose registry row has
-- no table_uid stops the file, because the mark could not be kept.
DO $convert$
DECLARE
    old_constraint record;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.system_row_actor_columns'::regclass
                 AND attname = 'table_id' AND attnum > 0 AND NOT attisdropped) THEN
        ALTER TABLE public.system_row_actor_columns ADD COLUMN IF NOT EXISTS table_uid integer;
        UPDATE public.system_row_actor_columns AS marked
           SET table_uid = registry.table_uid
          FROM public.system_db_tables AS registry
         WHERE registry.id = marked.table_id
           AND marked.table_uid IS DISTINCT FROM registry.table_uid;
        IF EXISTS (SELECT 1 FROM public.system_row_actor_columns WHERE table_uid IS NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'not_null_violation',
                MESSAGE = 'an actor mark points to a registry row without table_uid; the marks were not converted';
        END IF;
        FOR old_constraint IN
            SELECT conname FROM pg_catalog.pg_constraint
             WHERE conrelid = 'public.system_row_actor_columns'::regclass AND contype IN ('p', 'f')
        LOOP
            EXECUTE format('ALTER TABLE public.system_row_actor_columns DROP CONSTRAINT %I', old_constraint.conname);
        END LOOP;
        ALTER TABLE public.system_row_actor_columns DROP COLUMN table_id;
        ALTER TABLE public.system_row_actor_columns ALTER COLUMN table_uid SET NOT NULL;
        ALTER TABLE public.system_row_actor_columns
            ADD CONSTRAINT system_row_actor_columns_table_uid_fkey FOREIGN KEY (table_uid)
            REFERENCES public.system_db_tables (table_uid) ON DELETE CASCADE;
        ALTER TABLE public.system_row_actor_columns
            ADD CONSTRAINT system_row_actor_columns_pkey PRIMARY KEY (table_uid, actor_role);
    END IF;
END $convert$;

COMMENT ON TABLE public.system_row_actor_columns IS
    'Permanent marks naming each marked dataset''s creator and owner columns, keyed by the registry table_uid; written only by the table owner role.';
COMMENT ON COLUMN public.system_row_actor_columns.table_uid IS
    'The marked dataset''s registry table_uid, the key every reference to system_db_tables uses; never its id.';

-- 2. The registry's owner setting stays the marked owner column (000001 section 4),
-- now found by table_uid.
CREATE OR REPLACE FUNCTION public.protect_row_owner_setting() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.system_row_actor_columns AS marked
               WHERE marked.table_uid = OLD.table_uid AND marked.actor_role = 'owner'
                 AND marked.column_name IS DISTINCT FROM NEW.row_policy_owner_column) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'row_owner_setting_fixed',
            MESSAGE = 'row owner setting is fixed to the marked owner column';
    END IF;
    RETURN NEW;
END $$;

-- 3. Registration takes the registry table_uid. The registry-id form goes, so no caller
-- can pass the other key by mistake. The body is 000001 section 12 on table_uid.
DROP FUNCTION IF EXISTS public.app_register_row_actor_columns(bigint, text);
CREATE OR REPLACE FUNCTION public.app_register_row_actor_columns(registry_table_uid integer, owner_column text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    changes jsonb := '[]'::jsonb;
    registry record;
    target regclass;
    users_table_uid integer;
    actor record;
    previous_flag boolean;
BEGIN
    SELECT table_uid, table_name, COALESCE(schema_name, 'public') AS schema_name, row_policy_owner_column
      INTO registry
      FROM public.system_db_tables WHERE table_uid = registry_table_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'no_data_found',
            MESSAGE = format('registry row with table_uid %s does not exist', registry_table_uid);
    END IF;
    target := format('%I.%I', registry.schema_name, registry.table_name)::regclass;

    FOR actor IN
        SELECT * FROM (VALUES ('creator', 'created_by', 'WL58 row creator'),
                              ('owner', owner_column, 'WL58 row owner')) AS wanted (role, column_name, spec)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM public.system_column_details
                       WHERE table_uid = registry.table_uid AND column_name = actor.column_name) THEN
            INSERT INTO public.system_column_details
                (table_uid, column_name, data_type, co_number, lang_key, card_element, insertable,
                 editable_in_ui, hide_in_filter_panel, show_value_on_card, creation_spec)
            SELECT registry.table_uid, actor.column_name, format_type(attribute.atttypid, attribute.atttypmod),
                   attribute.attnum, actor.column_name, 'hidden', FALSE, FALSE, TRUE, TRUE, actor.spec
              FROM pg_catalog.pg_attribute AS attribute
             WHERE attribute.attrelid = target AND attribute.attname = actor.column_name;
            changes := changes || jsonb_build_object('action', 'column_metadata_added', 'column', actor.column_name);
        ELSE
            UPDATE public.system_column_details
               SET insertable = FALSE, editable_in_ui = FALSE, updated = now()
             WHERE table_uid = registry.table_uid AND column_name = actor.column_name
               AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
            IF FOUND THEN
                changes := changes || jsonb_build_object('action', 'column_metadata_locked', 'column', actor.column_name);
            END IF;
        END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.system_row_actor_columns
                   WHERE table_uid = registry.table_uid AND actor_role = 'owner') THEN
        INSERT INTO public.system_row_actor_columns (table_uid, actor_role, column_name)
        VALUES (registry.table_uid, 'creator', 'created_by')
        ON CONFLICT (table_uid, actor_role) DO NOTHING;
        INSERT INTO public.system_row_actor_columns (table_uid, actor_role, column_name)
        VALUES (registry.table_uid, 'owner', owner_column);
        changes := changes || jsonb_build_object('action', 'actor_columns_marked',
                                                 'creator', 'created_by', 'owner', owner_column);
        IF registry.row_policy_owner_column IS DISTINCT FROM owner_column THEN
            UPDATE public.system_db_tables SET row_policy_owner_column = owner_column, updated = now()
             WHERE table_uid = registry.table_uid;
            changes := changes || jsonb_build_object('action', 'registry_owner_moved',
                                                     'old_value', registry.row_policy_owner_column,
                                                     'new_value', owner_column);
        END IF;
    END IF;

    -- A relation row lets the generic synchronisation recognise the two keys; a new
    -- source row must never be inserted with its user, so the flag is FALSE.
    SELECT table_uid INTO users_table_uid FROM public.system_db_tables
     WHERE COALESCE(schema_name, 'public') = 'public' AND table_name = 'system_users';
    IF users_table_uid IS NOT NULL THEN
        FOR actor IN SELECT unnest(ARRAY['created_by', owner_column]) AS column_name LOOP
            SELECT insert_new_source_with_target INTO previous_flag
              FROM public.system_foreign_key_relations_1_m
             WHERE source_table_uid = registry.table_uid AND target_table_uid = users_table_uid
               AND source_column_name = actor.column_name AND target_column_name = 'id';
            IF NOT FOUND THEN
                INSERT INTO public.system_foreign_key_relations_1_m
                    (source_table_uid, source_column_name, target_table_uid, target_column_name,
                     reference_direction, insert_new_source_with_target, source_insert_specs)
                VALUES (registry.table_uid, actor.column_name, users_table_uid, 'id',
                        registry.table_name || '->system_users', FALSE, '{}'::jsonb);
            ELSIF previous_flag IS DISTINCT FROM FALSE THEN
                UPDATE public.system_foreign_key_relations_1_m
                   SET insert_new_source_with_target = FALSE, updated = now()
                 WHERE source_table_uid = registry.table_uid AND target_table_uid = users_table_uid
                   AND source_column_name = actor.column_name AND target_column_name = 'id';
                changes := changes || jsonb_build_object('action', 'relation_flag_changed',
                                                         'column', actor.column_name, 'old_value', previous_flag);
            END IF;
        END LOOP;
    END IF;
    RETURN changes;
END $$;

-- 4. Reading the marks (000001 section 13) through table_uid.
CREATE OR REPLACE FUNCTION public.app_row_actor_column(target regclass, actor_role text)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT marked.column_name
      FROM public.system_row_actor_columns AS marked
      JOIN public.system_db_tables AS registry ON registry.table_uid = marked.table_uid
      JOIN pg_catalog.pg_class AS relation ON relation.oid = target
      JOIN pg_catalog.pg_namespace AS relation_schema ON relation_schema.oid = relation.relnamespace
     WHERE COALESCE(registry.schema_name, 'public') = relation_schema.nspname
       AND registry.table_name = relation.relname
       AND marked.actor_role = app_row_actor_column.actor_role
$$;

-- 5. The final check (000001 section 14) through table_uid; every other line unchanged.
CREATE OR REPLACE FUNCTION public.app_check_row_actor_marks()
RETURNS SETOF text LANGUAGE plpgsql STABLE AS $$
DECLARE
    marked record;
    target regclass;
    column_row record;
    users_id_number smallint := (SELECT attnum FROM pg_catalog.pg_attribute
                                 WHERE attrelid = 'public.system_users'::regclass AND attname = 'id');
    guard record;
BEGIN
    -- A guard counts only when it fires on ordinary writes ('O' origin or 'A' always,
    -- not 'R' replica-only) and runs its own function.
    FOR guard IN
        SELECT * FROM (VALUES ('public.system_row_actor_columns', 'owner_only_writes', 'public.app_owner_only_writes()'),
                              ('public.system_row_actor_columns', 'owner_only_truncate', 'public.app_owner_only_writes()'),
                              ('public.system_data_repair_records', 'owner_only_writes', 'public.app_owner_only_writes()'),
                              ('public.system_data_repair_records', 'owner_only_truncate', 'public.app_owner_only_writes()'),
                              ('public.system_db_tables', 'protect_row_owner_setting', 'public.protect_row_owner_setting()'))
                 AS wanted (table_name, trigger_name, function_name)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                       WHERE tgrelid = guard.table_name::regclass AND tgname = guard.trigger_name
                         AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                         AND tgfoid = guard.function_name::regprocedure) THEN
            RETURN NEXT format('%s: guard trigger %s is missing, not firing on ordinary writes or not running %s',
                               guard.table_name, guard.trigger_name, guard.function_name);
        END IF;
    END LOOP;
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.system_data_repair_records'::regclass) THEN
        RETURN NEXT 'public.system_data_repair_records: row security is off';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                   WHERE polrelid = 'public.system_data_repair_records'::regclass
                     AND polname = 'repair_records_owner_role') THEN
        RETURN NEXT 'public.system_data_repair_records: policy repair_records_owner_role is missing';
    END IF;

    FOR marked IN
        SELECT registry.table_uid, registry.table_name, COALESCE(registry.schema_name, 'public') AS schema_name,
               registry.row_policy_owner_column,
               max(mark.column_name) FILTER (WHERE mark.actor_role = 'creator') AS creator_column,
               max(mark.column_name) FILTER (WHERE mark.actor_role = 'owner') AS owner_column
          FROM public.system_row_actor_columns AS mark
          JOIN public.system_db_tables AS registry ON registry.table_uid = mark.table_uid
         GROUP BY registry.table_uid, registry.table_name, registry.schema_name, registry.row_policy_owner_column
         ORDER BY registry.table_name
    LOOP
        target := to_regclass(format('%I.%I', marked.schema_name, marked.table_name));
        IF target IS NULL THEN
            RETURN NEXT format('%s: marked table does not exist', marked.table_name);
            CONTINUE;
        END IF;
        IF marked.creator_column IS NULL OR marked.owner_column IS NULL THEN
            RETURN NEXT format('%s: needs both a creator and an owner mark', marked.table_name);
        END IF;
        IF marked.owner_column IS DISTINCT FROM marked.row_policy_owner_column THEN
            RETURN NEXT format('%s: registry owner setting %s differs from the owner mark %s',
                               marked.table_name, COALESCE(marked.row_policy_owner_column, '(empty)'),
                               COALESCE(marked.owner_column, '(none)'));
        END IF;
        FOR column_row IN
            SELECT wanted.role, wanted.column_name, attribute.attnum, attribute.atttypid
              FROM (VALUES ('creator', marked.creator_column), ('owner', marked.owner_column))
                   AS wanted (role, column_name)
              LEFT JOIN pg_catalog.pg_attribute AS attribute
                ON attribute.attrelid = target AND attribute.attname = wanted.column_name
               AND attribute.attnum > 0 AND NOT attribute.attisdropped
             WHERE wanted.column_name IS NOT NULL
        LOOP
            IF column_row.attnum IS NULL THEN
                RETURN NEXT format('%s.%s: marked %s column does not exist',
                                   marked.table_name, column_row.column_name, column_row.role);
                CONTINUE;
            END IF;
            IF column_row.atttypid NOT IN ('integer'::regtype, 'bigint'::regtype) THEN
                RETURN NEXT format('%s.%s: marked %s column is %s, not integer or bigint', marked.table_name,
                                   column_row.column_name, column_row.role, format_type(column_row.atttypid, NULL));
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = target AND contype = 'f' AND conkey = ARRAY[column_row.attnum]
                   AND confrelid = 'public.system_users'::regclass AND confkey = ARRAY[users_id_number]
                   AND convalidated AND confdeltype = 'n' AND confmatchtype = 's' AND NOT condeferrable) THEN
                RETURN NEXT format('%s.%s: no validated ON DELETE SET NULL foreign key to system_users(id)',
                                   marked.table_name, column_row.column_name);
            END IF;
            IF (SELECT count(*) FROM pg_catalog.pg_constraint
                 WHERE conrelid = target AND contype = 'f' AND column_row.attnum = ANY(conkey)) > 1 THEN
                RETURN NEXT format('%s.%s: has more than one foreign key', marked.table_name, column_row.column_name);
            END IF;
            IF column_row.role = 'creator' AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_trigger
                 WHERE tgrelid = target AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                   AND tgfoid = 'public.protect_row_creator()'::regprocedure) THEN
                RETURN NEXT format('%s: the creator guard trigger is missing or not firing on ordinary writes',
                                   marked.table_name);
            END IF;
        END LOOP;
    END LOOP;
    -- The marks table itself is keyed by table_uid, never by the registry id.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.system_row_actor_columns'::regclass
                 AND attname = 'table_id' AND attnum > 0 AND NOT attisdropped) THEN
        RETURN NEXT 'public.system_row_actor_columns: still keyed by the registry id (table_id)';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint AS key
          JOIN pg_catalog.pg_attribute AS referencing
            ON referencing.attrelid = key.conrelid AND referencing.attnum = key.conkey[1]
          JOIN pg_catalog.pg_attribute AS referenced
            ON referenced.attrelid = key.confrelid AND referenced.attnum = key.confkey[1]
         WHERE key.conrelid = 'public.system_row_actor_columns'::regclass AND key.contype = 'f'
           AND key.confrelid = 'public.system_db_tables'::regclass
           AND cardinality(key.conkey) = 1 AND cardinality(key.confkey) = 1
           AND referencing.attname = 'table_uid' AND referenced.attname = 'table_uid'
           AND key.confdeltype = 'c' AND key.convalidated) THEN
        RETURN NEXT 'public.system_row_actor_columns: no validated ON DELETE CASCADE foreign key from table_uid to '
                    'system_db_tables(table_uid)';
    END IF;
    RETURN;
END $$;

-- 6. The file's own completion marker, the one row it writes.
INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wl58_row_actor_marks_by_table_uid', 'completed',
       jsonb_build_object('file', '20261005000002_key_row_actor_marks_by_table_uid.sql')
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wl58_row_actor_marks_by_table_uid' AND action = 'completed'
);
-- 20261005000006_check_row_actor_trigger_definitions.sql
-- Checks each actor guard's complete trigger definition, as well as the marks,
-- foreign keys, enabled states and repair-history protections already checked.
-- Bridges the actor checker and the acceptance block: the right function and name
-- alone do not prove that a guard runs before every protected ordinary write.
-- Exists separately because 000001 and 000002 are public migrations that may have
-- run. On upgrade this schema repair follows the data step 000004 (with language
-- seed 000005 between them); 000004's own end check still uses 000002's version.
-- In the package it runs in the schema phase, before any actor columns are marked.
-- Its only data is its completion marker, written after a clean check.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl58_row_actor_trigger_definitions
-- FINAL_CHECK: public.app_check_row_actor_marks()

-- pg_trigger's bit mask includes level, timing and events (ROW 1, BEFORE 2, INSERT 4,
-- DELETE 8, UPDATE 16, TRUNCATE 32): 31 is BEFORE ROW INSERT/UPDATE/DELETE, 34 is
-- BEFORE STATEMENT TRUNCATE, 19 is BEFORE ROW UPDATE.
CREATE OR REPLACE FUNCTION public.app_check_row_actor_marks()
RETURNS SETOF text LANGUAGE plpgsql STABLE AS $$
DECLARE
    marked record;
    target regclass;
    column_row record;
    users_id_number smallint := (SELECT attnum FROM pg_catalog.pg_attribute
                                 WHERE attrelid = 'public.system_users'::regclass AND attname = 'id');
    guard record;
BEGIN
    -- A guard counts only when it fires on ordinary writes ('O' origin or 'A' always,
    -- not 'R' replica-only) and runs its own function.
    FOR guard IN
        SELECT * FROM (VALUES ('public.system_row_actor_columns', 'owner_only_writes', 'public.app_owner_only_writes()', 31, NULL::text),
                              ('public.system_row_actor_columns', 'owner_only_truncate', 'public.app_owner_only_writes()', 34, NULL::text),
                              ('public.system_data_repair_records', 'owner_only_writes', 'public.app_owner_only_writes()', 31, NULL::text),
                              ('public.system_data_repair_records', 'owner_only_truncate', 'public.app_owner_only_writes()', 34, NULL::text),
                              ('public.system_db_tables', 'protect_row_owner_setting', 'public.protect_row_owner_setting()', 19, 'row_policy_owner_column'))
                 AS wanted (table_name, trigger_name, function_name, trigger_type, filter_column)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                       WHERE tgrelid = guard.table_name::regclass AND tgname = guard.trigger_name
                         AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                         AND tgfoid = guard.function_name::regprocedure
                         AND tgtype = guard.trigger_type AND tgqual IS NULL
                         AND tgattr::text = coalesce((SELECT attnum::text FROM pg_catalog.pg_attribute
                              WHERE attrelid = guard.table_name::regclass AND attname = guard.filter_column
                                AND attnum > 0 AND NOT attisdropped), '')) THEN
            RETURN NEXT format('%s: guard trigger %s is missing, not firing on ordinary writes or not running %s with the required timing, events, level, columns and no WHEN',
                               guard.table_name, guard.trigger_name, guard.function_name);
        END IF;
    END LOOP;
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.system_data_repair_records'::regclass) THEN
        RETURN NEXT 'public.system_data_repair_records: row security is off';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                   WHERE polrelid = 'public.system_data_repair_records'::regclass
                     AND polname = 'repair_records_owner_role') THEN
        RETURN NEXT 'public.system_data_repair_records: policy repair_records_owner_role is missing';
    END IF;

    FOR marked IN
        SELECT registry.table_uid, registry.table_name, COALESCE(registry.schema_name, 'public') AS schema_name,
               registry.row_policy_owner_column,
               max(mark.column_name) FILTER (WHERE mark.actor_role = 'creator') AS creator_column,
               max(mark.column_name) FILTER (WHERE mark.actor_role = 'owner') AS owner_column
          FROM public.system_row_actor_columns AS mark
          JOIN public.system_db_tables AS registry ON registry.table_uid = mark.table_uid
         GROUP BY registry.table_uid, registry.table_name, registry.schema_name, registry.row_policy_owner_column
         ORDER BY registry.table_name
    LOOP
        target := to_regclass(format('%I.%I', marked.schema_name, marked.table_name));
        IF target IS NULL THEN
            RETURN NEXT format('%s: marked table does not exist', marked.table_name);
            CONTINUE;
        END IF;
        IF marked.creator_column IS NULL OR marked.owner_column IS NULL THEN
            RETURN NEXT format('%s: needs both a creator and an owner mark', marked.table_name);
        END IF;
        IF marked.owner_column IS DISTINCT FROM marked.row_policy_owner_column THEN
            RETURN NEXT format('%s: registry owner setting %s differs from the owner mark %s',
                               marked.table_name, COALESCE(marked.row_policy_owner_column, '(empty)'),
                               COALESCE(marked.owner_column, '(none)'));
        END IF;
        FOR column_row IN
            SELECT wanted.role, wanted.column_name, attribute.attnum, attribute.atttypid
              FROM (VALUES ('creator', marked.creator_column), ('owner', marked.owner_column))
                   AS wanted (role, column_name)
              LEFT JOIN pg_catalog.pg_attribute AS attribute
                ON attribute.attrelid = target AND attribute.attname = wanted.column_name
               AND attribute.attnum > 0 AND NOT attribute.attisdropped
             WHERE wanted.column_name IS NOT NULL
        LOOP
            IF column_row.attnum IS NULL THEN
                RETURN NEXT format('%s.%s: marked %s column does not exist',
                                   marked.table_name, column_row.column_name, column_row.role);
                CONTINUE;
            END IF;
            IF column_row.atttypid NOT IN ('integer'::regtype, 'bigint'::regtype) THEN
                RETURN NEXT format('%s.%s: marked %s column is %s, not integer or bigint', marked.table_name,
                                   column_row.column_name, column_row.role, format_type(column_row.atttypid, NULL));
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = target AND contype = 'f' AND conkey = ARRAY[column_row.attnum]
                   AND confrelid = 'public.system_users'::regclass AND confkey = ARRAY[users_id_number]
                   AND convalidated AND confdeltype = 'n' AND confmatchtype = 's' AND NOT condeferrable) THEN
                RETURN NEXT format('%s.%s: no validated ON DELETE SET NULL foreign key to system_users(id)',
                                   marked.table_name, column_row.column_name);
            END IF;
            IF (SELECT count(*) FROM pg_catalog.pg_constraint
                 WHERE conrelid = target AND contype = 'f' AND column_row.attnum = ANY(conkey)) > 1 THEN
                RETURN NEXT format('%s.%s: has more than one foreign key', marked.table_name, column_row.column_name);
            END IF;
            IF column_row.role = 'creator' AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_trigger
                 WHERE tgrelid = target AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                   AND tgfoid = 'public.protect_row_creator()'::regprocedure
                   AND tgname = public.app_row_actor_object_name('protect', marked.table_name, 'creator')
                   AND tgtype = 19 AND tgattr::text = column_row.attnum::text AND tgqual IS NULL) THEN
                RETURN NEXT format('%s: the creator guard trigger is missing or not firing on ordinary writes with the required definition',
                                   marked.table_name);
            END IF;
        END LOOP;
    END LOOP;
    -- The marks table itself is keyed by table_uid, never by the registry id.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.system_row_actor_columns'::regclass
                 AND attname = 'table_id' AND attnum > 0 AND NOT attisdropped) THEN
        RETURN NEXT 'public.system_row_actor_columns: still keyed by the registry id (table_id)';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint AS key
          JOIN pg_catalog.pg_attribute AS referencing
            ON referencing.attrelid = key.conrelid AND referencing.attnum = key.conkey[1]
          JOIN pg_catalog.pg_attribute AS referenced
            ON referenced.attrelid = key.confrelid AND referenced.attnum = key.confkey[1]
         WHERE key.conrelid = 'public.system_row_actor_columns'::regclass AND key.contype = 'f'
           AND key.confrelid = 'public.system_db_tables'::regclass
           AND cardinality(key.conkey) = 1 AND cardinality(key.confkey) = 1
           AND referencing.attname = 'table_uid' AND referenced.attname = 'table_uid'
           AND key.confdeltype = 'c' AND key.convalidated) THEN
        RETURN NEXT 'public.system_row_actor_columns: no validated ON DELETE CASCADE foreign key from table_uid to '
                    'system_db_tables(table_uid)';
    END IF;
    RETURN;
END $$;

DO $check$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding, E'\n') INTO findings FROM public.app_check_row_actor_marks() AS finding;
    IF findings IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
            MESSAGE = 'wl58_row_actor_trigger_definitions refused: ' || findings;
    END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'wl58_row_actor_trigger_definitions', 'completed',
           jsonb_build_object('file', '20261005000006_check_row_actor_trigger_definitions.sql')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                        WHERE migration = 'wl58_row_actor_trigger_definitions' AND action = 'completed');
END $check$;
-- Separates confidential sign-in names from public display names (WL132, K116/K205).
-- Connects account lifecycle writes, bootstrap acceptance and identifier-only repair history.
-- One statement keeps every import path atomic; old public history remains unchanged (K201).
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: k116_login_names
-- FINAL_CHECK: public.app_check_login_name_protections()

DO $login_names$
DECLARE
    item record;
    ids bigint[];
    targets oid[] := ARRAY['public.system_users'::regclass::oid,
        'public.system_user_group_memberships'::regclass::oid, 'restricted.users_restricted'::regclass::oid];
    allocated text[] := '{}';
    display_name text;
    findings text;
    copied bigint;
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    IF EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'k116_login_names' AND action = 'completed') THEN
        RETURN;
    END IF;

    -- Known cache synchronization can propagate the rename. Include every static
    -- write target in its body and every cached-name table, without site-specific names.
    SELECT targets || coalesce(array_agg(DISTINCT relation.oid), '{}'::oid[]) INTO targets
    FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace ns ON ns.oid = relation.relnamespace
    WHERE ns.nspname = 'public' AND relation.relkind = 'r' AND (
        EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = relation.oid
            AND attname = 'cached_username' AND NOT attisdropped)
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger
            JOIN pg_catalog.pg_proc fn ON fn.oid = trigger.tgfoid
            CROSS JOIN LATERAL regexp_matches(fn.prosrc,
                '(?i)(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+((?:public\.)?[a-z_][a-z0-9_]*)', 'g') AS matched(parts)
            WHERE trigger.tgrelid = 'public.system_users'::regclass
                AND fn.proname = 'fn_sync_cached_username'
                AND to_regclass(matched.parts[1]) = relation.oid));
    FOR item IN SELECT oid, relowner FROM pg_catalog.pg_class
        WHERE oid = ANY(targets || ARRAY['public.system_data_repair_records'::regclass::oid,
            'public.system_config'::regclass::oid]) ORDER BY oid
    LOOP
        IF NOT pg_has_role(current_user, item.relowner, 'MEMBER') THEN
            RAISE EXCEPTION 'login-name migration: owner membership required for relation id %', item.oid;
        END IF;
        EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', item.oid::regclass);
    END LOOP;
    LOCK TABLE public.system_user_groups IN SHARE ROW EXCLUSIVE MODE;

    SELECT array_agg(id ORDER BY id) INTO ids FROM public.system_user_groups
    WHERE (id = 1 AND name IS DISTINCT FROM 'admins') OR (id <> 1 AND name = 'admins');
    IF ids IS NOT NULL THEN
        RAISE EXCEPTION 'login-name migration: administrator group ids %', ids;
    END IF;
    SELECT array_agg(credentials.id ORDER BY credentials.id) INTO ids
    FROM restricted.users_restricted credentials LEFT JOIN public.system_users account ON account.id = credentials.id
    WHERE account.id IS NULL OR account.username IS NULL OR btrim(account.username) = ''
        OR account.username ~ '^[[:space:]]|[[:space:]]$';
    IF ids IS NOT NULL THEN
        RAISE EXCEPTION 'login-name migration: missing account or invalid name at account ids %', ids;
    END IF;
    SELECT array_agg(id ORDER BY id) INTO ids FROM (
        SELECT id, count(*) OVER (PARTITION BY lower(username)) AS copies FROM public.system_users
        WHERE username IS NOT NULL
    ) duplicates WHERE copies > 1;
    IF ids IS NOT NULL THEN
        RAISE EXCEPTION 'login-name migration: duplicate display/login names at account ids %', ids;
    END IF;
    FOR item IN SELECT trigger.tgname, fn.proname, ns.nspname, relation.relname
        FROM pg_catalog.pg_trigger trigger JOIN pg_catalog.pg_proc fn ON fn.oid = trigger.tgfoid
        JOIN pg_catalog.pg_namespace ns ON ns.oid = fn.pronamespace
        JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
        WHERE NOT trigger.tgisinternal AND trigger.tgrelid = ANY(targets)
    LOOP
        IF item.nspname = 'public' AND (
            item.proname IN ('set_users_updated_timestamp', 'set_auth_user_group_memberships_updated_timestamp',
                'set_transaction_log_updated_at_timestamp',
                'set_log_updated_timestamp', 'set_service_catalog_updated_timestamp', 'set_domain_workspace_updated_timestamp')
            OR (item.proname = 'fn_sync_cached_username' AND item.tgname = 'trg_sync_cached_username')
            OR (item.proname = 'protect_row_creator' AND item.tgname = public.app_row_actor_object_name('protect', item.relname, 'creator'))
            OR (item.proname = 'app_enforce_administrator_names_differ' AND item.tgname IN (
                'app_users_names_differ', 'app_memberships_names_differ', 'app_credentials_names_differ'))
        ) THEN CONTINUE; END IF;
        RAISE EXCEPTION 'login-name migration: unknown trigger %', item.tgname;
    END LOOP;

    ALTER TABLE restricted.users_restricted ADD COLUMN IF NOT EXISTS login_name text;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'restricted.users_restricted'::regclass
        AND attname = 'login_name' AND atttypid <> 'text'::regtype AND NOT attisdropped) THEN
        RAISE EXCEPTION 'login-name migration: invalid login_name column type';
    END IF;
    -- Check proposed fills before an existing unique index can report its values.
    SELECT array_agg(id ORDER BY id) INTO ids FROM (
        SELECT credentials.id, count(*) OVER (PARTITION BY lower(coalesce(credentials.login_name, account.username))) AS copies
        FROM restricted.users_restricted credentials JOIN public.system_users account USING (id)
    ) duplicates WHERE copies > 1;
    IF ids IS NOT NULL THEN
        RAISE EXCEPTION 'login-name migration: duplicate login names at account ids %', ids;
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_restricted_login_name_lower
        ON restricted.users_restricted (lower(login_name));
    CREATE UNIQUE INDEX IF NOT EXISTS uq_system_users_username_lower ON public.system_users (lower(username));
    -- Reject a same-named wrong index before any write of a name. Its unrelated
    -- unique constraint could otherwise refuse a rename with values in DETAIL.
    FOR item IN SELECT * FROM (VALUES
        ('restricted.uq_users_restricted_login_name_lower', 'restricted.users_restricted', 'lower(login_name)'),
        ('public.uq_system_users_username_lower', 'public.system_users', 'lower((username)::text)')
    ) AS expected(index_name, table_name, expression)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index idx
            JOIN pg_catalog.pg_class relation ON relation.oid = idx.indexrelid
            JOIN pg_catalog.pg_am method ON method.oid = relation.relam
            WHERE idx.indexrelid = to_regclass(item.index_name) AND idx.indrelid = to_regclass(item.table_name)
                AND idx.indisunique AND idx.indisvalid AND idx.indisready AND idx.indpred IS NULL
                AND idx.indnatts = 1 AND idx.indnkeyatts = 1 AND method.amname = 'btree'
                AND pg_get_indexdef(idx.indexrelid, 1, false) = CASE
                    WHEN item.table_name = 'public.system_users' AND EXISTS (
                        SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = idx.indrelid
                            AND attname = 'username' AND atttypid = 'text'::regtype)
                    THEN 'lower(username)' ELSE item.expression END) THEN
            RAISE EXCEPTION 'login-name migration: %: invalid unique lower-name index', item.index_name;
        END IF;
    END LOOP;
    UPDATE restricted.users_restricted credentials SET login_name = account.username
    FROM public.system_users account WHERE credentials.id = account.id AND credentials.login_name IS NULL;
    GET DIAGNOSTICS copied = ROW_COUNT;
    ALTER TABLE restricted.users_restricted ALTER COLUMN login_name SET NOT NULL;

    CREATE OR REPLACE FUNCTION public.app_is_administrator_account(account_id bigint)
    RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
        SELECT EXISTS (SELECT 1 FROM public.system_users account WHERE account.id = account_id
            AND (account.admin_access_allowed IS TRUE OR EXISTS (
                SELECT 1 FROM public.system_user_group_memberships membership
                WHERE membership.user_id = account.id AND membership.group_id = 1)))
    $fn$;
    GRANT EXECUTE ON FUNCTION public.app_is_administrator_account(bigint) TO PUBLIC;

    CREATE OR REPLACE FUNCTION public.app_next_admin_display_name(prefix text, also_taken text[] DEFAULT '{}')
    RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
    DECLARE number bigint := 1; candidate text;
    BEGIN
        IF prefix IS NULL OR prefix NOT IN ('admin', 'auto', 'user') THEN
            RAISE EXCEPTION 'invalid display-name prefix' USING ERRCODE = '22023';
        END IF;
        LOOP
            candidate := prefix || '_' || number;
            IF NOT EXISTS (SELECT 1 FROM public.system_users WHERE lower(username) = lower(candidate))
                AND NOT EXISTS (SELECT 1 FROM restricted.users_restricted WHERE lower(login_name) = lower(candidate))
                AND NOT EXISTS (SELECT 1 FROM unnest(also_taken) AS taken WHERE lower(taken) = lower(candidate)) THEN
                RETURN candidate;
            END IF;
            number := number + 1;
        END LOOP;
    END $fn$;
    GRANT EXECUTE ON FUNCTION public.app_next_admin_display_name(text, text[]) TO PUBLIC;

    INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
    VALUES ('display_name_may_equal_login_name', true, '{"value":true}', 'true', 2,
        'Ordinary accounts may use the same display and login name; administrators must use different names.')
    ON CONFLICT (key) DO NOTHING;

    FOR item IN SELECT account.id, account.username, account.full_name, credentials.api_only
        FROM public.system_users account JOIN restricted.users_restricted credentials USING (id)
        WHERE public.app_is_administrator_account(account.id)
            AND lower(btrim(account.username)) = lower(btrim(credentials.login_name)) ORDER BY account.id
    LOOP
        display_name := public.app_next_admin_display_name(CASE WHEN item.api_only THEN 'auto' ELSE 'admin' END, allocated);
        allocated := array_append(allocated, display_name);
        UPDATE public.system_users SET username = display_name,
            full_name = CASE WHEN lower(full_name) = lower(item.username) THEN display_name ELSE full_name END,
            search_vector_simple = NULL WHERE id = item.id;
        UPDATE restricted.users_restricted SET authentication_generation = authentication_generation + 1 WHERE id = item.id;
        INSERT INTO public.system_data_repair_records (migration, table_name, row_id, action)
        SELECT 'k116_login_names', 'system_users', item.id, action FROM unnest(ARRAY[
            'display_name_assigned', 'generation_bumped', 'login_name_inherited_public', 'search_vector_cleared']) AS action;
        IF lower(item.full_name) = lower(item.username) THEN
            INSERT INTO public.system_data_repair_records (migration, table_name, row_id, action)
            VALUES ('k116_login_names', 'system_users', item.id, 'full_name_replaced');
        END IF;
    END LOOP;

    CREATE OR REPLACE FUNCTION public.app_enforce_administrator_names_differ()
    RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
    DECLARE account_id bigint; display text; login text; name_write boolean := false;
    BEGIN
        IF TG_TABLE_NAME = 'system_user_group_memberships' THEN
            account_id := NEW.user_id;
        ELSE
            account_id := NEW.id;
            IF TG_TABLE_NAME = 'system_users' THEN
                name_write := NEW.username IS DISTINCT FROM OLD.username;
            ELSIF TG_OP = 'INSERT' THEN
                name_write := true;
            ELSE
                name_write := NEW.login_name IS DISTINCT FROM OLD.login_name;
            END IF;
        END IF;
        -- Lock and read are separate statements: a waiter gets a fresh RC snapshot.
        -- NO KEY UPDATE is compatible with membership foreign-key KEY SHARE locks.
        PERFORM 1 FROM public.system_users WHERE id = account_id FOR NO KEY UPDATE;
        -- Publish a tuple version for cross-table writes too. A lock alone leaves
        -- an older RR snapshot able to miss a committed credential/membership write.
        -- Touching a non-key column avoids both a key-lock upgrade and recursive name/flag triggers.
        IF TG_TABLE_NAME <> 'system_users' THEN
            UPDATE public.system_users SET updated = updated WHERE id = account_id;
        END IF;
        SELECT account.username, credentials.login_name INTO display, login
        FROM public.system_users account JOIN restricted.users_restricted credentials USING (id)
        WHERE account.id = account_id;
        IF lower(btrim(display)) = lower(btrim(login)) THEN
            IF public.app_is_administrator_account(account_id) THEN
                RAISE EXCEPTION 'administrator_names_differ' USING ERRCODE = '23514', CONSTRAINT = 'administrator_names_differ';
            ELSIF name_write AND coalesce((SELECT boolean_value FROM public.system_config
                WHERE key = 'display_name_may_equal_login_name'), true) IS FALSE THEN
                RAISE EXCEPTION 'user_names_differ' USING ERRCODE = '23514', CONSTRAINT = 'user_names_differ';
            END IF;
        END IF;
        RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION public.app_enforce_administrator_names_differ() FROM PUBLIC;
    CREATE OR REPLACE TRIGGER app_users_names_differ AFTER UPDATE OF username, admin_access_allowed
        ON public.system_users FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();
    CREATE OR REPLACE TRIGGER app_memberships_names_differ AFTER INSERT OR UPDATE
        ON public.system_user_group_memberships FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();
    CREATE OR REPLACE TRIGGER app_credentials_names_differ AFTER INSERT OR UPDATE OF login_name, id
        ON restricted.users_restricted FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();

    CREATE OR REPLACE FUNCTION public.app_describe_account_name_setting()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
    DECLARE equal_count bigint;
    BEGIN
        SELECT count(*) INTO equal_count FROM public.system_users account
        JOIN restricted.users_restricted credentials USING (id)
        WHERE NOT public.app_is_administrator_account(account.id)
            AND lower(btrim(account.username)) = lower(btrim(credentials.login_name));
        NEW.creation_spec := format('%s: ordinary credentialed accounts with equal display and login names: %s. '
            'Existing equal names remain until a name is changed; administrators always use different names.',
            current_date, equal_count);
        RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION public.app_describe_account_name_setting() FROM PUBLIC;
    CREATE OR REPLACE TRIGGER app_account_name_setting_description BEFORE UPDATE ON public.system_config
        FOR EACH ROW WHEN (NEW.key = 'display_name_may_equal_login_name'
            AND OLD.boolean_value IS DISTINCT FROM NEW.boolean_value)
        EXECUTE FUNCTION public.app_describe_account_name_setting();

    CREATE OR REPLACE FUNCTION public.app_check_login_name_protections()
    RETURNS SETOF text LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $fn$
    DECLARE item record; fn_oid oid; column_ok boolean;
    BEGIN
        SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
            WHERE attrelid = 'restricted.users_restricted'::regclass AND attname = 'login_name'
                AND NOT attisdropped AND atttypid = 'text'::regtype AND attnotnull) INTO column_ok;
        IF NOT column_ok THEN RETURN NEXT 'login_name: missing text NOT NULL column'; END IF;
        FOR item IN SELECT * FROM (VALUES
            ('restricted.uq_users_restricted_login_name_lower', 'restricted.users_restricted', 'lower(login_name)'),
            ('public.uq_system_users_username_lower', 'public.system_users', 'lower((username)::text)')
        ) AS expected(index_name, table_name, expression)
        LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index idx
                JOIN pg_catalog.pg_class relation ON relation.oid = idx.indexrelid
                JOIN pg_catalog.pg_am method ON method.oid = relation.relam
                WHERE idx.indexrelid = to_regclass(item.index_name) AND idx.indrelid = to_regclass(item.table_name)
                    AND idx.indisunique AND idx.indisvalid AND idx.indisready AND idx.indpred IS NULL
                    AND idx.indnatts = 1 AND idx.indnkeyatts = 1 AND method.amname = 'btree'
                    AND pg_get_indexdef(idx.indexrelid, 1, false) = CASE
                        WHEN item.table_name = 'public.system_users' AND EXISTS (
                            SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = idx.indrelid
                                AND attname = 'username' AND atttypid = 'text'::regtype)
                        THEN 'lower(username)' ELSE item.expression END) THEN
                RETURN NEXT item.index_name || ': invalid unique lower-name index';
            END IF;
        END LOOP;
        FOR item IN SELECT * FROM (VALUES
            ('public.system_users', 'app_users_names_differ', 17, ARRAY['admin_access_allowed','username']::text[],
                'app_enforce_administrator_names_differ', false),
            ('public.system_user_group_memberships', 'app_memberships_names_differ', 21, '{}'::text[],
                'app_enforce_administrator_names_differ', false),
            ('restricted.users_restricted', 'app_credentials_names_differ', 21, ARRAY['id','login_name']::text[],
                'app_enforce_administrator_names_differ', false),
            ('public.system_config', 'app_account_name_setting_description', 19, '{}'::text[],
                'app_describe_account_name_setting', true)
        ) AS expected(table_name, trigger_name, kind, columns, function_name, conditional)
        LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger
                WHERE trigger.tgrelid = to_regclass(item.table_name) AND trigger.tgname = item.trigger_name
                    AND NOT trigger.tgisinternal AND trigger.tgenabled = 'O' AND trigger.tgtype = item.kind
                    AND trigger.tgfoid = to_regprocedure('public.' || item.function_name || '()')
                    AND trigger.tgnargs = 0 AND NOT trigger.tgdeferrable AND NOT trigger.tginitdeferred
                    AND (SELECT coalesce(array_agg(att.attname::text ORDER BY att.attname), '{}'::text[])
                        FROM pg_catalog.pg_attribute att WHERE att.attrelid = trigger.tgrelid
                            AND att.attnum = ANY(trigger.tgattr::smallint[])) = item.columns
                    AND CASE WHEN item.conditional THEN
                        regexp_replace(lower(substring(pg_get_triggerdef(trigger.oid, true)
                            FROM ' WHEN (.*) EXECUTE FUNCTION ')), '[[:space:]()]|::text', '', 'g') =
                        'new.key=''display_name_may_equal_login_name''andold.boolean_valueisdistinctfromnew.boolean_value'
                        ELSE trigger.tgqual IS NULL END) THEN
                RETURN NEXT item.trigger_name || ': invalid enabled row trigger';
            END IF;
        END LOOP;
        FOR item IN SELECT * FROM (VALUES
            ('app_is_administrator_account(bigint)', false, 'search_path=pg_catalog, public', true),
            ('app_next_admin_display_name(text,text[])', false, 'search_path=pg_catalog, public', true),
            ('app_enforce_administrator_names_differ()', true, 'search_path=pg_catalog, pg_temp', false),
            ('app_describe_account_name_setting()', true, 'search_path=pg_catalog, pg_temp', false),
            ('app_check_login_name_protections()', false, 'search_path=pg_catalog, pg_temp', false)
        ) AS expected(signature, definer, config, public_execute)
        LOOP
            fn_oid := to_regprocedure('public.' || item.signature);
            IF fn_oid IS NULL THEN
                RETURN NEXT item.signature || ': missing function';
            ELSE
                IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = fn_oid
                    AND prosecdef = item.definer AND proconfig = ARRAY[item.config]) THEN
                    RETURN NEXT item.signature || ': invalid security or search_path';
                END IF;
                IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc fn
                    CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) acl
                    WHERE fn.oid = fn_oid AND (acl.privilege_type <> 'EXECUTE'
                        OR (acl.grantee <> fn.proowner AND (NOT item.public_execute OR acl.grantee <> 0))
                        OR (acl.grantee = 0 AND acl.is_grantable)))
                    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc fn
                        CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) acl
                        WHERE fn.oid = fn_oid AND acl.grantee = fn.proowner AND acl.privilege_type = 'EXECUTE')
                    OR item.public_execute <> EXISTS (SELECT 1 FROM pg_catalog.pg_proc fn
                        CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) acl
                        WHERE fn.oid = fn_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') THEN
                    RETURN NEXT item.signature || ': invalid full execute ACL';
                END IF;
            END IF;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'display_name_may_equal_login_name'
            AND value_type = 2 AND boolean_value IS NOT NULL) THEN
            RETURN NEXT 'display_name_may_equal_login_name: missing non-NULL boolean setting';
        END IF;
        IF column_ok THEN
            RETURN QUERY SELECT 'administrator_names_differ: account id ' || account.id
            FROM public.system_users account JOIN restricted.users_restricted credentials USING (id)
            WHERE (account.admin_access_allowed IS TRUE OR EXISTS (
                SELECT 1 FROM public.system_user_group_memberships membership
                WHERE membership.user_id = account.id AND membership.group_id = 1))
                AND lower(btrim(account.username)) = lower(btrim(credentials.login_name));
        END IF;
    END $fn$;
    REVOKE ALL ON FUNCTION public.app_check_login_name_protections() FROM PUBLIC;
    SELECT string_agg(finding, '; ') INTO findings FROM public.app_check_login_name_protections() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'login-name protections failed: %', findings; END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    VALUES ('k116_login_names', 'login_name_copied', jsonb_build_object('count', copied)),
        ('k116_login_names', 'account_without_credentials', jsonb_build_object('count', (
            SELECT count(*) FROM public.system_users account WHERE NOT EXISTS (
                SELECT 1 FROM restricted.users_restricted credentials WHERE credentials.id = account.id)))),
        ('k116_login_names', 'completed', '{"file":"20261005000011_separate_login_names.sql"}');
END $login_names$;
-- 20261005000014_add_password_reset_dummy_work.sql
-- Gives unknown reset-code confirmations a real private write and commit.
-- Connects OTP verification with the same database work as a failed pending code.
-- The single row contains no account, identifier, credential or usable challenge.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: password_reset_dummy_work

CREATE TABLE IF NOT EXISTS restricted.password_reset_dummy_work (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    work boolean NOT NULL DEFAULT false
);
INSERT INTO restricted.password_reset_dummy_work(id,work)
SELECT true,false WHERE NOT EXISTS (SELECT 1 FROM restricted.password_reset_dummy_work WHERE id);
COMMENT ON TABLE restricted.password_reset_dummy_work IS
    'Constant account-free work for password-reset confirmation timing. Never stores challenge or identity data.';
INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'password_reset_dummy_work','completed','{"rows":1}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration='password_reset_dummy_work' AND action='completed');
-- 20261005000021_create_system_favorites.sql
-- Stores account-owned favorites with a stable dataset reference and a textual row key.
-- Connects typed favorite resolvers with the shared registry and account lifecycle.
-- Exists so future target types reuse one table without accepting SQL identifiers.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: system_favorites_table

CREATE TABLE IF NOT EXISTS public.system_favorites (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.system_users(id) ON DELETE CASCADE,
    target_table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    target_key text NOT NULL CHECK (char_length(target_key) BETWEEN 1 AND 200),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created timestamptz NOT NULL DEFAULT now(),
    updated timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_favorites_not_visitor CHECK (user_id <> 1),
    CONSTRAINT uq_system_favorites_user_target UNIQUE (user_id, target_table_uid, target_key)
);
CREATE INDEX IF NOT EXISTS idx_system_favorites_target
    ON public.system_favorites (target_table_uid, target_key);

COMMENT ON TABLE public.system_favorites IS
    'Personal favorites. Typed server resolvers check target visibility; generic row writes are forbidden.';
COMMENT ON COLUMN public.system_favorites.user_id IS
    'Account owner, always taken from the session; visitor and site-wide favorites are not allowed.';
COMMENT ON COLUMN public.system_favorites.target_table_uid IS
    'Stable registry identity, resolved by table name on this installation, never supplied by the client.';
COMMENT ON COLUMN public.system_favorites.target_key IS
    'Text form of the target single-column primary key from the PostgreSQL catalog; integer keys use canonical decimal form. Admin tools resolve a system_functions id from their route.';
COMMENT ON COLUMN public.system_favorites.sort_order IS 'Insertion order within the account; v1 offers no reordering.';

CREATE OR REPLACE FUNCTION public.set_system_favorites_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_system_favorites_timestamp'
          AND tgrelid = 'public.system_favorites'::regclass) THEN
        CREATE TRIGGER update_system_favorites_timestamp BEFORE UPDATE ON public.system_favorites
            FOR EACH ROW EXECUTE FUNCTION public.set_system_favorites_updated_timestamp();
    END IF;
END $$;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'system_favorites_table', 'completed',
       jsonb_build_object('file', '20261005000021_create_system_favorites.sql')
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'system_favorites_table' AND action = 'completed');
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
-- 20261005000031_create_system_front_page_blocks.sql
-- Stores ordered common and account-specific front page blocks with stable dataset references.
-- Connects the read facade and administrator API with account and dataset lifecycles.
-- Exists so personal lists replace the common list without duplicating menu defaults.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: system_front_page_blocks_table

CREATE TABLE IF NOT EXISTS public.system_front_page_blocks (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id bigint REFERENCES public.system_users(id) ON DELETE CASCADE,
    table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    result_limit smallint NOT NULL DEFAULT 5 CHECK (result_limit BETWEEN 1 AND 20),
    sort_order integer NOT NULL CHECK (sort_order BETWEEN 1 AND 100),
    enabled boolean NOT NULL DEFAULT true,
    created timestamptz NOT NULL DEFAULT now(),
    updated timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_front_page_blocks_not_visitor CHECK (user_id <> 1),
    CONSTRAINT uq_system_front_page_blocks_dataset UNIQUE NULLS NOT DISTINCT (user_id, table_uid),
    CONSTRAINT uq_system_front_page_blocks_position UNIQUE NULLS NOT DISTINCT (user_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_system_front_page_blocks_table ON public.system_front_page_blocks (table_uid);

COMMENT ON TABLE public.system_front_page_blocks IS
    'Front page blocks. Any account row replaces the common list; only the dedicated administrator API writes.';
COMMENT ON COLUMN public.system_front_page_blocks.user_id IS
    'NULL is the common site list; account 1 is never a personal scope. Deleting the account removes its list.';
COMMENT ON COLUMN public.system_front_page_blocks.table_uid IS
    'Installation-local stable dataset identity resolved by name; dropping a dataset removes its blocks.';
COMMENT ON COLUMN public.system_front_page_blocks.enabled IS
    'Disabled rows still make an account list its own; all disabled means deliberately empty.';
COMMENT ON COLUMN public.system_front_page_blocks.result_limit IS 'Newest visible rows requested, from 1 to 20, default 5.';
COMMENT ON COLUMN public.system_front_page_blocks.sort_order IS 'Unique position within the common or account list, from 1 to 100.';

CREATE OR REPLACE FUNCTION public.set_system_front_page_blocks_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_system_front_page_blocks_timestamp'
        AND tgrelid = 'public.system_front_page_blocks'::regclass) THEN
        CREATE TRIGGER update_system_front_page_blocks_timestamp BEFORE UPDATE ON public.system_front_page_blocks
            FOR EACH ROW EXECUTE FUNCTION public.set_system_front_page_blocks_updated_timestamp();
    END IF;
END $$;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'system_front_page_blocks_table', 'completed',
       jsonb_build_object('file', '20261005000031_create_system_front_page_blocks.sql')
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'system_front_page_blocks_table' AND action = 'completed');
-- 20261005000035_add_row_group_classifications.sql
-- Adds multilingual headings above the existing reusable row-group values.
-- Connects heading-aware selection and facets without changing membership identity.
-- Exists so one heading widens a selection and different headings narrow it.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl103_row_group_classifications

CREATE TABLE IF NOT EXISTS public.system_row_group_classifications (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    title jsonb NOT NULL CHECK (jsonb_typeof(title) = 'object' AND title <> '{}'::jsonb),
    is_single boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -100000 AND 100000),
    enabled boolean NOT NULL DEFAULT true,
    created timestamptz NOT NULL DEFAULT now(),
    updated timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_row_groups ADD COLUMN IF NOT EXISTS classification_id bigint
    REFERENCES public.system_row_group_classifications(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_system_row_groups_classification
    ON public.system_row_groups (classification_id, sort_order);

COMMENT ON TABLE public.system_row_group_classifications IS
    'Multilingual classification headings. Writes require the administrator row-group API; headings never grant row access.';
COMMENT ON COLUMN public.system_row_group_classifications.is_single IS
    'Class permits one value per row; category permits several. Fixed after creation by the administrator API.';
COMMENT ON COLUMN public.system_row_group_classifications.enabled IS
    'Disabling a heading hides all its values and removes their selection, preserving assignments.';
COMMENT ON COLUMN public.system_row_groups.classification_id IS
    'Optional heading; NULL values share one untitled group. Deletion of a used heading is restricted.';

CREATE OR REPLACE FUNCTION public.set_system_row_group_classifications_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_system_row_group_classifications_timestamp'
          AND tgrelid = 'public.system_row_group_classifications'::regclass) THEN
        CREATE TRIGGER update_system_row_group_classifications_timestamp
            BEFORE UPDATE ON public.system_row_group_classifications
            FOR EACH ROW EXECUTE FUNCTION public.set_system_row_group_classifications_updated_timestamp();
    END IF;
END $$;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wl103_row_group_classifications', 'completed',
       jsonb_build_object('file', '20261005000035_add_row_group_classifications.sql')
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wl103_row_group_classifications' AND action = 'completed');
-- 20261005000040_add_surviving_sign_in.sql
-- Remembers the sign-in kept by the latest account-wide authentication bump.
-- Connects profile credential rotation with stale-cookie recovery at the shared boundary.
-- Keeps an acting browser signed in when an older in-flight response writes its cookie back.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl132_surviving_sign_in

DO $surviving_sign_in$
BEGIN
    ALTER TABLE restricted.users_restricted
        ADD COLUMN IF NOT EXISTS surviving_sign_in_id text,
        ADD COLUMN IF NOT EXISTS surviving_sign_in_generation bigint;

    IF (SELECT count(*) FROM pg_catalog.pg_attribute
        WHERE attrelid = 'restricted.users_restricted'::regclass AND NOT attisdropped
          AND NOT attnotnull AND NOT atthasdef
          AND ((attname = 'surviving_sign_in_id' AND atttypid = 'text'::regtype)
            OR (attname = 'surviving_sign_in_generation' AND atttypid = 'bigint'::regtype))) <> 2 THEN
        RAISE EXCEPTION 'surviving sign-in columns must be nullable text/bigint without defaults';
    END IF;

    COMMENT ON COLUMN restricted.users_restricted.surviving_sign_in_id IS
        'Opaque sign-in identity kept by a self-service authentication bump; NULL ends every sign-in.';
    COMMENT ON COLUMN restricted.users_restricted.surviving_sign_in_generation IS
        'Generation that kept this sign-in. A later bump makes the survivor ineffective automatically.';

    -- Existing table grants cover both columns. The runtime restricted-table
    -- policy gives the confidential pool access, with none for basic/guest/readonly.
    -- Do not grant public reads or add these private values to account responses.
    INSERT INTO public.system_data_repair_records(migration, action, detail)
    SELECT 'wl132_surviving_sign_in', 'completed', '{"columns":2}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'wl132_surviving_sign_in' AND action = 'completed');
END $surviving_sign_in$;
-- 20261005000070_drop_column_label_value_layout.sql
-- Removes the unused per-column wrapping choice after WL52 made wrapping site-wide.
-- Bridges upgraded metadata and the fresh bootstrap with the column visibility API.
-- Keeps all label/value visibility columns and the site JSON setting unchanged (K234).
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl52_drop_column_label_value_layout

-- PostgreSQL also removes the column's CHECK constraint and comment. No CASCADE:
-- an unexpected external dependency must refuse the migration, not be erased.
ALTER TABLE IF EXISTS public.system_column_details
    DROP COLUMN IF EXISTS label_value_layout;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wl52_drop_column_label_value_layout', 'completed',
       jsonb_build_object('file', '20261005000070_drop_column_label_value_layout.sql')
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wl52_drop_column_label_value_layout' AND action = 'completed'
);
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
-- 20261009000020_add_migration_execution_evidence.sql
-- Adds nullable byte hashes, truthful outcomes and provenance to the migration ledger.
-- Connects startup execution and bootstrap baselines to future signed-release checks.
-- Leaves every historical row unverified; present files cannot prove past execution.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: wl157_migration_execution_evidence

DO $migration_evidence$
BEGIN
    ALTER TABLE public.system_schema_migrations
        ADD COLUMN IF NOT EXISTS content_sha256 text,
        ADD COLUMN IF NOT EXISTS outcome text,
        ADD COLUMN IF NOT EXISTS provenance text;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                   WHERE conrelid = 'public.system_schema_migrations'::regclass
                     AND conname = 'system_schema_migrations_evidence_check') THEN
        ALTER TABLE public.system_schema_migrations
            ADD CONSTRAINT system_schema_migrations_evidence_check CHECK (
                (content_sha256 IS NULL AND outcome IS NULL AND provenance IS NULL)
                OR (
                    content_sha256 IS NOT NULL AND content_sha256 ~ '^[0-9a-f]{64}$'
                    AND outcome IS NOT NULL AND provenance IS NOT NULL
                    AND (
                        (provenance = 'runner' AND outcome IN
                            ('applied', 'optional_failure_skipped', 'interrupted_self_managed', 'failed_self_managed'))
                        OR (provenance = 'bootstrap' AND outcome = 'bootstrap_baseline')
                    )
                )
            );
    END IF;

    COMMENT ON COLUMN public.system_schema_migrations.content_sha256 IS
        'Runner: exact bytes submitted for execution (outcome determines completion). Bootstrap: folded-in migration source hash, not execution proof. NULL: unverified history.';
    COMMENT ON COLUMN public.system_schema_migrations.outcome IS
        'applied: completed; optional_failure_skipped: optional error; failed_self_managed: observed failure with transaction rolled back, earlier commits may remain; interrupted_self_managed: completion unknown; bootstrap_baseline: packaged source; NULL: unverified history.';
    COMMENT ON COLUMN public.system_schema_migrations.provenance IS
        'runner or bootstrap; NULL is unverified historical origin.';

    INSERT INTO public.system_data_repair_records (migration, action)
    SELECT 'wl157_migration_execution_evidence', 'completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                      WHERE migration = 'wl157_migration_execution_evidence' AND action = 'completed');
END $migration_evidence$;
-- 20261009000040_cut_over_dataset_card_appearance.sql
-- Preserves explicit legacy card choices as canonical dataset appearance overrides.
-- Connects upgrades and fresh bootstrap with the sole revision-protected authority.
-- Retires both physical columns and their editable metadata after checking preservation.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: dataset_card_appearance_cutover
-- FINAL_CHECK: public.app_check_dataset_card_appearance_cutover()

-- to_jsonb makes replay safe after the source columns have been retired.
DO $cutover$
DECLARE findings text;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('dataset_appearance_shared',0));
    IF EXISTS (SELECT 1 FROM public.system_db_tables d
                WHERE (to_jsonb(d)->>'card_style_variant') IS NOT NULL
                  AND (to_jsonb(d)->>'card_style_variant') NOT IN ('modern','standard')) THEN
        RAISE EXCEPTION 'invalid legacy card style; cutover refused';
    END IF;
    INSERT INTO public.system_dataset_appearance AS current (table_uid,overrides)
    SELECT table_uid,jsonb_strip_nulls(jsonb_build_object(
        'shared.card_style_variant',to_jsonb(d)->'card_style_variant',
        'shared.card_detail_columns',to_jsonb(d)->'card_detail_columns'))
      FROM public.system_db_tables d
     WHERE (to_jsonb(d)->>'card_style_variant') IS NOT NULL
        OR (to_jsonb(d)->>'card_detail_columns') IS NOT NULL
    ON CONFLICT(table_uid) DO UPDATE
       SET overrides=current.overrides || EXCLUDED.overrides,revision=current.revision+1
     WHERE current.overrides IS DISTINCT FROM current.overrides || EXCLUDED.overrides;

    IF EXISTS (SELECT 1 FROM public.system_db_tables d
        LEFT JOIN public.system_dataset_appearance a USING(table_uid)
        WHERE ((to_jsonb(d)->>'card_style_variant') IS NOT NULL
            AND a.overrides->'shared.card_style_variant' IS DISTINCT FROM to_jsonb(d)->'card_style_variant')
           OR ((to_jsonb(d)->>'card_detail_columns') IS NOT NULL
            AND a.overrides->'shared.card_detail_columns' IS DISTINCT FROM to_jsonb(d)->'card_detail_columns')) THEN
        RAISE EXCEPTION 'legacy card choices were not preserved; cutover refused';
    END IF;
    DELETE FROM public.system_column_details
     WHERE table_uid IN (SELECT table_uid FROM public.system_db_tables WHERE table_name='system_db_tables')
       AND column_name IN ('card_style_variant','card_detail_columns');
    ALTER TABLE public.system_db_tables DROP COLUMN IF EXISTS card_style_variant;
    ALTER TABLE public.system_db_tables DROP COLUMN IF EXISTS card_detail_columns;
END $cutover$;

COMMENT ON TABLE public.system_dataset_appearance IS
    'Private revision-protected per-dataset appearance overrides. Authorized results and dedicated administrator APIs are the only presentation boundary.';

CREATE OR REPLACE FUNCTION public.app_check_dataset_card_appearance_cutover()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $check$
    SELECT 'legacy card appearance columns remain'
     WHERE EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.system_db_tables'::regclass
         AND NOT attisdropped AND attname IN ('card_style_variant','card_detail_columns'))
    UNION ALL
    SELECT 'legacy card appearance editable metadata remains'
     WHERE EXISTS (SELECT 1 FROM public.system_column_details c JOIN public.system_db_tables d USING(table_uid)
         WHERE d.table_name='system_db_tables' AND c.column_name IN ('card_style_variant','card_detail_columns'))
    UNION ALL
    SELECT 'invalid migrated card override'
     WHERE EXISTS (SELECT 1 FROM public.system_dataset_appearance
         WHERE (overrides ? 'shared.card_style_variant' AND overrides->>'shared.card_style_variant' NOT IN ('modern','standard'))
            OR (overrides ? 'shared.card_detail_columns' AND overrides->'shared.card_detail_columns' NOT IN ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb)));
$check$;

DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_dataset_card_appearance_cutover() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'dataset card appearance final check refused: %',findings; END IF;
END $acceptance$;

INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'dataset_card_appearance_cutover','completed',jsonb_build_object('file','20261009000040_cut_over_dataset_card_appearance.sql')
WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='dataset_card_appearance_cutover' AND action='completed');
-- 20261009000050_create_application_update_admission.sql
-- Creates private durable update intent, authentication proofs and audit records.
-- Connects administrator admission to a future manager-controlled execution worker.
-- Ships disabled: no installation identity, release offer or executor is bootstrapped.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: wl157_application_update_admission
-- FINAL_CHECK: public.app_check_application_update_admission()

CREATE TABLE IF NOT EXISTS restricted.system_application_update_control (
    singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton IS TRUE),
    installation_id text NOT NULL CHECK (installation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    executor_enabled boolean NOT NULL DEFAULT FALSE,
    executor_available boolean NOT NULL DEFAULT FALSE,
	 executor_checked_at timestamptz NOT NULL DEFAULT '-infinity',
    offer jsonb CHECK (offer IS NULL OR jsonb_typeof(offer) = 'object')
);
COMMENT ON TABLE restricted.system_application_update_control IS
    'Operator/manager-published, installation-bound signed offer. No browser write API; absent row fails closed. Reachability is refreshed by the future manager boundary.';

CREATE TABLE IF NOT EXISTS restricted.system_application_update_jobs (
    id text PRIMARY KEY,
    installation_id text NOT NULL,
    requester_id integer NOT NULL,
    authorization_context jsonb NOT NULL CHECK (jsonb_typeof(authorization_context) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    active boolean NOT NULL DEFAULT TRUE,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'protocol_version' = '1')
);
CREATE UNIQUE INDEX IF NOT EXISTS system_application_update_one_active
    ON restricted.system_application_update_jobs ((active)) WHERE active IS TRUE;

CREATE TABLE IF NOT EXISTS restricted.system_application_update_proofs (
    id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object'),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
	 verification_method text NOT NULL CHECK (verification_method IN ('none','fixed_pin','totp','email')),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
COMMENT ON TABLE restricted.system_application_update_proofs IS
    'Single-use SHA-256 token references bound to actor, generation, sign-in, action, installation, release/cutover and evidence; no passwords, factors or raw tokens.';

CREATE TABLE IF NOT EXISTS restricted.system_application_update_decisions (
    id text PRIMARY KEY,
    job_id text NOT NULL REFERENCES restricted.system_application_update_jobs(id),
    evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
    authorization_context jsonb NOT NULL CHECK (jsonb_typeof(authorization_context) = 'object'),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'protocol_version' = '1')
);
CREATE INDEX IF NOT EXISTS system_application_update_pending_decisions
    ON restricted.system_application_update_decisions(job_id,evidence_sha256,expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS restricted.system_application_update_admissions (
    actor_id integer NOT NULL,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    PRIMARY KEY (actor_id,operation,idempotency_key)
);

CREATE TABLE IF NOT EXISTS restricted.system_application_update_events (
    job_id text NOT NULL REFERENCES restricted.system_application_update_jobs(id),
    sequence bigint NOT NULL CHECK (sequence > 0),
    event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
    authorization_context jsonb NOT NULL CHECK (jsonb_typeof(authorization_context) = 'object'),
    proof_id text NOT NULL,
    target jsonb NOT NULL CHECK (jsonb_typeof(target) = 'object'),
    origin text NOT NULL CHECK (origin IN ('administrator_view','manager')),
    PRIMARY KEY (job_id,sequence)
);
COMMENT ON TABLE restricted.system_application_update_events IS
    'Atomic admission audit mirror. Execution/consumption authority must also be journaled outside database restoration scope by the manager; never infer progress from logs.';

CREATE TABLE IF NOT EXISTS restricted.system_application_update_auth_attempts (
    key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
    window_start timestamptz NOT NULL,
    attempts integer NOT NULL CHECK (attempts > 0)
);
REVOKE ALL ON restricted.system_application_update_control, restricted.system_application_update_jobs,
    restricted.system_application_update_proofs, restricted.system_application_update_decisions,
    restricted.system_application_update_admissions, restricted.system_application_update_events,
    restricted.system_application_update_auth_attempts FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.app_check_application_update_admission()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $check$
    SELECT 'application-update storage missing a private table or primary key: ' || expected.name
    FROM unnest(ARRAY['system_application_update_control','system_application_update_jobs',
        'system_application_update_proofs','system_application_update_decisions',
        'system_application_update_admissions','system_application_update_events',
        'system_application_update_auth_attempts']) AS expected(name)
    WHERE to_regclass('restricted.' || expected.name) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('restricted.' || expected.name) AND contype='p')
    UNION ALL
    SELECT 'application-update storage has an unexpected column shape: ' || expected.name
    FROM (VALUES ('system_application_update_control',6),('system_application_update_jobs',8),
        ('system_application_update_proofs',6),('system_application_update_decisions',7),
        ('system_application_update_admissions',5),('system_application_update_events',7),
        ('system_application_update_auth_attempts',3)) AS expected(name,column_count)
    WHERE (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('restricted.' || expected.name)
        AND attnum>0 AND NOT attisdropped) <> expected.column_count
    UNION ALL
    SELECT 'application-update authorization context column is invalid: ' || expected.name
    FROM unnest(ARRAY['system_application_update_jobs','system_application_update_decisions',
        'system_application_update_events']) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('restricted.' || expected.name)
        AND attname='authorization_context' AND atttypid='jsonb'::regtype AND attnotnull
        AND attnum>0 AND NOT attisdropped)
    UNION ALL
    SELECT 'application-update storage must stay outside generic datasets'
    WHERE EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_name LIKE 'system_application_update_%')
    UNION ALL
    SELECT 'application-update admission requires the single-active-job index'
    WHERE NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('restricted.system_application_update_one_active') AND indisunique AND indisvalid
        AND pg_get_indexdef(indexrelid) LIKE '%(active)%WHERE%active IS TRUE%')
    UNION ALL
    SELECT 'application-update proof freshness constraint missing'
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='restricted.system_application_update_proofs'::regclass
        AND contype='c' AND convalidated AND pg_get_constraintdef(oid) LIKE '%expires_at%created_at%00:05:00%')
    UNION ALL
    SELECT 'application-update idempotency scope is invalid'
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='restricted.system_application_update_admissions'::regclass
        AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (actor_id, operation, idempotency_key)')
    UNION ALL
    SELECT 'application-update storage must not grant privileges to PUBLIC'
    WHERE EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
        LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
        WHERE n.nspname='restricted' AND c.relname LIKE 'system_application_update_%'
        AND c.relkind='r' AND acl.grantee=0);
$check$;
DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_application_update_admission() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'application-update admission final check refused: %', findings; END IF;
    INSERT INTO public.system_data_repair_records(migration,action)
    SELECT 'wl157_application_update_admission','completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='wl157_application_update_admission' AND action='completed');
END $acceptance$;
-- 20261009000060_extend_dataset_appearance_three_places.sql
-- Activates owned tab values and sparse default overrides without shared cover writes.
-- Connects upgrades and fresh bootstrap with the reviewed version-two definition.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: dataset_appearance_three_place_schema
-- FINAL_CHECK: public.app_check_dataset_appearance_storage()

-- Immutable migration rule snapshot. Tests compare it with definition.json;
-- future rules need a new migration, never edits to executed source.
CREATE OR REPLACE FUNCTION public.app_dataset_appearance_v2_rules()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $rules$
 SELECT '
{
 "light.oval_enabled": {
  "place": "tab_only",
  "type": "boolean",
  "default": true,
  "dark_default": false
 },
 "light.oval_width": {
  "place": "tab_only",
  "type": "number",
  "default": 32,
  "min": 20,
  "max": 140,
  "step": 1
 },
 "light.oval_height": {
  "place": "tab_only",
  "type": "number",
  "default": 67,
  "min": 20,
  "max": 140,
  "step": 1
 },
 "light.oval_position_y": {
  "place": "tab_only",
  "type": "number",
  "default": 56,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "light.center_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.4,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "light.mid_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.7,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "light.edge_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "light.center_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 39,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "light.mid_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 55,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "light.edge_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 80,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "light.image_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 1,
  "step": 0.05,
  "dark_default": 0.3
 },
 "light.overlay_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0,
  "min": 0,
  "max": 1,
  "step": 0.01
 },
 "light.image_blur": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 24,
  "step": 1
 },
 "dark.oval_enabled": {
  "place": "tab_only",
  "type": "boolean",
  "default": false,
  "dark_default": false
 },
 "dark.oval_width": {
  "place": "tab_only",
  "type": "number",
  "default": 32,
  "min": 20,
  "max": 140,
  "step": 1
 },
 "dark.oval_height": {
  "place": "tab_only",
  "type": "number",
  "default": 67,
  "min": 20,
  "max": 140,
  "step": 1
 },
 "dark.oval_position_y": {
  "place": "tab_only",
  "type": "number",
  "default": 56,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "dark.center_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.4,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "dark.mid_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.7,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "dark.edge_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "dark.center_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 39,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "dark.mid_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 55,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "dark.edge_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 80,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "dark.image_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.3,
  "min": 0,
  "max": 1,
  "step": 0.05,
  "dark_default": 0.3
 },
 "dark.overlay_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0,
  "min": 0,
  "max": 1,
  "step": 0.01
 },
 "dark.image_blur": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 24,
  "step": 1
 },
 "shared.hero_extra_height": {
  "place": "tab_only",
  "type": "number",
  "default": 40,
  "min": 0,
  "max": 240,
  "step": 5
 },
 "shared.hero_bottom_fade": {
  "place": "tab_only",
  "type": "number",
  "default": 48,
  "min": 0,
  "max": 200,
  "step": 2
 },
 "shared.card_image_width": {
  "place": "site_default",
  "type": "number",
  "default": 300,
  "min": 30,
  "max": 600,
  "step": 5
 },
 "shared.card_image_presentation": {
  "place": "site_default",
  "type": "string",
  "default": "contain",
  "values": [
   "cover",
   "contain",
   "contain_blur"
  ]
 },
 "shared.article_image_caption_position": {
  "place": "site_default",
  "type": "string",
  "default": "below",
  "values": [
   "below",
   "overlay"
  ]
 },
 "shared.card_show_all_fields": {
  "place": "site_default",
  "type": "boolean",
  "default": true
 },
 "shared.label_value_layout": {
  "place": "site_default",
  "type": "string",
  "default": "stacked",
  "values": [
   "stacked",
   "inline"
  ],
  "development_values": [
   "auto"
  ]
 },
 "shared.card_style_variant": {
  "place": "site_default",
  "type": "string",
  "default": "modern",
  "values": [
   "standard",
   "modern"
  ]
 },
 "shared.card_description_lines": {
  "place": "site_default",
  "type": "integer",
  "default": 2,
  "min": 1,
  "max": 12,
  "step": 1
 },
 "shared.card_detail_columns": {
  "place": "site_default",
  "type": "integer",
  "default": 2,
  "min": 1,
  "max": 4,
  "step": 1
 },
 "shared.active_tab_fade": {
  "place": "site_only",
  "type": "number",
  "default": 25,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "shared.active_tab_max_opacity": {
  "place": "site_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "shared.active_tab_glow_intensity": {
  "place": "site_only",
  "type": "number",
  "default": 0.5,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "shared.active_tab_glow_width": {
  "place": "site_only",
  "type": "number",
  "default": 2,
  "min": 0,
  "max": 8,
  "step": 0.25
 },
 "shared.active_tab_glow_blur": {
  "place": "site_only",
  "type": "number",
  "default": 4,
  "min": 0,
  "max": 12,
  "step": 0.5
 },
 "shared.filterbar_content_top_space": {
  "place": "site_default",
  "type": "number",
  "default": 40,
  "min": 0,
  "max": 200,
  "step": 2
 },
 "shared.active_filter_remove_side": {
  "place": "site_only",
  "type": "string",
  "default": "start",
  "values": [
   "start",
   "end"
  ]
 },
 "shared.brand_color": {
  "place": "site_only",
  "type": "hex_color",
  "default": "#1a8fe6"
 }
}
'::jsonb;
$rules$;

CREATE OR REPLACE FUNCTION public.app_valid_dataset_appearance_v2(appearance_values jsonb, place text, complete boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $check$
DECLARE item record; rule jsonb; number numeric; wanted integer;
BEGIN
    IF appearance_values IS NULL OR jsonb_typeof(appearance_values) <> 'object' THEN RETURN false; END IF;
    SELECT count(*) INTO wanted FROM jsonb_each(public.app_dataset_appearance_v2_rules()) WHERE value->>'place'=place;
    IF complete AND (SELECT count(*) FROM jsonb_each(appearance_values)) <> wanted THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_each(appearance_values) LOOP
        rule := public.app_dataset_appearance_v2_rules()->item.key;
        IF rule IS NULL OR rule->>'place' <> place OR item.value='null'::jsonb THEN RETURN false; END IF;
        CASE rule->>'type'
        WHEN 'boolean' THEN IF jsonb_typeof(item.value) <> 'boolean' THEN RETURN false; END IF;
        WHEN 'number', 'integer' THEN
            IF jsonb_typeof(item.value) <> 'number' THEN RETURN false; END IF;
            number := item.value::text::numeric;
            IF number < (rule->>'min')::numeric OR number > (rule->>'max')::numeric
               OR (rule->>'type'='integer' AND number <> trunc(number)) THEN RETURN false; END IF;
        WHEN 'hex_color' THEN
            IF jsonb_typeof(item.value) <> 'string' OR (item.value #>> '{}') !~ '^#[0-9A-Fa-f]{6}$' THEN RETURN false; END IF;
        WHEN 'string' THEN
            IF jsonb_typeof(item.value) <> 'string' OR NOT (COALESCE(rule->'values','[]') || COALESCE(rule->'development_values','[]')) @> jsonb_build_array(item.value) THEN RETURN false; END IF;
        ELSE RETURN false;
        END CASE;
    END LOOP;
    IF place='tab_only' AND complete THEN
        FOREACH place IN ARRAY ARRAY['light','dark'] LOOP
            IF (appearance_values->>(place||'.center_opacity'))::numeric > (appearance_values->>(place||'.mid_opacity'))::numeric
               OR (appearance_values->>(place||'.mid_opacity'))::numeric > (appearance_values->>(place||'.edge_opacity'))::numeric
               OR (appearance_values->>(place||'.center_stop'))::numeric > (appearance_values->>(place||'.mid_stop'))::numeric
               OR (appearance_values->>(place||'.mid_stop'))::numeric > (appearance_values->>(place||'.edge_stop'))::numeric THEN RETURN false; END IF;
        END LOOP;
    END IF;
    RETURN true;
END $check$;

ALTER TABLE public.system_dataset_appearance ADD COLUMN IF NOT EXISTS tab_values jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.system_dataset_appearance ALTER COLUMN schema_version SET DEFAULT 2;
-- Version one remains readable only between these two atomic migration steps.
-- The backfill tightens this constraint to version two after converting all rows.
DO $schema$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='dataset_appearance_three_place_backfill' AND action='completed') THEN
        ALTER TABLE public.system_dataset_appearance DROP CONSTRAINT ck_system_dataset_appearance_schema_version;
        ALTER TABLE public.system_dataset_appearance ADD CONSTRAINT ck_system_dataset_appearance_schema_version CHECK(schema_version IN (1,2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND conname='ck_system_dataset_appearance_tab_values') THEN
        ALTER TABLE public.system_dataset_appearance ADD CONSTRAINT ck_system_dataset_appearance_tab_values
            CHECK(schema_version=1 OR public.app_valid_dataset_appearance_v2(tab_values,'tab_only',true));
        ALTER TABLE public.system_dataset_appearance ADD CONSTRAINT ck_system_dataset_appearance_overrides
            CHECK(schema_version=1 OR public.app_valid_dataset_appearance_v2(overrides,'site_default',false));
    END IF;
END $schema$;
COMMENT ON COLUMN public.system_dataset_appearance.tab_values IS 'Complete 28 canonical tab-owned appearance_values. Never inherits site changes; one revision covers this map and overrides.';
COMMENT ON TABLE public.system_dataset_appearance IS 'Private version-two tab appearance and sparse default overrides. Dedicated authorized savers only; immutable UID ownership.';
REVOKE ALL ON public.system_dataset_appearance FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.app_check_dataset_appearance_storage()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $check$
    SELECT 'dataset appearance storage requires exactly five non-null columns and version-two defaults'
    WHERE (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute
        WHERE attrelid='public.system_dataset_appearance'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull)
        IS DISTINCT FROM ARRAY['overrides','revision','schema_version','tab_values','table_uid']
       OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.system_dataset_appearance'::regclass AND attnum>0 AND NOT attisdropped) <> 5
       OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
           WHERE d.adrelid='public.system_dataset_appearance'::regclass AND a.attname='schema_version' AND pg_get_expr(d.adbin,d.adrelid)='2')
    UNION ALL
    SELECT 'dataset appearance requires its primary key and cascading UID'
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (table_uid)')
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND contype='f' AND pg_get_constraintdef(oid)='FOREIGN KEY (table_uid) REFERENCES system_db_tables(table_uid) ON DELETE CASCADE')
    UNION ALL
    SELECT 'dataset appearance storage requires six validated checks'
    WHERE (SELECT count(*) FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND contype='c' AND convalidated
        AND (conname,pg_get_constraintdef(oid)) IN (
            ('ck_system_dataset_appearance_schema_version','CHECK ((schema_version = 2))'),
            ('ck_system_dataset_appearance_schema_version','CHECK ((schema_version = ANY (ARRAY[1, 2])))'),
            ('ck_system_dataset_appearance_object','CHECK ((jsonb_typeof(overrides) = ''object''::text))'),
            ('ck_system_dataset_appearance_no_null','CHECK ((NOT jsonb_path_exists(overrides, ''$.*?(@ == null)''::jsonpath)))'),
            ('ck_system_dataset_appearance_revision','CHECK ((revision > 0))'),
            ('ck_system_dataset_appearance_tab_values','CHECK (((schema_version = 1) OR app_valid_dataset_appearance_v2(tab_values, ''tab_only''::text, true)))'),
            ('ck_system_dataset_appearance_overrides','CHECK (((schema_version = 1) OR app_valid_dataset_appearance_v2(overrides, ''site_default''::text, false)))'))) <> 6
    UNION ALL
    SELECT 'dataset appearance must not be registered or exposed to PUBLIC'
    WHERE EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_name='system_dataset_appearance')
       OR EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid='public.system_dataset_appearance'::regclass AND a.grantee=0);
$check$;

DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_dataset_appearance_storage() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'dataset appearance storage final check refused: %',findings; END IF;
END $acceptance$;
INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'dataset_appearance_three_place_schema','completed',jsonb_build_object('file','20261009000060_extend_dataset_appearance_three_places.sql')
WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='dataset_appearance_three_place_schema' AND action='completed');
-- row_actor_columns.schema.sql
-- Completes the creator and owner structure of the sixteen public content tables.
-- Bridges the common actor functions and the package's final schema, before seed rows
-- or privileges exist. Registration belongs to 000004 after groups and folders exist.
-- Exists so a fresh package needs no actor DDL in its data phase and its schema snapshot
-- is complete; upgrades and new datasets use these same physical helpers.
DO $actor_schema$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'palvelukatalogi', 'riskienhallinta', 'dokumentaatio', 'tiketit', 'system_about',
        'dev_agent_task_statuses', 'dev_agent_task_todo_statuses', 'dev_agent_task_queues',
        'dev_agent_task_groups', 'dev_agent_tasks', 'dev_agent_task_todos', 'dev_agent_worklines',
        'dev_agent_workline_reports', 'dev_agent_handover_reports', 'dev_agent_release_goals',
        'dev_agent_release_goal_contracts'
    ] LOOP
        PERFORM public.app_ensure_row_actor_columns(format('public.%I', table_name)::regclass, 'owner_id');
        PERFORM public.app_ensure_row_actor_constraints(format('public.%I', table_name)::regclass, 'owner_id');
    END LOOP;
END $actor_schema$;
-- 20260921000001_withdraw_public_table_creation.sql
-- Leaves table creation in the shared public schema to the application's own role.
-- Bridges databases first created before PostgreSQL 15 with that version's secure default.
-- Exists because every database role, the read-only one included, could create tables:
-- PUBLIC still held CREATE on schema public, carried forward by each dump and upgrade.
-- The public bootstrap runs this same file, so a new installation ends in this state too.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

DO $$
DECLARE
    read_role text;
BEGIN
    -- Migrations run as the role that creates datasets. Its configured name
    -- differs per installation, so it is addressed as the connected role. The
    -- grant makes its right explicit before the right shared by everyone goes.
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', current_user);

    -- PostgreSQL 15 and later create a database without this. An older database
    -- keeps it through pg_dump, restore and pg_upgrade, and so did every copy
    -- restored from one: through it every role could create a table.
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;

    -- A read-only role never needs a direct grant either. Only names known to
    -- be read-only are touched, and a role this installation lacks is skipped.
    FOR read_role IN
        SELECT rolname
          FROM pg_roles
         WHERE rolname IN ('readeronly', 'filterest_readonly', 'readonly_user')
    LOOP
        EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', read_role);
    END LOOP;

    -- Only the schema owner or a superuser can withdraw a right the owner
    -- granted; for any other role REVOKE only warns and changes nothing.
    -- Stop the update instead of recording a repair that did not happen.
    IF has_schema_privilege('public', 'public', 'CREATE') THEN
        RAISE EXCEPTION
            'PUBLIC still holds CREATE on schema public: role % can neither own the schema nor act as a superuser',
            current_user;
    END IF;

    -- Dataset creation must survive the change; roll it back if it would not.
    IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
        RAISE EXCEPTION
            'role % would lose CREATE on schema public and could no longer create datasets',
            current_user;
    END IF;
END
$$;
