// missing_media_reference_resolver_test.go
// Verifies that a stored media reference is looked for where the server stores it.
// Between the reference forms this product has used and the real storage directory.
// Exists because the whole point of the check is a truthful present/missing answer:
// a false "missing" wastes an administrator's time and a false "present" hides the fault.
package missing_media_check

import (
	"os"
	"path/filepath"
	"testing"

	media_utils "easelect/backend/core_components/media_utils"
)

func writeStorageFile(t *testing.T, storageRoot string, relativePath string) {
	t.Helper()
	fullPath := filepath.Join(storageRoot, filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		t.Fatalf("create storage folder: %v", err)
	}
	if err := os.WriteFile(fullPath, []byte("image bytes"), 0o644); err != nil {
		t.Fatalf("write storage file: %v", err)
	}
}

// fileFound answers as the check does whether any size folder holds the file.
func fileFound(storageRoot string, relativePaths []string) bool {
	return media_utils.StoredPictureState(relativePaths, media_utils.StoredFileState(storageRoot)) == media_utils.StoredFileExists
}

func TestReferencePresentOnDisk(t *testing.T) {
	storageRoot := t.TempDir()
	writeStorageFile(t, storageRoot, "117/12/original/117_12_3.jpg")

	reference, ok := ResolveReference("117_12_3.jpg", "117", 12)
	if !ok {
		t.Fatal("a stored filename must resolve to storage coordinates")
	}
	if !fileFound(storageRoot, reference.RelativePaths) {
		t.Fatalf("file on disk reported as missing; looked in %v", reference.RelativePaths)
	}
}

func TestReferenceMissingFromDisk(t *testing.T) {
	storageRoot := t.TempDir()
	// The row folder exists but every variant folder is empty, which is exactly
	// the state that made an About dataset show no pictures at all.
	if err := os.MkdirAll(filepath.Join(storageRoot, "117", "12", "original"), 0o755); err != nil {
		t.Fatalf("create empty variant folder: %v", err)
	}

	reference, ok := ResolveReference("117_12_3.jpg", "117", 12)
	if !ok {
		t.Fatal("a stored filename must resolve even when its file is gone")
	}
	if fileFound(storageRoot, reference.RelativePaths) {
		t.Fatal("an empty storage folder must be reported as missing")
	}
}

func TestReferenceFoundThroughASizedVariantOnly(t *testing.T) {
	storageRoot := t.TempDir()
	// The storage route falls back between sizes, so a row whose original is
	// gone but whose 1000px copy remains still shows a picture.
	writeStorageFile(t, storageRoot, "117/12/1000/117_12_3.jpg")

	reference, _ := ResolveReference("117_12_3.jpg", "117", 12)
	if !fileFound(storageRoot, reference.RelativePaths) {
		t.Fatal("a surviving sized variant still shows a picture and is not missing")
	}
}

func TestLegacyFlatFilenameKeepsItsOwnCoordinates(t *testing.T) {
	storageRoot := t.TempDir()
	// The retired flat form carries the owning row inside the name. The parent
	// coordinates passed in here are deliberately wrong, so a check that ignored
	// the name would look in 117/99 and wrongly report the picture as missing.
	writeStorageFile(t, storageRoot, "117/1/original/117_1_4.webp")

	reference, ok := ResolveReference("117_1_4.webp", "117", 99)
	if !ok {
		t.Fatal("a retired flat filename must still resolve instead of failing the run")
	}
	if !reference.Legacy {
		t.Fatal("a retired flat filename must be recognised as one")
	}
	if reference.OwnerFolder != "117/1" {
		t.Fatalf("owner folder = %q, want 117/1 from the filename itself", reference.OwnerFolder)
	}
	if !fileFound(storageRoot, reference.RelativePaths) {
		t.Fatalf("legacy file on disk reported as missing; looked in %v", reference.RelativePaths)
	}
}

func TestLegacyFlatFilenameMissingIsReportedNotCrashed(t *testing.T) {
	storageRoot := t.TempDir()

	reference, ok := ResolveReference("117_1_4.webp", "117", 1)
	if !ok {
		t.Fatal("a retired flat filename must resolve so the run can report it")
	}
	if fileFound(storageRoot, reference.RelativePaths) {
		t.Fatal("nothing is on disk, so the reference must count as missing")
	}
}

func TestMediaLibraryReferenceUsesItsOwnFolder(t *testing.T) {
	storageRoot := t.TempDir()
	const assetID = "3f1c2b0e-8a4d-4f6b-9c2e-5d7a1b3c4e5f"
	writeStorageFile(t, storageRoot, "media/"+assetID+"/original/image.webp")

	reference, ok := ResolveReference("/storage/media/"+assetID+"/original/image.webp", "117", 12)
	if !ok {
		t.Fatal("an independent shared asset must resolve to its own folder")
	}
	if !reference.MediaLibrary {
		t.Fatal("an independent shared asset must be recognised as one")
	}
	if reference.OwnerFolder != "media/"+assetID {
		t.Fatalf("owner folder = %q, want the asset's own folder", reference.OwnerFolder)
	}
	if !fileFound(storageRoot, reference.RelativePaths) {
		t.Fatalf("shared asset on disk reported as missing; looked in %v", reference.RelativePaths)
	}
}

func TestHandEditedValueStaysInsideStorage(t *testing.T) {
	// A hand-edited database value must not steer the check outside the storage
	// root. The reference keeps only the leaf name under the row's own folder.
	reference, ok := ResolveReference("../../etc/passwd", "117", 1)
	if !ok {
		t.Fatal("the value still names a file, so the check reports on it")
	}
	if reference.OwnerFolder != "117/1" || reference.Filename != "passwd" {
		t.Fatalf("resolved to %s/%s, want it confined to the row's own folder", reference.OwnerFolder, reference.Filename)
	}
	for _, relativePath := range reference.RelativePaths {
		if filepath.IsAbs(relativePath) || len(relativePath) > 2 && relativePath[:2] == ".." {
			t.Fatalf("candidate path %q leaves the storage root", relativePath)
		}
	}
}

// A gallery row stored as a storage route address is looked for where the route serves
// it from, not in the parent row's own folder; otherwise a file in use could be listed
// as unused.
func TestGalleryReferenceWithTheStoragePrefixUsesItsOwnFolder(t *testing.T) {
	reference, ok := ResolveReference("/storage/117/5/original/photo.jpg", "300", 1)
	if !ok || reference.OwnerFolder != "117/5" || reference.Filename != "photo.jpg" {
		t.Fatalf("resolved to %+v (%v), want folder 117/5", reference, ok)
	}
}

// A card picture is placed the way the card picture rule places it, so the check never
// looks for it somewhere the writer would not.
func TestCardPictureReferenceIsPlacedLikeTheWriterPlacesIt(t *testing.T) {
	reference, ok := ResolveCardPictureReference("/storage/117/5/original/photo.jpg", "117", 4)
	if !ok || reference.OwnerFolder != "117/5" || reference.Filename != "photo.jpg" {
		t.Fatalf("a /storage/ address resolved to %+v (%v), want 117/5/photo.jpg", reference, ok)
	}
	if reference, ok = ResolveCardPictureReference("117_4_4.jpg", "117", 4); !ok || reference.OwnerFolder != "117/4" {
		t.Fatalf("a flat name resolved to %+v (%v), want the row's own folder", reference, ok)
	}
	const assetID = "3f1c2b0e-8a4d-4f6b-9c2e-5d7a1b3c4e5f"
	if reference, ok = ResolveCardPictureReference("/storage/media/"+assetID+"/original/image.webp", "117", 4); !ok || !reference.MediaLibrary {
		t.Fatalf("a media-library address resolved to %+v (%v), want the library folder", reference, ok)
	}
	for _, unplaceable := range []string{"../../etc/passwd", "117/5/extra/original/photo.jpg", "117/5/original/photo.jpg?size=1", "null/4/photo.jpg"} {
		if reference, ok := ResolveCardPictureReference(unplaceable, "117", 4); ok {
			t.Errorf("%q resolved to %+v; the writer cannot place it, so neither may the check", unplaceable, reference)
		}
	}
}

func TestUnresolvableReferencesAreRejectedSafely(t *testing.T) {
	cases := []struct {
		name        string
		storedValue string
		tableUID    string
		rowID       int64
	}{
		{name: "empty", storedValue: "   ", tableUID: "117", rowID: 1},
		{name: "no parent row", storedValue: "picture.webp", tableUID: "117", rowID: 0},
		{name: "no table uid", storedValue: "picture.webp", tableUID: "", rowID: 1},
		{name: "broken media library reference", storedValue: "/storage/media/not-a-uuid/original/image.webp", tableUID: "117", rowID: 1},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, ok := ResolveReference(testCase.storedValue, testCase.tableUID, testCase.rowID); ok {
				t.Fatalf("%q must not resolve to a storage path", testCase.storedValue)
			}
		})
	}
}
