// article_presentation_contract_test.go
// Checks canonical section storage and compatibility names against the vocabulary.
// Connects the storage batch with the source-owned presentation contract.
// Keeps block support independent from later renderer and activation delivery.
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
		if !reflect.DeepEqual(articleSupportedSections(key), presentation.Blocks) {
			t.Fatalf("canonical block drift: %s", key)
		}
	}
}
