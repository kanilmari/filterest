// initial_card_roles_test.go
// Proves stable creation defaults and deliberate administrator role choices.
// Connects physical column declarations with the Card visibility metadata map.
// Prevents inferred headers from selecting credentials or actor references.
package dtt_3_table_create

import (
	"reflect"
	"testing"
)

func TestInitialCardRoles(t *testing.T) {
	columns := []ColumnDefinition{{"id", "SERIAL"}, {"api_key", "TEXT"},
		{"title", "TEXT NOT NULL"}, {"display_name", "VARCHAR(80)"}, {"content", "TEXT"},
		{"description", "TEXT"}, {"created_by", "INTEGER"}, {"owner_id", "BIGINT"}}
	want := map[string]string{"id": "details", "api_key": "details", "title": "header",
		"display_name": "details", "content": "description", "description": "details",
		"created_by": "hidden", "owner_id": "hidden"}
	if got := InitialCardRoles(columns, nil); !reflect.DeepEqual(got, want) {
		t.Fatalf("roles=%v want=%v", got, want)
	}
	explicit := map[string]string{"title": "hidden", "display_name": "header+lang_key", "content": "details", "description": "description2"}
	got := InitialCardRoles(columns, explicit)
	for name, role := range explicit {
		if got[name] != role {
			t.Fatalf("explicit %s=%s became %s", name, role, got[name])
		}
	}
	if explicit["id"] != "" {
		t.Fatal("defaults mutated the caller's explicit choices")
	}
}

func TestInitialCardRolesOnlyTextNamesAndOneDescription(t *testing.T) {
	for _, kind := range []string{"JSONB", "INTEGER", "BYTEA", "VECTOR"} {
		roles := InitialCardRoles([]ColumnDefinition{{"name", kind}, {"otsikko", "TEXT"}, {"kuvaus", "TEXT"}}, nil)
		if roles["name"] != "details" || roles["otsikko"] != "header" || roles["kuvaus"] != "description" {
			t.Fatalf("%s: %v", kind, roles)
		}
	}
	roles := InitialCardRoles([]ColumnDefinition{{"a", "TEXT"}, {"b", "TEXT"}, {"title", "TEXT"}}, map[string]string{"a": "header", "b": "header"})
	if roles["a"] != "header" || roles["b"] != "header" || roles["title"] != "details" {
		t.Fatalf("multiple configured headers=%v", roles)
	}
}
