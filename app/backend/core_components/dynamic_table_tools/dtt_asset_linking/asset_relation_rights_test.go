// asset_relation_rights_test.go
// Checks existing ordinary and configured relations at the linking boundary.
// Reuses the asset handler driver and returned-error contract.
// A query failure must never become an invitation to create a second relation.
package dtt_asset_linking

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
)

func TestExistingAssetRelationSeedsOnlyAtFirstLink(t *testing.T) {
	for _, spec := range []driver.Value{nil, `{"file_upload":{"filename_column":"filename","profiles":{"image":{}}}}`} {
		db, state := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
			{match: "fk.target_insert_specs::text", cols: []string{"id", "parent", "fk", "specs"}, rows: [][]driver.Value{{int64(30), "parent", "parent_id", spec}}},
			{match: "SELECT table_uid", cols: []string{"uid"}, rows: [][]driver.Value{{int64(20)}}},
		}, []imageAssetLinkingExecResponse{{match: "INSERT INTO system_group_table_func_rights", rowsAffected: 1}, {match: "UPDATE system_foreign_key_relations_1_m", rowsAffected: 1}})
		status, reused, err := EnsureSharedAssetRelation(db, "parent", 10, BuildImageFileUploadConfig("parent", 10, nil))
		if err != nil || !reused || status.RelationID != 30 {
			t.Fatal(status, reused, err)
		}
		if err := SaveFileUploadConfigByRelationID(db, 30, status.UploadConfig); err != nil {
			t.Fatal(err)
		}
		seeds := 0
		for _, call := range state.calls {
			if strings.Contains(call.query, "INSERT INTO system_group_table_func_rights") {
				seeds++
			}
			if strings.Contains(call.query, "GRANT") {
				t.Fatal("physical ACL copied", call.query)
			}
		}
		want := 0
		if spec == nil {
			want = 1
		}
		if seeds != want {
			t.Fatal("rights seeding", seeds, want)
		}
	}
}
func TestAssetRelationLookupPreservesDatabaseErrors(t *testing.T) {
	failure := errors.New("catalogue read failed")
	db, state := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{{match: "fk.target_insert_specs::text", err: failure}}, nil)
	_, _, err := EnsureSharedAssetRelation(db, "parent", 10, FileUploadConfig{})
	if !errors.Is(err, failure) || len(state.calls) != 0 {
		t.Fatal("lookup failure tried to create relation", err, state.calls)
	}
}
func TestAssetConfigurationRefusesMissingRelation(t *testing.T) {
	db, _ := openImageLinkingMockDB(t, nil, []imageAssetLinkingExecResponse{{match: "UPDATE system_foreign_key_relations_1_m", rowsAffected: 0}})
	if err := SaveFileUploadConfigByRelationID(db, 99, FileUploadConfig{}); err == nil {
		t.Fatal("missing relation reported success")
	}
}
