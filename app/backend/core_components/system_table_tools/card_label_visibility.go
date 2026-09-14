// card_label_visibility.go
// Preserves raw inherited versus explicit card-label choices at the API boundary.
// Connects compatible effective booleans, nullable overrides and conditional SQL writes.
// Keeps role defaults in the one database resolver and prevents unrelated edits freezing inheritance.
package system_table_tools

import (
	"bytes"
	"encoding/json"
	"fmt"
)

func decodeCardLabelVisibilityPresence(column *CardVisibilityColumn, fields map[string]json.RawMessage) error {
	legacy, legacyProvided := fields["show_key_on_card"]
	override, overrideProvided := fields["show_key_on_card_override"]
	column.showKeyOnCardProvided = legacyProvided
	column.showKeyOnCardOverrideProvided = overrideProvided
	if legacyProvided {
		value := bytes.TrimSpace(legacy)
		if !bytes.Equal(value, []byte("true")) && !bytes.Equal(value, []byte("false")) {
			return fmt.Errorf("show_key_on_card must be a boolean; use show_key_on_card_override null to inherit")
		}
	}
	if overrideProvided {
		value := bytes.TrimSpace(override)
		if !bytes.Equal(value, []byte("true")) && !bytes.Equal(value, []byte("false")) && !bytes.Equal(value, []byte("null")) {
			return fmt.Errorf("show_key_on_card_override must be null or a boolean")
		}
	}
	return nil
}

// An explicit raw choice wins over a legacy effective field. Omission preserves storage.
func cardLabelVisibilityOverrideForWrite(column CardVisibilityColumn) (bool, *bool) {
	if column.showKeyOnCardOverrideProvided {
		return true, column.ShowKeyOnCardOverride
	}
	if column.showKeyOnCardProvided {
		value := column.ShowKeyOnCard
		return true, &value
	}
	return false, nil
}
