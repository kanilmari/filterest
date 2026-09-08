// media_response_guard_test.go
// Verifies media-only redaction without changing ordinary authored content.
// Between revoked independent media references and JSON row maps.
// Exists to prevent cache metadata leakage while preserving the parent's text.
package dtt_1_row_read

import "testing"

func TestMediaResponseGuardRemovesOnlyDeniedLinksAndDerivedMetadata(t *testing.T) {
	denied := "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png"
	legacy := "/storage/101/1/original/101_1_9.png"
	rows := []map[string]interface{}{
		{"cached_image": denied, "cached_image_title": "Derived private title", "cached_image_metadata_json": "Derived metadata", "title": "Authored title", "description": "Authored description", "id": 1},
		{"filename": denied, "title": "Own child title", "description": "Own child description"},
		{"cached_image": legacy, "cached_image_title": "Legacy cache"},
	}
	filterIndependentMediaRows(rows, func(string) bool { return false })
	if rows[0]["cached_image"] != nil || rows[0]["cached_image_title"] != nil || rows[0]["cached_image_metadata_json"] != nil {
		t.Fatal("derived metadata survived")
	}
	if rows[0]["title"] != "Authored title" || rows[0]["description"] != "Authored description" {
		t.Fatal("authored parent content changed")
	}
	if rows[1]["filename"] != nil || rows[1]["title"] != "Own child title" || rows[1]["description"] != "Own child description" {
		t.Fatal("child authored content changed")
	}
	if rows[2]["cached_image"] != legacy || rows[2]["cached_image_title"] != "Legacy cache" {
		t.Fatal("legacy behavior changed")
	}
}
func TestMediaResponseGuardPreservesAllowedImageMetadata(t *testing.T) {
	ref := "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png"
	rows := []map[string]interface{}{{"cached_image": ref, "cached_image_title": "Available"}}
	filterIndependentMediaRows(rows, func(string) bool { return true })
	if rows[0]["cached_image"] != ref || rows[0]["cached_image_title"] != "Available" {
		t.Fatal("allowed media changed")
	}
}
