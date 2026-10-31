// front_page_box_merge.go
// Matches administrator box inputs with stable identities before any writes.
// Connects the legacy dataset-only editor and the newer partial box-id API to one writer.
// Preserves omitted fields and refuses ambiguous matches rather than losing saved definitions.
package system_table_tools

import "encoding/json"

func (input frontPageBlockInput) has(key string) bool {
	if input.present != nil {
		_, exists := input.present[key]
		return exists
	}
	switch key {
	case "title":
		return input.Title != nil
	case "query":
		return input.Query != nil
	case "category_links":
		return input.CategoryLinks != nil
	default:
		return true
	}
}

func mergeFrontPageBlockInputs(inputs []frontPageBlockInput, existing []frontPageBlock) ([]frontPageBlock, error) {
	byID := map[int64]frontPageBlock{}
	byDataset := map[string][]frontPageBlock{}
	for _, block := range existing {
		byID[block.ID] = block
		byDataset[block.Dataset] = append(byDataset[block.Dataset], block)
	}
	used := map[int64]bool{}
	explicit := map[int64]bool{}
	for _, input := range inputs {
		if input.ID > 0 {
			explicit[input.ID] = true
		}
	}
	positions := map[int]bool{}
	blocks := make([]frontPageBlock, 0, len(inputs))
	for _, input := range inputs {
		block := frontPageBlock{Dataset: input.Dataset, ResultLimit: 3, Enabled: true, CategoryLinks: 3, Query: json.RawMessage(`{}`)}
		if input.ID > 0 {
			var exists bool
			block, exists = byID[input.ID]
			if !exists {
				return nil, errFrontPageInput
			}
		} else if matches := byDataset[input.Dataset]; len(matches) == 1 && !explicit[matches[0].ID] {
			block = matches[0]
		} else if len(matches) > 1 {
			// A modern list can append a new box once existing duplicates all have ids.
			for _, match := range matches {
				if !explicit[match.ID] {
					return nil, errFrontPageInput
				}
			}
		}
		if block.ID > 0 && used[block.ID] {
			return nil, errFrontPageInput
		}
		if input.has("dataset") {
			block.Dataset = input.Dataset
		}
		if input.has("result_limit") {
			block.ResultLimit = input.ResultLimit
		}
		if input.has("sort_order") {
			block.SortOrder = input.SortOrder
		}
		if input.has("enabled") {
			block.Enabled = input.Enabled
		}
		if input.has("title") {
			block.Title = input.Title
		}
		if input.has("query") {
			block.Query = input.Query
		}
		if input.CategoryLinks != nil {
			block.CategoryLinks = *input.CategoryLinks
		}
		if block.Dataset == "" || block.ResultLimit < 1 || block.ResultLimit > 20 || block.SortOrder < 1 || block.SortOrder > 100 || positions[block.SortOrder] {
			return nil, errFrontPageInput
		}
		used[block.ID], positions[block.SortOrder] = true, true
		blocks = append(blocks, block)
	}
	return blocks, nil
}
