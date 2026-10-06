// definitions.go
// Embeds the one catalogue of duration settings and their stored field names.
// Connects the browser input and server registry through immutable JSON data.
// Exists so adding a duration setting does not duplicate its bounds or format.
package setting_durations

import (
	_ "embed"
	"encoding/json"

	"easelect/backend/reusable_components/setting_duration"
)

//go:embed definitions.json
var source []byte

// Definitions returns an independent copy so callers cannot change shared rules.
func Definitions() map[string]setting_duration.Definition {
	var catalog struct {
		Settings map[string]setting_duration.Definition `json:"settings"`
	}
	if err := json.Unmarshal(source, &catalog); err != nil {
		panic(err)
	}
	return catalog.Settings
}
