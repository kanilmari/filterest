"""Guard the language keys required by the public Filterest article fixture.

The required set comes from authenticated, uncached article-route runtime
captures with both supported field-selection states. Keeping it here makes
missing bootstrap translations fail before the browser falls back to repeat
AI-translation requests.
"""

from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
LANGUAGE_SEED = (
    REPO_ROOT
    / "server_tools/public_slice_export/public_bootstrap/app_tables.lang_keys.sql"
)
LANGUAGE_MIGRATION = (
    REPO_ROOT
    / "server_tools/migrations/20260720000003_seed_filterest_public_metadata_lang_keys.sql"
)

REQUIRED_ARTICLE_RUNTIME_KEYS = frozenset(
    """
    account logout system_config users admin_and_development_tools admin_tools
    permissions queen_chat table_tools create_table foreign_keys asset_linking
    card_visibility service_catalog_moderation child_tab_config
    dataset_alias_management dataset_header_config maintenance
    add_notification_trigger refresh_embeddings check_json_columns
    database_consistency empty_rows fix_media_subfolders
    check_and_fix_all_datasets check_all_media_subfolders fk_cache_triggers
    translation_helper text_index_maintenance user_tools create user register
    database other_tables ai_chat_conversations dokumentaatio_tiketit_relation
    palvelukatalogi_dokumentaatio_relation palvelukatalogi_riskienhallinta_relation
    palvelukatalogi_tiketit_relation payments
    riskienhallinta_dokumentaatio_relation riskienhallinta_tiketit_relation
    spatial_ref_sys system_about system_audit_log system_child_tab_config
    system_column_control system_column_details system_db_tables system_db_version
    system_foreign_key_relations_1_m system_foreign_key_relations_m_m
    system_functions system_group_table_func_rights system_lang_keys
    system_lang_keys_archive system_lang_key_sources system_schema_migrations
    system_table_folders system_table_row_view_counts system_table_views
    system_transaction_log system_user_column_settings
    system_user_group_memberships system_user_groups system_users views
    geography_columns geometry_columns palvelu_id open_in_new_tab palvelu_name
    dokumentaatio_id dokumentaatio_name kuva riski_id riski_name edit cancel
    delete search_for_riski_id search_for_maarapaiva search_for_id
    search_for_palvelu_id search_for_dokumentaatio_id search_for_kuva
    search_for_created search_for_updated chat_for_table chat_welcome_message
    delete_history open showing_first_50 name comments write_comment send
    """.split()
) | frozenset(
    {
        "riski_name (ln)",
        "search_for_riski_name (ln)",
        "palvelu_name (ln)",
        "search_for_palvelu_name (ln)",
        "dokumentaatio_name (ln)",
        "search_for_dokumentaatio_name (ln)",
    }
)

REQUIRED_APP_DATASET_FIELD_KEYS = frozenset(
    """
    id created updated palvelu kuvaus omistava_tiimi palvelutaso tila
    vastuuhenkilo cached_image vaikutus riskitaso riski todennakoisyys
    alentamistoimet palvelu_id otsikko kohdetiimi ohje paivitetty voimassaolo
    kuva vastuutiimi maarapaiva riski_id prioriteetti pyyntotyyppi
    dokumentaatio_id
    """.split()
)

REQUIRED_FIRST_RUN_KEYS = frozenset(
    """
    first_run_admin_title first_run_admin_description first_run_admin_submit
    confirm_password first_run_username_invalid first_run_email_invalid
    first_run_password_invalid first_run_password_mismatch
    first_run_admin_creation_failed form_sections previous next back proceed
    first_run_welcome first_run_site_name first_run_site_name_invalid
    first_run_section_settings first_run_section_credentials
    first_run_settings_title first_run_settings_description
    first_run_environment_legend environment_development
    environment_development_description environment_testing
    environment_testing_description environment_qa
    environment_qa_description environment_production
    environment_production_description first_run_verification_legend
    verification_none verification_none_description verification_fixed_pin
    verification_fixed_pin_description verification_authenticator
    verification_authenticator_description verification_email
    verification_email_description fixed_pin confirm_fixed_pin
    authenticator_setup_key authenticator_confirmation_code
    verification_fixed_pin_prompt verification_authenticator_prompt
    verification_email_prompt first_run_environment_invalid
    first_run_verification_invalid first_run_fixed_pin_invalid
    first_run_fixed_pin_mismatch first_run_totp_invalid
    first_run_postmark_required
    """.split()
)

REQUIRED_METADATA_SEED_KEYS = frozenset(
    """
    id created updated admin_access_allowed admin_approved admin_user_id
    amount_cents applied_at app_name archived_at auth_name auth_srid
    bio_social_medias boolean_value bridging_col_a bridging_col_b
    bridging_table_name bridging_table_uid cached_name_col_in_src cached_oid
    card_detail_capitalization card_detail_icon_key card_detail_icon_svg
    card_detail_label_mode card_details_layout card_element card_style_variant
    ch column_label column_name column_uid column_width_px co_number created_at
    creation_spec currency customer_email dataset data_type default_view_id
    details disabled display_name duration_ms editable_in_ui en enabled
    error_message external_order_id fco_number fi filename
    filterbar_visible_by_default fk_display_column folder_description folder_id
    folder_name full_name function_id group_id handler_name hidden
    hide_everywhere hide_false_null_on_big_crd hide_false_null_on_sml_crd
    hide_in_filter_panel hide_on_bg_crd_if_not_own hide_on_small_card
    http_method icon_key insertable insert_expln_langkey
    insert_new_source_with_target insert_new_target_with_source instance_id
    int_value ip_address is_about_table is_current_project is_default is_hidden
    is_main_table is_multilingual is_removable json_value key lang_key
    lang_key_id lang_key_type last_seen main_group_id mandatory messages
    metadata method multi_lang_embeddings must_be_true_unless_own
    name_col_in_tgt operation_type original_created original_id original_updated
    orphan_since package paid_at parent_id parent_table payment_token
    predecessor_id preview privileged proj4text rate_limit_amount
    rate_limit_minutes reference_direction revolut_checkout_url revolut_order_id
    row_id row_policy_owner_column schema_name sco_number search_placeholder
    search_slogan search_vector_simple show_key_on_card show_value_on_card
    sort_order source_column_name source_high source_insert_specs source_low
    source_table_uid source_type specific_table_related sql_dump_policy srid
    srtext status success tab_key table_a_column table_a_uid table_b_column
    table_b_uid table_name table_uid tab_order tab_order_json target_column_name
    target_insert_specs target_schema_name target_table_uid text_value tiketti_id
    title ui_only updated_at url_path url_route_endpoint usage_explanation
    user_group_id username value_type version viewed_by_user_id visible
    webhook_received_at yue
    """.split()
)

SQL_VALUE = r"'((?:''|[^'])*)'"
LANGUAGE_ROW = re.compile(
    rf"^\s*\({SQL_VALUE},\s*{SQL_VALUE},\s*{SQL_VALUE},\s*{SQL_VALUE},\s*"
    rf"{SQL_VALUE},\s*{SQL_VALUE}\)[,;]?\s*$",
    re.MULTILINE,
)


def _seed_rows() -> list[tuple[str, ...]]:
    source = LANGUAGE_SEED.read_text(encoding="utf-8")
    return [
        tuple(value.replace("''", "'") for value in match.groups())
        for match in LANGUAGE_ROW.finditer(source)
    ]


def test_public_article_runtime_keys_have_complete_four_language_seed_rows() -> None:
    rows = _seed_rows()
    rows_by_key = {row[0]: row for row in rows}

    assert len(REQUIRED_ARTICLE_RUNTIME_KEYS) == 104
    assert REQUIRED_ARTICLE_RUNTIME_KEYS <= rows_by_key.keys()
    for lang_key in REQUIRED_ARTICLE_RUNTIME_KEYS:
        _, fi, en, ch, yue, creation_spec = rows_by_key[lang_key]
        assert all(value.strip() for value in (fi, en, ch, yue))
        assert creation_spec == "public fixture seed"


def test_public_app_language_seed_does_not_duplicate_keys() -> None:
    lang_keys = [row[0] for row in _seed_rows()]

    assert len(lang_keys) == len(set(lang_keys))


def test_first_run_has_complete_four_language_seed_rows() -> None:
    rows_by_key = {row[0]: row for row in _seed_rows()}

    assert REQUIRED_FIRST_RUN_KEYS <= rows_by_key.keys()
    for lang_key in REQUIRED_FIRST_RUN_KEYS:
        assert all(value.strip() for value in rows_by_key[lang_key][1:5])


def test_four_public_app_datasets_have_complete_four_language_field_labels() -> None:
    rows_by_key = {row[0]: row for row in _seed_rows()}

    assert REQUIRED_APP_DATASET_FIELD_KEYS <= rows_by_key.keys()
    for lang_key in REQUIRED_APP_DATASET_FIELD_KEYS:
        assert all(value.strip() for value in rows_by_key[lang_key][1:5])


def test_public_dataset_titles_and_search_copy_are_curated_in_four_languages() -> None:
    rows_by_key = {row[0]: row for row in _seed_rows()}
    expected_titles = {
        "palvelukatalogi_front_page": ("Palvelut", "Services", "服务", "服務"),
        "riskienhallinta_front_page": ("Riskit", "Risks", "风险", "風險"),
        "dokumentaatio_front_page": (
            "Dokumentaatio",
            "Documentation",
            "文档",
            "文件",
        ),
        "tiketit_front_page": ("Tiketit", "Tickets", "工单", "工單"),
        "system_users_front_page": ("Käyttäjät", "Users", "用户", "用戶"),
    }

    for lang_key, expected in expected_titles.items():
        assert rows_by_key[lang_key][1:5] == expected

    for dataset in (
        "palvelukatalogi",
        "riskienhallinta",
        "dokumentaatio",
        "tiketit",
        "system_users",
    ):
        slogan = rows_by_key[f"search_slogan_{dataset}"][1:5]
        placeholder = rows_by_key[f"search_for_{dataset}"][1:5]
        assert all(value.strip() for value in slogan)
        assert all(value.strip() for value in placeholder)
        assert not any("front page" in value.lower() or "etusivu" in value.lower() for value in slogan)


def test_public_asset_dataset_copy_is_curated_in_four_languages() -> None:
    rows_by_key = {row[0]: row for row in _seed_rows()}
    expected_copy = {
        "palvelukatalogi_assets": (
            ("Palvelukuvat", "Service images", "服务图片", "服務圖片"),
            (
                "Hallinnoi palveluihin liitettyjä kuvia ja niiden kuvauksia.",
                "Manage images linked to services and their descriptions.",
                "管理与服务关联的图片及其说明。",
                "管理同服務相關嘅圖片同說明。",
            ),
            (
                "Hae palvelukuvia tiedostonimellä tai kuvauksella",
                "Search service images by filename or description",
                "按文件名或说明搜索服务图片",
                "按檔案名稱或者說明搜尋服務圖片",
            ),
        ),
        "riskienhallinta_assets": (
            ("Riskikuvat", "Risk images", "风险图片", "風險圖片"),
            (
                "Hallinnoi riskejä, vaikutuksia ja hallintatoimia havainnollistavia kuvia.",
                "Manage images that illustrate risks, impacts, and mitigating actions.",
                "管理用于说明风险、影响和应对措施的图片。",
                "管理用嚟說明風險、影響同應對措施嘅圖片。",
            ),
            (
                "Hae riskikuvia tiedostonimellä tai kuvauksella",
                "Search risk images by filename or description",
                "按文件名或说明搜索风险图片",
                "按檔案名稱或者說明搜尋風險圖片",
            ),
        ),
        "dokumentaatio_assets": (
            ("Dokumentaation kuvat", "Documentation images", "文档图片", "文件圖片"),
            (
                "Hallinnoi ohjeissa ja dokumentaatiossa käytettäviä kuvia sekä niiden kuvauksia.",
                "Manage images used in guidance and documentation, together with their descriptions.",
                "管理指南和文档中使用的图片及其说明。",
                "管理指南同文件使用嘅圖片同說明。",
            ),
            (
                "Hae dokumentaation kuvia tiedostonimellä tai kuvauksella",
                "Search documentation images by filename or description",
                "按文件名或说明搜索文档图片",
                "按檔案名稱或者說明搜尋文件圖片",
            ),
        ),
        "tiketit_assets": (
            ("Tikettien kuvat", "Ticket images", "工单图片", "工單圖片"),
            (
                "Hallinnoi tiketteihin liitettyjä kuvakaappauksia, kuvia ja kuvauksia.",
                "Manage screenshots, images, and descriptions linked to tickets.",
                "管理与工单关联的截图、图片和说明。",
                "管理同工單相關嘅螢幕截圖、圖片同說明。",
            ),
            (
                "Hae tikettien kuvia tiedostonimellä tai kuvauksella",
                "Search ticket images by filename or description",
                "按文件名或说明搜索工单图片",
                "按檔案名稱或者說明搜尋工單圖片",
            ),
        ),
    }

    for table_name, (title, slogan, placeholder) in expected_copy.items():
        assert rows_by_key[table_name][1:5] == title
        assert rows_by_key[f"{table_name}_front_page"][1:5] == title
        assert rows_by_key[f"search_slogan_{table_name}"][1:5] == slogan
        assert rows_by_key[f"search_for_{table_name}"][1:5] == placeholder

        rendered_copy = (*title, *slogan, *placeholder)
        assert not any(
            forbidden in value.lower()
            for value in rendered_copy
            for forbidden in ("front page", "etusivu", "search slogan")
        )


def test_public_runtime_metadata_has_complete_four_language_seed_rows() -> None:
    metadata_rows = {
        row[0]: row
        for row in _seed_rows()
        if row[5] == "public fixture metadata seed"
        and row[0] not in {"email", "password"}
    }

    assert len(REQUIRED_METADATA_SEED_KEYS) == 168
    assert REQUIRED_METADATA_SEED_KEYS == metadata_rows.keys()
    for row in metadata_rows.values():
        assert all(value.strip() for value in row[1:5])


def test_public_seed_derives_missing_filter_and_dataset_page_labels() -> None:
    source = LANGUAGE_SEED.read_text(encoding="utf-8")

    assert "'search_for_' || base.lang_key" in source
    assert "COALESCE(NULLIF(details.lang_key, ''), details.column_name)" in source
    assert "'search_for_' || tables.table_name" in source
    assert "tables.table_name || '_front_page'" in source
    assert source.count("WHERE NOT EXISTS (") >= 2


def test_filterest_metadata_language_migration_matches_public_seed() -> None:
    source = LANGUAGE_MIGRATION.read_text(encoding="utf-8")
    rows = [
        tuple(value.replace("''", "'") for value in match.groups())
        for match in LANGUAGE_ROW.finditer(source)
    ]
    rows_by_key = {row[0]: row for row in rows}

    assert REQUIRED_METADATA_SEED_KEYS == rows_by_key.keys()
    assert "MERGE INTO public.system_lang_keys" in source
    assert "ON CONFLICT" not in source
    assert "v_instance_kind NOT IN ('filterest_sibling', 'filterest_domain')" in source
    assert "'search_for_' || base.lang_key" in source
    assert "tables.table_name || '_front_page'" in source
