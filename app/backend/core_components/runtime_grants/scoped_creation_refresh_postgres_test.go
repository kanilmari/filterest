// scoped_creation_refresh_postgres_test.go
// Creates a dataset beside unrelated authored column metadata.
// Connects the real creation handler and bootstrap to the scoped refresh rule.
// Proves one creation cannot silently repair another dataset's metadata.
package runtime_grants_test

import (
	"easelect/backend/core_components/runtime_grants"
	"testing"
)

func TestDatasetCreationLeavesUnrelatedMetadataUntouchedPostgres(t *testing.T) {
	fixture := newMutationHooksFixture(t)
	uid := fixture.create("unrelated_metadata", "")
	runtime_grants.FixtureExec(t, fixture.owner, `UPDATE system_column_details SET co_number=999, data_type='authored diagnostic'
 WHERE table_uid=$1 AND column_name='title'`, uid)
	fixture.create("scoped_created", "")
	var order int
	var dataType string
	if err := fixture.owner.QueryRow(`SELECT co_number,data_type FROM system_column_details
 WHERE table_uid=$1 AND column_name='title'`, uid).Scan(&order, &dataType); err != nil {
		t.Fatal(err)
	}
	if order != 999 || dataType != "authored diagnostic" {
		t.Fatalf("creation refreshed unrelated metadata: order=%d type=%q", order, dataType)
	}
	fixture.privilege("scoped_created", "", "SELECT", true)
}
