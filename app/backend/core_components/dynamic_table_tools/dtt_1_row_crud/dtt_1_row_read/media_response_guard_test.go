// media_response_guard_test.go
// Verifies media-only redaction without changing ordinary authored content.
// Between revoked independent media references and JSON row maps.
// Exists to prevent cache metadata leakage while preserving the parent's text.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dbutils"
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
// with slashes or backslashes, so each such address is found for the same check. A name
// that reaches the library in a way this reading cannot pin to one file is unresolved.
func TestMediaLibraryReferencesInFindsEveryAddressTheBrowserCouldShow(t *testing.T) {
	library := "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png"
	other := "/storage/media/9f0c5a52-7b1e-4c8e-9d36-0f1f3c1d2b4a/original/other.png"
	id := "174668a1-2efa-45a6-aa6c-d8a4ee8ec069"
	unresolved := []string{unresolvedMediaLibraryAddress}
	cases := []struct {
		name  string
		value string
		want  []string
	}{
		{name: "a plain full address", value: library, want: []string{library}},
		{name: "a plain relative address the browser reads under /storage/", value: strings.TrimPrefix(library, "/storage/"), want: []string{library}},
		{name: "a relative address inside a language map", value: `{"fi": "` + strings.TrimPrefix(library, "/storage/") + `", "en": "en.png"}`, want: []string{library}},
		// A ./ address depends on the page and a full address on its host, which this check
		// cannot know: a full address is read as this site's, and a ./ address names a library
		// file only when its readings from the site root and as a stored name agree.
		{name: "a page-relative address whose readings disagree", value: "./" + strings.TrimPrefix(library, "/storage/"), want: unresolved},
		{name: "a page-relative address whose readings agree", value: "./../storage/media/" + id + "/original/image.png", want: []string{library}},
		{name: "a full address of any host", value: "https://cdn.example" + library, want: []string{library}},
		{name: "an address naming a host after two slashes", value: "//cdn.example" + library + "?v=1", want: []string{library}},
		{name: "a backslash before the host, which the browser reads as a slash", value: `/\cdn.example\storage\media\` + id + `\original\image.png`, want: []string{library}},
		{name: "an external picture outside a storage/media path", value: "https://cdn.example/media/photo.jpg", want: nil},
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
		// The browser reads a backslash as a slash, also around dot segments, and drops tabs
		// and line breaks anywhere.
		{name: "backslashes after a dot segment", value: `/storage/media/../media\` + id + `\original\image.png`, want: []string{library}},
		{name: "mixed separators", value: `/storage\media/` + id + `\original/image.png`, want: []string{library}},
		{name: "a dot segment between backslashes", value: `/storage/x\..\media\` + id + `/original/image.png`, want: []string{library}},
		{name: "a relative name with backslashes", value: `media\` + id + `\original\image.png`, want: []string{library}},
		{name: "a name starting with a dot and a backslash is a stored name", value: `.\media\` + id + `\original\image.png`, want: []string{library}},
		{name: "tabs and line breaks inside", value: "/storage/me\tdia/" + id + "/orig\r\ninal/image.png", want: []string{library}},
		{name: "backslashes inside a language map", value: `{"fi": "media\\` + id + `\\original\\image.png", "en": "en.png"}`, want: []string{library}},
		// The card puts a name starting with a backslash under /storage/ first, so the browser
		// asks for /storage/storage/media/…, which is no library file.
		{name: "a name starting with a backslash", value: `\storage\media\` + id + `\original\image.png`, want: nil},
		// Escapes are read every way a browser and a server could read them: decoded before and
		// after the dot segments, and again until nothing changes. A name some reading takes into
		// the library names a file only when every reading is that file; otherwise it is unresolved.
		{name: "dot segments the browser resolves before the server decodes", value: "/%73torage/media/" + id + "/original/image.png/..%2f../..", want: unresolved},
		{name: "the same inside a language map", value: `{"fi": "/%73torage/media/` + id + `/original/image.png/..%2f../..", "en": "en.png"}`, want: unresolved},
		{name: "the same encoded twice", value: "/%2573torage/media/" + id + "/original/image.png/..%252f../..", want: unresolved},
		{name: "slashes encoded twice", value: "/storage/media%252F" + id + "%252Foriginal%252Fimage.png", want: unresolved},
		{name: "escapes in mixed case", value: "/storage/media%2f" + id + "%2Foriginal%2fimage.png", want: unresolved},
		{name: "dot segments encoded in mixed case", value: "/storage/x/%2E%2e/media/" + id + "/original/image.png", want: unresolved},
		{name: "escapes every reading drops agree on one file", value: library + "/x%41/..", want: []string{library}},
		{name: "decoded storage and media segments refuse even when no reading reaches the library", value: "/storage/%41/../x/media/y.png", want: unresolved},
		{name: "encoded slashes", value: "/storage/media%2F" + id + "%2Foriginal%2Fimage.png", want: unresolved},
		{name: "encoded backslashes", value: "/storage/media/" + id + "%5Coriginal%5Cimage.png", want: unresolved},
		{name: "an encoded prefix", value: "/stor%61ge/media/" + id + "/original/image.png", want: unresolved},
		{name: "encoded dot segments", value: "/storage/x/%2e%2e/media/" + id + "/original/image.png", want: unresolved},
		{name: "an encoded relative name", value: "%6Dedia/" + id + "/original/image.png", want: unresolved},
		{name: "an encoded file name", value: "/storage/media/" + id + "/original/image%2Epng", want: unresolved},
		{name: "a broken escape inside the library", value: "/storage/media/" + id + "/original/image%zz.png", want: unresolved},
		{name: "an encoded name in a full address", value: "https://cdn.example/storage/media%2F" + id + "%2Foriginal%2Fimage.png", want: unresolved},
		{name: "an encoded name inside a language map", value: `{"fi": "fi.png", "en": "media%2F` + id + `%2Foriginal%2Fimage.png"}`, want: unresolved},
		{name: "the unresolved marker reads as itself", value: unresolvedMediaLibraryAddress, want: unresolved},
		{name: "an encoded name outside the library", value: "/storage/101/1/original/101_1_9%20copy.png", want: nil},
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

const (
	guardedLibraryID      = "174668a1-2efa-45a6-aa6c-d8a4ee8ec069"
	guardedLibraryPicture = "/storage/media/" + guardedLibraryID + "/original/image.png"
)

// askedDecision gives every read decision the same answer and records the file paths asked.
func askedDecision(allow bool) (func(string) bool, *[]string) {
	asked := []string{}
	return func(reference string) bool {
		asked = append(asked, reference)
		return allow
	}, &asked
}

// guardTestRow is one row response carrying value in field key, the derived cached_image
// fields, and authored fields the filter must never change.
func guardTestRow(key string, value interface{}) map[string]interface{} {
	row := map[string]interface{}{
		"cached_image_title":         "Derived title",
		"cached_image_metadata_json": "Derived metadata",
		"title":                      "Authored title",
		"description":                "Authored description",
		"id":                         1,
	}
	row[key] = value
	return row
}

// The filter reads cached_image and filename as the browser loads them, so the decision is
// asked about the library file path. A viewer who may open the file keeps the value exactly as
// written, query or fragment included; a refused file is removed in every one of these forms,
// and a refused cached_image takes its derived fields with it. A ./ address and an address
// naming a host are read as this site's, because the page and the host cannot be known here.
func TestMediaResponseGuardDecidesOnTheFileTheBrowserLoads(t *testing.T) {
	relative := strings.TrimPrefix(guardedLibraryPicture, "/storage/")
	values := map[string]string{
		"the plain address":                guardedLibraryPicture,
		"a query":                          guardedLibraryPicture + "?v=1",
		"a fragment":                       guardedLibraryPicture + "#zoom",
		"a relative path":                  relative,
		"a relative path with a query":     relative + "?v=1",
		"dot segments":                     "/storage/./x/../media/" + guardedLibraryID + "/original/image.png",
		"spaces around the address":        string(rune(0xFEFF)) + " " + guardedLibraryPicture + "\n",
		"a language map":                   `{"fi": "` + relative + `", "en": "en.png"}`,
		"a query inside a language map":    `{"fi": "` + guardedLibraryPicture + `?v=1"}`,
		"backslashes after a dot segment":  `/storage/media/../media\` + guardedLibraryID + `\original\image.png`,
		"mixed separators":                 `/storage\media/` + guardedLibraryID + `\original/image.png`,
		"a relative name with backslashes": `media\` + guardedLibraryID + `\original\image.png`,
		"tabs and line breaks inside":      "/storage/me\tdia/" + guardedLibraryID + "/orig\ninal/image.png",
		"a language map with backslashes":  `{"fi": "media\\` + guardedLibraryID + `\\original\\image.png", "en": "en.png"}`,
		"a page-relative address above it": "./../storage/media/" + guardedLibraryID + "/original/image.png",
		"escapes every reading drops":      guardedLibraryPicture + "/x%41/..",
		"a full address":                   "https://cdn.example" + guardedLibraryPicture + "?v=1",
		"a backslash before a host":        `/\cdn.example\storage\media\` + guardedLibraryID + `\original\image.png`,
	}
	for name, value := range values {
		for _, key := range []string{"cached_image", "filename"} {
			t.Run(name+" in "+key, func(t *testing.T) {
				allowedRow := guardTestRow(key, value)
				decide, asked := askedDecision(true)
				filterIndependentMediaRows([]map[string]interface{}{allowedRow}, decide)
				if !reflect.DeepEqual(allowedRow, guardTestRow(key, value)) {
					t.Fatalf("a picture the viewer may open changed: %#v", allowedRow)
				}
				if !reflect.DeepEqual(*asked, []string{guardedLibraryPicture}) {
					t.Fatalf("decision asked about %q, want only the file path %q", *asked, guardedLibraryPicture)
				}

				refusedRow := guardTestRow(key, value)
				decide, _ = askedDecision(false)
				filterIndependentMediaRows([]map[string]interface{}{refusedRow}, decide)
				want := guardTestRow(key, value)
				want[key] = nil
				if key == "cached_image" {
					delete(want, "cached_image_title")
					delete(want, "cached_image_metadata_json")
				}
				if !reflect.DeepEqual(refusedRow, want) {
					t.Fatalf("refused row = %#v, want %#v", refusedRow, want)
				}
			})
		}
	}
}

// A value from which the browser loads no media-library file is left as it is, without
// asking: other pictures, an external picture outside a storage/media path, a path that only
// passes through media/, a language map without library pictures, and a value that is not text.
func TestMediaResponseGuardLeavesOtherPicturesWithoutAsking(t *testing.T) {
	values := []interface{}{
		nil,
		42,
		"",
		"3155_6_2.png",
		"/storage/101/1/original/101_1_9.png",
		"101/1/300/101_1_9.png",
		"/storage/101/1/original/101_1_9%20copy.png",
		"https://cdn.example/media/photo.jpg",
		// The browser loads the dataset file /storage/101/1/…, which the storage route
		// authorizes as dataset media; the library's decision does not govern it.
		"/storage/media/../101/1/original/101_1_9.png",
		// The card puts a name starting with a backslash under /storage/ first, so the
		// browser asks for /storage/storage/media/…, which is no library file.
		`\storage\media\` + guardedLibraryID + `\original\image.png`,
		`{"fi": "fi.png", "en": "/storage/101/1/original/101_1_9.png"}`,
	}
	for _, value := range values {
		for _, key := range []string{"cached_image", "filename"} {
			row := guardTestRow(key, value)
			decide, asked := askedDecision(false)
			filterIndependentMediaRows([]map[string]interface{}{row}, decide)
			if len(*asked) != 0 || !reflect.DeepEqual(row, guardTestRow(key, value)) {
				t.Errorf("%s %#v: decision asked about %q, row became %#v", key, value, *asked, row)
			}
		}
	}
}

// Only cached_image and filename are read. Another field holding a library address, such as a
// dataset's own image field, authored text or metadata, keeps its value and is never asked about.
func TestMediaResponseGuardLeavesUnrelatedFieldsUntouched(t *testing.T) {
	relative := strings.TrimPrefix(guardedLibraryPicture, "/storage/")
	row := map[string]interface{}{
		"cached_image":       relative + "?v=1",
		"cached_image_title": "Derived title",
		"logo_image":         guardedLibraryPicture,
		"description":        "See " + relative,
		"metadata_json":      `{"fi": "` + guardedLibraryPicture + `"}`,
		"title":              "Authored title",
	}
	decide, asked := askedDecision(false)
	filterIndependentMediaRows([]map[string]interface{}{row}, decide)
	want := map[string]interface{}{
		"cached_image":  nil,
		"logo_image":    guardedLibraryPicture,
		"description":   "See " + relative,
		"metadata_json": `{"fi": "` + guardedLibraryPicture + `"}`,
		"title":         "Authored title",
	}
	if !reflect.DeepEqual(row, want) {
		t.Fatalf("row = %#v, want %#v", row, want)
	}
	if !reflect.DeepEqual(*asked, []string{guardedLibraryPicture}) {
		t.Fatalf("decision asked about %q, want only the cached_image file", *asked)
	}
}

// A name that some reading takes into the library, but whose readings do not all agree on one
// library file, is removed even for a viewer who may open every library picture, and the
// decision is never asked: escapes decoded before or after the dot segments, decoded twice,
// written in either case, and a ./ address whose page cannot be known.
func TestMediaResponseGuardRefusesLibraryNamesItCannotPinToOneFile(t *testing.T) {
	values := map[string]string{
		"dot segments the browser resolves before the server decodes": "/%73torage/media/" + guardedLibraryID + "/original/image.png/..%2f../..",
		"the same inside a language map":                              `{"fi": "/%73torage/media/` + guardedLibraryID + `/original/image.png/..%2f../..", "en": "en.png"}`,
		"the same encoded twice":                                      "/%2573torage/media/" + guardedLibraryID + "/original/image.png/..%252f../..",
		"slashes encoded twice":                                       "/storage/media%252F" + guardedLibraryID + "%252Foriginal%252Fimage.png",
		"escapes in mixed case":                                       "/storage/media%2f" + guardedLibraryID + "%2Foriginal%2fimage.png",
		"a page-relative address whose readings disagree":             "./media/" + guardedLibraryID + "/original/image.png",
		"encoded slashes":                                             "/storage/media%2F" + guardedLibraryID + "%2Foriginal%2Fimage.png",
		"encoded backslashes":                                         "/storage/media/" + guardedLibraryID + "%5Coriginal%5Cimage.png",
		"an encoded prefix":                                           "/stor%61ge/media/" + guardedLibraryID + "/original/image.png",
		"encoded dot segments":                                        "/storage/x/%2e%2e/media/" + guardedLibraryID + "/original/image.png",
		"an encoded relative name":                                    "%6Dedia/" + guardedLibraryID + "/original/image.png",
		"an encoded file name":                                        "/storage/media/" + guardedLibraryID + "/original/image%2Epng",
		"an encoded name in a full address":                           "https://cdn.example/storage/media%2F" + guardedLibraryID + "%2Foriginal%2Fimage.png",
		"a language map carrying one":                                 `{"fi": "fi.png", "en": "media%2F` + guardedLibraryID + `%2Foriginal%2Fimage.png"}`,
	}
	for name, value := range values {
		for _, key := range []string{"cached_image", "filename"} {
			t.Run(name+" in "+key, func(t *testing.T) {
				row := guardTestRow(key, value)
				decide, asked := askedDecision(true)
				filterIndependentMediaRows([]map[string]interface{}{row}, decide)
				want := guardTestRow(key, value)
				want[key] = nil
				if key == "cached_image" {
					delete(want, "cached_image_title")
					delete(want, "cached_image_metadata_json")
				}
				if !reflect.DeepEqual(row, want) || len(*asked) != 0 {
					t.Fatalf("row = %#v after asking about %q, want %#v without asking", row, *asked, want)
				}
			})
		}
	}
}

// The server cannot know which language the browser will read, so one refused language
// removes the whole map; the map stays as written when every language may be opened.
func TestMediaResponseGuardRefusesALanguageMapWhenAnyLanguageIsRefused(t *testing.T) {
	other := "/storage/media/9f0c5a52-7b1e-4c8e-9d36-0f1f3c1d2b4a/original/image.png"
	value := `{"fi": "` + guardedLibraryPicture + `", "en": "` + strings.TrimPrefix(other, "/storage/") + `?v=2"}`
	row := guardTestRow("cached_image", value)
	filterIndependentMediaRows([]map[string]interface{}{row}, func(reference string) bool {
		return reference == guardedLibraryPicture
	})
	if _, derived := row["cached_image_title"]; row["cached_image"] != nil || derived {
		t.Fatalf("a map with one refused language survived: %#v", row)
	}
	row = guardTestRow("filename", value)
	filterIndependentMediaRows([]map[string]interface{}{row}, func(string) bool { return true })
	if !reflect.DeepEqual(row, guardTestRow("filename", value)) {
		t.Fatalf("a map the viewer may open changed: %#v", row)
	}
}

// withRegisteredMediaDecision registers authorize as the media library's read decision for
// this test and restores the previous one afterwards.
func withRegisteredMediaDecision(t *testing.T, authorize independentMediaAuthorizer) {
	t.Helper()
	independentMediaRead.Lock()
	previous := independentMediaRead.authorize
	independentMediaRead.authorize = authorize
	independentMediaRead.Unlock()
	t.Cleanup(func() {
		independentMediaRead.Lock()
		independentMediaRead.authorize = previous
		independentMediaRead.Unlock()
	})
}

// Every row response asks the registered decision about the file path, once per response
// however the rows write it, and without the media library every form is still refused.
func TestFilterIndependentMediaRowsAsksTheRegisteredDecisionAboutTheFilePath(t *testing.T) {
	relative := strings.TrimPrefix(guardedLibraryPicture, "/storage/")
	rows := func() []map[string]interface{} {
		return []map[string]interface{}{
			{"cached_image": guardedLibraryPicture + "?v=1", "cached_image_title": "Derived title", "title": "Own title"},
			{"filename": relative, "title": "Gallery row"},
			{"filename": guardedLibraryPicture + "#zoom"},
			{"filename": `{"fi": "` + relative + `"}`},
			{"filename": `/storage/media/../media\` + guardedLibraryID + `\original\image.png`},
		}
	}
	actor := dbutils.NewRequestActorContext(7, "basic")
	asked := []string{}
	withRegisteredMediaDecision(t, func(_ dbutils.Querier, _ dbutils.RequestActorContext, reference string) bool {
		asked = append(asked, reference)
		return true
	})
	allowedRows := rows()
	FilterIndependentMediaRows(nil, actor, allowedRows)
	if !reflect.DeepEqual(allowedRows, rows()) {
		t.Fatalf("pictures the viewer may open changed: %#v", allowedRows)
	}
	if !reflect.DeepEqual(asked, []string{guardedLibraryPicture}) {
		t.Fatalf("registered decision asked about %q, want the file path once", asked)
	}

	withRegisteredMediaDecision(t, nil)
	refusedRows := rows()
	FilterIndependentMediaRows(nil, actor, refusedRows)
	want := []map[string]interface{}{
		{"cached_image": nil, "title": "Own title"},
		{"filename": nil, "title": "Gallery row"},
		{"filename": nil},
		{"filename": nil},
		{"filename": nil},
	}
	if !reflect.DeepEqual(refusedRows, want) {
		t.Fatalf("without the media library: %#v, want %#v", refusedRows, want)
	}
}
