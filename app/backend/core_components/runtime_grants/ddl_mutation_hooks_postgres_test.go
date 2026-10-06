// ddl_mutation_hooks_postgres_test.go
// Exercises each DDL, rename and consistency-repair grant boundary as HTTP requests.
// Uses bootstrap objects and separate limited logins, with no live database.
// Effective ACLs and rejected mutations prove completion and atomic rollback.
package runtime_grants_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/lib/pq"

	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	drop "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	fk "easelect/backend/core_components/dynamic_table_tools/dtt_foreign_keys"
	folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	triggers "easelect/backend/core_components/dynamic_table_tools/dtt_triggers"
	. "easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/system_table_tools"
)

func TestDedicatedDDLGrantHooksPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	f.create("hook_target", "")
	f.create("hook_source", `,{"name":"target_id","data_type":"INTEGER"}`)
	f.right("hook_source", "/api/add-row-multipart")
	f.excess("hook_source")
	f.request(fk.AddForeignKeyHandler, `{"referencing_dataset":"hook_source","referencing_column":"target_id","referenced_dataset":"hook_target","referenced_column":"id"}`, 200)
	f.privilege("hook_source", "", "DELETE", false)
	f.privilege("hook_target", "id", "UPDATE", true)
	f.privilege("hook_target", "title", "UPDATE", false)
	f.excess("hook_source")
	f.request(fk.DeleteForeignKeyHandler, `{"referencing_dataset":"hook_source","constraint_name":"fk_hook_source_target_id"}`, 200)
	f.privilege("hook_source", "", "DELETE", false)
	f.privilege("hook_target", "id", "UPDATE", false)
	f.privilege("hook_target", "title", "SELECT", true)
	f.excess("hook_source")
	f.request(workflows.ModifyColumnsHandler, `{"dataset_name":"hook_source","added_columns":[{"new_name":"extra","data_type":"TEXT"}]}`, 200)
	f.privilege("hook_source", "extra", "SELECT", true)
	f.privilege("hook_source", "", "DELETE", false)
	f.create("hook_destination", "")
	f.request(triggers.CreateTriggerHandler, `{"source_dataset":"hook_source","target_dataset":"hook_destination","condition":"true","action_values":"{\"title\":\"created by hook\"}"}`, 201)
	f.privilege("hook_destination", "", "INSERT", true)
	if _, err := f.basic.Exec(`INSERT INTO hook_destination(title) VALUES('physical trigger destination grant')`); err != nil {
		t.Fatal(err)
	}
	f.request(drop.DropTableHandler, `{"dataset_name":"hook_source","confirm_dataset_name":"hook_source"}`, 200)
	var automationRemains bool
	if err := f.owner.QueryRow(`SELECT EXISTS(SELECT 1 FROM system_triggers WHERE source_table='hook_source' OR target_table='hook_source')`).Scan(&automationRemains); err != nil || automationRemains {
		t.Fatal("dropped dataset automation survived", err)
	}
	f.privilege("hook_destination", "", "INSERT", false)
	var remains bool
	if err := f.owner.QueryRow(`SELECT to_regclass('hook_source') IS NOT NULL`).Scan(&remains); err != nil || remains {
		t.Fatal("dataset did not drop", err)
	}
}

func TestRenameHooksKeepStableIdentityAndReconcilePostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	uid := f.create("rename_hook", "")
	id := f.treeID("rename_hook")
	f.right("rename_hook", "/api/add-row-multipart")
	var oid int64
	if err := f.owner.QueryRow(`SELECT 'rename_hook'::regclass::oid`).Scan(&oid); err != nil {
		t.Fatal(err)
	}
	f.excess("rename_hook")
	f.request(folders.HandleRenameTreeNode, fmt.Sprintf(`{"item_id":%d,"item_type":"table","new_name":"rename_tree_done","translations":{"fi":"Nimi","en":"Name"}}`, id), 200)
	f.assertUID("rename_tree_done", uid)
	f.privilege("rename_tree_done", "", "DELETE", false)
	f.privilege("rename_tree_done", "", "INSERT", true)
	f.excess("rename_tree_done")
	f.request(func(w http.ResponseWriter, r *http.Request) { update.UpdateRowHandler(w, r, "system_db_tables") }, fmt.Sprintf(`{"id":%d,"column":"table_name","value":"rename_generic_done"}`, id), 200)
	f.assertUID("rename_generic_done", uid)
	f.privilege("rename_generic_done", "", "DELETE", false)
	f.privilege("rename_generic_done", "", "INSERT", true)
	var afterOID int64
	if err := f.owner.QueryRow(`SELECT 'rename_generic_done'::regclass::oid`).Scan(&afterOID); err != nil || afterOID != oid {
		t.Fatal("physical identity changed", afterOID, oid, err)
	}
}

func TestConsistencyRepairReconcilesFormerBlockerPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	uid := f.create("repair_hook", "")
	var validIDs pq.Int64Array
	if err := f.owner.QueryRow(`SELECT array_agg(r.id ORDER BY r.id)
 FROM system_foreign_key_relations_1_m r
 JOIN system_db_tables target ON target.table_uid=r.target_table_uid
 WHERE r.source_table_uid=$1`, uid).Scan(&validIDs); err != nil || len(validIDs) == 0 {
		t.Fatal("creation fixture has no valid relation", err)
	}
	assertCreationRelations := func() {
		t.Helper()
		for _, id := range validIDs {
			if !f.rowExists("system_foreign_key_relations_1_m", id) {
				t.Fatal("valid creation relation was deleted by repair", id)
			}
		}
	}
	f.excess("repair_hook")
	FixtureExec(t, f.owner, fmt.Sprintf(`SET session_replication_role=replica;
 INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,source_column_name,target_column_name)
 VALUES(%d,999999999,'id','id'); SET session_replication_role=origin`, uid))
	id := f.relationID("repair_hook", 999999999)
	f.request(system_table_tools.FixDatabaseConsistencyHandler, fmt.Sprintf(`{"fix_ids":["cat5_1m_%d"]}`, id), 200)
	if f.rowExists("system_foreign_key_relations_1_m", id) {
		t.Fatal("dangling row survived repair")
	}
	assertCreationRelations()
	f.privilege("repair_hook", "", "DELETE", false)
	// A mistaken or stale ID must not remove a valid creation relation either.
	rec := f.request(system_table_tools.FixDatabaseConsistencyHandler, fmt.Sprintf(`{"fix_ids":["cat5_1m_%d"]}`, validIDs[0]), 200)
	assertCreationRelations()
	if !strings.Contains(rec.Body.String(), `"fixed":0`) {
		t.Fatal("valid relation was not skipped", rec.Body)
	}
	// A malformed later repair rolls back the earlier deletion too.
	FixtureExec(t, f.owner, fmt.Sprintf(`SET session_replication_role=replica;
 INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,source_column_name,target_column_name)
 VALUES(%d,999999999,'id','id'); SET session_replication_role=origin`, uid))
	id = f.relationID("repair_hook", 999999999)
	f.request(system_table_tools.FixDatabaseConsistencyHandler, fmt.Sprintf(`{"fix_ids":["cat5_1m_%d","unsupported"]}`, id), 500)
	if !f.rowExists("system_foreign_key_relations_1_m", id) {
		t.Fatal("failed repair partially committed")
	}
	assertCreationRelations()
}

func TestAutomationRenameHooksPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	f.create("automation_rename_source", "")
	f.create("automation_rename_destination", "")
	f.right("automation_rename_source", "/api/add-row-multipart")
	f.request(triggers.CreateTriggerHandler, `{"source_dataset":"automation_rename_source","target_dataset":"automation_rename_destination","condition":"true","action_values":"{\"title\":\"rename proof\"}"}`, 201)
	var automationID int64
	if err := f.owner.QueryRow(`SELECT id FROM system_triggers WHERE source_table=$1 AND target_table=$2`, "automation_rename_source", "automation_rename_destination").Scan(&automationID); err != nil {
		t.Fatal(err)
	}
	source, destination := "automation_rename_source", "automation_rename_destination"
	for _, step := range []struct {
		source, tree bool
		name         string
	}{
		{true, true, "automation_source_tree"},
		{false, true, "automation_destination_tree"},
		{true, false, "automation_source_generic"},
		{false, false, "automation_destination_generic"},
	} {
		oldName := destination
		if step.source {
			oldName = source
		}
		id := f.treeID(oldName)
		if step.tree {
			f.request(folders.HandleRenameTreeNode, fmt.Sprintf(`{"item_id":%d,"item_type":"table","new_name":%q}`, id, step.name), 200)
		} else {
			f.request(func(w http.ResponseWriter, r *http.Request) { update.UpdateRowHandler(w, r, "system_db_tables") }, fmt.Sprintf(`{"id":%d,"column":"table_name","value":%q}`, id, step.name), 200)
		}
		if step.source {
			source = step.name
		} else {
			destination = step.name
		}
		var follows bool
		if err := f.owner.QueryRow(`SELECT source_table=$2 AND target_table=$3 FROM system_triggers WHERE id=$1`, automationID, source, destination).Scan(&follows); err != nil || !follows {
			t.Fatal("automation endpoints did not follow rename", step.name, err)
		}
		f.privilege(destination, "", "INSERT", true)
	}
}

func TestDDLReconciliationFailureRollsBackSchemaAndMetadataPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	f.create("rollback_hook", "")
	f.create("rollback_target", "")
	FixtureExec(t, f.owner, `GRANT DELETE ON rollback_hook TO PUBLIC`)
	// PUBLIC's inherited write cannot be removed from a single runtime role.
	f.request(workflows.ModifyColumnsHandler, `{"dataset_name":"rollback_hook","added_columns":[{"new_name":"refused_extra","data_type":"TEXT"}]}`, 500)
	var exists bool
	if err := f.owner.QueryRow(`SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='rollback_hook'::regclass AND attname='refused_extra' AND NOT attisdropped)`).Scan(&exists); err != nil || exists {
		t.Fatal("failed grant check committed column", err)
	}
	f.request(triggers.CreateTriggerHandler, `{"source_dataset":"rollback_hook","target_dataset":"rollback_target","condition":"true","action_values":"{\"title\":\"refused\"}"}`, 500)
	if err := f.owner.QueryRow(`SELECT EXISTS(SELECT 1 FROM system_triggers WHERE source_table='rollback_hook')`).Scan(&exists); err != nil || exists {
		t.Fatal("failed grant check committed trigger", err)
	}
	FixtureExec(t, f.owner, `REVOKE DELETE ON rollback_hook FROM PUBLIC`)
	// Unreviewed physical side effects refuse a DDL request and preserve grants.
	FixtureExec(t, f.owner, `CREATE FUNCTION unreviewed_hook() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
 CREATE TRIGGER unreviewed BEFORE INSERT ON rollback_hook FOR EACH ROW EXECUTE FUNCTION unreviewed_hook()`)
	before := ACLFingerprint(t, f.owner)
	f.request(folders.HandleRenameTreeNode, fmt.Sprintf(`{"item_id":%d,"item_type":"table","new_name":"refused_rename"}`, f.treeID("rollback_hook")), 409)
	f.request(drop.DropTableHandler, `{"dataset_name":"rollback_hook","confirm_dataset_name":"rollback_hook"}`, 409)
	if err := f.owner.QueryRow(`SELECT to_regclass('rollback_hook') IS NOT NULL AND to_regclass('refused_rename') IS NULL`).Scan(&exists); err != nil || !exists || ACLFingerprint(t, f.owner) != before {
		t.Fatal("refused DDL left mutations", err)
	}
	// Account writes remain hard-denied, including custom quoted basic identity.
	var writes bool
	if err := f.owner.QueryRow(`SELECT has_table_privilege($1,'system_users','UPDATE')`, f.roles.Names["basic"]).Scan(&writes); err != nil || writes {
		t.Fatal("account write acquired", err)
	}
}
