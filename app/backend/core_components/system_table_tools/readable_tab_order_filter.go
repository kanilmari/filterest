// readable_tab_order_filter.go
// Projects saved navigation order through the catalogue actually returned to a viewer.
// Connects legacy dataset names, unified static IDs and readable dataset identities.
// Drops private names and extra fields, then closes position gaps to hide omitted counts.
package system_table_tools

import (
	"encoding/json"
	"sort"

	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

type catalogueTabOrderEntry struct {
	TabID     string `json:"tab_id"`
	SortOrder int    `json:"sort_order"`
}

// readableTabOrder normalizes aliases to readable canonical identities and permits
// only static tabs supported by main_dataset_tabs.js. The Users shortcut still
// requires its dataset; arbitrary static prefixes cannot smuggle private names.
func readableTabOrder(raw string, datasets []dtt_models.Table) []catalogueTabOrderEntry {
	readableNames := make(map[string]string)
	for _, dataset := range datasets {
		readableNames[dataset.TableName] = dataset.TableName
		for _, name := range dataset.Names {
			readableNames[name] = dataset.TableName
		}
	}
	var saved []struct {
		TabID       string `json:"tab_id"`
		DatasetName string `json:"dataset_name"`
		SortOrder   int    `json:"sort_order"`
	}
	result := make([]catalogueTabOrderEntry, 0)
	if json.Unmarshal([]byte(raw), &saved) != nil {
		return result
	}
	sort.SliceStable(saved, func(i, j int) bool { return saved[i].SortOrder < saved[j].SortOrder })
	seen := make(map[string]bool)
	for _, entry := range saved {
		name := entry.TabID
		if name == "" {
			name = entry.DatasetName
		}
		var tabID string
		switch name {
		case "static:user", "static:register", "static:login", "static:logout":
			tabID = name
		case "static:system_users":
			if readableNames["system_users"] != "" {
				tabID = name
			}
		default:
			tabID = readableNames[name]
		}
		if tabID == "" || seen[tabID] {
			continue
		}
		seen[tabID] = true
		result = append(result, catalogueTabOrderEntry{TabID: tabID, SortOrder: len(result)})
	}
	return result
}
