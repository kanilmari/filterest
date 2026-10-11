"""test_managed_timestamps_postgres.py
Prove Helsinki wall clocks become correct instants without losing dependencies.
Connect the forward migration and fresh bootstrap on a disposable local cluster.
Opt in only under the shared PostgreSQL suite lock; never read installation data.
"""
import json
import re

import pytest
from test_managed_timestamp_bootstrap import MANAGED_COLUMNS, MIGRATION
from test_row_actor_support import cluster, installed, value  # noqa: F401


@pytest.fixture
def clocks(cluster):
    cluster("CREATE DATABASE timestamp_clocks")
    cluster("ALTER DATABASE timestamp_clocks SET TimeZone='UTC'")

    def run(sql, check=True):
        return cluster(sql, "timestamp_clocks", check)

    run("""SET TIME ZONE 'UTC'; CREATE SCHEMA restricted;
        CREATE TABLE public.system_data_repair_records (
            migration text, action text, detail jsonb, recorded_at timestamptz DEFAULT now());
        CREATE ROLE clock_view_owner NOLOGIN; CREATE ROLE clock_reader NOLOGIN;
        CREATE ROLE clock_column_reader NOLOGIN;
    """)
    for table, columns in MANAGED_COLUMNS.items():
        extras = ""
        if table == "system_db_tables":
            extras = ",schema_name text,table_name text,table_uid integer"
        if table == "system_column_details":
            extras = ",table_uid integer,column_name text,data_type text"
        definitions = ",".join(f"{column} timestamp DEFAULT now()" for column in columns)
        run(f"CREATE TABLE public.{table} (id integer PRIMARY KEY,{definitions}{extras});")
        for row_id, clock in enumerate(["2026-01-15 09:30:45.123456", "2026-06-14 09:30:00",
                                        "2026-03-29 04:30:00", "2026-10-25 03:30:00"], 1):
            run(f"INSERT INTO public.{table}(id,{','.join(columns)}) VALUES ({row_id}," +
                ",".join(f"TIMESTAMP '{clock}'" for _ in columns) + ");")
        run(f"INSERT INTO public.{table}(id,{','.join(columns)}) VALUES (5,NULL,NULL);")
    run("""
        UPDATE system_db_tables SET schema_name='public',table_name='system_config',table_uid=42 WHERE id=1;
        UPDATE system_column_details SET table_uid=42,column_name='created',data_type='timestamp without time zone' WHERE id=1;
        ALTER TABLE system_config ADD COLUMN already_zoned timestamptz DEFAULT '2026-01-15T07:30:00Z';
        ALTER TABLE system_config ALTER COLUMN updated SET DEFAULT TIMESTAMP '2026-01-15 09:30:00';
        CREATE TABLE restricted.users_restricted (id integer, historical_clock timestamp);
        INSERT INTO restricted.users_restricted VALUES (1,'2026-01-15 09:30:00');
        CREATE TABLE system_config_lang_embeddings (updated timestamp);
        INSERT INTO system_config_lang_embeddings VALUES ('2026-06-14 09:30:00');
        CREATE TABLE app_dating_profiles (created timestamp); INSERT INTO app_dating_profiles VALUES ('2026-01-15 09:30:00');
        CREATE TABLE system_styles (created timestamp); INSERT INTO system_styles VALUES ('2026-01-15 09:30:00');
        CREATE TABLE palvelukatalogi (created timestamp); INSERT INTO palvelukatalogi VALUES ('2026-01-15 09:30:00');
        CREATE TABLE palvelukatalogi_assets (created timestamp); INSERT INTO palvelukatalogi_assets VALUES ('2026-01-15 09:30:00');
        CREATE TABLE palvelukatalogi_lang_embeddings (updated timestamp); INSERT INTO palvelukatalogi_lang_embeddings VALUES ('2026-01-15 09:30:00');
        CREATE INDEX clock_created_idx ON system_config(created);
        ALTER TABLE system_config ADD CONSTRAINT clock_range CHECK(created >= TIMESTAMP '2026-01-01');
        CREATE FUNCTION clock_update() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN NEW.updated=now(); RETURN NEW; END $$;
        CREATE TRIGGER clock_update BEFORE UPDATE ON system_config
            FOR EACH ROW WHEN (NEW.created IS DISTINCT FROM OLD.created) EXECUTE FUNCTION clock_update();
        CREATE TRIGGER clock_metadata_update BEFORE UPDATE ON system_column_details
            FOR EACH ROW EXECUTE FUNCTION clock_update();
        CREATE TRIGGER clock_disabled BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION clock_update();
        ALTER TABLE system_config DISABLE TRIGGER clock_disabled;
        COMMENT ON TRIGGER clock_disabled ON system_config IS 'keep disabled';
        CREATE TRIGGER clock_replica BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION clock_update();
        ALTER TABLE system_config ENABLE REPLICA TRIGGER clock_replica;
        COMMENT ON TRIGGER clock_replica ON system_config IS 'keep replica';
        CREATE TRIGGER clock_always BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION clock_update();
        ALTER TABLE system_config ENABLE ALWAYS TRIGGER clock_always;
        COMMENT ON TRIGGER clock_always ON system_config IS 'keep always';
        CREATE VIEW clock_view WITH (security_barrier=true) AS SELECT id,created,updated FROM system_config;
        CREATE VIEW clock_nested AS SELECT * FROM clock_view;
        ALTER VIEW clock_view OWNER TO clock_view_owner;
        GRANT SELECT ON system_config TO clock_view_owner;
        COMMENT ON VIEW clock_view IS 'preserved clock view';
        COMMENT ON COLUMN clock_view.created IS 'preserved clock column';
        ALTER VIEW clock_view ALTER COLUMN created SET DEFAULT TIMESTAMP '2026-01-15 09:30:00';
        SET ROLE clock_view_owner;
        GRANT SELECT ON clock_view TO clock_reader WITH GRANT OPTION;
        GRANT SELECT (created) ON clock_view TO clock_column_reader;
        RESET ROLE;
        CREATE FUNCTION clock_view_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        CREATE TRIGGER clock_view_write INSTEAD OF INSERT ON clock_view FOR EACH ROW EXECUTE FUNCTION clock_view_write();
        COMMENT ON TRIGGER clock_view_write ON clock_view IS 'keep view insert';
        CREATE RULE clock_no_delete AS ON DELETE TO clock_view DO INSTEAD NOTHING;
        COMMENT ON RULE clock_no_delete ON clock_view IS 'keep rule';
    """)
    return run


def test_fixture_uses_postgres16_supported_view_operations():
    # Run only the fixture's SQL assembly, without the socket/psql fixture.
    statements = []
    clocks.__wrapped__(lambda sql, *args: statements.append(sql))
    setup = '\n'.join(statements)
    assert not re.search(r'ALTER TABLE clock_(?:view|nested)\b', setup)
    assert 'CREATE TRIGGER clock_view_write INSTEAD OF INSERT ON clock_view FOR EACH ROW' in setup
    assert 'CREATE RULE clock_no_delete AS ON DELETE TO clock_view DO INSTEAD NOTHING' in setup
    for action, trigger in [('DISABLE', 'clock_disabled'), ('ENABLE REPLICA', 'clock_replica'),
                            ('ENABLE ALWAYS', 'clock_always')]:
        assert f'ALTER TABLE system_config {action} TRIGGER {trigger};' in setup


def replay(run):
    # Match the real migration runner's transaction boundary, including refusal.
    return run("BEGIN; SET LOCAL TIME ZONE 'UTC';" + MIGRATION.read_text() + "COMMIT;")


def objects(run):
    return json.loads(value(run, """SELECT jsonb_build_object(
        'views',(SELECT jsonb_agg(jsonb_build_array(c.relname,pg_get_viewdef(c.oid),c.relowner,COALESCE(c.relacl,acldefault('r',c.relowner)),c.reloptions,
            obj_description(c.oid,'pg_class')) ORDER BY c.relname) FROM pg_class c WHERE c.relname IN ('clock_view','clock_nested')),
        'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,a.attacl,col_description(a.attrelid,a.attnum)) ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid='clock_view'::regclass AND a.attnum>0),
        'triggers',(SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid),obj_description(oid,'pg_trigger')) ORDER BY tgname)
            FROM pg_trigger WHERE NOT tgisinternal),
        'rules',(SELECT jsonb_agg(jsonb_build_array(rulename,ev_enabled,pg_get_ruledef(oid),obj_description(oid,'pg_rewrite')) ORDER BY rulename)
            FROM pg_rewrite WHERE rulename='clock_no_delete'),
        'indexes',(SELECT jsonb_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE tablename='system_config'))"""))


def assert_clock_object_states(run):
    states = json.loads(value(run, """SELECT jsonb_object_agg(tgname,tgenabled) FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN ('system_config'::regclass,
            'system_column_details'::regclass,'clock_view'::regclass)"""))
    assert states == {'clock_update': 'O', 'clock_metadata_update': 'O', 'clock_disabled': 'D',
                      'clock_replica': 'R', 'clock_always': 'A', 'clock_view_write': 'O'}
    assert value(run, "SELECT ev_enabled FROM pg_rewrite WHERE ev_class='clock_view'::regclass AND rulename='clock_no_delete'") == 'O'


def test_all_inventory_clocks_round_trip_and_dependencies_survive_twice(clocks):
    run = clocks
    assert_clock_object_states(run)
    before_objects = objects(run)
    before = {}
    for table, columns in MANAGED_COLUMNS.items():
        for column in columns:
            before[table, column] = value(run, f"SELECT jsonb_agg({column}::text ORDER BY id) FROM {table}")
    replay(run)
    assert value(run, "SELECT count(*) FROM app_check_managed_timestamp_zones()") == "0"
    assert objects(run) == before_objects
    assert_clock_object_states(run)
    assert value(run, "SELECT count(*) FROM pg_index WHERE indrelid='system_config'::regclass AND indisvalid AND indisready") == '2'
    assert value(run, "SELECT count(*) FROM pg_constraint WHERE conrelid='system_config'::regclass AND conname='clock_range' AND convalidated") == '1'
    for (table, column), wall_values in before.items():
        assert value(run, f"SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='{table}'::regclass AND attname='{column}'") == 'timestamp with time zone'
        assert value(run, f"SELECT jsonb_agg(({column} AT TIME ZONE 'Europe/Helsinki')::text ORDER BY id) FROM {table}") == wall_values
    assert value(run, "SELECT created AT TIME ZONE 'UTC' FROM system_config WHERE id=4") == '2026-10-25 01:30:00'
    assert value(run, "SELECT created AT TIME ZONE 'UTC' FROM system_config WHERE id=3") == '2026-03-29 01:30:00'
    assert value(run, "SELECT historical_clock AT TIME ZONE 'UTC' FROM restricted.users_restricted") == '2026-01-15 07:30:00'
    assert value(run, "SELECT updated AT TIME ZONE 'UTC' FROM system_config_lang_embeddings") == '2026-06-14 06:30:00'
    assert value(run, "SELECT data_type FROM system_column_details WHERE id=1") == 'timestamp with time zone'
    assert value(run, "SET ROLE clock_reader; SELECT created AT TIME ZONE 'Europe/Helsinki' FROM clock_view WHERE id=4; RESET ROLE;") == '2026-10-25 03:30:00'
    assert value(run, "INSERT INTO clock_view(id) VALUES (90) RETURNING created AT TIME ZONE 'UTC'") == '2026-01-15 07:30:00'
    # Zoned defaults keep their instant, naive literal defaults get Helsinki's zone.
    assert value(run, "INSERT INTO system_config(id) VALUES (6) RETURNING updated AT TIME ZONE 'UTC'") == '2026-01-15 07:30:00'
    assert value(run, "SELECT abs(extract(epoch FROM created-now())) < 5 FROM system_config WHERE id=6") == 't'
    assert value(run, "SELECT already_zoned AT TIME ZONE 'UTC' FROM system_config WHERE id=6") == '2026-01-15 07:30:00'
    # CSV's RFC3339Nano cell can carry either Helsinki's offset or UTC;
    # PostgreSQL restores the same instant even in an UTC import session.
    assert value(run, "INSERT INTO system_config(id,created) VALUES (7,'2026-06-14T09:30:00.123456+03:00') RETURNING created AT TIME ZONE 'Europe/Helsinki'") == '2026-06-14 09:30:00.123456'
    for table, column in [('app_dating_profiles','created'),('system_styles','created'),('palvelukatalogi','created'),
                          ('palvelukatalogi_assets','created'),('palvelukatalogi_lang_embeddings','updated')]:
        assert value(run, f"SELECT pg_typeof({column})::text || ':' || {column}::text FROM {table}") == 'timestamp without time zone:2026-01-15 09:30:00'
    # Exercise trigger behavior after reconstruction, not just catalogue presence.
    assert value(run, "UPDATE system_config SET created=created+INTERVAL '1 minute' WHERE id=1 RETURNING abs(extract(epoch FROM updated-now())) < 5") == 't'
    state = value(run, "SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM system_config t")
    replay(run)
    assert value(run, "SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM system_config t") == state
    assert objects(run) == before_objects
    assert_clock_object_states(run)
    assert value(run, "SELECT count(*) FROM system_data_repair_records") == '1'
    assert value(run, "SHOW TimeZone") == 'UTC'


def test_dependent_view_instead_of_trigger_and_rule_survive_twice(clocks):
    before = objects(clocks)
    for _ in range(2):
        replay(clocks)
        assert objects(clocks) == before
        assert_clock_object_states(clocks)
        # The INSTEAD OF trigger returns NEW (including the restored view
        # default), while the delete rule protects the underlying row.
        assert value(clocks, "INSERT INTO clock_view(id) VALUES (90) RETURNING created AT TIME ZONE 'UTC'") == '2026-01-15 07:30:00'
        assert value(clocks, "SELECT count(*) FROM system_config WHERE id=90") == '0'
        assert value(clocks, "DELETE FROM clock_view WHERE id=1; SELECT count(*) FROM system_config WHERE id=1") == '1'


@pytest.mark.parametrize('trigger_state', ['ENABLE', 'DISABLE', 'ENABLE REPLICA', 'ENABLE ALWAYS'],
                         ids=['origin', 'disabled', 'replica', 'always'])
def test_already_zoned_metadata_clocks_survive_when_only_another_table_is_naive(cluster, trigger_state):
    cluster('CREATE DATABASE timestamp_metadata_zoned')
    cluster("ALTER DATABASE timestamp_metadata_zoned SET TimeZone='UTC'")

    def run(sql, check=True):
        return cluster(sql, 'timestamp_metadata_zoned', check)

    run("""SET TIME ZONE 'UTC';
        CREATE TABLE system_data_repair_records (migration text, action text, detail jsonb);
        CREATE TABLE system_db_tables (table_uid integer, schema_name text, table_name text);
        INSERT INTO system_db_tables VALUES (42,'public','system_config');
        CREATE TABLE system_config (id integer, created timestamp);
        INSERT INTO system_config VALUES (1,'2026-01-15 09:30:45.123456');
        CREATE TABLE system_column_details (id integer, table_uid integer, column_name text,
            data_type text, created timestamptz, updated timestamptz);
        INSERT INTO system_column_details VALUES
            (1,42,'created','timestamp without time zone','2026-01-15T07:30:45.123456Z','2026-06-14T06:30:00Z');
        CREATE FUNCTION metadata_update() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN NEW.updated=now(); RETURN NEW; END $$;
        CREATE TRIGGER clock_metadata_update BEFORE UPDATE ON system_column_details
            FOR EACH ROW EXECUTE FUNCTION metadata_update();
        COMMENT ON TRIGGER clock_metadata_update ON system_column_details IS 'preserve metadata state';
    """)
    run(f'ALTER TABLE system_column_details {trigger_state} TRIGGER clock_metadata_update;')
    before_clocks = value(run, 'SELECT jsonb_build_array(created,updated) FROM system_column_details')
    trigger_query = """SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid),
        obj_description(oid,'pg_trigger')) ORDER BY tgname) FROM pg_trigger
        WHERE tgrelid='system_column_details'::regclass AND NOT tgisinternal"""
    before_trigger = value(run, trigger_query)
    for _ in range(2):
        replay(run)
        assert value(run, 'SELECT jsonb_build_array(created,updated) FROM system_column_details') == before_clocks
        assert value(run, 'SELECT data_type FROM system_column_details') == 'timestamp with time zone'
        assert value(run, 'SELECT created AT TIME ZONE \'UTC\' FROM system_config') == '2026-01-15 07:30:45.123456'
        assert value(run, trigger_query) == before_trigger
        assert value(run, 'SELECT count(*) FROM system_data_repair_records') == '1'
        assert value(run, 'SHOW TimeZone') == 'UTC'
    # Prove restored trigger behavior as well as its definition/state/comment.
    # Replica mode must be exercised in the session in which it actually fires.
    if trigger_state == 'ENABLE REPLICA':
        run("SET session_replication_role='replica'; UPDATE system_column_details SET data_type=data_type;")
    else:
        run('UPDATE system_column_details SET data_type=data_type;')
    if trigger_state == 'DISABLE':
        assert value(run, 'SELECT jsonb_build_array(created,updated) FROM system_column_details') == before_clocks
    else:
        assert value(run, 'SELECT abs(extract(epoch FROM updated-now())) < 5 FROM system_column_details') == 't'


def test_true_helsinki_spring_gap_0330_normalizes_forward(clocks):
    # 03:30 does not exist on this date; PostgreSQL interprets it with the
    # standard offset, yielding 01:30 UTC / 04:30 Helsinki after conversion.
    clocks("INSERT INTO system_config(id,created) VALUES (80,TIMESTAMP '2026-03-29 03:30:00')")
    replay(clocks)
    assert value(clocks, "SELECT created AT TIME ZONE 'UTC' FROM system_config WHERE id=80") == '2026-03-29 01:30:00'
    assert value(clocks, "SELECT created AT TIME ZONE 'Europe/Helsinki' FROM system_config WHERE id=80") == '2026-03-29 04:30:00'


@pytest.mark.parametrize('object_kind', ['trigger', 'rule'])
@pytest.mark.parametrize('enabled', ['D', 'R', 'A', 'Z'])
def test_unrestorable_dependent_view_states_refuse_without_partial_conversion(clocks, object_kind, enabled):
    # Override the captured value to simulate a legacy/corrupt state. PostgreSQL
    # 16 cannot create these states on views through supported DDL; do not alter
    # pg_catalog or issue the unsupported ALTER TABLE just to test refusal.
    migration = MIGRATION.read_text()
    if object_kind == 'trigger':
        original = 'AS definition, t.tgenabled,'
        replacement = ('AS definition, CASE WHEN t.tgname = \'clock_view_write\' '
                       f'THEN \'{enabled}\'::"char" ELSE t.tgenabled END AS tgenabled,')
        object_name = 'clock_view_write'
    else:
        original = 'v.relkind, r.ev_enabled'
        replacement = ('v.relkind, CASE WHEN r.rulename = \'clock_no_delete\' '
                       f'THEN \'{enabled}\'::"char" ELSE r.ev_enabled END AS ev_enabled')
        object_name = 'clock_no_delete'
    assert migration.count(original) == 1
    migration = migration.replace(original, replacement, 1)
    before = objects(clocks)
    before_rows = value(clocks, "SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM system_config t")
    result = clocks('BEGIN;' + migration + 'COMMIT;', check=False)
    assert result.returncode != 0
    assert f'cannot restore captured {object_kind} {object_name} on public.clock_view' in result.stderr
    assert f'enabled state {enabled} is unsupported for relation kind v; nothing converted' in result.stderr
    assert objects(clocks) == before
    assert value(clocks, "SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM system_config t") == before_rows
    for table, columns in MANAGED_COLUMNS.items():
        for column in columns:
            assert value(clocks, f"SELECT atttypid='timestamp'::regtype FROM pg_attribute WHERE attrelid='{table}'::regclass AND attname='{column}'") == 't'
    assert value(clocks, "SELECT count(*) FROM system_data_repair_records") == '0'


@pytest.mark.parametrize('dependency', ['materialized', 'delegated_acl'])
def test_unsupported_dependencies_refuse_without_partial_conversion(clocks, dependency):
    if dependency == 'materialized':
        clocks("CREATE MATERIALIZED VIEW clock_materialized AS SELECT created FROM system_config")
        expected = 'dependent materialized views'
    else:
        clocks("CREATE ROLE clock_delegate NOLOGIN; SET ROLE clock_reader; GRANT SELECT ON clock_view TO clock_delegate; RESET ROLE;")
        expected = 'delegated dependent-view grants'
    before = objects(clocks)
    result = clocks('BEGIN;' + MIGRATION.read_text() + 'COMMIT;', check=False)
    assert result.returncode != 0 and expected in result.stderr
    assert objects(clocks) == before
    assert value(clocks, "SELECT pg_typeof(created) FROM system_config LIMIT 1") == 'timestamp without time zone'
    assert value(clocks, "SELECT count(*) FROM system_data_repair_records") == '0'


def test_fresh_bootstrap_has_no_naive_platform_clocks_and_replays(installed):
    assert value(installed, 'SELECT count(*) FROM app_check_managed_timestamp_zones()') == '0'
    # Include every static bootstrap table, even the deliberately excluded showcases.
    assert value(installed, "SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','restricted') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='timestamp'::regtype") == '0'
    replay(installed)
    replay(installed)
    assert value(installed, "SELECT count(*) FROM system_data_repair_records WHERE migration='wl167_managed_timestamp_zones'") == '1'
