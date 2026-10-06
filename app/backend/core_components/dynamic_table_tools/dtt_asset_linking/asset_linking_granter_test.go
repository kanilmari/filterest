// asset_linking_granter_test.go
// Proves rights seeding returns errors and never copies physical ACLs.
// Exercises the existing asset-linking driver at the linking boundary.
// Keeps privilege provisioning exclusively with the runtime grant policy.
package dtt_asset_linking

import (
	"errors"
	"strings"
	"testing"
)

func TestCopyTablePermissionsReturnsErrorsAndSeedsOnlyRights(t *testing.T) {
	for _, failure := range []error{nil, errors.New("rights write failed")} {
		db, state := openImageLinkingMockDB(t, nil, []imageAssetLinkingExecResponse{{match: "INSERT INTO system_group_table_func_rights", rowsAffected: 1, err: failure}})
		err := CopyTablePermissions(db, 10, 20)
		if !errors.Is(err, failure) {
			t.Fatalf("error=%v want %v", err, failure)
		}
		if len(state.calls) != 1 || strings.Contains(state.calls[0].query, "GRANT") || state.calls[0].args[0].Value != int64(20) || state.calls[0].args[1].Value != int64(10) {
			t.Fatal(state.calls)
		}
	}
}
