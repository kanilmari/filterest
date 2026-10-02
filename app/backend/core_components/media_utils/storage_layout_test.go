// storage_layout_test.go
// Unit tests for the shared storage-root layout rules.
// Bridges folder-name, variant-path, and file-probe decisions with their callers' expectations.
// Exists so cleanup, preview retention, and the missing-media check keep one answer for the same folder.
package media_utils

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestIsCanonicalStorageIDAcceptsOnlyDatasetFolderNames(t *testing.T) {
	accepted := []string{"1", "117", "3470", "9991759140000000"}
	for _, value := range accepted {
		if !IsCanonicalStorageID(value) {
			t.Errorf("IsCanonicalStorageID(%q) = false, want true", value)
		}
	}
	rejected := []string{
		"", "0", "-1", "+117", "0117", " 117", "117 ", "1.0", "1e3",
		"media", "service_catalog_logos", "lost+found", "backup_2026-09-23", "117_backup",
		"99999999999999999999",
	}
	for _, value := range rejected {
		if IsCanonicalStorageID(value) {
			t.Errorf("IsCanonicalStorageID(%q) = true, want false", value)
		}
	}
}

func TestVariantRelativePathsListsOriginalFirstThenEverySize(t *testing.T) {
	got := VariantRelativePaths("117/4", "117_4_4.jpg")
	want := []string{
		"117/4/original/117_4_4.jpg",
		"117/4/300/117_4_4.jpg",
		"117/4/1000/117_4_4.jpg",
		"117/4/2160/117_4_4.jpg",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("VariantRelativePaths = %#v, want %#v", got, want)
	}
}

func TestStoredFileStateCountsOnlyRegularFilesUnderTheRoot(t *testing.T) {
	storageRoot := t.TempDir()
	filePath := filepath.Join(storageRoot, "117", "4", "300", "117_4_4.jpg")
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("create variant folder: %v", err)
	}
	if err := os.WriteFile(filePath, []byte("picture"), 0o644); err != nil {
		t.Fatalf("write picture: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(storageRoot, "117", "4", "original", "folder.jpg"), 0o755); err != nil {
		t.Fatalf("create decoy folder: %v", err)
	}

	state := StoredFileState(storageRoot)
	if state("117/4/300/117_4_4.jpg") != StoredFileExists {
		t.Fatal("a stored file must be found")
	}
	if state("117/4/original/117_4_4.jpg") != StoredFileMissing {
		t.Fatal("a missing file must not be found")
	}
	if state("117/4/original/folder.jpg") != StoredFileMissing {
		t.Fatal("a folder is not a stored picture")
	}
}

// A writer that would give up the only reference to a picture asks this question,
// so "could not look" must never come back as "gone".
func TestStoredFileStateTellsAMissingFileFromOneThatCouldNotBeChecked(t *testing.T) {
	storageRoot := t.TempDir()
	filePath := filepath.Join(storageRoot, "117", "4", "original", "117_4_4.jpg")
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("create variant folder: %v", err)
	}
	if err := os.WriteFile(filePath, []byte("picture"), 0o644); err != nil {
		t.Fatalf("write picture: %v", err)
	}
	state := StoredFileState(storageRoot)
	cases := map[string]StoredFileStatus{
		"117/4/original/117_4_4.jpg":        StoredFileExists,
		"117/4/300/117_4_4.jpg":             StoredFileMissing,
		"118/1/original/118_1_1.jpg":        StoredFileMissing,
		"117/4/original/117_4_4.jpg/nested": StoredFileMissing,
		"117/4/original":                    StoredFileMissing,
	}
	for relativePath, want := range cases {
		if got := state(relativePath); got != want {
			t.Errorf("StoredFileState(%q) = %v, want %v", relativePath, got, want)
		}
	}

	unmounted := StoredFileState(filepath.Join(storageRoot, "not-mounted"))
	if got := unmounted("117/4/original/117_4_4.jpg"); got != StoredFileUnknown {
		t.Fatalf("a storage root that is not there gave %v, want unknown", got)
	}

	if os.Geteuid() != 0 {
		locked := filepath.Join(storageRoot, "119")
		if err := os.MkdirAll(filepath.Join(locked, "1", "original"), 0o755); err != nil {
			t.Fatalf("create locked folder: %v", err)
		}
		if err := os.Chmod(locked, 0o000); err != nil {
			t.Fatalf("lock folder: %v", err)
		}
		t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })
		if got := state("119/1/original/119_1_1.jpg"); got != StoredFileUnknown {
			t.Fatalf("an unreadable folder gave %v, want unknown", got)
		}
	}
}

// One size folder holding the picture is enough; "missing" needs every look to be sure.
func TestStoredPictureStateNeedsEverySizeFolderCertainlyEmptyForMissing(t *testing.T) {
	paths := VariantRelativePaths("117/4", "117_4_4.jpg")
	answers := func(byPath map[string]StoredFileStatus) func(string) StoredFileStatus {
		return func(relativePath string) StoredFileStatus {
			if status, ok := byPath[relativePath]; ok {
				return status
			}
			return StoredFileMissing
		}
	}
	if got := StoredPictureState(paths, answers(map[string]StoredFileStatus{"117/4/1000/117_4_4.jpg": StoredFileExists})); got != StoredFileExists {
		t.Fatalf("a sized copy alone gave %v, want exists", got)
	}
	if got := StoredPictureState(paths, answers(nil)); got != StoredFileMissing {
		t.Fatalf("every folder empty gave %v, want missing", got)
	}
	if got := StoredPictureState(paths, answers(map[string]StoredFileStatus{"117/4/300/117_4_4.jpg": StoredFileUnknown})); got != StoredFileUnknown {
		t.Fatalf("one folder that could not be read gave %v, want unknown", got)
	}
	if got := StoredPictureState(paths, answers(map[string]StoredFileStatus{
		"117/4/original/117_4_4.jpg": StoredFileUnknown,
		"117/4/2160/117_4_4.jpg":     StoredFileExists,
	})); got != StoredFileExists {
		t.Fatalf("an unreadable folder and a found copy gave %v, want exists", got)
	}
}

func TestMediaLibraryStoragePathAcceptsOnlyTheCanonicalIdentity(t *testing.T) {
	const assetID = "174668a1-2efa-45a6-aa6c-d8a4ee8ec069"
	for _, raw := range []string{"media/" + assetID + "/original/image.png", "media/" + assetID + "/300/image.png", "media/" + assetID + "/2160/image.jpg"} {
		if _, _, _, ok := ParseMediaLibraryStoragePath(raw); !ok {
			t.Errorf("rejected %s", raw)
		}
	}
	for _, raw := range []string{"media/" + assetID + "/original/../copy.json", "media/" + assetID + "/original/image.svg", "media/" + strings.ToUpper(assetID) + "/original/image.png", "media/" + assetID + "/copy.json", "media/" + assetID + "/x/image.png", "media/" + assetID + "/original/image.png?x=1", "media/" + assetID + "/original/other.png"} {
		if _, _, _, ok := ParseMediaLibraryStoragePath(raw); ok {
			t.Errorf("accepted %s", raw)
		}
	}
}
