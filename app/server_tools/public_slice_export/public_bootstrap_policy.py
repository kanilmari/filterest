# public_bootstrap_policy.py
# Owns reviewed public bootstrap copy and synthetic-content contracts.
# Shared by the generator and audit through the audit module's public imports.
# Keeps policy separate from audit parsing; table allowlists live in public_bootstrap_table_allowlists.py.
import re

FORBIDDEN_CONTENT_PATTERNS = {
    "private table": re.compile(
        r"\b(dev_projects|dev_milestones|app_notes|"
        r"app_service_catalog|app_service_catalog_assets|"
        r"app_service_child_items|app_service_locations)\b",
        re.IGNORECASE,
    ),
    "private app/tool reference": re.compile(
        r"\b(agent_tools|tukisuu|mcp_app|private_tools|private_apps)\b|"
        r"/api/app/(agent|tukisuu|mcp)",
        re.IGNORECASE,
    ),
    "parallel replacement mock table": re.compile(
        r"\b(app_services|app_tickets|app_risks|app_documents)\b",
        re.IGNORECASE,
    ),
    "provider token": re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    "secret assignment": re.compile(
        r"\b[A-Z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD)\s*=", re.IGNORECASE
    ),
    "private upstream runtime wording": re.compile(
        r"\bprivate\s+(?:Easelect|upstream)\s+runtime\b|\bEaselect\s+runtime\s+state\b",
        re.IGNORECASE,
    ),
}

EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
TABLE_PATTERN = re.compile(
    r"\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO|COPY)\s+"
    r"((?:public|restricted)\.[A-Za-z0-9_]+)",
    re.IGNORECASE,
)
INSERT_TABLE_PATTERN = re.compile(r"\bINSERT\s+INTO\s+((?:public|restricted)\.[A-Za-z0-9_]+)", re.IGNORECASE)
SYSTEM_CONFIG_KEY_PATTERN = re.compile(
    r"\(\s*\d+\s*,\s*'((?:''|[^'])+)'\s*,",
    re.IGNORECASE,
)
SYSTEM_CONFIG_SELECT_KEY_PATTERN = re.compile(
    r"\bSELECT\s*'((?:''|[^'])+)'\s*,",
    re.IGNORECASE,
)
MIGRATION_LEDGER_INSERT_PATTERN = re.compile(
    r"\bINSERT\s+INTO\s+public\.system_schema_migrations\s*"
    r"\(\s*filename\s*,\s*content_sha256\s*,\s*outcome\s*,\s*provenance\s*\)"
    r"\s*VALUES\s*(.*?)\s*ON\s+CONFLICT\s*\(\s*filename\s*\)\s+DO\s+NOTHING\s*;",
    re.IGNORECASE | re.DOTALL,
)
MIGRATION_LEDGER_FILENAME_PATTERN = re.compile(r"\(\s*'([^']+\.sql)'\s*,")
MIGRATION_LEDGER_EVIDENCE_PATTERN = re.compile(
    r"\(\s*'([^']+\.sql)'\s*,\s*'([0-9a-f]{64})'\s*,\s*'bootstrap_baseline'\s*,\s*'bootstrap'\s*\)"
)

CANONICAL_MOCK_ROW_COUNTS = {
    "public.palvelukatalogi": 1,
    "public.riskienhallinta": 1,
    "public.dokumentaatio": 3,
    "public.tiketit": 1,
    "public.palvelukatalogi_assets": 1,
    "public.riskienhallinta_assets": 1,
    "public.dokumentaatio_assets": 0,
    "public.tiketit_assets": 1,
}

CANONICAL_MOCK_RELATION_MINIMUMS = {
    "public.palvelukatalogi_riskienhallinta_relation": 1,
    "public.palvelukatalogi_dokumentaatio_relation": 1,
    "public.palvelukatalogi_tiketit_relation": 1,
    "public.riskienhallinta_dokumentaatio_relation": 1,
    "public.riskienhallinta_tiketit_relation": 1,
    "public.dokumentaatio_tiketit_relation": 1,
}

CANONICAL_IMAGE_ASSET_RELATIONS = {
    "palvelukatalogi": ("palvelukatalogi_assets", "palvelukatalogi_id", 300, 7),
    "riskienhallinta": ("riskienhallinta_assets", "riskienhallinta_id", 301, 8),
    "dokumentaatio": ("dokumentaatio_assets", "dokumentaatio_id", 302, 9),
    "tiketit": ("tiketit_assets", "tiketit_id", 303, 10),
}

CANONICAL_RUNTIME_SEED_COUNTS = {
    "public.system_about": 1,
    "public.system_db_version": 1,
}

REQUIRED_RUNTIME_SCHEMA_FRAGMENTS = {
    "surviving sign-in identity": "ADD COLUMN IF NOT EXISTS surviving_sign_in_id text",
    "surviving sign-in generation": "ADD COLUMN IF NOT EXISTS surviving_sign_in_generation bigint",
    "classification headings": "CREATE TABLE IF NOT EXISTS public.system_row_group_classifications",
    "classification reference": "ADD COLUMN IF NOT EXISTS classification_id bigint",
    "AI conversation table": "CREATE TABLE IF NOT EXISTS public.ai_chat_conversations",
    "table-view metadata table": "CREATE TABLE IF NOT EXISTS public.system_table_views",
    "child-tab configuration table": "CREATE TABLE IF NOT EXISTS public.system_child_tab_config",
    "cross-dataset comments table": "CREATE TABLE IF NOT EXISTS public.system_comments",
    "row-group table": "CREATE TABLE IF NOT EXISTS public.system_row_groups",
    "row-group membership table": "CREATE TABLE IF NOT EXISTS public.system_row_group_memberships",
    "field collection table": "CREATE TABLE IF NOT EXISTS public.system_column_field_sets",
    "field collection member table": "CREATE TABLE IF NOT EXISTS public.system_column_field_set_members",
    "view field assignment table": "CREATE TABLE IF NOT EXISTS public.system_view_field_set_assignments",
    "user visual preference table": "CREATE TABLE IF NOT EXISTS public.system_user_visual_preferences",
    "user visual preference timestamp trigger": "update_system_user_visual_preferences_timestamp",
    "client delivery mode": "ADD COLUMN IF NOT EXISTS client_delivery_mode VARCHAR(32)",
    "protected ID delivery constraint": "ck_system_column_details_id_client_delivery",
    "group view assignment target": "ADD COLUMN IF NOT EXISTS group_id BIGINT",
    "group view assignment precedence": "ADD COLUMN IF NOT EXISTS group_priority INTEGER",
    "group view assignment uniqueness": "uq_system_view_field_set_assignment_principal",
    "permission category registry": "CREATE TABLE IF NOT EXISTS public.system_permission_categories",
    "permission action registry": "CREATE TABLE IF NOT EXISTS public.system_permission_actions",
    "row access rules": "CREATE TABLE IF NOT EXISTS public.system_row_access_rules",
    "row access audit events": "CREATE TABLE IF NOT EXISTS public.system_row_access_rule_events",
    "deny-wins row access resolver": "CREATE OR REPLACE FUNCTION public.resolve_effective_row_access",
    "stable view key": "view_key text NOT NULL UNIQUE",
    "about/privacy table": "CREATE TABLE IF NOT EXISTS public.system_about",
    "database-version table": "CREATE TABLE IF NOT EXISTS public.system_db_version",
    "dataset alias table": "CREATE TABLE IF NOT EXISTS public.system_db_table_aliases",
    "UI-language registry": "CREATE TABLE IF NOT EXISTS public.system_languages",
    "normalized UI translations": "CREATE TABLE IF NOT EXISTS public.system_lang_key_translations",
    "single default UI language index": "idx_system_languages_one_default",
    "normalized UI translation lookup index": "idx_system_lang_key_translations_language",
    "embedding refresh queue": "CREATE TABLE IF NOT EXISTS public.system_embedding_refresh_jobs",
    "embedding refresh claim index": "idx_system_embedding_refresh_jobs_claim",
    "dataset media registry": "CREATE TABLE IF NOT EXISTS public.system_dataset_media",
    "dataset media lookup index": "idx_system_dataset_media_table_uid",
    "dataset media timestamp trigger": "update_system_dataset_media_timestamp",
    "dataset sorting defaults": "CREATE TABLE IF NOT EXISTS public.system_dataset_sort_defaults",
    "dataset sorting user index": "idx_system_dataset_sort_defaults_user",
    "dataset embedding enable switch": "external_embedding_enabled BOOLEAN NOT NULL DEFAULT FALSE",
    "dataset embedding policy marker": "external_embedding_policy_configured BOOLEAN NOT NULL DEFAULT FALSE",
    "embedding field allowlist marker": "external_embedding_allowed BOOLEAN NOT NULL DEFAULT FALSE",
    "dataset alias lookup index": "idx_system_db_table_aliases_table_uid",
    "single primary dataset alias index": "idx_system_db_table_aliases_one_primary_alias_per_table",
    "system table ID default": "ALTER TABLE public.system_db_tables ALTER COLUMN id SET DEFAULT",
    "system table UID default": "ALTER TABLE public.system_db_tables ALTER COLUMN table_uid SET DEFAULT",
    "system table default flag": "ALTER TABLE public.system_db_tables ALTER COLUMN is_default SET DEFAULT FALSE",
    "system table non-null default flag": "ALTER TABLE public.system_db_tables ALTER COLUMN is_default SET NOT NULL",
    "system table filterbar flag": "ALTER TABLE public.system_db_tables ALTER COLUMN filterbar_visible_by_default SET DEFAULT FALSE",
    "system table non-null filterbar flag": "ALTER TABLE public.system_db_tables ALTER COLUMN filterbar_visible_by_default SET NOT NULL",
    "AI conversation uniqueness": "idx_ai_chat_conversations_user_dataset",
    "comment lookup index": "idx_system_comments_lookup",
}

REQUIRED_RUNTIME_SEED_FRAGMENTS = {
    "classification registry marker": "wl103_row_group_classifications_registry",
    "classification schema marker": "wl103_row_group_classifications",
    "category ribbon copy": "row_group_categories",
    "classification window copy": "row_group_window_new_heading",
    "classification window recoverable error": "row_group_window_save_failed",
    "production-update notice state": "'production_update_notice'",
    "production-update manager route": "('router.systemUpdateNoticeHandler', '/system/update-notice'",
    "production-update administrator stream": "('router.adminUpdateNoticeStreamHandler', '/api/admin/update-notice/stream'",
    "production-update administrator permission": "Filterest public bootstrap administrator production-update notice stream",
    "row-group table registry": "('system_row_groups', 'Row Groups'",
    "row-group membership table registry": "('system_row_group_memberships', 'Row Group Memberships'",
    "row-group administrator route": "('system_table_tools.AdminRowGroupsHandler', '/api/admin/row-groups'",
    "row-group membership administrator route": "('system_table_tools.AdminRowGroupMembershipsHandler', '/api/admin/row-group-memberships'",
    "row-group administrator permission": "Filterest public bootstrap administrator row-group API",
    "guest public-schema access": "GRANT USAGE ON SCHEMA public TO guest_user",
    "guest row-group read access": "public.system_row_groups,\n            public.system_row_group_memberships\n        TO guest_user",
    "PostgreSQL RLS readiness gate": "'postgresql_rls_backend_enabled'",
    "row-access administrator route": "'/api/admin/row-access-rules'",
    "view-field reset route": "'system_table_tools.ResetSharedViewFieldSetHandler'",
    "view-field administrator UI permission": "'ui.admin.view_field_assignments'",
    "user visual preference table registry": "('system_user_visual_preferences', 'User Visual Preferences'",
    "user visual preference route": "'auth.UserVisualPreferenceHandler'",
    "user visual preference authenticated grants": "public.system_user_visual_preferences\n        TO basic_user",
    "embedding client-delivery exclusion": "SET client_delivery_mode = 'server_only'",
    "row-access administrator permission": "Filterest DB 9.7.0 accepted administrator access-control workflows",
    "row-access translated copy": "('edit_row_permissions',",
    "view-field translated copy": "('view_field_assignments',",
}

