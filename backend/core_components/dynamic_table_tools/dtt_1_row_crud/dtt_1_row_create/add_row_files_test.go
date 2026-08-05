package dtt_1_row_create

import (
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/media_utils"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveAllowedExtensionsUsesConfigTypes(t *testing.T) {
	config := dtt_asset_linking.FileUploadConfig{
		AllowedFileTypes: []string{"pdf", ".docx", "zip"},
	}

	allowed := resolveAllowedExtensions(config)

	for _, ext := range []string{"pdf", "docx", "zip"} {
		if !isAllowedExtension(ext, allowed) {
			t.Fatalf("expected %q to be allowed", ext)
		}
	}
	if isAllowedExtension("png", allowed) {
		t.Fatal("did not expect png to be allowed when explicit attachment extensions were provided")
	}
}

func TestResolveAllowedExtensionsFallsBackToImageDefaults(t *testing.T) {
	allowed := resolveAllowedExtensions(dtt_asset_linking.FileUploadConfig{})

	for ext := range media_utils.AllowedImageExtensions {
		if !isAllowedExtension(ext, allowed) {
			t.Fatalf("expected image extension %q to be allowed", ext)
		}
	}
}

func TestRequiredUploadSubfoldersForAttachment(t *testing.T) {
	config := dtt_asset_linking.FileUploadConfig{
		ProfileKey: dtt_asset_linking.AssetProfileAttachment,
		AssetKinds: []dtt_asset_linking.AssetKind{dtt_asset_linking.AssetKindPDF},
	}

	subfolders := requiredUploadSubfolders(config)
	if len(subfolders) != 1 || subfolders[0] != "original" {
		t.Fatalf("requiredUploadSubfolders(%#v) = %#v, want []string{\"original\"}", config, subfolders)
	}
}

func TestRequiredUploadSubfoldersForImage(t *testing.T) {
	config := dtt_asset_linking.FileUploadConfig{
		ProfileKey: dtt_asset_linking.AssetProfileImage,
		AssetKinds: []dtt_asset_linking.AssetKind{dtt_asset_linking.AssetKindImage},
	}

	subfolders := requiredUploadSubfolders(config)
	if len(subfolders) != len(media_utils.RequiredSubfolders) {
		t.Fatalf("requiredUploadSubfolders image len = %d, want %d", len(subfolders), len(media_utils.RequiredSubfolders))
	}
	for i, want := range media_utils.RequiredSubfolders {
		if subfolders[i] != want {
			t.Fatalf("requiredUploadSubfolders[%d] = %q, want %q", i, subfolders[i], want)
		}
	}
}

func TestCanonicalSharedAssetProfileResolvesImageDisplayVariants(t *testing.T) {
	config := dtt_asset_linking.FileUploadConfig{
		ProfileKey: dtt_asset_linking.SharedAssetProfileKey,
		Profiles: map[string]dtt_asset_linking.FileUploadProfileConfig{
			dtt_asset_linking.AssetProfileImage: {
				Enabled:    true,
				AssetKinds: []dtt_asset_linking.AssetKind{dtt_asset_linking.AssetKindImage},
			},
		},
	}
	profileKey := dtt_asset_linking.ResolveProfileKeyForAssetKind(string(dtt_asset_linking.AssetKindImage))
	effective, ok := dtt_asset_linking.ResolveEffectiveUploadConfigForProfile(config, "palvelukatalogi_assets", profileKey)
	if !ok {
		t.Fatal("canonical asset_linking image profile was not resolved")
	}
	if !isImageUpload(effective) {
		t.Fatal("resolved canonical asset upload was not classified as an image")
	}
	if got := requiredUploadSubfolders(effective); len(got) != len(media_utils.RequiredSubfolders) {
		t.Fatalf("image upload subfolders = %#v, want all display variants %#v", got, media_utils.RequiredSubfolders)
	}
}

func TestCreateImageDisplayVariantCopiesBrowserImageWithoutLocalDecoder(t *testing.T) {
	if !shouldCopySourceAsDisplayVariant("example.avif") {
		t.Fatal("expected avif to use passthrough display variant")
	}
	if shouldCopySourceAsDisplayVariant("example.png") {
		t.Fatal("did not expect png to use passthrough display variant")
	}

	tempDir := t.TempDir()
	sourcePath := filepath.Join(tempDir, "original.avif")
	destinationPath := filepath.Join(tempDir, "400", "original.avif")
	sourceBytes := []byte("fake-avif-bytes")

	if err := os.WriteFile(sourcePath, sourceBytes, 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	if err := CreateImageDisplayVariant(sourcePath, destinationPath, 300); err != nil {
		t.Fatalf("CreateImageDisplayVariant returned error: %v", err)
	}

	gotBytes, err := os.ReadFile(destinationPath)
	if err != nil {
		t.Fatalf("read destination: %v", err)
	}
	if string(gotBytes) != string(sourceBytes) {
		t.Fatalf("fallback bytes = %q, want %q", string(gotBytes), string(sourceBytes))
	}
}

func TestResolveUploadStorageCoordinatesUsesParentContextForDirectSharedAssets(t *testing.T) {
	tableUID, rowID, err := resolveUploadStorageCoordinates(
		"2758",
		9,
		false,
		dtt_asset_linking.SharedAssetParentStorageContext{
			ParentTableUID: "104",
			ParentRowID:    41,
		},
	)
	if err != nil {
		t.Fatalf("resolveUploadStorageCoordinates returned error: %v", err)
	}
	if tableUID != "104" || rowID != 41 {
		t.Fatalf("resolveUploadStorageCoordinates = (%q, %d), want (104, 41)", tableUID, rowID)
	}
}

func TestResolveUploadStorageCoordinatesFallsBackWhenNoParentContextExists(t *testing.T) {
	tableUID, rowID, err := resolveUploadStorageCoordinates(
		"2758",
		9,
		false,
		dtt_asset_linking.SharedAssetParentStorageContext{},
	)
	if err != nil {
		t.Fatalf("resolveUploadStorageCoordinates returned error: %v", err)
	}
	if tableUID != "2758" || rowID != 9 {
		t.Fatalf("resolveUploadStorageCoordinates fallback = (%q, %d), want (2758, 9)", tableUID, rowID)
	}
}

func TestRemoveUploadedFileVariantsRemovesOnlyCurrentUpload(t *testing.T) {
	baseFolder := t.TempDir()
	subfolders := []string{"original", "320", "640", "1280"}
	for _, subfolder := range subfolders {
		if err := os.MkdirAll(filepath.Join(baseFolder, subfolder), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", subfolder, err)
		}
		if err := os.WriteFile(filepath.Join(baseFolder, subfolder, "new.jpg"), []byte("new"), 0o644); err != nil {
			t.Fatalf("write new file: %v", err)
		}
	}
	existingPath := filepath.Join(baseFolder, "original", "existing.jpg")
	if err := os.WriteFile(existingPath, []byte("existing"), 0o644); err != nil {
		t.Fatalf("write existing file: %v", err)
	}

	removeUploadedFileVariants(baseFolder, subfolders, "new.jpg")

	if _, err := os.Stat(existingPath); err != nil {
		t.Fatalf("pre-existing file was removed: %v", err)
	}
	for _, subfolder := range subfolders {
		if _, err := os.Stat(filepath.Join(baseFolder, subfolder, "new.jpg")); !os.IsNotExist(err) {
			t.Fatalf("current upload remains in %s: %v", subfolder, err)
		}
	}
}

func TestLoadFileUploadConfigPropagatesDatabaseErrors(t *testing.T) {
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	pushQuery(queuedQuery{err: errMock("transaction aborted")})

	if _, _, err := loadFileUploadConfigForUpload(db, "palvelukatalogi_assets", "palvelukatalogi_id"); err == nil {
		t.Fatal("loadFileUploadConfigForUpload() error = nil, want database failure")
	}
}
