"""Verify field-selector copy on fresh bootstrap and incremental PostgreSQL upgrades.

Connects the canonical public language source to the matching versioned migration.
Protects existing reviewed site copy, locale status, and repeatable non-numeric keys.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

import pytest

APP = Path(__file__).resolve().parents[2]
SEED = APP / "server_tools/public_bootstrap/source/field_settings.lang_keys.sql"
MIGRATION = APP / "server_tools/migrations/20260908000001_seed_field_settings_language_keys.sql"
HANDLER = APP / "frontend/core_components/lang/translation_handler.js"
KEYS = (
    "field_set_owner_personal", "field_set_source_personal", "field_set_source_group",
    "field_set_source_site", "field_set_source_metadata", "field_set_editing_site_default",
    "field_set_assignment_unavailable", "use_site_default", "use_metadata_default",
    "field_set_inheritance_restored",
)
SCHEMA = """
CREATE TABLE system_lang_keys (
    id BIGSERIAL PRIMARY KEY, lang_key TEXT UNIQUE NOT NULL,
    fi TEXT, en TEXT, ch TEXT, yue TEXT, creation_spec TEXT, updated TIMESTAMPTZ
);
ALTER SEQUENCE system_lang_keys_id_seq RESTART WITH 317;
CREATE TABLE system_lang_key_translations (
    lang_key_id BIGINT REFERENCES system_lang_keys(id), language_code TEXT,
    translation TEXT, source_kind TEXT, review_status TEXT, updated TIMESTAMPTZ,
    UNIQUE(lang_key_id, language_code)
);
CREATE TABLE system_lang_key_sources (
    lang_key_id BIGINT REFERENCES system_lang_keys(id), source_type TEXT,
    source_high TEXT, source_low TEXT, usage_explanation TEXT, last_seen DATE,
    UNIQUE(lang_key_id, source_type, source_high)
);
CREATE TABLE system_db_version (version TEXT, description TEXT);
"""
def _seed_rows():
    pattern = r"\(\s*" + r"\s*,\s*".join([r"'((?:''|[^'])*)'"] * 6) + r"\s*\)"
    return {
        row[0]: tuple(value.replace("''", "'") for value in row[1:])
        for row in re.findall(pattern, SEED.read_text())
    }


def test_reviewed_seed_covers_exact_field_selection_copy_and_matches_fallbacks():
    rows = _seed_rows()
    assert set(rows) == set(KEYS)
    handler = HANDLER.read_text()
    for key in KEYS:
        block = re.search(r"\b" + key + r": \{(.*?)\n    \},", handler, re.S)[1]
        fallbacks = tuple(
            json.loads(re.search(r"\b" + language + r': ("(?:[^"\\]|\\.)*")', block)[1])
            for language in ("fi", "en", "ch", "yue")
        )
        assert rows[key][:4] == fallbacks
        assert rows[key][4].strip()
    assert SEED.read_text() in MIGRATION.read_text()


@pytest.fixture
def database():
    """Run SQL against a disposable Unix-socket-only cluster, never the live DB."""
    if os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1":
        pytest.skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
    pg_bin = Path(os.environ.get("PG_TEST_BIN", "/usr/lib/postgresql/16/bin"))
    if not (pg_bin / "initdb").exists():
        pytest.skip("PostgreSQL test binaries unavailable")
    with tempfile.TemporaryDirectory(prefix="field-lang-test-") as directory:
        base = Path(directory)
        data = base / "pgdata"
        socket = base / "socket"
        socket.mkdir(mode=0o700)
        subprocess.run([str(pg_bin / "initdb"), "-D", str(data), "-A", "trust", "-U", "test_owner",
                        "--no-locale", "--encoding=UTF8"], check=True, capture_output=True)
        subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(data), "-l", str(base / "postgres.log"),
                        "-o", f"-h '' -k '{socket}' -p 15458", "-w", "start"],
                       check=True, capture_output=True)
        try:
            def execute(sql):
                return subprocess.run(
                    [str(pg_bin / "psql"), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                     "-h", str(socket), "-p", "15458", "-U", "test_owner", "-d", "postgres"],
                    input=sql, text=True, check=True, capture_output=True,
                ).stdout.strip()
            execute(SCHEMA)
            yield execute
        finally:
            subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"],
                           check=True, capture_output=True)


def _assert_complete(database):
    assert database("SELECT count(*) FROM system_lang_keys") == "10"
    assert database("SELECT count(*) FROM system_lang_key_translations") == "20"
    assert database("SELECT count(*) FROM system_lang_key_sources") == "10"
    assert database("SELECT count(*) FROM system_lang_key_translations "
                    "WHERE language_code NOT IN ('fi','en') OR review_status <> 'approved'") == "0"
    assert database("SELECT count(*) FROM system_lang_keys "
                    "WHERE NULLIF(btrim(fi),'') IS NULL OR NULLIF(btrim(en),'') IS NULL") == "0"
    assert database("SELECT min(id) >= 317 FROM system_lang_keys") == "t"


def test_fresh_bootstrap_has_all_reviewed_keys_before_first_view(database):
    database(SEED.read_text())
    _assert_complete(database)
    database(SEED.read_text())
    _assert_complete(database)
    assert database("SELECT count(*) FROM system_db_version") == "0"


def test_upgrade_fills_missing_copy_preserves_site_values_and_is_repeatable(database):
    database("""
        INSERT INTO system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
        VALUES ('use_site_default', '  Sivuston oma teksti  ', '', NULL, '', '  site-owned wording  ');
        INSERT INTO system_lang_key_translations
            (lang_key_id, language_code, translation, source_kind, review_status)
        SELECT id, 'fi', 'Sivuston tarkistettu käännös', 'manual', 'approved'
        FROM system_lang_keys WHERE lang_key = 'use_site_default';
    """)
    database(MIGRATION.read_text())
    _assert_complete(database)
    database(MIGRATION.read_text())
    _assert_complete(database)
    assert database("SELECT '[' || fi || '|' || en || '|' || creation_spec || ']' FROM system_lang_keys "
                    "WHERE lang_key='use_site_default'") == (
        "[  Sivuston oma teksti  |Use site default|  site-owned wording  ]"
    )
    assert database("SELECT translation FROM system_lang_key_translations "
                    "WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys "
                    "WHERE lang_key='use_site_default')") == "Sivuston tarkistettu käännös"
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.7.4'") == "1"
