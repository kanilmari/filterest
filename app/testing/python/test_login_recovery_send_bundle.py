"""Fresh-install contract: production login bundle must not hardcode Finnish recovery send copy."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_SOURCE_ROOT = (
    REPO_ROOT / "filterest"
    if (REPO_ROOT / "filterest/go.mod").is_file()
    else REPO_ROOT
)
LOGIN_DIST = PUBLIC_SOURCE_ROOT / "frontend" / "dist"


def _newest_login_bundle() -> Path:
    bundles = sorted(
        LOGIN_DIST.glob("login.*.min.js"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    assert bundles, f"no login.*.min.js bundle under {LOGIN_DIST}"
    return bundles[0]


def test_production_login_bundle_does_not_hardcode_finnish_send_code():
    bundle = _newest_login_bundle().read_text(encoding="utf-8")
    assert "send_code" in bundle
    assert "Send code" in bundle
    assert "Lähetä koodi" not in bundle
