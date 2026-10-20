// report.go
// Defines the shared deterministic K388 BEFORE/AFTER settings-report format.
// Connects target settings, current opener sources and actual route audiences.
// Keeps null storage values distinct from absent settings and effective defaults.
package article_presentation_report

import "encoding/json"

// ArticleBaselineReport contains settings evidence, not a row-content export.
// Arrays have stable orders; JSON maps are sorted by encoding/json. No timestamp,
// connection identity, installation config or request cache enters this format.
type ArticleBaselineReport struct {
	Phase           string                   `json:"phase"`
	FormatVersion   int                      `json:"format_version"`
	ContractVersion int                      `json:"contract_version"`
	Scope           string                   `json:"scope"`
	Limitations     []string                 `json:"limitations"`
	Groups          []ArticleBaselineGroup   `json:"groups"`
	Users           []ArticleBaselineUser    `json:"users"`
	Datasets        []ArticleBaselineDataset `json:"datasets"`
}
type ArticleBaselineGroup struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}
type ArticleBaselineUser struct {
	ID       int64   `json:"id"`
	GroupIDs []int64 `json:"group_ids"`
}
type ArticleBaselineDataset struct {
	UID            int                              `json:"dataset_uid"`
	Name           string                           `json:"dataset"`
	Schema         string                           `json:"schema"`
	OpenerPolicy   json.RawMessage                  `json:"opener_policy"`
	StoredBlocks   json.RawMessage                  `json:"stored_blocks"`
	BlockReadError *string                          `json:"block_read_error"`
	Blocks         map[string]ArticleBaselineBlocks `json:"blocks"`
	Targets        []ArticleBaselineTarget          `json:"targets"`
	Readers        []ArticleBaselineReader          `json:"readers"`
	Audience       ArticleBaselineAudience          `json:"article_route_audience"`
}
type ArticleBaselineBlocks struct {
	Present     bool            `json:"present"`
	Overrides   map[string]bool `json:"overrides"`
	InitialOpen map[string]bool `json:"initial_open"`
}
type ArticleBaselineTarget struct {
	Kind    string                    `json:"kind"` // metadata, site, group, personal
	ID      *int64                    `json:"id"`
	Article ArticleBaselineProjection `json:"article_view"`
	IFAV    ArticleBaselineIFAV       `json:"image_first_view"`
	Page    ArticleBaselineProjection `json:"image_first_page_view"`
}
type ArticleBaselineSource struct {
	Kind          string `json:"kind"`
	AssignmentID  *int64 `json:"assignment_id"`
	FieldSetID    *int64 `json:"field_set_id"`
	UserID        *int64 `json:"user_id"`
	GroupID       *int64 `json:"group_id"`
	GroupPriority *int   `json:"group_priority"`
}
type ArticleBaselineField struct {
	UID           *int64 `json:"column_uid"` // null only for information-schema fallback without metadata
	Name          string `json:"column"`
	Width         int    `json:"width_px"` // current response normalizes SQL NULL to zero
	StoredWidth   *int   `json:"stored_width_px"`
	Role          string `json:"card_element"`
	CoNumber      int    `json:"co_number"`
	HideUnlessOwn bool   `json:"hide_unless_own"`
	HideFalseNull bool   `json:"hide_false_null"`
}
type ArticleBaselineProjection struct {
	Source ArticleBaselineSource  `json:"source"`
	Fields []ArticleBaselineField `json:"fields"`
}
type ArticleBaselineIFAV struct {
	SourceDependent      bool                      `json:"source_dependent"`
	ConfiguredProjection ArticleBaselineProjection `json:"configured_projection"`
	OpeningSources       []ArticleBaselineOpening  `json:"opening_sources"`
	DifferentFromArticle bool                      `json:"different_from_article"`
}
type ArticleBaselineOpening struct {
	Path              string                 `json:"path"`
	ViewKey           string                 `json:"supplied_view_key"`
	Source            ArticleBaselineSource  `json:"source"`
	Fields            []ArticleBaselineField `json:"ordered_projection_fields"`
	AdditionalRowKeys string                 `json:"additional_row_keys"`
}
type ArticleBaselineReader struct {
	UserID                           int64                     `json:"user_id"`
	Article                          ArticleBaselineProjection `json:"article_view"`
	IFAV                             ArticleBaselineIFAV       `json:"image_first_view"`
	Page                             ArticleBaselineProjection `json:"image_first_page_view"`
	ArticleRouteAllowed              bool                      `json:"article_route_allowed"`
	ArticleRouteTablelessAllowed     bool                      `json:"article_route_tableless_allowed"`
	ArticleRouteAccessControlAllowed bool                      `json:"article_route_access_control_allowed"`
}
type ArticleBaselineGrant struct {
	FunctionID           int64   `json:"function_id"`
	GroupID              int64   `json:"group_id"`
	Schema               *string `json:"target_schema"`
	DatasetUID           *int64  `json:"target_dataset_uid"`
	Disabled             *bool   `json:"disabled"`
	SpecificTableRelated *bool   `json:"specific_table_related"`
}
type ArticleBaselineAudience struct {
	Route                 string                 `json:"route"`
	GroupIDs              []int64                `json:"group_ids"`
	TablelessGroupIDs     []int64                `json:"tableless_group_ids"`
	AccessControlGroupIDs []int64                `json:"access_control_group_ids"`
	DatasetScopedGroupIDs []int64                `json:"dataset_scoped_group_ids"`
	GuestUserID           int64                  `json:"guest_user_id"`
	GuestAllowed          bool                   `json:"guest_allowed"`
	Grants                []ArticleBaselineGrant `json:"grants"`
}
