"""WL132 LT3/LT4/K205 on isolated PostgreSQL, never an installation database.

The historical package tests unchanged credential backfill and atomic stops.
Enable only with FILTEREST_TEST_DISPOSABLE_POSTGRES=1; source proofs live beside
these in test_login_name_bootstrap.py, concurrency in test_login_name_overlap.py.
"""
import json
import subprocess

import pytest
from test_row_actor_support import cluster as _cluster, installed, upgrade, value, refused  # noqa: F401
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / 'server_tools/migrations'
K1 = MIGRATIONS / '20261005000011_separate_login_names.sql'
K3 = MIGRATIONS / '20261005000013_seed_login_name_keys.sql'
CHECK = 'SELECT * FROM public.app_check_login_name_protections()'


@pytest.fixture
def cluster():
    generator = _cluster.__wrapped__()
    try:
        try:
            runner = next(generator)
        except (pytest.fail.Exception, subprocess.CalledProcessError) as error:
            if any(message in str(error) + str(getattr(error, 'stderr', ''))
                   for message in ('Operation not permitted', 'Permission denied')):
                pytest.skip('sandbox cannot start disposable PostgreSQL Unix socket')
            raise
        yield runner
    finally:
        generator.close()


@pytest.fixture
def before_k1(upgrade):
    for migration in sorted(MIGRATIONS.glob('202610050000*.sql')):
        if migration.name < K1.name:
            upgrade(migration.read_text())
    return upgrade


def add_accounts(run, upgraded=True):
    run("""INSERT INTO system_users (id,username,full_name,admin_access_allowed,enabled,search_vector_simple) VALUES
        (40,'ordinary_canary','ordinary_canary',false,true,to_tsvector('simple','ordinary_canary')),
        (42,'admin_canary','ADMIN_CANARY',true,true,to_tsvector('simple','admin_canary')),
        (43,'flag_canary','Unchanged full name',true,true,NULL),
        (44,'auto_canary','auto_canary',false,true,NULL),
        (45,'group_canary','group_canary',false,true,NULL),
        (46,'Admin_1','Admin_1',false,true,NULL);
        INSERT INTO system_user_group_memberships(user_id,group_id) VALUES (42,1),(44,1),(45,1);""")
    column = ',login_name' if upgraded else ''
    expression = ',username' if upgraded else ''
    run(f"""INSERT INTO restricted.users_restricted(id,password,email,login_verification_method,api_only{column})
        SELECT id,'hash',id || '@example.invalid','none',id=44{expression} FROM system_users
        WHERE id IN (40,42,43,44,45,46);""")


def snapshot(run):
    return value(run, """SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM system_users u),
        'credentials',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM restricted.users_restricted c),
        'records',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM system_data_repair_records r),
        'version',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM system_db_version v),
        'column',(SELECT count(*) FROM pg_attribute WHERE attrelid='restricted.users_restricted'::regclass
            AND attname='login_name' AND NOT attisdropped),
        'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid) FROM pg_index
            WHERE indrelid IN ('system_users'::regclass,'restricted.users_restricted'::regclass)),
        'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_trigger
            WHERE NOT tgisinternal))""")


def test_backfill_keeps_every_credential_name_numbering_generation_and_rerun(before_k1):
    run = before_k1
    add_accounts(run, upgraded=False)
    former = json.loads(value(run, "SELECT jsonb_object_agg(id,username) FROM system_users WHERE id IN (40,42,43,44,45,46)"))
    run(K1.read_text())
    assert json.loads(value(run, "SELECT jsonb_object_agg(id,login_name) FROM restricted.users_restricted")) == former
    assert value(run, "SELECT string_agg(username,',' ORDER BY id) FROM system_users WHERE id IN (42,43,44,45)") == 'admin_2,admin_3,auto_1,admin_4'
    assert value(run, "SELECT full_name FROM system_users WHERE id=42") == 'admin_2'
    assert value(run, "SELECT full_name FROM system_users WHERE id=43") == 'Unchanged full name'
    assert value(run, "SELECT count(*) FROM system_users WHERE id IN (42,43,44,45) AND search_vector_simple IS NULL") == '4'
    assert value(run, "SELECT count(*) FROM restricted.users_restricted WHERE id IN (42,43,44,45) AND authentication_generation=2") == '4'
    assert value(run, "SELECT authentication_generation FROM restricted.users_restricted WHERE id=40") == '1'
    assert value(run, CHECK) == ''
    records = value(run, "SELECT jsonb_agg(to_jsonb(r)) FROM system_data_repair_records r WHERE migration='k116_login_names'")
    for name in former.values():
        assert name not in records
    original = snapshot(run)
    run(K1.read_text())
    assert snapshot(run) == original


STOPS = [
    ("UPDATE system_users SET username='ADMIN_CANARY' WHERE id=40", 'duplicate', ['40','42']),
    ("INSERT INTO system_users(id,username) VALUES (90,'PUBLIC_ONLY'),(91,'public_only')", 'duplicate', ['90','91']),
    ("UPDATE system_users SET username=NULL WHERE id=42", 'invalid name', ['42']),
    ("UPDATE system_users SET username='' WHERE id=42", 'invalid name', ['42']),
    ("UPDATE system_users SET username=' admin_canary' WHERE id=42", 'invalid name', ['42']),
    ("UPDATE system_users SET username=E'admin_canary\\t' WHERE id=42", 'invalid name', ['42']),
    ("UPDATE system_user_groups SET name='wrong_group_canary' WHERE id=1", 'group ids', ['1']),
    ("UPDATE system_user_groups SET name='renamed' WHERE id=1; UPDATE system_user_groups SET name='admins' WHERE id=2", 'group ids', ['1','2']),
    ("ALTER TABLE restricted.users_restricted DROP CONSTRAINT user_data_fk; INSERT INTO restricted.users_restricted(id,password,email) VALUES (99,'h','99@example.invalid')", 'missing account', ['99']),
    ("ALTER TABLE restricted.users_restricted ADD COLUMN login_name integer", 'column type', []),
    ("CREATE INDEX uq_users_restricted_login_name_lower ON restricted.users_restricted(email)", 'lower-name index', []),
    ("CREATE UNIQUE INDEX uq_system_users_username_lower ON system_users(full_name) WHERE full_name IS NOT NULL", 'lower-name index', []),
]


@pytest.mark.parametrize('setup,reason,ids', STOPS)
def test_each_preupgrade_stop_rolls_everything_back_without_names(before_k1, setup, reason, ids):
    run = before_k1
    add_accounts(run, upgraded=False)
    run(setup)
    original = snapshot(run)
    result = run(K1.read_text(), check=False)
    assert result.returncode and reason in result.stderr, result.stderr
    for identifier in ids:
        assert identifier in result.stderr
    for secret in ('admin_canary', 'ordinary_canary', 'wrong_group_canary', 'PUBLIC_ONLY'):
        assert secret.lower() not in result.stderr.lower()
    assert snapshot(run) == original


def test_owner_membership_is_required_and_orphan_public_accounts_get_no_credentials(before_k1):
    run = before_k1
    run('CREATE ROLE login_outsider; GRANT USAGE ON SCHEMA public, restricted TO login_outsider; GRANT SELECT ON system_data_repair_records TO login_outsider')
    original = snapshot(run)
    refused(run, 'SET ROLE login_outsider; '+K1.read_text(), 'owner membership required for relation id')
    assert snapshot(run) == original
    run("INSERT INTO system_users(id,username) VALUES (90,'orphan_public')")
    run(K1.read_text())
    assert value(run, 'SELECT count(*) FROM restricted.users_restricted WHERE id=90') == '0'


def test_preexisting_duplicate_login_index_stop_is_atomic(before_k1):
    run = before_k1
    add_accounts(run, upgraded=False)
    run("ALTER TABLE restricted.users_restricted ADD COLUMN login_name text; UPDATE restricted.users_restricted SET login_name='duplicate_private_canary' WHERE id IN (40,42)")
    original = snapshot(run)
    error = refused(run, K1.read_text(), 'duplicate login names at account ids {40,42}')
    assert 'duplicate_private_canary' not in error
    assert snapshot(run) == original


@pytest.mark.parametrize('target', ['system_users','system_user_group_memberships','restricted.users_restricted','cache_target'])
def test_unknown_trigger_including_propagation_target_stops(before_k1, target):
    run = before_k1
    add_accounts(run, upgraded=False)
    if target == 'cache_target':
        run("""CREATE TABLE cache_target(id bigint, copied_name text);
            CREATE FUNCTION fn_sync_cached_username() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN UPDATE public.cache_target SET copied_name=NEW.username WHERE id=NEW.id; RETURN NEW; END $$;
            CREATE TRIGGER trg_sync_cached_username AFTER UPDATE OF username ON system_users
                FOR EACH ROW EXECUTE FUNCTION fn_sync_cached_username();""")
    run(f"""CREATE FUNCTION unknown_name_copy() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END $$;
        CREATE TRIGGER unknown_copy BEFORE UPDATE ON {target} FOR EACH ROW EXECUTE FUNCTION unknown_name_copy();""")
    original = snapshot(run)
    error = refused(run, K1.read_text(), 'unknown trigger unknown_copy')
    assert 'admin_canary' not in error
    assert snapshot(run) == original


def test_known_timestamp_cache_and_creator_triggers_stay_enabled_and_fire(before_k1):
    run = before_k1
    add_accounts(run, upgraded=False)
    run("""CREATE TABLE cache_target(id bigint PRIMARY KEY, created_by bigint REFERENCES system_users(id), cached_username text, updated timestamptz);
        INSERT INTO cache_target VALUES (42,42,'admin_canary','2000-01-01');
        CREATE FUNCTION set_users_updated_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated=now(); RETURN NEW; END $$;
        CREATE TRIGGER users_timestamp BEFORE UPDATE ON system_users FOR EACH ROW EXECUTE FUNCTION set_users_updated_timestamp();
        CREATE FUNCTION set_service_catalog_updated_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated=now(); RETURN NEW; END $$;
        CREATE TRIGGER catalog_timestamp BEFORE UPDATE ON cache_target FOR EACH ROW EXECUTE FUNCTION set_service_catalog_updated_timestamp();
        CREATE TRIGGER protect_cache_target_creator BEFORE UPDATE ON cache_target FOR EACH ROW EXECUTE FUNCTION protect_row_creator();
        CREATE FUNCTION fn_sync_cached_username() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE public.cache_target SET cached_username=NEW.username WHERE id=NEW.id; RETURN NEW; END $$;
        CREATE TRIGGER trg_sync_cached_username AFTER UPDATE OF username ON system_users
            FOR EACH ROW EXECUTE FUNCTION fn_sync_cached_username();""")
    run(K1.read_text())
    assert value(run, "SELECT cached_username FROM cache_target WHERE id=42") == 'admin_2'
    assert value(run, "SELECT updated > '2000-01-01' FROM cache_target WHERE id=42") == 't'
    assert value(run, "SELECT updated IS NOT NULL FROM system_users WHERE id=42") == 't'
    assert value(run, "SELECT count(*) FROM pg_trigger WHERE tgname IN ('users_timestamp','catalog_timestamp','protect_cache_target_creator','trg_sync_cached_username') AND tgenabled='O'") == '4'


def test_administrator_helper_public_access_and_next_name_confidential_boundary(installed):
    run = installed
    # Creators must provide different administrator names after K1.
    run("""INSERT INTO system_users(id,username,admin_access_allowed) VALUES (42,'admin_2',true),(43,'group_only',false),(44,'Admin_1',false);
        INSERT INTO system_user_group_memberships(user_id,group_id) VALUES (43,1);
        INSERT INTO restricted.users_restricted(id,password,email,login_name) VALUES (42,'h','42@example.invalid','admin_3');
        CREATE ROLE login_guest; CREATE ROLE login_basic; CREATE ROLE login_reader;
        GRANT USAGE ON SCHEMA public TO login_guest,login_basic,login_reader;
        GRANT SELECT ON system_users,system_user_group_memberships TO login_guest,login_basic,login_reader;""")
    for role in ('login_guest','login_basic','login_reader'):
        assert value(run, f'SET ROLE {role}; SELECT app_is_administrator_account(42) AND app_is_administrator_account(43) AND NOT app_is_administrator_account(44)') == 't'
        refused(run, f"SET ROLE {role}; SELECT app_next_admin_display_name('admin')", 'permission denied')
        refused(run, f'SET ROLE {role}; SELECT login_name FROM restricted.users_restricted', 'permission denied')
        refused(run, f'SET ROLE {role}; {CHECK}', 'permission denied')
    assert value(run, "SELECT app_next_admin_display_name('admin',ARRAY['ADMIN_4'])") == 'admin_5'
    assert value(run, "SELECT app_next_admin_display_name('auto')") == 'auto_1'
    assert value(run, "SELECT app_next_admin_display_name('user')") == 'user_1'
    refused(run, "SELECT app_next_admin_display_name('invalid')", 'invalid display-name prefix')


@pytest.fixture
def named(installed):
    run = installed
    run("""INSERT INTO system_users(id,username,admin_access_allowed) VALUES
        (40,'ordinary_canary',false),(42,'admin_1',true),(43,'group_display',false);
        INSERT INTO system_user_group_memberships(user_id,group_id) VALUES (42,1),(43,1);
        INSERT INTO restricted.users_restricted(id,password,email,login_name) VALUES
        (40,'h','40@example.invalid','ordinary_canary'),(42,'h','42@example.invalid','admin_canary'),
        (43,'h','43@example.invalid','group_login');""")
    return run


def test_both_unique_indexes_refuse_case_variants(named):
    refused(named, "INSERT INTO system_users(id,username) VALUES (50,'ORDINARY_CANARY')", 'uq_system_users_username_lower')
    named("INSERT INTO system_users(id,username) VALUES (50,'other_display')")
    refused(named, "INSERT INTO restricted.users_restricted(id,password,email,login_name) VALUES (50,'h','50@example.invalid','ORDINARY_CANARY')", 'uq_users_restricted_login_name_lower')


@pytest.mark.parametrize('sql', [
    "UPDATE system_users SET username='AdMiN_CaNaRy' WHERE id=42",
    "UPDATE system_users SET username=' admin_canary ' WHERE id=42",
    "UPDATE restricted.users_restricted SET login_name='ADMIN_1' WHERE id=42",
    "UPDATE system_users SET admin_access_allowed=true WHERE id=40",
    "INSERT INTO system_user_group_memberships(user_id,group_id) VALUES (40,1)",
    "UPDATE system_user_group_memberships SET user_id=40 WHERE user_id=43",
    "INSERT INTO system_user_group_memberships(user_id,group_id) VALUES (40,2); UPDATE system_user_group_memberships SET group_id=1 WHERE user_id=40",
    "INSERT INTO system_users(id,username,admin_access_allowed) VALUES (50,'new_admin',true); INSERT INTO restricted.users_restricted(id,password,email,login_name) VALUES (50,'h','50@example.invalid','new_admin')",
    "INSERT INTO system_users(id,username,admin_access_allowed) VALUES (50,'ordinary_canary',true); DELETE FROM system_users WHERE id=40; UPDATE restricted.users_restricted SET id=50 WHERE id=40",
])
def test_rule_refuses_every_sql_path_without_names(named, sql):
    # The credential-move fixture needs a unique public name before moving it.
    if 'SET id=50' in sql:
        sql = "INSERT INTO system_users(id,username,admin_access_allowed) VALUES (50,'moved_admin',true); UPDATE system_users SET username='changed_old' WHERE id=40; UPDATE restricted.users_restricted SET login_name='moved_admin' WHERE id=40; UPDATE restricted.users_restricted SET id=50 WHERE id=40"
    before = snapshot(named)
    error = refused(named, 'BEGIN; '+sql+'; COMMIT;', 'administrator_names_differ')
    assert 'admin_canary' not in error and 'ordinary_canary' not in error
    assert snapshot(named) == before


def test_k205_false_changes_only_name_writes_and_description_counts(named):
    run = named
    run("UPDATE system_config SET boolean_value=false WHERE key='display_name_may_equal_login_name'")
    description = value(run, "SELECT creation_spec FROM system_config WHERE key='display_name_may_equal_login_name'")
    assert 'accounts with equal display and login names: 1.' in description
    assert value(run, 'SELECT current_date') in description
    assert 'ordinary_canary' not in description
    run("""UPDATE system_users SET username=username,admin_access_allowed=false WHERE id=40;
        UPDATE restricted.users_restricted SET login_name=login_name WHERE id=40;
        INSERT INTO system_user_group_memberships(user_id,group_id) VALUES (40,2);
        UPDATE system_user_group_memberships SET group_id=3 WHERE user_id=40;
        UPDATE system_users SET username='Different' WHERE id=40;""")
    for sql in ("UPDATE system_users SET username='ORDINARY_CANARY' WHERE id=40",
                "UPDATE restricted.users_restricted SET login_name=' different ' WHERE id=40",
                "INSERT INTO system_users(id,username) VALUES (50,'new_equal'); INSERT INTO restricted.users_restricted(id,password,email,login_name) VALUES (50,'h','50@example.invalid','NEW_EQUAL')"):
        error = refused(run, 'BEGIN; '+sql+'; COMMIT;', 'user_names_differ')
        assert 'ORDINARY_CANARY' not in error and 'new_equal' not in error
    run("UPDATE system_config SET boolean_value=true WHERE key='display_name_may_equal_login_name'")
    assert 'accounts with equal display and login names: 0.' in value(run, "SELECT creation_spec FROM system_config WHERE key='display_name_may_equal_login_name'")
    run("UPDATE system_users SET username='ordinary_canary' WHERE id=40")
    # Saving the unchanged flag must preserve the previous count/date description.
    previous = value(run, "SELECT creation_spec FROM system_config WHERE key='display_name_may_equal_login_name'")
    run("UPDATE system_config SET boolean_value=true WHERE key='display_name_may_equal_login_name'")
    assert value(run, "SELECT creation_spec FROM system_config WHERE key='display_name_may_equal_login_name'") == previous
    run("DELETE FROM system_config WHERE key='display_name_may_equal_login_name'; UPDATE system_users SET username='different' WHERE id=40; UPDATE restricted.users_restricted SET login_name='different' WHERE id=40")
    assert value(run, "SELECT username FROM system_users WHERE id=40") == 'different'
    run("INSERT INTO system_users(id,username) VALUES (50,'missing_setting_equal'); INSERT INTO restricted.users_restricted(id,password,email,login_name) VALUES (50,'h','50@example.invalid','missing_setting_equal')")
    refused(run, "UPDATE system_users SET username='admin_canary' WHERE id=42", 'administrator_names_differ')


def test_k205_does_not_reject_unchanged_credential_move_or_non_name_update(named):
    run = named
    run("""UPDATE system_config SET boolean_value=false WHERE key='display_name_may_equal_login_name';
        INSERT INTO system_users(id,username,admin_access_allowed) VALUES (50,'moved_equal',false);
        UPDATE system_users SET username='changed_old' WHERE id=40;
        UPDATE restricted.users_restricted SET login_name='moved_equal' WHERE id=40;
        UPDATE restricted.users_restricted SET id=50 WHERE id=40;
        UPDATE restricted.users_restricted SET password='new_hash' WHERE id=50;
        UPDATE system_users SET full_name='Changed full name',enabled=false WHERE id=50;""")
    assert value(run, 'SELECT count(*) FROM restricted.users_restricted WHERE id=50') == '1'
    assert value(run, 'SELECT * FROM app_check_login_name_protections()') == ''


BREAKS = [
    ("ALTER TABLE restricted.users_restricted ALTER COLUMN login_name DROP NOT NULL", 'login_name:'),
    ("ALTER TABLE restricted.users_restricted DROP COLUMN login_name CASCADE", 'login_name:'),
    ("DROP TRIGGER app_credentials_names_differ ON restricted.users_restricted; ALTER TABLE restricted.users_restricted ALTER COLUMN login_name TYPE varchar", 'login_name:'),
    ("DROP INDEX restricted.uq_users_restricted_login_name_lower", 'uq_users_restricted'),
    ("DROP INDEX public.uq_system_users_username_lower", 'uq_system_users'),
    ("DROP INDEX restricted.uq_users_restricted_login_name_lower; CREATE INDEX uq_users_restricted_login_name_lower ON restricted.users_restricted(lower(login_name))", 'uq_users_restricted'),
    ("DROP INDEX public.uq_system_users_username_lower; CREATE UNIQUE INDEX uq_system_users_username_lower ON system_users(lower(username)) WHERE enabled", 'uq_system_users'),
    ("DROP INDEX public.uq_system_users_username_lower; CREATE UNIQUE INDEX uq_system_users_username_lower ON system_users(lower(full_name))", 'uq_system_users'),
    ("UPDATE pg_index SET indisready=false WHERE indexrelid='restricted.uq_users_restricted_login_name_lower'::regclass", 'uq_users_restricted'),
    ("UPDATE pg_index SET indisvalid=false WHERE indexrelid='public.uq_system_users_username_lower'::regclass", 'uq_system_users'),
    ("ALTER TABLE system_users DISABLE TRIGGER app_users_names_differ", 'app_users_names_differ'),
    ("DROP TRIGGER app_memberships_names_differ ON system_user_group_memberships", 'app_memberships_names_differ'),
    ("CREATE OR REPLACE TRIGGER app_credentials_names_differ BEFORE INSERT OR UPDATE OF login_name,id ON restricted.users_restricted FOR EACH ROW EXECUTE FUNCTION app_enforce_administrator_names_differ()", 'app_credentials_names_differ'),
    ("CREATE OR REPLACE TRIGGER app_users_names_differ AFTER UPDATE OF username ON system_users FOR EACH ROW EXECUTE FUNCTION app_enforce_administrator_names_differ()", 'app_users_names_differ'),
    ("CREATE OR REPLACE TRIGGER app_users_names_differ AFTER UPDATE OF username,admin_access_allowed ON system_users FOR EACH STATEMENT EXECUTE FUNCTION app_enforce_administrator_names_differ()", 'app_users_names_differ'),
    ("CREATE OR REPLACE TRIGGER app_users_names_differ AFTER UPDATE OF username,admin_access_allowed ON system_users FOR EACH ROW EXECUTE FUNCTION app_describe_account_name_setting()", 'app_users_names_differ'),
    ("ALTER FUNCTION app_is_administrator_account(bigint) SECURITY DEFINER", 'app_is_administrator_account'),
    ("ALTER FUNCTION app_next_admin_display_name(text,text[]) RESET ALL", 'app_next_admin_display_name'),
    ("ALTER FUNCTION app_enforce_administrator_names_differ() SECURITY INVOKER", 'app_enforce_administrator_names_differ'),
    ("GRANT EXECUTE ON FUNCTION app_check_login_name_protections() TO PUBLIC", 'app_check_login_name_protections'),
    ("REVOKE EXECUTE ON FUNCTION app_is_administrator_account(bigint) FROM PUBLIC", 'app_is_administrator_account'),
    ("CREATE ROLE unexpected_reader; GRANT EXECUTE ON FUNCTION app_enforce_administrator_names_differ() TO unexpected_reader", 'app_enforce_administrator_names_differ'),
    ("DELETE FROM system_config WHERE key='display_name_may_equal_login_name'", 'display_name_may_equal_login_name:'),
    ("UPDATE system_config SET value_type=6 WHERE key='display_name_may_equal_login_name'", 'display_name_may_equal_login_name:'),
    ("UPDATE system_config SET boolean_value=NULL WHERE key='display_name_may_equal_login_name'", 'display_name_may_equal_login_name:'),
    ("ALTER TABLE system_config DISABLE TRIGGER app_account_name_setting_description", 'app_account_name_setting_description'),
    ("CREATE OR REPLACE TRIGGER app_account_name_setting_description BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION app_describe_account_name_setting()", 'app_account_name_setting_description'),
    ("GRANT EXECUTE ON FUNCTION app_describe_account_name_setting() TO PUBLIC", 'app_describe_account_name_setting'),
    ("SET session_replication_role=replica; UPDATE system_users SET username='admin_canary' WHERE id=42", 'administrator_names_differ: account id 42'),
]


@pytest.mark.parametrize('damage,finding', BREAKS)
def test_final_check_names_every_broken_protection(named, damage, finding):
    named(damage)
    result = value(named, CHECK)
    assert finding in result
    if "TYPE varchar" in damage:
        assert "app_credentials_names_differ" in result
    assert 'admin_canary' not in result and 'ordinary_canary' not in result


def test_unexpected_default_function_acl_stops_and_rolls_back(before_k1):
    run = before_k1
    add_accounts(run, upgraded=False)
    run('CREATE ROLE unexpected_reader; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO unexpected_reader')
    original = snapshot(run)
    refused(run, K1.read_text(), 'invalid full execute ACL')
    assert snapshot(run) == original


def test_preflight_reports_function_default_privileges(before_k1):
    run = before_k1
    run('CREATE ROLE default_acl_reader; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO default_acl_reader')
    preflight = (APP / 'server_tools/scripts/login_name_dry_run.sql').read_text()
    reports = dict(line.split('|', 1) for line in value(run, preflight).splitlines())
    grants = json.loads(reports['function_default_privileges'])
    grantee = int(value(run, "SELECT oid FROM pg_roles WHERE rolname='default_acl_reader'"))
    # Role ids are oids, which jsonb prints as strings.
    assert any(int(grant['grantee_role_id']) == grantee and grant['privilege'] == 'EXECUTE' for grant in grants)


def test_k1_and_preflight_accept_shortened_row_actor_trigger(before_k1):
    run = before_k1
    # Longer than 47 bytes so the trigger name is shortened, shorter than PostgreSQL's 63-byte identifier limit.
    name = 'cached_username_target_with_a_name_longer_than_47_bytes'
    run(f'''CREATE TABLE {name}(id bigint, cached_username text, creator bigint);
        DO $$ BEGIN EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON {name} FOR EACH ROW EXECUTE FUNCTION public.protect_row_creator()',
            public.app_row_actor_object_name('protect', '{name}', 'creator')); END $$;''')
    preflight = (APP / 'server_tools/scripts/login_name_dry_run.sql').read_text()
    reports = dict(line.split('|', 1) for line in value(run, preflight).splitlines())
    assert json.loads(reports['stop_unknown_triggers']) == []
    run(K1.read_text())
    assert value(run, CHECK) == ''


@pytest.mark.parametrize('signature,definer,public', [
    ('app_is_administrator_account(bigint)',False,True),
    ('app_next_admin_display_name(text,text[])',False,True),
    ('app_enforce_administrator_names_differ()',True,False),
    ('app_describe_account_name_setting()',True,False),
    ('app_check_login_name_protections()',False,False),
])
@pytest.mark.parametrize('damage', ['security','config','acl'])
def test_final_check_full_function_contract(named, signature, definer, public, damage):
    if damage == 'security':
        named(f'ALTER FUNCTION {signature} SECURITY '+('INVOKER' if definer else 'DEFINER'))
    elif damage == 'config':
        named(f'ALTER FUNCTION {signature} SET search_path=public')
    else:
        named(f'CREATE ROLE unexpected_reader; GRANT EXECUTE ON FUNCTION {signature} TO unexpected_reader')
    assert signature in value(named, CHECK)


@pytest.mark.parametrize('signature', ['app_is_administrator_account(bigint)',
    'app_next_admin_display_name(text,text[])','app_enforce_administrator_names_differ()',
    'app_describe_account_name_setting()'])
def test_final_check_reports_missing_functions_without_raising(named, signature):
    named(f'DROP FUNCTION {signature} CASCADE')
    assert signature + ': missing function' in value(named, CHECK)


def test_marker_missing_rerun_recognizes_own_triggers_and_keeps_names(named):
    named("DELETE FROM system_data_repair_records WHERE migration='k116_login_names' AND action='completed'")
    original = value(named, "SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM system_users u")
    named(K1.read_text())
    assert value(named, "SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM system_users u") == original
    assert value(named, CHECK) == ''


def test_legacy_easelect_membership_timestamp_is_known_to_migration_and_dry_run(before_k1):
    run = before_k1
    add_accounts(run, upgraded=False)
    run("""CREATE FUNCTION public.set_auth_user_group_memberships_updated_timestamp() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN NEW.updated = NOW(); RETURN NEW; END $$;
        CREATE TRIGGER update_auth_user_group_memberships_timestamp
        BEFORE UPDATE ON system_user_group_memberships FOR EACH ROW
        EXECUTE FUNCTION public.set_auth_user_group_memberships_updated_timestamp();""")
    report = run((APP / 'server_tools/scripts/login_name_dry_run.sql').read_text()).stdout
    stops = next(line.split('|', 1)[1] for line in report.splitlines() if line.startswith('stop_unknown_triggers|'))
    assert json.loads(stops) == []
    assert 'update_auth_user_group_memberships_timestamp' in report
    run(K1.read_text())
    assert value(run, CHECK) == ''
    assert value(run, "SELECT count(*) FROM pg_trigger WHERE tgname='update_auth_user_group_memberships_timestamp' AND tgenabled='O'") == '1'
