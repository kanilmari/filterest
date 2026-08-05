-- Generated from schema_info.csv by testing/essential/generate_dummy_test_database.py
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
ALTER TABLE public.system_db_tables ALTER COLUMN card_style_variant SET DEFAULT 'standard';
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
    column_name text,
    column_uid integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id integer GENERATED BY DEFAULT AS IDENTITY,
    table_uid integer,
    column_label text,
    editable_in_ui boolean DEFAULT true,
    created timestamp without time zone DEFAULT now() NOT NULL,
    updated timestamp without time zone DEFAULT now() NOT NULL,
    data_type character varying(255),
    card_element character varying(255) DEFAULT 'details',
    creation_spec text,
    show_key_on_card boolean DEFAULT true,
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
    card_detail_capitalization boolean DEFAULT true
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

CREATE TABLE IF NOT EXISTS public.system_user_column_settings (
    column_name character varying(100),
    sort_order integer,
    user_id integer,
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    updated timestamp with time zone DEFAULT now() NOT NULL,
    table_name character varying(100),
    created timestamp with time zone DEFAULT now() NOT NULL,
    column_width_px integer,
    is_hidden boolean DEFAULT false,
    table_uid integer
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_column_settings
    ON public.system_user_column_settings (user_id, table_name, column_name);

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

CREATE TABLE IF NOT EXISTS public.system_table_views (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    created timestamp with time zone NOT NULL DEFAULT now(),
    updated timestamp with time zone NOT NULL DEFAULT now(),
    kuvaus character varying(255),
    name character varying(128),
    status character varying(255)
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

CREATE TABLE IF NOT EXISTS public.system_column_view_presets (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_name text NOT NULL,
    preset_name text NOT NULL,
    hidden_columns jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by integer REFERENCES public.system_users(id) ON DELETE SET NULL,
    created timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (table_name, preset_name)
);

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
