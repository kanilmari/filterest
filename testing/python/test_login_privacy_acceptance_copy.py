"""Fresh-install contract for the login privacy acceptance sentence and link."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
LOGIN_TEMPLATE = REPO_ROOT / "frontend" / "templates" / "login.html"
PUBLIC_LANG_SEED = (
    REPO_ROOT
    / "server_tools"
    / "public_slice_export"
    / "public_bootstrap"
    / "app_tables.lang_keys.sql"
)
FULL_SENTENCE_MIGRATION = (
    REPO_ROOT
    / "server_tools"
    / "migrations"
    / "20260817000003_simplify_login_privacy_acceptance.sql"
)
LINK_SCOPE_MIGRATION = (
    REPO_ROOT
    / "server_tools"
    / "migrations"
    / "20260818000002_split_login_privacy_acceptance_link.sql"
)


def test_login_links_only_the_privacy_notice_name():
    template = LOGIN_TEMPLATE.read_text(encoding="utf-8")
    privacy_block = template.split('<div class="privacy-notice-link">', 1)[1].split(
        "</div>", 1
    )[0]

    assert privacy_block.count("<a ") == 1
    assert privacy_block.count("</a>") == 1
    assert (
        '<a href="#" id="privacy-notice-link" '
        'data-lang-key="privacy_notice_login_acceptance_link">privacy notice</a>'
    ) in privacy_block
    assert '<span data-lang-key="privacy_notice_login_acceptance_prefix">' in privacy_block
    assert '<span data-lang-key="privacy_notice_login_acceptance_suffix">' in privacy_block


def test_standalone_login_has_main_landmark_and_visible_link_affordances():
    template = LOGIN_TEMPLATE.read_text(encoding="utf-8")
    auth_css = (
        REPO_ROOT / "frontend" / "core_components" / "auth" / "auth.css"
    ).read_text(encoding="utf-8")

    assert '<main class="auth-page-shell" data-testid="login-page-shell">' in template
    assert "</main>\n    {{end}}" in template
    assert ".privacy-notice-link a {" in auth_css
    assert ".auth-secondary-actions a {" in auth_css
    assert auth_css.count("text-decoration: underline;") >= 3
    assert "color: var(--auth-link-color" in auth_css


def test_canonical_and_public_seed_ship_all_link_scope_keys():
    migration = LINK_SCOPE_MIGRATION.read_text(encoding="utf-8")
    public_seed = PUBLIC_LANG_SEED.read_text(encoding="utf-8")

    for lang_key in (
        "privacy_notice_login_acceptance_prefix",
        "privacy_notice_login_acceptance_link",
        "privacy_notice_login_acceptance_suffix",
    ):
        assert lang_key in migration
        assert lang_key in public_seed

    assert "INSERT INTO public.system_lang_key_translations" in migration
    for language_code in ("en", "fi", "zh-CN", "zh-TW", "zh-HK"):
        assert f"'{language_code}'" in migration


def test_original_9_0_0_migration_is_preserved_as_immutable_history():
    migration = FULL_SENTENCE_MIGRATION.read_text(encoding="utf-8")

    assert "privacy_notice_login_acceptance" in migration
    assert "To sign in, you must accept the privacy notice." in migration


def test_public_fallback_titles_do_not_expose_front_page_wording():
    public_seed = PUBLIC_LANG_SEED.read_text(encoding="utf-8")
    derived_titles = public_seed.split(
        "SELECT tables.table_name || '_front_page' AS lang_key", 1
    )[1]

    assert "base.en || ' front page'" not in derived_titles
    assert "base.fi || ' – etusivu'" not in derived_titles
