// asset_mutation_hooks_postgres_test.go
// Checks new/existing asset relations and every configuration completion path.
// Reuses bootstrap creation and real lazy transactions with quoted limited roles.
// Copied application rights are seeded once; configuration never recopies them.
package runtime_grants_test

import (
	assets "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	. "easelect/backend/core_components/runtime_grants"
	"fmt"
	"net/http"
	"testing"
)

func TestAssetLinkingNewExistingAndConfigurationGrantHooksPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	f.create("asset_hook", "")
	f.right("asset_hook", "/api/add-row-multipart")
	f.excess("asset_hook")
	f.request(assets.EnableImageAssetLinkingHandler, `{"parent_table":"asset_hook"}`, 201)
	f.privilege("asset_hook_assets", "", "INSERT", true)
	f.privilege("asset_hook_assets", "", "DELETE", false)
	// Removing one seeded child right makes re-copying observable independently
	// of physical gallery/adoption dependencies from the parent.
	FixtureExec(t, f.owner, `DELETE FROM system_group_table_func_rights r USING system_db_tables d,system_functions fn
 WHERE r.target_table_uid=d.table_uid AND d.table_name='asset_hook_assets' AND r.function_id=fn.id AND fn.url_route_endpoint='/api/add-row-multipart'`)
	assertNotRecopied := func() {
		t.Helper()
		var count int
		if err := f.owner.QueryRow(`SELECT count(*) FROM system_group_table_func_rights r JOIN system_db_tables d ON d.table_uid=r.target_table_uid JOIN system_functions fn ON fn.id=r.function_id WHERE d.table_name='asset_hook_assets' AND fn.url_route_endpoint='/api/add-row-multipart'`).Scan(&count); err != nil || count != 0 {
			t.Fatal("configuration recopied child rights", count, err)
		}
	}
	for _, step := range []struct {
		handler http.HandlerFunc
		body    string
		status  int
	}{
		{assets.EnableImageAssetLinkingHandler, `{"parent_table":"asset_hook"}`, 200},
		{assets.EnableAttachmentLinkingHandler, `{"parent_table":"asset_hook"}`, 201},
		{assets.EnableAttachmentLinkingHandler, `{"parent_table":"asset_hook"}`, 200},
		{assets.UpdateImageAssetLinkingHandler, `{"parent_table":"asset_hook","max_file_size_mb":11}`, 200},
		{assets.DisableImageAssetLinkingHandler, `{"parent_table":"asset_hook"}`, 200},
		{assets.DisableAttachmentLinkingHandler, `{"parent_table":"asset_hook"}`, 200},
	} {
		f.excess("asset_hook_assets")
		f.request(step.handler, step.body, step.status)
		assertNotRecopied()
		f.privilege("asset_hook_assets", "", "DELETE", false)
	}
	// Removing one profile retains the shared relation and its independent rights.
	f.excess("asset_hook_assets")
	f.request(assets.RemoveImageAssetLinkingHandler, `{"parent_table":"asset_hook","confirm":true}`, 200)
	assertNotRecopied()
	f.privilege("asset_hook_assets", "", "DELETE", false)
	f.request(assets.RemoveAttachmentLinkingHandler, `{"parent_table":"asset_hook","confirm":true}`, 200)
	var exists bool
	if err := f.owner.QueryRow(`SELECT to_regclass('asset_hook_assets') IS NOT NULL`).Scan(&exists); err != nil || exists {
		t.Fatal("last profile did not drop child", err)
	}
}

func TestAssetLinkingExistingPlainRelationSeedsRightsOncePostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	parent := f.create("existing_asset_hook", "")
	// Both the physical child and plain relation exist before asset linking.
	child := f.create("existing_asset_hook_assets", `,{"name":"existing_asset_hook_id","data_type":"INTEGER"},{"name":"filename","data_type":"TEXT"},{"name":"asset_kind","data_type":"TEXT"}`)
	FixtureExec(t, f.owner, `INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,source_column_name,target_column_name) VALUES($1,$2,'existing_asset_hook_id','id')`, child, parent)
	f.right("existing_asset_hook", "/api/add-row-multipart")
	id := f.relationID("existing_asset_hook_assets")
	f.request(assets.EnableAttachmentLinkingHandler, `{"parent_table":"existing_asset_hook"}`, 201)
	if got := f.relationID("existing_asset_hook_assets"); got != id {
		t.Fatal("existing relation replaced", got, id)
	}
	f.privilege("existing_asset_hook_assets", "", "INSERT", true)
	FixtureExec(t, f.owner, `DELETE FROM system_group_table_func_rights WHERE target_table_uid=$1`, child)
	f.request(assets.EnableAttachmentLinkingHandler, `{"parent_table":"existing_asset_hook"}`, 200)
	var count int
	if err := f.owner.QueryRow(`SELECT count(*) FROM system_group_table_func_rights WHERE target_table_uid=$1`, child).Scan(&count); err != nil || count != 0 {
		t.Fatal("repeat linking seeded again", count, err)
	}
}

func TestAssetLinkingPolicyRefusalRollsBackNewAndEarlyReturnPathsPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	f.create("refused_asset_hook", "")
	FixtureExec(t, f.owner, `CREATE FUNCTION refused_asset_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
 CREATE TRIGGER refused_asset BEFORE INSERT ON refused_asset_hook FOR EACH ROW EXECUTE FUNCTION refused_asset_trigger()`)
	f.request(assets.EnableImageAssetLinkingHandler, `{"parent_table":"refused_asset_hook"}`, 409)
	var exists bool
	if err := f.owner.QueryRow(`SELECT to_regclass('refused_asset_hook_assets') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='refused_asset_hook'::regclass AND attname='cached_image' AND NOT attisdropped)`).Scan(&exists); err != nil || exists {
		t.Fatal("refused link committed schema", err)
	}
	FixtureExec(t, f.owner, `DROP TRIGGER refused_asset ON refused_asset_hook`)
	f.request(assets.EnableImageAssetLinkingHandler, `{"parent_table":"refused_asset_hook"}`, 201)
	FixtureExec(t, f.owner, `CREATE TRIGGER refused_asset BEFORE INSERT ON refused_asset_hook FOR EACH ROW EXECUTE FUNCTION refused_asset_trigger()`)
	id := f.relationID("refused_asset_hook_assets")
	var before, after string
	if err := f.owner.QueryRow(`SELECT target_insert_specs::text FROM system_foreign_key_relations_1_m WHERE id=$1`, id).Scan(&before); err != nil {
		t.Fatal(err)
	}
	f.request(assets.EnableImageAssetLinkingHandler, `{"parent_table":"refused_asset_hook","max_file_size_mb":99}`, 409)
	if err := f.owner.QueryRow(`SELECT target_insert_specs::text FROM system_foreign_key_relations_1_m WHERE id=$1`, id).Scan(&after); err != nil || after != before {
		t.Fatal("early return committed refused config", err)
	}
	// Keep the refusal key observable to the HTTP caller.
	rec := f.request(assets.EnableAttachmentLinkingHandler, `{"parent_table":"refused_asset_hook"}`, 409)
	if rec.Body.Len() == 0 {
		t.Fatal(fmt.Sprintf("empty refusal for relation %d", id))
	}
}
