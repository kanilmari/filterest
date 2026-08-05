package system_table_tools

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFindProjectLogoPublicPathSupportsJpg(t *testing.T) {
	storageDir := t.TempDir()
	logoFile := filepath.Join(storageDir, "project_logo.jpg")
	if err := os.WriteFile(logoFile, []byte("jpg"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got := findProjectLogoPublicPath(storageDir)
	if got != "/storage/project_logo.jpg" {
		t.Fatalf("findProjectLogoPublicPath() = %q, want %q", got, "/storage/project_logo.jpg")
	}
}

func TestRemoveExistingProjectLogoFilesRemovesAllSupportedVariants(t *testing.T) {
	storageDir := t.TempDir()
	for _, ext := range projectLogoExtensions {
		logoFile := filepath.Join(storageDir, "project_logo"+ext)
		if err := os.WriteFile(logoFile, []byte(ext), 0o644); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", ext, err)
		}
	}

	if err := removeExistingProjectLogoFiles(storageDir); err != nil {
		t.Fatalf("removeExistingProjectLogoFiles() error = %v", err)
	}

	for _, ext := range projectLogoExtensions {
		logoFile := filepath.Join(storageDir, "project_logo"+ext)
		if _, err := os.Stat(logoFile); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("expected %q to be removed, stat error = %v", logoFile, err)
		}
	}
}

func TestIsAllowedProjectLogoExtensionRejectsUnsupportedTypes(t *testing.T) {
	if !isAllowedProjectLogoExtension(".webp") {
		t.Fatal("expected .webp to be allowed")
	}

	if isAllowedProjectLogoExtension(".bmp") {
		t.Fatal("expected .bmp to be rejected")
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
