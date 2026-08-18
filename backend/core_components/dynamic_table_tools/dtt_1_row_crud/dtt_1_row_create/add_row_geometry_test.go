// add_row_geometry_test.go
// Verifies missing geometry stays missing and create triggers receive row data.
// Bridges row-create normalization with the PostGIS and trigger safety contracts.
// Exists to prevent false Helsinki locations and ID-only trigger regressions.
package dtt_1_row_create

import "testing"

func TestNormalizeGeometryInsertValueKeepsNullableGeometryMissing(t *testing.T) {
	for _, value := range []interface{}{nil, "", "   "} {
		normalized, err := normalizeGeometryInsertValue(value, true)
		if err != nil {
			t.Fatalf("normalizeGeometryInsertValue(%#v, true) error = %v", value, err)
		}
		if normalized != nil {
			t.Fatalf("normalizeGeometryInsertValue(%#v, true) = %#v, want nil", value, normalized)
		}
	}
}

func TestNormalizeGeometryInsertValueRejectsMissingRequiredGeometry(t *testing.T) {
	if _, err := normalizeGeometryInsertValue("", false); err == nil {
		t.Fatal("normalizeGeometryInsertValue(\"\", false) error = nil, want required-value error")
	}
}

func TestNormalizeGeometryInsertValuePreservesProvidedPoint(t *testing.T) {
	const point = "POINT(24.9384 60.1699)"
	normalized, err := normalizeGeometryInsertValue(point, false)
	if err != nil {
		t.Fatalf("normalizeGeometryInsertValue() error = %v", err)
	}
	if normalized != point {
		t.Fatalf("normalizeGeometryInsertValue() = %#v, want %q", normalized, point)
	}
}

func TestRequiredGeometryValueMissingRejectsOmittedRequiredValue(t *testing.T) {
	if !requiredGeometryValueMissing("location", "USER-DEFINED geometry", "NO", "", "", map[string]interface{}{}) {
		t.Fatal("requiredGeometryValueMissing() = false, want missing required geometry")
	}
	if requiredGeometryValueMissing(
		"location",
		"USER-DEFINED geometry",
		"NO",
		"",
		"",
		map[string]interface{}{"location": "POINT(24.9384 60.1699)"},
	) {
		t.Fatal("requiredGeometryValueMissing() = true for a provided point")
	}
	if requiredGeometryValueMissing("location", "USER-DEFINED geometry", "NO", "generated point", "", map[string]interface{}{}) {
		t.Fatal("requiredGeometryValueMissing() = true for a database-defaulted geometry")
	}
}

func TestMapInsertedRowValuesIncludesDatabaseGeneratedFields(t *testing.T) {
	triggerRow, err := mapInsertedRowValues(
		[]string{"id", "status", "name", "created"},
		[]interface{}{int64(42), "paid", "Invoice 42", "database default"},
	)
	if err != nil {
		t.Fatalf("mapInsertedRowValues() error = %v", err)
	}

	if triggerRow["id"] != int64(42) || triggerRow["status"] != "paid" || triggerRow["name"] != "Invoice 42" || triggerRow["created"] != "database default" {
		t.Fatalf("mapInsertedRowValues() = %#v, want request and database-generated fields", triggerRow)
	}
	if _, err := mapInsertedRowValues([]string{"id"}, nil); err == nil {
		t.Fatal("mapInsertedRowValues() accepted mismatched columns and values")
	}
}
