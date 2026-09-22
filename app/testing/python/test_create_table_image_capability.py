"""Guard the seeded copy of the table-creation image capability.

The form's behaviour (pictures on by default for a new dataset, and switched on
only after the dataset exists) is covered by the dataset form's unit tests:
dataset_image_attachments.test.js and dataset_create_source.test.js.
"""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    REPO_ROOT
    / "server_tools/migrations"
    / "20260817000005_seed_create_table_image_capability_lang_keys.sql"
)


def test_copy_is_seeded_into_legacy_and_normalized_language_models() -> None:
    migration = MIGRATION.read_text(encoding="utf-8")

    assert "create_table_enable_images" in migration
    assert "table_created_image_setup_failed" in migration
    assert "INSERT INTO public.system_lang_key_translations" in migration
    assert "('zh-CN'::TEXT, keys.ch, 'needs_review'::TEXT)" in migration
    assert "'manual'" in migration
