package system_table_tools

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"easelect/backend/core_components/runtimepaths"
)

func TestResolveStorageDirUsesConfiguredRuntimeRoot(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(t.TempDir(), "app")
	paths, err := runtimepaths.Resolve(applicationRoot, installationRoot, true)
	if err != nil {
		t.Fatalf("runtimepaths.Resolve() error = %v", err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatalf("runtimepaths.Configure() error = %v", err)
	}
	t.Cleanup(func() {
		workingDirectory, workingDirectoryErr := os.Getwd()
		if workingDirectoryErr != nil {
			t.Errorf("os.Getwd() cleanup error = %v", workingDirectoryErr)
			return
		}
		legacyPaths, resolveErr := runtimepaths.Resolve(
			workingDirectory,
			workingDirectory,
			false,
		)
		if resolveErr != nil {
			t.Errorf("runtimepaths.Resolve() cleanup error = %v", resolveErr)
			return
		}
		if configureErr := runtimepaths.Configure(legacyPaths); configureErr != nil {
			t.Errorf("runtimepaths.Configure() cleanup error = %v", configureErr)
		}
	})

	if got := resolveStorageDir(); got != paths.StorageRoot {
		t.Fatalf("resolveStorageDir() = %q, want %q", got, paths.StorageRoot)
	}
}

func TestIsAllowedDatasetMediaExtensionRejectsUnsupportedTypes(t *testing.T) {
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"} {
		if !isAllowedDatasetMediaExtension(ext) {
			t.Fatalf("expected %s to be allowed", ext)
		}
	}

	for _, ext := range []string{".bmp", ".PNG", ""} {
		if isAllowedDatasetMediaExtension(ext) {
			t.Fatalf("expected %q to be rejected", ext)
		}
	}
}

func TestDatasetHeaderLangKeysReturnsDeterministicDefaults(t *testing.T) {
	keys := datasetHeaderLangKeys("app_muistilista")

	if keys.Title != "app_muistilista_front_page" {
		t.Fatalf("Title key = %q, want %q", keys.Title, "app_muistilista_front_page")
	}
	if keys.Slogan != "search_slogan_app_muistilista" {
		t.Fatalf("Slogan key = %q, want %q", keys.Slogan, "search_slogan_app_muistilista")
	}
	if keys.SearchPlaceholder != "search_for_app_muistilista" {
		t.Fatalf("SearchPlaceholder key = %q, want %q", keys.SearchPlaceholder, "search_for_app_muistilista")
	}
}

func TestDatasetHeaderSourceHighUsesCanonicalDatasetOwnership(t *testing.T) {
	got := datasetHeaderSourceHigh("app_muistilista", "title")
	if got != "app_muistilista" {
		t.Fatalf("datasetHeaderSourceHigh() = %q, want %q", got, "app_muistilista")
	}
}

func TestLegacyDatasetHeaderSourceHighRetainsDatasetAndFieldFormat(t *testing.T) {
	got := legacyDatasetHeaderSourceHigh("app_muistilista", "title")
	if got != "app_muistilista:title" {
		t.Fatalf("legacyDatasetHeaderSourceHigh() = %q, want %q", got, "app_muistilista:title")
	}
}

func TestSaveDatasetMediaFileUsesDatasetScopedRoleDirectory(t *testing.T) {
	fileHeader := datasetMediaTestFileHeader(t, "cover.png", []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	storageDir := t.TempDir()

	saved, err := saveDatasetMediaFile(storageDir, 104, "cover", fileHeader)
	if err != nil {
		t.Fatalf("saveDatasetMediaFile() error = %v", err)
	}

	wantPrefix := "104/dataset_media/cover/original/"
	if len(saved.StorageKey) <= len(wantPrefix) || saved.StorageKey[:len(wantPrefix)] != wantPrefix {
		t.Fatalf("StorageKey = %q, want prefix %q", saved.StorageKey, wantPrefix)
	}
	if saved.OriginalName != "cover.png" || saved.MIMEType != "image/png" {
		t.Fatalf("saved metadata = %#v", saved)
	}
	if _, err := os.Stat(filepath.Join(storageDir, filepath.FromSlash(saved.StorageKey))); err != nil {
		t.Fatalf("saved media stat error = %v", err)
	}
}

func TestSaveDatasetMediaFileRejectsUnsupportedRole(t *testing.T) {
	fileHeader := datasetMediaTestFileHeader(t, "cover.png", []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})

	if _, err := saveDatasetMediaFile(t.TempDir(), 104, "thumbnail", fileHeader); err == nil {
		t.Fatal("saveDatasetMediaFile() accepted unsupported role")
	}
}

func datasetMediaTestFileHeader(t *testing.T, filename string, content []byte) *multipart.FileHeader {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("dataset_media", filename)
	if err != nil {
		t.Fatalf("CreateFormFile() error = %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("multipart write error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("multipart close error = %v", err)
	}

	request, err := http.NewRequest(http.MethodPost, "/", &body)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(1 << 20); err != nil {
		t.Fatalf("ParseMultipartForm() error = %v", err)
	}
	files := request.MultipartForm.File["dataset_media"]
	if len(files) != 1 {
		t.Fatalf("multipart file count = %d, want 1", len(files))
	}
	return files[0]
}
