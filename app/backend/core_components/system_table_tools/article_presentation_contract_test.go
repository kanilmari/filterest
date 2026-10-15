// article_presentation_contract_test.go
// Checks the server's unchanged legacy section API against the shared vocabulary.
// Connects source-owned canonical blocks with compatibility storage names.
// Ensures adding a reserved presentation cannot accidentally enable API writes.
package system_table_tools

import (
	"reflect"
	"testing"

	contract "easelect/frontend/shared/article_presentations"
)

func TestArticlePresentationContractDrift(t *testing.T) {
	rules := contract.Read()
	for alias, key := range rules.Aliases {
		_, actual, err := validateViewFieldSetTarget("example", alias)
		if err != nil || actual != key {
			t.Fatalf("field-settings alias drift: %s", alias)
		}
	}
	for key, presentation := range rules.Presentations {
		if presentation.PermissionRoute != "/ui/view/"+key {
			t.Fatalf("route drift: %s", key)
		}
		if presentation.LegacySectionKey != nil {
			if !reflect.DeepEqual(articleSupportedSections(*presentation.LegacySectionKey), presentation.Blocks) {
				t.Fatalf("section drift: %s", key)
			}
			response := articleSectionDefaultsResponse("example", *presentation.LegacySectionKey, nil, false)
			for _, value := range response.InitialOpen {
				if value != rules.AbsentBlockInitialOpen {
					t.Fatal("absent block default drift")
				}
			}
		}
		if len(articleSupportedSections(key)) != 0 {
			t.Fatalf("canonical key enabled prematurely: %s", key)
		}
	}
}
