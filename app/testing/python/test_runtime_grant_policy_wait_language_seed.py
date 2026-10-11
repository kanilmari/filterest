"""test_runtime_grant_policy_wait_language_seed.py
Check permission-policy wait copy for fresh installs and upgrades offline.
Connect the API fallback, canonical locale registry and generated bootstrap.
Keep missing translations or stale migration evidence out of a release.
"""
from pathlib import Path
import re

from bootstrap_contract_assertions import assert_bootstrap_baseline


APP_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = APP_ROOT / "server_tools/migrations/20261009000081_seed_runtime_grant_policy_wait_language_key.sql"
BOOTSTRAP = APP_ROOT / "server_tools/public_bootstrap"


def test_policy_wait_refusal_has_copy_for_every_bundled_locale():
    migration = MIGRATION.read_text()
    authored = migration.split("AS (VALUES", 1)[1].split("), written AS", 1)[0]
    values = re.findall(r"'((?:[^']|'')*)'", authored)
    assert len(values) == 7
    assert values[0] == "error_runtime_grant_policy_busy"
    assert all(value.strip() for value in values)
    assert values[1] != values[2]  # Finnish is authored rather than English fallback.
    assert values[3] != values[4]  # Simplified Chinese and Cantonese have their own copy.
    assert values[5] != values[4]  # Taiwan Chinese is not relabelled Cantonese.
    response_source = (APP_ROOT / "backend/core_components/runtime_grant_mutations/mutation.go").read_text()
    assert values[0] in response_source and values[2] in response_source

    fallback_source = (APP_ROOT / "frontend/core_components/error_and_status_handling/error_monitor_handler_helpers.js").read_text()
    fallback_block = re.search(r"error_runtime_grant_policy_busy:\s*\{([^}]+)\}", fallback_source).group(1)
    fallback = {language.strip('"'): text for language, text in re.findall(r'([\w"-]+):\s*"([^"]+)"', fallback_block)}
    assert fallback == {
        "fi": values[1], "en": values[2], "ch": values[3], "yue": values[4],
        "zh-cn": values[3], "zh-tw": values[5], "zh-hk": values[6],
    }

    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    registry = seed.split("INSERT INTO public.system_languages (", 1)[1].split("ON CONFLICT", 1)[0]
    canonical_locales = set(re.findall(r"\('([A-Za-z-]+)',", registry))
    normalized_values = migration.split("CROSS JOIN LATERAL (VALUES", 1)[1].split(") c(language_code", 1)[0]
    seeded_locales = set(re.findall(r"\('([A-Za-z-]+)',", normalized_values))
    assert canonical_locales == {"en", "fi", "zh-CN", "zh-TW", "zh-HK"}
    assert canonical_locales <= seeded_locales
    assert {"ch", "yue"} <= seeded_locales


def test_policy_wait_refusal_bootstrap_contains_the_upgrade_and_its_evidence():
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert MIGRATION.name in (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert MIGRATION.read_text() in seed
    assert_bootstrap_baseline(seed, MIGRATION)
