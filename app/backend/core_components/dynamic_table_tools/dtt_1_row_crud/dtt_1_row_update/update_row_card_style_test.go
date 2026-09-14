// update_row_card_style_test.go
// Verifies nullable dataset card-style edits before generic text conversion.
// Connects ordinary row-edit payloads to the same override contract as card settings.
// Preserves inheritance and prevents arbitrary style values entering metadata.
package dtt_1_row_update

import (
	"encoding/json"
	"testing"
)

func TestDatasetCardStyleRowUpdateContract(t *testing.T) {
	for _, value := range []string{"null", `"standard"`, `"modern"`} {
		t.Run(value, func(t *testing.T) {
			var request updateRowRequest
			if err := json.Unmarshal([]byte(`{"id":1,"column":"card_style_variant","value":`+value+"}"), &request); err != nil {
				t.Fatal(err)
			}
			updates, err := normalizeUpdateOperations(request)
			if err != nil || len(updates) != 1 {
				t.Fatalf("operations=%v, error=%v", updates, err)
			}
			if err := validateCardStyleUpdate("system_db_tables", updates[0]); err != nil {
				t.Fatal(err)
			}
			converted, err := convertValue(updates[0].Value, "character varying")
			if err != nil {
				t.Fatal(err)
			}
			if value == "null" && converted != nil {
				t.Fatalf("null became %v", converted)
			}
			if value != "null" && converted != updates[0].Value {
				t.Fatalf("explicit style changed: %v", converted)
			}
		})
	}
	for _, value := range []interface{}{"", "floating", "Modern", " modern ", true, float64(1), []interface{}{}, map[string]interface{}{}} {
		if err := validateCardStyleUpdate("system_db_tables", updateRowFieldUpdate{Column: "card_style_variant", Value: value}); err == nil {
			t.Fatalf("invalid style accepted: %#v", value)
		}
	}
	var omitted updateRowRequest
	if err := json.Unmarshal([]byte(`{"id":1,"column":"card_style_variant"}`), &omitted); err == nil {
		t.Fatal("omitted value must not clear inheritance")
	}
}

func TestCardStyleRowValidationDoesNotConstrainUnrelatedFields(t *testing.T) {
	for _, test := range []struct{ table, column string }{
		{"example", "card_style_variant"}, {"system_db_tables", "table_name"}, {"system_db_tables", "card_details_layout"},
	} {
		if err := validateCardStyleUpdate(test.table, updateRowFieldUpdate{Column: test.column, Value: "unrelated"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDatasetCardDetailColumnsRowUpdateContract(t *testing.T) {
	for _, raw := range []string{"null", "1", "2", "3", "4"} {
		var request updateRowRequest
		if err := json.Unmarshal([]byte(`{"id":1,"column":"card_detail_columns","value":`+raw+"}"), &request); err != nil {
			t.Fatal(err)
		}
		updates, err := normalizeUpdateOperations(request)
		if err != nil || len(updates) != 1 {
			t.Fatalf("updates=%v, err=%v", updates, err)
		}
		if err := validateCardStyleUpdate("system_db_tables", updates[0]); err != nil {
			t.Fatal(err)
		}
		converted, err := convertValue(updates[0].Value, "integer")
		if err != nil {
			t.Fatal(err)
		}
		if raw == "null" && converted != nil {
			t.Fatalf("null became %v", converted)
		}
	}
	for _, raw := range []string{"0", "5", "2.5", "-1", `"2"`, `""`, "true", "[]", "{}"} {
		var value interface{}
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			t.Fatal(err)
		}
		if err := validateCardStyleUpdate("system_db_tables", updateRowFieldUpdate{Column: "card_detail_columns", Value: value}); err == nil {
			t.Fatalf("invalid count accepted: %s", raw)
		}
	}
	if err := validateCardStyleUpdate("unrelated", updateRowFieldUpdate{Column: "card_detail_columns", Value: "unchanged"}); err != nil {
		t.Fatal(err)
	}
}
