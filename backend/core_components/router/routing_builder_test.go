package router

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetProjectLogoPathReturnsStoragePathWhenLogoExists(t *testing.T) {
	tempDir := t.TempDir()
	logoFile := filepath.Join(tempDir, "project_logo.png")
	if err := os.WriteFile(logoFile, []byte("png"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	previousStorageDir := localStorageDir
	localStorageDir = tempDir
	t.Cleanup(func() {
		localStorageDir = previousStorageDir
	})

	got := getProjectLogoPath()
	if got != "/storage/project_logo.png" {
		t.Fatalf("getProjectLogoPath() = %q, want %q", got, "/storage/project_logo.png")
	}
}

func TestGetProjectLogoPathReturnsEmptyWhenLogoMissing(t *testing.T) {
	previousStorageDir := localStorageDir
	localStorageDir = t.TempDir()
	t.Cleanup(func() {
		localStorageDir = previousStorageDir
	})

	got := getProjectLogoPath()
	if got != "" {
		t.Fatalf("getProjectLogoPath() = %q, want empty string", got)
	}
}

func TestGetProjectLogoPathSupportsNonPngExtensions(t *testing.T) {
	tempDir := t.TempDir()
	logoFile := filepath.Join(tempDir, "project_logo.jpg")
	if err := os.WriteFile(logoFile, []byte("jpg"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	previousStorageDir := localStorageDir
	localStorageDir = tempDir
	t.Cleanup(func() {
		localStorageDir = previousStorageDir
	})

	got := getProjectLogoPath()
	if got != "/storage/project_logo.jpg" {
		t.Fatalf("getProjectLogoPath() = %q, want %q", got, "/storage/project_logo.jpg")
	}
}

func TestResolveInstallationEnvironmentUsesExplicitFirstRunChoice(t *testing.T) {
	for _, environment := range []string{"dev", "test", "qa", "prod"} {
		if got := resolveInstallationEnvironment(environment, "prod"); got != environment {
			t.Fatalf("resolveInstallationEnvironment(%q, prod) = %q", environment, got)
		}
	}
}

func TestResolveInstallationEnvironmentPreservesRuntimeFallbackBeforeFirstRunChoice(t *testing.T) {
	if got := resolveInstallationEnvironment("", "dev"); got != "dev" {
		t.Fatalf("empty stored environment in dev runtime = %q, want dev", got)
	}
	if got := resolveInstallationEnvironment("", "prod"); got != "prod" {
		t.Fatalf("empty stored environment in prod runtime = %q, want prod", got)
	}
	if got := resolveInstallationEnvironment("unexpected", "dev"); got != "dev" {
		t.Fatalf("invalid stored environment in dev runtime = %q, want dev", got)
	}
}

func TestDefaultSpecificTableRelatedForMixedFolderRoutes(t *testing.T) {
	if !defaultSpecificTableRelated("dtt_system_table_folders.HandleUpdateTableFolder") {
		t.Fatal("HandleUpdateTableFolder should default to table-specific permissions")
	}

	if defaultSpecificTableRelated("dtt_system_table_folders.HandleUpdateFolder") {
		t.Fatal("HandleUpdateFolder should stay tableless by default")
	}
}

func TestParseProtectedStoragePath(t *testing.T) {
	parsed, ok := parseProtectedStoragePath("104/133/original/104_133_38.pdf")
	if !ok || parsed.TableUID != "104" || parsed.ParentRowID != 133 || parsed.Variant != "original" || parsed.Filename != "104_133_38.pdf" {
		t.Fatalf("parseProtectedStoragePath() = (%#v, %v), want canonical storage identity", parsed, ok)
	}
	if parsed, ok := parseProtectedStoragePath("project_logo.png"); ok || parsed.TableUID != "" {
		t.Fatalf("parseProtectedStoragePath(project_logo.png) = (%#v, %v), want zero false", parsed, ok)
	}
}

func TestPublicStoragePathAllowlist(t *testing.T) {
	if !isPublicStoragePath("project_logo.png") {
		t.Fatal("project logo should stay public")
	}
	if !isPublicStoragePath("service_catalog_logos/firefox.svg") {
		t.Fatal("legacy service catalog logos should stay public")
	}
	if isPublicStoragePath("104/133/original/104_133_38.png") {
		t.Fatal("row-scoped storage must not be public")
	}
}

func TestSetStorageDownloadHeadersForAttachments(t *testing.T) {
	rr := httptest.NewRecorder()
	setStorageDownloadHeaders(rr, "104/133/original/contract.pdf")
	if got := rr.Header().Get("Content-Disposition"); !strings.Contains(got, "attachment") || !strings.Contains(got, "contract.pdf") {
		t.Fatalf("Content-Disposition = %q, want attachment filename", got)
	}

	rr = httptest.NewRecorder()
	setStorageDownloadHeaders(rr, "104/133/300/photo.png")
	if got := rr.Header().Get("Content-Disposition"); got != "" {
		t.Fatalf("image Content-Disposition = %q, want empty", got)
	}
}
