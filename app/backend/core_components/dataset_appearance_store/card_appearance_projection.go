// card_appearance_projection.go
// Projects legacy nullable card fields from the appearance override map.
// Connects compatibility readers and writers with canonical leaf persistence.
// Preserves explicit equality and uses null only for inheritance.
package dataset_appearance_store

// CardProjections returns independent nullable values for the legacy read shape.
func CardProjections(overrides map[string]any) (*string, *int) {
	var style *string
	var columns *int
	if value, ok := overrides["shared.card_style_variant"].(string); ok {
		style = &value
	}
	if value, ok := overrides["shared.card_detail_columns"].(float64); ok {
		count := int(value)
		columns = &count
	}
	return style, columns
}

// CardPatch maps explicit null to Unset and keeps omitted fields untouched.
func CardPatch(values map[string]any) DatasetAppearancePatch {
	patch := DatasetAppearancePatch{Set: map[string]any{}}
	for key, value := range values {
		path := "shared." + key
		if value == nil {
			patch.Unset = append(patch.Unset, path)
		} else {
			patch.Set[path] = value
		}
	}
	return patch
}
