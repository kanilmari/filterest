// declared_names_test.go
// Verifies finite declaration parsing and chained schema naming without a database.
// Connects author mistakes to explicit scan failures rather than silent lost evidence.
// Protects exact owner attribution, bounded values and independent catalogue copies.
package lang_key_naming

import (
	"reflect"
	"testing"
)

func TestDeclaredNamesAreFiniteAndFileOwned(t *testing.T) {
	for _, item := range []struct {
		json  string
		names []string
	}{
		{`{"build":"prefix + value","prefix":"notice_email_","values":["sent","failed"]}`, []string{"notice_email_sent", "notice_email_failed"}},
		{`{"build":"prefix + value","prefix":"error_trigger_","values":["source","target"],"suffix":"_dataset_missing"}`, []string{"error_trigger_source_dataset_missing", "error_trigger_target_dataset_missing"}},
		{`{"build":"copy(key)","keys":["media_library_choose","media_library_close"]}`, []string{"media_library_choose", "media_library_close"}},
	} {
		d, err := ParseDeclaration("private/backend/owner.go", DeclarationMarker+item.json)
		if err != nil || d.Owner != "private/backend/owner.go" || !reflect.DeepEqual(d.Names(), item.names) {
			t.Fatal(d, err)
		}
		names := d.Names()
		names[0] = "tampered"
		if d.Names()[0] == "tampered" {
			t.Fatal("caller changed declaration")
		}
	}
	for _, invalid := range []string{
		`{}`, `{"build":" ","keys":["k"]}`, `{"build":"x","prefix":"all_"}`, `{"build":"x","keys":["*"]}`,
		`{"build":"x","prefix":"p_","values":[""]}`, `{"build":"x","keys":["k"],"prefix":"p_","values":["v"]}`,
		`{"build":"x","schema":"all_names"}`, `{"build":"x","keys":["k"],"unknown":true}`, `{"build":"x","keys":["k"]} {}`,
	} {
		if _, err := ParseDeclaration("owner.js", DeclarationMarker+invalid); err == nil {
			t.Errorf("accepted %s", invalid)
		}
	}
}

func TestLinkedSchemaNamesStripChainedEndings(t *testing.T) {
	for key, want := range map[string]string{
		"owner_name (ln)":                "owner_name (ln)",
		"search_for_owner_name (ln)_asc": "owner_name (ln)",
		"name (ln)":                      "name (ln)",
	} {
		if got := LinkedSchemaAlias(key); got != want {
			t.Errorf("%s: %v != %v", key, got, want)
		}
	}
	for _, key := range []string{"search_for_owner_name (ln 12)_desc", "owner_name", "other_owner_name (ln)_unknown", "owner_name (ln 0)", "owner_name (lnx)", " (ln)"} {
		if got := LinkedSchemaAlias(key); got != "" {
			t.Errorf("unrelated schema name %q: %v", key, got)
		}
	}
}
