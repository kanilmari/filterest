// dataset_cover_theme_config.go
// Adapts shared appearance types to the existing site presentation protocol.
// Connects administrator handlers with the canonical shared definition.
// Preserves Go contract names while keeping validation and types in one place.
package system_table_tools

import appearance "easelect/frontend/shared/dataset_appearance"

var defaultFilterbarContentTopSpace = appearance.Rules().SharedFields["filterbar_content_top_space"].Default.(float64)

type DatasetCoverThemeValues = appearance.DatasetCoverThemeValues
type DatasetCoverSharedValues = appearance.DatasetCoverSharedValues
type DatasetCoverThemeConfig = appearance.DatasetCoverThemeConfig

func inheritLegacyImageBlur(raw string, config *DatasetCoverThemeConfig) {
	appearance.InheritLegacyImageBlur(raw, config)
}
func defaultSitePresentationSettings() SitePresentationSettingsResponse {
	return SitePresentationSettingsResponse{DatasetCoverTheme: appearance.DefaultConfig(), RowArticleTimestampDisplayMode: rowArticleTimestampDateTime}
}
