// display_column_resolver_test.go
// Verifies the established label priorities after extraction from the row utility.
// Links grant dependency columns with the same choices the readers make.
// Protects historical exceptions, case matching and ordinal fallback.
package fk_display

import "testing"

func TestEstablishedDisplayColumnPriorities(t *testing.T) {
	for _, example := range []struct {
		table   string
		columns []string
		want    string
	}{
		{"system_functions", nil, "name"}, {"system_user_groups", nil, "name"}, {"system_db_tables", nil, "table_name"},
		{"content", []string{"description", "title", "name"}, "name"},
		{"content", []string{"description", "TITLE"}, "TITLE"},
		{"content", []string{"description", "item_title", "item_name"}, "item_name"},
		{"content", []string{"description", "header_text", "name_text"}, "name_text"},
		{"content", []string{"description", "body"}, "description"},
	} {
		column, err := Resolve(example.table, example.columns)
		if err != nil || column != example.want {
			t.Fatalf("%s %v: %q %v; want %q", example.table, example.columns, column, err, example.want)
		}
	}
	if _, err := Resolve("numeric_only", nil); err == nil {
		t.Fatal("missing text label was guessed")
	}
}
