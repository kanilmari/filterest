"""Prove per-use card storage on fresh installs, upgrades and new galleries.

Connect the public generator baseline to the migration-owned gallery installer.
Run database proofs only in the existing isolated PostgreSQL cluster harness.
"""
import json
from pathlib import Path
import re

from test_row_actor_support import cluster

APP = Path(__file__).resolve().parents[2]
NAME = "20261015000009_add_card_image_usage_presentation.sql"
MIGRATION = APP / "server_tools/migrations" / NAME
BOOTSTRAP = APP / "server_tools/public_bootstrap"
FIELDS = "'card_image_presentation','card_image_focal_x','card_image_focal_y'"


def test_card_image_migration_is_unreleased_and_has_one_bootstrap_owner():
    sql = MIGRATION.read_text()
    assert "-- VERSION_DB: 9.12.0" in sql
    assert "-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql" in sql
    assert "-- COMPLETION_MARKER: wl69_card_image_usage_storage" in sql
    assert NAME in (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert sql in (BOOTSTRAP / "seed_data.sql").read_text()
    assert not re.search(r"SECURITY\s+DEFINER|card_image_locked|system_user_visual_preferences", sql, re.I)


def test_card_image_upgrade_matches_fresh_and_replays(cluster):
    for name in ("card_fresh", "card_upgrade"):
        cluster(f"CREATE DATABASE {name}")
        for source in ("schema.sql", "seed_data.sql"):
            cluster((BOOTSTRAP / source).read_text(), name)
    # Reconstruct the old gallery storage boundary in the isolated upgrade DB.
    cluster(f"""DO $old$ DECLARE g record; BEGIN
        FOR g IN SELECT DISTINCT t.table_name,t.table_uid FROM system_db_tables t
          JOIN system_column_details c USING(table_uid) WHERE c.column_name='card_image_presentation'
        LOOP
          EXECUTE format('ALTER TABLE %I DROP COLUMN card_image_presentation, DROP COLUMN card_image_focal_x, DROP COLUMN card_image_focal_y',g.table_name);
          DELETE FROM system_column_details WHERE table_uid=g.table_uid AND column_name IN ({FIELDS});
        END LOOP;
    END $old$;""", "card_upgrade")
    shape = f"""SELECT jsonb_agg(jsonb_build_array(t.table_name,c.column_name,c.data_type,c.editable_in_ui,
          c.insertable,c.card_element,c.hide_in_filter_panel,c.show_value_on_card,c.hide_everywhere) ORDER BY t.table_name,c.column_name)
        FROM system_column_details c JOIN system_db_tables t USING(table_uid)
        WHERE c.column_name IN ({FIELDS})"""
    fresh = cluster(shape, "card_fresh").stdout.strip()
    assert fresh and fresh != "null"
    for _ in range(2):
        cluster(MIGRATION.read_text(), "card_upgrade")
        assert cluster(shape, "card_upgrade").stdout.strip() == fresh


def test_card_image_upgrade_discovers_normalized_indicators_and_replays(cluster):
    """Each configured gallery has exactly one image indicator, never a fallback."""
    cluster("CREATE DATABASE card_discovery")
    for source in ("schema.sql", "seed_data.sql"):
        cluster((BOOTSTRAP / source).read_text(), "card_discovery")

    def run(sql):
        return cluster(sql, "card_discovery").stdout.strip()

    # Also cover the other SupportsImage indicators and the unconfigured legacy path.
    cases = [
        ({"asset_kinds": ["ImAgE"]}, True),
        ({"asset_kinds": [" image "]}, True),
        ({"asset_kinds": ["attachment", "\tImAgE\r\n"]}, True),
        ({"asset_kinds": ["\u00a0ImAgE\u2003"]}, True),
        ({"cache_targets": [{"column": "CaChEd_ImAgE"}]}, True),
        ({"cache_targets": [{"column": " cached_image "}]}, True),
        ({"cache_targets": [{"column": "cached_file"}, {"column": "\tCaChEd_ImAgE\n"}]}, True),
        ({"cache_targets": [{"column": "\u2002CaChEd_ImAgE\u3000"}]}, True),
        ({"profiles": {"image": {}}}, True),
        ({"profile_key": "\tImAgE\n", "asset_kinds": None, "cache_targets": None}, True),
        ({"target_directory": "\u00a0MeDiA\t"}, True),
        ({"profiles": {"IMAGE": {}}}, False),
        ({"profile_key": "attachment", "asset_kinds": ["file"],
          "cache_targets": [{"column": "cached_file"}], "target_directory": "documents"}, False),
        ({}, False),
        (None, True),
    ]
    run("""CREATE TABLE card_discovery_parent(id integer PRIMARY KEY);
        INSERT INTO system_db_tables(table_uid,table_name,schema_name)
          VALUES(990800,'card_discovery_parent','public');""")
    for index, (config, _) in enumerate(cases):
        name, uid = f"card_discovery_{index}", 990801 + index
        # file_upload null exercises the legacy column-based gallery fallback.
        specs = json.dumps({"file_upload": None if config is None else
                            {**config, "filename_column": "filename"}}).replace("'", "''")
        run(f"""CREATE TABLE {name}(id integer PRIMARY KEY, asset_kind text, filename text,
              parent_id integer REFERENCES card_discovery_parent(id));
            INSERT INTO system_db_tables(table_uid,table_name,schema_name) VALUES({uid},'{name}','public');
            INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,
              source_column_name,target_column_name,target_insert_specs)
              VALUES({uid},990800,'parent_id','id','{specs}'::jsonb);""")

    # Preserve physical columns, constraints and authored metadata across replay.
    snapshot = f"""SELECT jsonb_agg(jsonb_build_object('name',t.table_name,
        'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a
          WHERE a.attrelid=to_regclass(t.table_name) AND a.attnum>0 AND NOT a.attisdropped),
        'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c
          WHERE c.conrelid=to_regclass(t.table_name)),
        'metadata',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.column_name) FROM system_column_details d
          WHERE d.table_uid=t.table_uid AND d.column_name IN ({FIELDS}))) ORDER BY t.table_uid)
      FROM system_db_tables t WHERE t.table_uid BETWEEN 990801 AND {990800 + len(cases)}"""
    before = run(snapshot)
    run(MIGRATION.read_text())
    upgraded = json.loads(run(snapshot))
    assert run(snapshot) != before
    for gallery, (_, expected) in zip(upgraded, cases, strict=True):
        fields = {column["attname"] for column in gallery["columns"]}
        presentation = {"card_image_presentation", "card_image_focal_x", "card_image_focal_y"}
        assert fields & presentation == (presentation if expected else set()), gallery["name"]
        constraints = [c for c in gallery["constraints"] if c["conname"] == "card_image_usage_valid"]
        assert len(constraints) == int(expected), gallery["name"]
        assert len(gallery["metadata"] or []) == (3 if expected else 0), gallery["name"]
    # An administrator's metadata edit and saved settings must also survive replay.
    run("""UPDATE system_column_details SET editable_in_ui=false
        WHERE table_uid=990801 AND column_name='card_image_presentation';
        INSERT INTO card_discovery_0(id,card_image_presentation,card_image_focal_x,card_image_focal_y)
          VALUES(1,'contain',0.25,0.75);""")
    stored = run("SELECT row_to_json(g) FROM card_discovery_0 g")
    after = run(snapshot)
    for _ in range(2):
        run(MIGRATION.read_text())
        assert run(snapshot) == after
        assert run("SELECT row_to_json(g) FROM card_discovery_0 g") == stored


def test_card_image_storage_checks_new_gallery_values_and_keeps_authored_metadata(cluster):
    cluster("CREATE DATABASE card_constraints")
    for source in ("schema.sql", "seed_data.sql"):
        cluster((BOOTSTRAP / source).read_text(), "card_constraints")
    def run(sql, check=True):
        return cluster(sql, "card_constraints", check)
    run("""CREATE TABLE card_test_gallery(id integer PRIMARY KEY);
        INSERT INTO system_db_tables(table_uid,table_name,schema_name) VALUES(990701,'card_test_gallery','public');
        SELECT public.app_ensure_card_image_storage(990701);
        INSERT INTO card_test_gallery(id,card_image_presentation,card_image_focal_x,card_image_focal_y)
          VALUES(1,'cover',0,1),(2,NULL,NULL,NULL),(3,'contain_blur',0.25,0.75);
        UPDATE system_column_details SET editable_in_ui=false
          WHERE table_uid=990701 AND column_name='card_image_presentation';
        SELECT public.app_ensure_card_image_storage(990701);""")
    assert run("SELECT editable_in_ui FROM system_column_details WHERE table_uid=990701 AND column_name='card_image_presentation'").stdout.strip() == "f"
    for values in ("'unsafe',NULL,NULL", "'cover',NULL,0.5", "'cover',0.5,NULL", "'cover',-0.1,0.5", "'cover',0.5,1.1", "'cover','NaN',0.5"):
        result = run(f"UPDATE card_test_gallery SET (card_image_presentation,card_image_focal_x,card_image_focal_y)=({values}) WHERE id=1", False)
        assert result.returncode != 0, values
        assert "card_image_usage_valid" in result.stderr
    assert run("SELECT card_image_presentation||':'||card_image_focal_x||':'||card_image_focal_y FROM card_test_gallery WHERE id=1").stdout.strip() == "cover:0.0000:1.0000"
