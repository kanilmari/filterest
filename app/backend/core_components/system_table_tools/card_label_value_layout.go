// card_label_value_layout.go
// Distinguishes inherited, explicit and omitted column label/value settings.
// Connects card-visibility JSON requests with the existing authorized metadata update.
// Prevents older clients from clearing a stored layout and rejects unknown values.
package system_table_tools

import (
	"encoding/json"
	"fmt"
)

// UnmarshalJSON preserves whether the optional layout was sent at all.
// Existing clients omit it; an explicit null restores the renderer's prior default.
func (column *CardVisibilityColumn) UnmarshalJSON(data []byte) error {
	type plainColumn CardVisibilityColumn
	var decoded plainColumn
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*column = CardVisibilityColumn(decoded)
	_, column.labelValueLayoutProvided = fields["label_value_layout"]
	return nil
}

func validateLabelValueLayout(value *string) error {
	if value == nil {
		return nil
	}
	switch *value {
	case "auto", "inline", "stacked":
		return nil
	default:
		return fmt.Errorf("invalid label_value_layout: use auto, inline, stacked or null")
	}
}
