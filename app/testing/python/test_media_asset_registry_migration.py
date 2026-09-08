"""Verify bounded media registry upgrades on disposable PostgreSQL only.

Connects physical image identities, per-parent usages and reviewed FI/EN UI copy.
Protects existing data, reference retention, least-privilege grants and idempotence.
"""
from pathlib import Path
import json
import re
import subprocess
import pytest
from test_field_settings_language_seed import database

MIGRATION = Path(__file__).resolve().parents[2] / "server_tools/migrations/20260908000006_add_media_asset_registry.sql"
ASSET = "174668a1-2efa-45a6-aa6c-d8a4ee8ec069"
INSERT = f"""
INSERT INTO system_media_assets(id,relation_id,parent_table_uid,child_table_uid,foreign_key_column,filename_column,
 source_row_id,source_reference,filename,original_sha256,default_caption,created_by)
VALUES('{ASSET}',17,101,102,'parent_id','filename',9,'101_1_9.png','image.png',repeat('a',64),'{{"fi":"Kuva","en":"Image"}}',2);
INSERT INTO system_media_asset_usages(asset_id,relation_id,parent_row_id,child_row_id)
VALUES('{ASSET}',17,2,11),('{ASSET}',17,3,12);
"""

def test_registry_upgrade_preserves_existing_assets_and_referenced_deletion_is_rejected(database):
    database(MIGRATION.read_text())
    database(INSERT)
    before = database("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM system_media_assets a")
    database(MIGRATION.read_text())
    assert database("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM system_media_assets a") == before
    assert database("SELECT count(*) FROM system_media_asset_usages") == "2"
    with pytest.raises(subprocess.CalledProcessError):
        database(f"DELETE FROM system_media_assets WHERE id='{ASSET}'")
    assert database("SELECT count(*) FROM system_media_assets") == "1"
    database(f"DELETE FROM system_media_asset_usages WHERE asset_id='{ASSET}' AND parent_row_id=2")
    assert database("SELECT count(*) FROM system_media_assets") == "1"
    assert database("SELECT count(*) FROM system_media_asset_usages") == "1"
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.7.9'") == "1"

def test_media_copy_preserves_existing_site_whitespace_and_seeds_exact_fi_en_keys(database):
    database("INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec) VALUES('media_library_choose','  Oma valinta  ',NULL,'  Oma kuvaus  ')")
    database(MIGRATION.read_text())
    assert database("SELECT '['||fi||']:'||'['||creation_spec||']' FROM system_lang_keys WHERE lang_key='media_library_choose'") == "[  Oma valinta  ]:[  Oma kuvaus  ]"
    assert database("SELECT count(*) FROM system_lang_keys WHERE lang_key LIKE 'media_library_%'") == "9"
    assert database("SELECT count(*) FROM system_lang_key_translations WHERE language_code IN ('fi','en')") == "18"
    before = database("SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM system_lang_keys k")
    database(MIGRATION.read_text())
    assert database("SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM system_lang_keys k") == before

def test_registry_roles_keep_guest_read_only_and_basic_api_capable(database):
    database("CREATE ROLE basic_user; CREATE ROLE guest_user;")
    database(MIGRATION.read_text())
    assert database("SELECT has_table_privilege('basic_user','system_media_assets','INSERT')") == "t"
    assert database("SELECT has_table_privilege('guest_user','system_media_assets','SELECT')") == "t"
    assert database("SELECT has_table_privilege('guest_user','system_media_assets','INSERT')") == "f"
    assert database("SELECT has_table_privilege('guest_user','system_media_asset_usages','DELETE')") == "f"


REPAIR = MIGRATION.with_name("20260908000010_restrict_media_registry_and_restore_support_view.sql")
APP = MIGRATION.parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
INSERT_SOURCE = APP / "backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create/create_table.go"
CHECK_SOURCE = APP / "backend/core_components/system_table_tools/database_consistency_check_queries.go"


def _actual_catalog_query(path, function, variable):
    body = path.read_text().split("func " + function, 1)[1]
    return re.search(variable + r" := `(.*?)`", body, re.S)[1]


def _assert_registry_policy(database):
    for table in ("system_media_assets", "system_media_asset_usages"):
        for role in ("guest_user", "readeronly", "readonly_user", "basic_user", "confidential_user", "admin_user"):
            assert database(f"SELECT has_table_privilege('{role}','{table}','SELECT')") == "t"
            assert database(f"SELECT has_table_privilege('{role}','{table}','UPDATE,TRUNCATE,REFERENCES,TRIGGER')") == "f"
            for privilege in ("INSERT", "DELETE"):
                expected = "t" if role in ("basic_user", "confidential_user", "admin_user") else "f"
                assert database(f"SELECT has_table_privilege('{role}','{table}','{privilege}')") == expected


def _prepare_roles_with_native_style_defaults(database):
    database("""
        CREATE ROLE admin_user; CREATE ROLE basic_user; CREATE ROLE confidential_user;
        CREATE ROLE readonly_user; CREATE ROLE readeronly; CREATE ROLE guest_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO guest_user,basic_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO admin_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readeronly;
    """)


def test_default_acl_repair_preserves_assets_and_restores_only_required_catalog_state(database):
    _prepare_roles_with_native_style_defaults(database)
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    # Schema-local defaults are reinstalled after recreating this disposable schema.
    database("""ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO guest_user,basic_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO admin_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readeronly;""")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    database("DROP TABLE system_media_asset_usages; DROP TABLE system_media_assets;")
    # Replay the immutable old migration under the real failing default-ACL shape.
    database(MIGRATION.read_text())
    assert database("SELECT has_table_privilege('guest_user','system_media_assets','UPDATE')") == "t"
    database(INSERT.replace("17,101,102", "17,900001,900002"))
    database("""
        CREATE TABLE wl56_other_table(id integer, content jsonb);
        INSERT INTO wl56_other_table VALUES(7, '{"fi":"Oma sisältö", "en":"Authored content"}');
        CREATE SCHEMA tenant; CREATE TABLE tenant.system_media_assets(id integer);
        INSERT INTO system_db_tables(cached_oid,schema_name,table_name)
          SELECT c.oid,'public',c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname IN ('system_media_assets','system_media_asset_usages');
        INSERT INTO system_column_details(table_uid,column_name,data_type)
          SELECT table_uid,'id','uuid' FROM system_db_tables WHERE table_name='system_media_assets';
        INSERT INTO system_column_control(table_uid)
          SELECT table_uid FROM system_db_tables WHERE table_name='system_media_assets';
        INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
          SELECT g.id,f.id,t.table_uid FROM system_user_groups g CROSS JOIN system_functions f CROSS JOIN system_db_tables t
          WHERE g.name='admins' AND f.name='dtt_1_row_read.GetResultsHandlerWrapper'
            AND t.table_name IN ('system_media_assets','system_media_asset_usages');
        DELETE FROM system_group_table_func_rights WHERE target_table_uid IN
          (SELECT table_uid FROM system_db_tables WHERE table_name='system_column_supported_views');
        DELETE FROM system_column_details WHERE table_uid IN
          (SELECT table_uid FROM system_db_tables WHERE table_name='system_column_supported_views');
        DELETE FROM system_db_tables WHERE table_name='system_column_supported_views';
    """)
    before_assets = database("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM system_media_assets a")
    before_usages = database("SELECT jsonb_agg(to_jsonb(a) ORDER BY parent_row_id) FROM system_media_asset_usages a")
    before_defaults = database("SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d")
    before_roles = database("SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb) ORDER BY rolname) FROM pg_roles")
    before_content = database("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM wl56_other_table a")
    for _ in range(2):
        database(REPAIR.read_text())
        _assert_registry_policy(database)
        assert database("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM system_media_assets a") == before_assets
        assert database("SELECT jsonb_agg(to_jsonb(a) ORDER BY parent_row_id) FROM system_media_asset_usages a") == before_usages
        assert database("SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d") == before_defaults
        assert database("SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb) ORDER BY rolname) FROM pg_roles") == before_roles
        assert database("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM wl56_other_table a") == before_content
        assert database("SELECT has_table_privilege('guest_user','wl56_other_table','UPDATE')") == "t"
        assert database("SELECT count(*) FROM system_db_tables WHERE schema_name='public' AND table_name IN ('system_media_assets','system_media_asset_usages')") == "0"
        assert database("SELECT count(*) FROM system_db_tables WHERE table_name='system_column_supported_views'") == "1"
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.7.13'") == "1"
    # Execute the actual startup catalog SQL and consistency-discovery SQL after repair.
    query = _actual_catalog_query(INSERT_SOURCE, "InsertNewTables(", "tablesQuery")
    catalog_rows = database(query).splitlines()
    assert all(not row.endswith("|public|system_media_assets") and not row.endswith("|public|system_media_asset_usages") for row in catalog_rows)
    assert any(row.endswith("|tenant|system_media_assets") for row in catalog_rows)
    database("INSERT INTO system_db_tables(cached_oid,schema_name,table_name) " + query)
    assert database("SELECT count(*) FROM system_db_tables WHERE schema_name='public' AND table_name IN ('system_media_assets','system_media_asset_usages')") == "0"
    discovered = database(_actual_catalog_query(CHECK_SOURCE, "checkUnregisteredTables()", "query")).splitlines()
    assert "system_media_assets|public" not in discovered
    assert "system_media_asset_usages|public" not in discovered
    _assert_registry_policy(database)


def test_fresh_media_schema_resets_inherited_default_crud_without_changing_other_tables(database):
    _prepare_roles_with_native_style_defaults(database)
    before_defaults = database("SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d")
    source = (BOOTSTRAP / "source/media_assets.schema.sql").read_text()
    for _ in range(2):
        database(source)
        _assert_registry_policy(database)
    assert database("SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d") == before_defaults
    database("CREATE TABLE wl56_other_table(id integer);")
    assert database("SELECT has_table_privilege('guest_user','wl56_other_table','UPDATE')") == "t"
    grant_block = source.split("-- BEGIN exact media registry role policy.", 1)[1].split("-- END exact media registry role policy.", 1)[0]
    assert grant_block in REPAIR.read_text()
    support_repair = MIGRATION.with_name("20260908000008_restore_column_support_view_registration.sql").read_text()
    support_repair = support_repair[support_repair.index("INSERT INTO public.system_db_tables"):support_repair.index("INSERT INTO public.system_db_version")].rstrip()
    assert support_repair in REPAIR.read_text()
