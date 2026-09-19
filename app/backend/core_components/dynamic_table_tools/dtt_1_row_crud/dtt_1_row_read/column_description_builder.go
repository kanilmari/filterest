// column_description_builder.go
// Builds complete client-visible descriptions for dataset columns.
// Bridges ordinary schema metadata and dataset-specific metadata overlays.
// Exists so every response path inherits new description fields from one contract.
package dtt_1_row_read

// buildColumnDescription starts from the complete client-visible column contract
// and applies the values known by a specific metadata source. Relationship fields
// remain optional because their absence tells the browser that a column has no
// foreign-key target.
func buildColumnDescription(overrides map[string]interface{}) map[string]interface{} {
	description := map[string]interface{}{
		"data_type":                  "",
		"card_element":               "",
		"show_key_on_card":           false,
		"show_value_on_card":         false,
		"hide_in_filter_panel":       false,
		"hide_everywhere":            false,
		"hide_on_small_card":         false,
		"hide_false_null_on_sml_crd": false,
		"hide_false_null_on_big_crd": false,
		"hide_on_bg_crd_if_not_own":  false,
		"co_number":                  0,
		"fco_number":                 0,
		"is_multilingual":            false,
		"editable_in_ui":             false,
		"card_detail_icon_svg":       "",
		"card_detail_icon_key":       "",
		"card_detail_capitalization": true,
		"card_detail_label_mode":     "label",
		"label_value_layout":         nil,
	}

	for fieldName, value := range overrides {
		description[fieldName] = value
	}

	return description
}
