// kind_evidence_schema_invalidation_test.go
// Proves the existing schema metadata invalidation boundary clears kind evidence.
// Connects column/create/drop application paths with a warm scoped reader.
// Prevents the evidence cache from drifting away from the row metadata contract.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dataset_kinds/kindtest"
	"testing"
)

func TestKindEvidenceSchemaInvalidationRefreshesWarmReader(t *testing.T) {
	read := kindtest.WarmProbe(t)
	read(1)
	read(1)
	// ModifyColumnsHandler, creation completion and DropTableHandler call this
	// exact boundary after commit, even for a child affecting a different host.
	InvalidateSchemaCache("changed_child")
	read(2)
}
