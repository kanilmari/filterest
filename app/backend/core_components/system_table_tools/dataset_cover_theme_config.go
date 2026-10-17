// dataset_cover_theme_config.go
// Adapts shared appearance types to the existing site presentation protocol.
// Connects administrator handlers with the canonical shared definition.
// Preserves Go contract names while keeping validation and types in one place.
package system_table_tools

import (
	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/system_config_checks"
	appearance "easelect/frontend/shared/dataset_appearance"
)

type DatasetCoverThemeValues = appearance.DatasetCoverThemeValues
type DatasetCoverSharedValues = appearance.DatasetCoverSharedValues
type DatasetCoverThemeConfig = appearance.DatasetCoverThemeConfig

func defaultSitePresentationSettings() SitePresentationSettingsResponse {
	values := store.DefaultSiteAppearanceValues()
	return SitePresentationSettingsResponse{TableCellMaxLines: system_config_checks.DefaultTableCellMaxLines, SchemaVersion: 2, SiteValues: values.SiteValues, Defaults: values.Defaults, RowArticleTimestampDisplayMode: rowArticleTimestampDateTime}
}
