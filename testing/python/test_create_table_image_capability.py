"""Guard the default image capability in the table-creation workflow."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TABLE_CREATOR = (
    REPO_ROOT
    / "frontend/core_components/general_tables/gt_3_table_crud"
    / "gt_3_1_table_create/table_creator.js"
)
MIGRATION = (
    REPO_ROOT
    / "server_tools/migrations"
    / "20260817000005_seed_create_table_image_capability_lang_keys.sql"
)


def test_create_table_offers_images_enabled_by_default() -> None:
    source = TABLE_CREATOR.read_text(encoding="utf-8")

    assert "enableImagesCheckbox.id = 'enable_images'" in source
    assert "enableImagesCheckbox.checked = true" in source
    assert "enableImagesCheckbox.defaultChecked = true" in source
    assert "create-table-enable-images" in source


def test_successful_table_creation_enables_the_existing_image_capability() -> None:
    source = TABLE_CREATOR.read_text(encoding="utf-8")

    create_call = source.index("await endpoint_router('createDataset'")
    image_call = source.index("await endpoint_router('enableImageAssetLinking'")
    assert image_call > create_call
    assert "if (result.enableImages)" in source
    assert "table_created_image_setup_failed" in source


def test_copy_is_seeded_into_legacy_and_normalized_language_models() -> None:
    migration = MIGRATION.read_text(encoding="utf-8")

    assert "create_table_enable_images" in migration
    assert "table_created_image_setup_failed" in migration
    assert "INSERT INTO public.system_lang_key_translations" in migration
    assert "('zh-CN'::TEXT, keys.ch, 'needs_review'::TEXT)" in migration
    assert "'manual'" in migration
