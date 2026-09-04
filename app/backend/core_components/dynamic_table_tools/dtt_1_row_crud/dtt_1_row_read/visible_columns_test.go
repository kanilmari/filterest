// visible_columns_test.go
// Verifies the boundary between view presentation and required row transport data.
// Exists so hiding the id field visually cannot silently break row actions.
package dtt_1_row_read

import (
	"reflect"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestAppendRequiredClientTransportColumnUIDsAddsHiddenID(t *testing.T) {
	columns := map[int]dtt_models.ColumnInfo{
		10: {ColumnUid: 10, ColumnName: "id"},
		20: {ColumnUid: 20, ColumnName: "title"},
	}
	got := appendRequiredClientTransportColumnUIDs(columns, []int{20})
	if !reflect.DeepEqual(got, []int{20, 10}) {
		t.Fatalf("transport columns = %#v, want title plus id", got)
	}
}

func TestAppendRequiredClientTransportColumnUIDsDoesNotDuplicateID(t *testing.T) {
	columns := map[int]dtt_models.ColumnInfo{
		10: {ColumnUid: 10, ColumnName: "id"},
		20: {ColumnUid: 20, ColumnName: "title"},
	}
	got := appendRequiredClientTransportColumnUIDs(columns, []int{10, 20})
	if !reflect.DeepEqual(got, []int{10, 20}) {
		t.Fatalf("transport columns = %#v, want unchanged selection", got)
	}
}

func TestFilterTransportOnlyColumnsFromPresentationHidesIDButKeepsOtherColumns(t *testing.T) {
	got := filterTransportOnlyColumnsFromPresentation(
		[]string{"title", "id", "created"},
		[]string{"title", "created"},
	)
	if !reflect.DeepEqual(got, []string{"title", "created"}) {
		t.Fatalf("presentation columns = %#v, want hidden transport id omitted", got)
	}
}

func TestFilterTransportOnlyColumnsFromPresentationKeepsVisibleID(t *testing.T) {
	got := filterTransportOnlyColumnsFromPresentation(
		[]string{"title", "id"},
		[]string{"id", "title"},
	)
	if !reflect.DeepEqual(got, []string{"title", "id"}) {
		t.Fatalf("presentation columns = %#v, want visible id retained", got)
	}
}
