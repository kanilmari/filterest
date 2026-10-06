// cache_target_lifecycle_postgres_test.go
// Proves both rename routes carry real image configurations and independent caches.
// Uses the existing bootstrap fixture and committed HTTP transaction boundary.
// A dropped cache-only destination leaves every surviving relation valid.
package runtime_grants_test

import (
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	drop "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	assets "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	. "easelect/backend/core_components/runtime_grants"
	"fmt"
	"net/http"
	"testing"
)

func TestImageAndIndependentCacheTargetsFollowRenameAndDropPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	f.create("cache_parent", "")
	f.right("cache_parent", "/api/add-row-multipart")
	f.request(assets.EnableImageAssetLinkingHandler, `{"parent_table":"cache_parent"}`, 201)
	relationID := f.relationID("cache_parent_assets")
	assertTarget := func(name string, want bool) {
		t.Helper()
		var present bool
		err := f.owner.QueryRow(`SELECT EXISTS(SELECT 1 FROM system_foreign_key_relations_1_m r,
		 LATERAL (SELECT value FROM jsonb_array_elements(r.target_insert_specs->'file_upload'->'cache_targets')
		 UNION ALL SELECT target FROM jsonb_each(r.target_insert_specs->'file_upload'->'profiles') p,
		 jsonb_array_elements(p.value->'cache_targets') target) targets
		 WHERE r.id=$1 AND targets.value->>'table'=$2)`, relationID, name).Scan(&present)
		if err != nil || present != want {
			t.Fatal("cache target", name, present, want, err)
		}
	}
	rename := func(old, name string, tree bool) {
		t.Helper()
		id := f.treeID(old)
		if tree {
			f.request(folders.HandleRenameTreeNode, fmt.Sprintf(`{"item_id":%d,"item_type":"table","new_name":%q}`, id, name), 200)
		} else {
			f.request(func(w http.ResponseWriter, r *http.Request) { update.UpdateRowHandler(w, r, "system_db_tables") }, fmt.Sprintf(`{"id":%d,"column":"table_name","value":%q}`, id, name), 200)
		}
		assertTarget(old, false)
		assertTarget(name, true)
		// Root and image profile both retain the renamed parent's destination.
		var copies int
		if err := f.owner.QueryRow(`SELECT (SELECT count(*) FROM jsonb_array_elements(target_insert_specs->'file_upload'->'cache_targets') v WHERE v->>'table'=$2)+
		 (SELECT count(*) FROM jsonb_array_elements(target_insert_specs->'file_upload'->'profiles'->'image'->'cache_targets') v WHERE v->>'table'=$2)
		 FROM system_foreign_key_relations_1_m WHERE id=$1`, relationID, name).Scan(&copies); err != nil || copies != 2 {
			t.Fatal("cache target copies", copies, err)
		}
	}
	rename("cache_parent", "cache_parent_tree", true)
	rename("cache_parent_tree", "cache_parent_generic", false)
	f.create("cache_only", `,{"name":"cached_image","data_type":"TEXT"}`)
	FixtureExec(t, f.owner, `UPDATE system_foreign_key_relations_1_m SET target_insert_specs=jsonb_set(
	 jsonb_set(target_insert_specs,'{file_upload,cache_targets}',target_insert_specs#>'{file_upload,cache_targets}' || '[{"table":"cache_only","column":"cached_image","where":"id = {{parent_id}}"}]'),
	 '{file_upload,profiles,image,cache_targets}',target_insert_specs#>'{file_upload,profiles,image,cache_targets}' || '[{"table":"cache_only","column":"cached_image","where":"id = {{parent_id}}"}]') WHERE id=$1`, relationID)
	rename("cache_only", "cache_only_tree", true)
	rename("cache_only_tree", "cache_only_generic", false)
	f.request(drop.DropTableHandler, `{"dataset_name":"cache_only_generic","confirm_dataset_name":"cache_only_generic"}`, 200)
	assertTarget("cache_only_generic", false)
	assertTarget("cache_parent_generic", true)
	if !f.rowExists("system_foreign_key_relations_1_m", relationID) {
		t.Fatal("surviving image relation removed")
	}
	f.request(assets.UpdateImageAssetLinkingHandler, `{"parent_table":"cache_parent_generic","max_file_size_mb":12}`, 200)
}
