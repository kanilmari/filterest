-- column_supported_views.schema.sql
-- Includes reviewed public feature metadata in a fresh installation.
-- Mirrors the corresponding incremental migration without importing runtime data.
-- Keeps clean installs and upgraded databases on the same feature contract.

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
    COALESCE(details.show_key_on_card, TRUE) AS show_key_on_card,
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
