// contract_reader.go
// Embeds the article presentation vocabulary shared with the browser.
// Connects future independent routes with explicit current compatibility routes.
// Reserves the page presentation without registering or enabling it.
package article_presentations

import (
	_ "embed"
	"encoding/json"
)

//go:embed contract.json
var source []byte

// Presentation distinguishes the approved route from today's compatibility gate.
type Presentation struct {
	Reserved               bool     `json:"reserved"`
	PermissionRoute        string   `json:"permission_route"`
	CurrentPermissionRoute *string  `json:"current_permission_route"`
	LegacySectionKey       *string  `json:"legacy_section_key"`
	Blocks                 []string `json:"blocks"`
}

// Contract is immutable source policy, not dataset settings or a view registration.
type Contract struct {
	Version                int                     `json:"version"`
	Presentations          map[string]Presentation `json:"presentations"`
	Aliases                map[string]string       `json:"aliases"`
	Blocks                 []string                `json:"blocks"`
	AbsentBlockInitialOpen bool                    `json:"absent_block_initial_open"`
	OpenerDefaults         map[string]string       `json:"opener_defaults"`
}

// Read returns a separate value so callers cannot mutate another reader's policy.
func Read() Contract {
	var result Contract
	if err := json.Unmarshal(source, &result); err != nil {
		panic(err)
	}
	return result
}
