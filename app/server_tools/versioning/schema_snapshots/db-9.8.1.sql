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
    table_uid integer,
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
    table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    column_label text,
    editable_in_ui boolean DEFAULT true,
    created timestamp without time zone DEFAULT now() NOT NULL,
    updated timestamp without time zone DEFAULT now() NOT NULL,
    data_type character varying(255),
    card_element character varying(255) DEFAULT 'details',
    label_value_layout character varying(16),
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
    CONSTRAINT system_column_details_label_value_layout_check CHECK (label_value_layout IS NULL OR label_value_layout IN ('auto', 'inline', 'stacked')),
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

-- Match the additive shared field-layout migration in fresh installations.
COMMENT ON COLUMN public.system_column_details.label_value_layout IS
    'Optional shared field label/value layout: null preserves existing view behavior; auto, inline or stacked affects presentation only.';
-- runtime.schema.sql
-- Defines the public-safe tables required before Filterest serves its first authenticated page.
-- Bridges the reduced essential fixture schema and backend startup/browser runtime dependencies.
-- Exists so generated siblings fail during bootstrap instead of returning recurring HTTP 500 errors.

ALTER TABLE restricted.users_restricted
    ADD COLUMN IF NOT EXISTS authentication_generation bigint NOT NULL DEFAULT 1;

-- A generated bootstrap is already at the schema state represented by the
-- migration files shipped with it. The matching seed records that immutable
-- filename baseline so an unrestricted first startup executes only migrations
-- added after this bootstrap was generated.
CREATE TABLE IF NOT EXISTS public.system_schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamp with time zone DEFAULT now()
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
    user_id integer,
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
    user_id integer,
    cached_username character varying,
    palvelu_id integer REFERENCES public.palvelukatalogi(id) ON UPDATE CASCADE ON DELETE SET NULL,
    cached_image text,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dokumentaatio (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id integer,
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
    user_id integer,
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
