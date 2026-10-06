// stored_picture_location_test.go
// Guards the existing K121 placement after sharing it with response authorization.
// Equivalent query, fragment and variant spellings keep the same storage coordinates.
// Other-row files remain distinguishable and independent addresses remain unplaced.
package dtt_card_picture

import "testing"

func TestStoredPictureLocationUsesOneFileIdentity(t *testing.T) {
	for _, value := range []string{
		"117_4_4.jpg", "117_4_4.jpg#preview", "117_4_4.jpg?size=300#preview",
		"/storage/117/4/300/117_4_4.jpg#preview", "storage/117/4/original/117_4_4.jpg?size=300",
		"117/4/117_4_4.jpg#preview?size=300", "\u00a0/storage/117/4/1000/117_4_4.jpg#preview\u00a0",
	} {
		uid, id, filename, ok := ResolveStoredPictureLocation(value, "117", 4)
		if !ok || uid != "117" || id != 4 || filename != "117_4_4.jpg" {
			t.Fatal(value, uid, id, filename, ok)
		}
	}
	for _, value := range []string{"https://example.org/117_4_4.jpg#preview", "//example.org/117_4_4.jpg", "/storage/media/9/300/117_4_4.jpg", "../117_4_4.jpg", "/storage/117/4/../117_4_4.jpg", "/storage/117/4/media/117_4_4.jpg"} {
		if _, _, _, ok := ResolveStoredPictureLocation(value, "117", 4); ok {
			t.Fatal("independent or ambiguous reference placed as a dataset file", value)
		}
	}
	uid, id, filename, ok := ResolveStoredPictureLocation("/storage/118/8/300/117_4_4.jpg#preview", "117", 4)
	if !ok || uid != "118" || id != 8 || filename != "117_4_4.jpg" {
		t.Fatal("explicit coordinates were lost to the basename", uid, id, filename, ok)
	}
}
