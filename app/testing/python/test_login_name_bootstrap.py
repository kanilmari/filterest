"""WL132 bootstrap/source acceptance and read-only dry-run regression proofs."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

import pytest
from test_login_name_postgres import cluster, installed, upgrade, before_k1, K1, K3, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / 'server_tools/public_bootstrap'
DRY_RUN = APP / 'server_tools/scripts/login_name_dry_run.sql'


def test_k1_atomic_statement_and_bootstrap_class_marker_final_check():
    migration = K1.read_text()
    assert re.findall(r'^DO \$(\w+)\$', migration, re.M) == ['login_names']
    assert migration.rstrip().endswith('END $login_names$;')
    assert not re.search(r'^\s*(BEGIN|COMMIT)\s*;', migration, re.M)
    assert '-- COMPLETION_MARKER: k116_login_names' in migration
    assert '-- FINAL_CHECK: public.app_check_login_name_protections()' in migration
    assert '-- VERSION_DB: 9.10.0' in migration and '-- VERSION_DB_OWNER:' in migration
    schema = (BOOTSTRAP / 'schema.sql').read_bytes()
    seed = (BOOTSTRAP / 'seed_data.sql').read_text()
    assert K1.read_bytes() in schema and K3.read_text() in seed
    assert schema == (APP / 'server_tools/versioning/schema_snapshots/db-9.10.0.sql').read_bytes()
    acceptance = seed[seed.index('DO $filterest_acceptance$'):]
    assert "'k116_login_names'" in acceptance
    assert "SELECT 'public.app_check_login_name_protections(): ' || result FROM public.app_check_login_name_protections() AS result" in acceptance
    assert 'login_name text NOT NULL' in (BOOTSTRAP / 'source/base.schema.sql').read_text()
    assert "'display_name_may_equal_login_name', true" in (BOOTSTRAP / 'source/base.seed.sql').read_text()
    manifest = json.loads((BOOTSTRAP / 'manifest.json').read_text())
    for migration in (K1, K3):
        assert migration.name in manifest['migration_ledger_baseline']
    assert 'restricted.users_restricted' in manifest['allowed_schema_tables']
    assert 'restricted.users_restricted' not in manifest['allowed_seed_tables']


def test_generated_hashes_and_repeatable_database_free_generator(tmp_path):
    manifest = json.loads((BOOTSTRAP / 'manifest.json').read_text())
    for name, metadata in manifest['source_files'].items():
        assert hashlib.sha256((APP.parent / name.removeprefix('filterest/')).read_bytes()).hexdigest() == metadata['sha256'], name
    for name, metadata in manifest['generated_files'].items():
        assert hashlib.sha256((APP / name).read_bytes()).hexdigest() == metadata['sha256'], name
    subprocess.run([sys.executable, str(BOOTSTRAP / 'generate_bootstrap.py'), '--target', str(tmp_path)], check=True, capture_output=True)
    for filename in ('schema.sql','seed_data.sql','manifest.json'):
        assert (tmp_path / 'app/server_tools/public_bootstrap' / filename).read_bytes() == (BOOTSTRAP / filename).read_bytes()


def test_k3_finnish_and_english_messages_cover_slice_2():
    sql = K3.read_text()
    keys = set(re.findall(r"^\s*\('([^']+)',", sql, re.M))
    assert {'error_admin_display_name_equals_login_name','error_user_display_name_equals_login_name',
            'username_exists','error_identity_edit_requires_administrator','login_name','login_name_help',
            'login_name_exists','change_login_name','login_name_changed','login_name_change_rate_limited',
            'login_name_change_notice_subject','notice_email_sent','notice_email_failed',
            'password_reset_send_attempted','sign_out_other_devices','other_devices_signed_out',
            'display_name_may_equal_login_name','display_name_may_equal_login_name_help'} <= keys
    assert 'Kirjaudu ulos muilta laitteilta' in sql and 'Sign out other devices' in sql
    assert "(VALUES ('fi', served.fi), ('en', served.en))" in sql
    assert not re.search(r"\b(zh|zh_hant|zh_hans)\b", sql)


def test_dry_run_is_select_only_and_does_not_project_names():
    sql = DRY_RUN.read_text()
    # Strip quoted literals/comments: UPDATE/INSERT in the trigger-body regexp are data.
    stripped = re.sub(r"'([^']|'')*'|--[^\n]*", ' ', sql)
    assert not re.search(r'\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|DO|CALL|COPY|TRUNCATE)\b', stripped, re.I)
    assert not re.search(r'\b(set_config|nextval|pg_advisory_lock)\s*\(', stripped, re.I)
    assert re.search(r'SELECT item, detail FROM report ORDER BY item;\s*$', sql)
    assert 'ordinary_equal_name_count' in sql


def shape(run):
    return value(run, """SELECT jsonb_build_object(
        'column',(SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull))
            FROM pg_attribute WHERE attrelid='restricted.users_restricted'::regclass AND attname='login_name' AND NOT attisdropped),
        'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index
            WHERE indexrelid IN ('restricted.uq_users_restricted_login_name_lower'::regclass,'uq_system_users_username_lower'::regclass)),
        'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgname LIKE 'app_%names_differ'
            OR tgname='app_account_name_setting_description'),
        'functions',(SELECT jsonb_agg(jsonb_build_array(proname,prosrc,prosecdef,proconfig,proacl::text) ORDER BY proname)
            FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('app_is_administrator_account',
                'app_next_admin_display_name','app_enforce_administrator_names_differ','app_describe_account_name_setting','app_check_login_name_protections')),
        'setting',(SELECT jsonb_build_array(boolean_value,json_value,text_value,value_type,creation_spec) FROM system_config WHERE key='display_name_may_equal_login_name'),
        'marker',(SELECT count(*) FROM system_data_repair_records WHERE migration='k116_login_names' AND action='completed'))""")


def test_fresh_bootstrap_and_historical_upgrade_match_and_k3_preserves_reviewed_copy(installed, upgrade):
    for migration in sorted((APP / 'server_tools/migrations').glob('202610050000*.sql')):
        upgrade(migration.read_text())
    assert shape(installed) == shape(upgrade)
    for run in (installed, upgrade):
        assert value(run, 'SELECT * FROM app_check_login_name_protections()') == ''
        assert value(run, "SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='sign_out_other_devices' AND language_code IN ('fi','en')") == '2'
        assert value(run, "SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='sign_out_other_devices' AND language_code NOT IN ('fi','en')") == '0'
        run("UPDATE system_lang_keys SET fi='Sivuston teksti' WHERE lang_key='sign_out_other_devices'; UPDATE system_lang_key_translations SET translation='Site wording' WHERE language_code='en' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='sign_out_other_devices'); UPDATE system_config SET boolean_value=false WHERE key='display_name_may_equal_login_name'")
        run(K1.read_text())
        run(K3.read_text())
        assert value(run, "SELECT boolean_value FROM system_config WHERE key='display_name_may_equal_login_name'") == 'f'
        assert value(run, "SELECT fi FROM system_lang_keys WHERE lang_key='sign_out_other_devices'") == 'Sivuston teksti'
        assert value(run, "SELECT translation FROM system_lang_key_translations WHERE language_code='en' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='sign_out_other_devices')") == 'Site wording'


@pytest.mark.parametrize('after_upgrade', [False,True])
def test_dry_run_executes_in_read_only_transaction_and_keeps_names_private(before_k1, after_upgrade):
    run = before_k1
    run("""INSERT INTO system_users(id,username,admin_access_allowed) VALUES (40,'ordinary_private_canary',false),(42,'admin_private_canary',true),(43,'test_user',false);
        INSERT INTO restricted.users_restricted(id,password,email) VALUES (40,'hash_canary','40@example.invalid'),(42,'hash_canary','42@example.invalid');""")
    if after_upgrade:
        run(K1.read_text())
    result = run('BEGIN READ ONLY; '+DRY_RUN.read_text()+' COMMIT;')
    assert result.returncode == 0
    assert 'ordinary_equal_name_count|1' in result.stdout
    assert 'test_name_orphan_ids|[43]' in result.stdout
    for name in ('ordinary_private_canary','admin_private_canary','hash_canary','example.invalid'):
        assert name not in result.stdout


def test_bootstrap_acceptance_rejects_missing_marker_and_damaged_protection(cluster):
    cluster('CREATE DATABASE login_bad_bootstrap')
    cluster((BOOTSTRAP / 'schema.sql').read_text(), 'login_bad_bootstrap')
    cluster('ALTER TABLE system_users DISABLE TRIGGER app_users_names_differ', 'login_bad_bootstrap')
    result = cluster((BOOTSTRAP / 'seed_data.sql').read_text(), 'login_bad_bootstrap', check=False)
    assert result.returncode and 'app_users_names_differ' in result.stderr
    assert cluster('SELECT count(*) FROM system_db_version', 'login_bad_bootstrap').stdout.strip() == '0'
    assert cluster('SELECT count(*) FROM system_schema_migrations', 'login_bad_bootstrap').stdout.strip() == '0'
    cluster('ALTER TABLE system_users ENABLE TRIGGER app_users_names_differ; DELETE FROM system_data_repair_records WHERE migration=\'k116_login_names\'', 'login_bad_bootstrap')
    # The earlier failed seed may have inserted rows before its atomic acceptance.
    acceptance = (BOOTSTRAP / 'seed_data.sql').read_text().split('DO $filterest_acceptance$', 1)[1]
    result = cluster('DO $filterest_acceptance$'+acceptance, 'login_bad_bootstrap', check=False)
    assert result.returncode and 'missing completion markers: k116_login_names' in result.stderr
