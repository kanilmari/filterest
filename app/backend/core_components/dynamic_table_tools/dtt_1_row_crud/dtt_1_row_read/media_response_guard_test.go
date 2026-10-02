// media_response_guard_test.go
// Verifies media-only redaction without changing ordinary authored content.
// Between revoked independent media references and JSON row maps.
// Exists to prevent cache metadata leakage while preserving the parent's text.
package dtt_1_row_read

import (
	"reflect"
	"sort"
	"strings"
	"testing"
)

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

// The browser can load a media-library picture from a plain value or from any text of a
// language map it reads in the viewer's language, written as a full or a relative address,
// so each such address is found for the same check.
func TestMediaLibraryReferencesInFindsEveryAddressTheBrowserCouldShow(t *testing.T) {
	library := "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png"
	other := "/storage/media/9f0c5a52-7b1e-4c8e-9d36-0f1f3c1d2b4a/original/other.png"
	cases := []struct {
		name  string
		value string
		want  []string
	}{
		{name: "a plain full address", value: library, want: []string{library}},
		{name: "a plain relative address the browser reads under /storage/", value: strings.TrimPrefix(library, "/storage/"), want: []string{library}},
		{name: "a relative address inside a language map", value: `{"fi": "` + strings.TrimPrefix(library, "/storage/") + `", "en": "en.png"}`, want: []string{library}},
		{name: "a page-relative address the browser keeps as it is", value: "./" + strings.TrimPrefix(library, "/storage/"), want: nil},
		{name: "another site's address", value: "https://cdn.example" + library, want: nil},
		{name: "a query is set aside: the storage route serves the file without it", value: strings.TrimPrefix(library, "/storage/") + "?v=1", want: []string{library}},
		{name: "a fragment is set aside: the browser never sends it", value: library + "#zoom", want: []string{library}},
		{name: "a query inside a language map", value: `{"fi": "` + library + `?v=1"}`, want: []string{library}},
		{name: "dot segments resolve as the browser resolves them", value: "/storage/./x/../media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png", want: []string{library}},
		{name: "a relative name with dot segments", value: "x/../media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png", want: []string{library}},
		{name: "a repeated key keeps its last value, as JSON.parse does", value: `{"fi": "` + library + `", "fi": "fi.png"}`, want: nil},
		{name: "a repeated key's last value is checked", value: `{"fi": "fi.png", "fi": "` + library + `"}`, want: []string{library}},
		{name: "a language map", value: `{"fi": "` + library + `", "en": "en.png"}`, want: []string{library}},
		{name: "spaces around the address and the map", value: "\uFEFF {\"fi\": \" " + library + "\\n\", \"en\": \"" + other + "\"} ", want: []string{library, other}},
		{name: "a nested value", value: `{"fi": {"x": ["` + library + `"]}}`, want: []string{library}},
		{name: "no library picture", value: `{"fi": "fi.png", "en": "/storage/101/1/original/101_1_9.png"}`, want: nil},
		{name: "not JSON", value: `{"fi": "` + library, want: nil},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := mediaLibraryReferencesIn(testCase.value)
			sort.Strings(got)
			want := append([]string(nil), testCase.want...)
			sort.Strings(want)
			if len(got) == 0 && len(want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("mediaLibraryReferencesIn = %v, want %v", got, want)
			}
		})
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
