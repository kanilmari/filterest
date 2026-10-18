// heading_order_test.go
// Proves heading order choices through both typed and generic validation paths.
// Shares the source-owned value examples with the browser contract tests.
package dataset_appearance

import (
	"encoding/json"
	"os"
	"testing"
)

func TestDatasetAppearanceHeadingOrderContract(t *testing.T) {
	raw, err := os.ReadFile("../../../testing/shared_contracts/row_group_heading_order.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		Default string
		Valid   []string
		Invalid []any
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	if DefaultConfig().Shared.RowGroupHeadingOrder != contract.Default {
		t.Fatal("wrong default")
	}
	for _, value := range contract.Valid {
		config := DefaultConfig()
		config.Shared.RowGroupHeadingOrder = value
		if err := Validate(config, false); err != nil {
			t.Fatal(err)
		}
		if err := Rules().ValidateLeaf("shared.row_group_heading_order", value, false); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range contract.Invalid {
		config := Rules().Defaults()
		config["shared"]["row_group_heading_order"] = value
		if Validate(config, false) == nil || Rules().ValidateLeaf("shared.row_group_heading_order", value, false) == nil {
			t.Fatalf("invalid choice accepted: %#v", value)
		}
	}
}
