// types.go
// Defines the bounded same-dataset image reuse contract.
// Between registered asset relations, ordinary row creation, and protected storage.
// Exists to keep physical assets independent from per-row uses without widening audiences.
package media_library

import (
	"errors"
	"fmt"
	"strings"

	media_utils "easelect/backend/core_components/media_utils"
)

var ErrUnsupported = errors.New("media_reuse_not_supported_for_permissions")
var ErrDenied = errors.New("media_reuse_not_allowed")
var ErrConflict = errors.New("media_reuse_source_changed")

// Selection names a registered relation and an existing image row, never a path supplied by a client.
type Selection struct {
	RelationID  int64 `json:"relation_id"`
	SourceRowID int64 `json:"source_row_id"`
}
type Request struct {
	Dataset     string `json:"dataset"`
	RelationID  int64  `json:"relation_id"`
	SourceRowID int64  `json:"source_row_id"`
	ParentRowID int64  `json:"parent_row_id"`
	AssetID     string `json:"asset_id,omitempty"`
}
type Item struct {
	SourceRowID int64  `json:"source_row_id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
}
type Result struct {
	AssetID    string `json:"asset_id"`
	UsageRowID int64  `json:"usage_row_id"`
	URL        string `json:"url"`
	Unchanged  bool   `json:"unchanged"`
}
type relation struct {
	ID                                  int64
	Parent, Child, ForeignKey, Filename string
	ParentUID, ChildUID                 int64
	MetadataColumns                     []string
}
type source struct {
	ID, ParentID int64
	Reference    string
	Metadata     map[string]interface{}
}
type asset struct {
	ID, Filename string
	RelationID   int64
	SourceID     int64
}

func storageURL(a asset) string {
	return fmt.Sprintf("/storage/media/%s/original/%s", a.ID, a.Filename)
}
func parseReference(raw string) (asset, bool) {
	id, _, file, ok := media_utils.ParseMediaLibraryStoragePath(strings.TrimPrefix(raw, "/storage/"))
	return asset{ID: id, Filename: file}, ok
}
