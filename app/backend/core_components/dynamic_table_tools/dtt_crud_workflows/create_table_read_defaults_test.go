// create_table_read_defaults_test.go
// Pins the creation-time read contract separately for guests and signed-in users.
// Connects the permission seeder's policy to the six ordinary reading capabilities.
// Prevents paid AI capabilities from silently returning to the public default.
package dtt_crud_workflows

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"slices"
	"testing"
)

func TestDatasetReadDefaultsKeepGuestAIOptIn(t *testing.T) {
	ordinary := []string{
		"dtt_1_row_read.GetResultsHandlerWrapper",
		"dtt_1_row_read.GetRowCountHandlerWrapper",
		"dtt_1_row_read.GetFilterOptionsHandler",
		"dtt_1_row_read.GetDynamicChildItemsHandler",
		"dtt_2_column_crud.GetTableColumnsHandler",
		"dtt_3_table_read.GetTableViewHandlerWrapper",
	}
	if got := datasetReadFunctionNames(false); !reflect.DeepEqual(got, ordinary) {
		t.Fatalf("guest default = %v; want ordinary reads %v", got, ordinary)
	}
	users := datasetReadFunctionNames(true)
	if len(users) != len(ordinary)+2 {
		t.Fatalf("signed-in reader bundle changed: %v", users)
	}
	for _, name := range append(ordinary, "dtt_1_row_read.GetIntelligentResultsHandlerWrapper", "dtt_1_row_read.GetResultsVector") {
		if !slices.Contains(users, name) {
			t.Errorf("signed-in reader lost %s", name)
		}
	}
}

// The editor owns its permission diff in JavaScript; creation seeds the same
// bundles in Go. Pin the mirrored exports to the actual creation function so a
// change on either side cannot silently grant guest AI or show full read as partial.
func TestDatasetEditorReadBundlesMatchCreationDefaults(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate the creation-default test")
	}
	editorPath := filepath.Join(filepath.Dir(currentFile), "../../../../frontend/core_components/general_tables/dataset_form/dataset_group_read_access.js")
	editor, err := os.ReadFile(editorPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, bundle := range []struct {
		name      string
		includeAI bool
	}{
		{"DATASET_GUEST_READ_FUNCTION_NAMES", false},
		{"DATASET_READ_FUNCTION_NAMES", true},
	} {
		t.Run(bundle.name, func(t *testing.T) {
			pattern := `export const ` + bundle.name + ` = Object\.freeze\(\[([\s\S]*?)\]\);`
			definition := regexp.MustCompile(pattern).FindSubmatch(editor)
			if len(definition) != 2 {
				t.Fatalf("cannot find the editor's literal %s bundle", bundle.name)
			}
			var names []string
			for _, match := range regexp.MustCompile(`"([^"]+)"`).FindAllSubmatch(definition[1], -1) {
				names = append(names, string(match[1]))
			}
			if want := datasetReadFunctionNames(bundle.includeAI); !reflect.DeepEqual(names, want) {
				t.Fatalf("editor %s = %v; creation defaults = %v", bundle.name, names, want)
			}
		})
	}
}
