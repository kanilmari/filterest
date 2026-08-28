// site_favicon_test.go
// Verifies current site identities resolve to versioned pixel icons and the new F stays 16 px sharp.
package frontendassets

import (
	"image"
	_ "image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestSiteFaviconPathUsesSiteNameInitial(t *testing.T) {
	frontendDir := t.TempDir()
	assetDir := filepath.Join(frontendDir, "icons", "site_favicons")
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(): %v", err)
	}
	for _, fileName := range []string{
		"site-initial-e-v1-16.png",
		"site-initial-es-v1-16.png",
		"site-initial-f-v1-16.png",
		"site-initial-k-v1-16.png",
		"site-initial-s-v1-16.png",
	} {
		if err := os.WriteFile(filepath.Join(assetDir, fileName), []byte("png"), 0o644); err != nil {
			t.Fatalf("WriteFile(%s): %v", fileName, err)
		}
	}

	tests := []struct {
		name           string
		siteName       string
		configuredFile string
		want           string
	}{
		{name: "Fintravel", siteName: "Fintravel", want: defaultSiteFaviconPath},
		{name: "lowercase Serlog", siteName: "serlog.com", want: "/frontend/icons/site_favicons/site-initial-s-v1-16.png"},
		{name: "multi-word initials", siteName: "Easelect Something", want: "/frontend/icons/site_favicons/site-initial-es-v1-16.png"},
		{name: "multi-word fallback to first initial", siteName: "Easelect Workspace", want: "/frontend/icons/site_favicons/site-initial-e-v1-16.png"},
		{name: "explicit configured file wins", siteName: "Easelect Something", configuredFile: "site-initial-s-v1-16.png", want: "/frontend/icons/site_favicons/site-initial-s-v1-16.png"},
		{name: "unsafe configured path is ignored", siteName: "Easelect Something", configuredFile: "../site-initial-s-v1-16.png", want: "/frontend/icons/site_favicons/site-initial-es-v1-16.png"},
		{name: "missing configured file is ignored", siteName: "Easelect Something", configuredFile: "missing.png", want: "/frontend/icons/site_favicons/site-initial-es-v1-16.png"},
		{name: "Easelect after punctuation", siteName: "  2026 — Easelect", want: "/frontend/icons/site_favicons/site-initial-e-v1-16.png"},
		{name: "future available initial", siteName: "Knowledge", want: "/frontend/icons/site_favicons/site-initial-k-v1-16.png"},
		{name: "missing Latin initial", siteName: "Travel", want: defaultSiteFaviconPath},
		{name: "unsupported initial", siteName: "Åland", want: defaultSiteFaviconPath},
		{name: "empty", siteName: "", want: defaultSiteFaviconPath},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := SiteFaviconPath(frontendDir, test.siteName, test.configuredFile); got != test.want {
				t.Fatalf("SiteFaviconPath(%q, %q) = %q, want %q", test.siteName, test.configuredFile, got, test.want)
			}
		})
	}
}

func TestSiteInitialFaviconAssetsStayPixelSharp(t *testing.T) {
	assetDir := filepath.Join("..", "..", "..", "frontend", "icons", "site_favicons")
	for _, fileName := range []string{
		"site-initial-e-v1-16.png",
		"site-initial-es-v1-16.png",
		"site-initial-f-v1-16.png",
		"site-initial-s-v1-16.png",
	} {
		file, err := os.Open(filepath.Join(assetDir, fileName))
		if err != nil {
			t.Fatalf("open %s: %v", fileName, err)
		}
		imageValue, _, decodeErr := image.Decode(file)
		file.Close()
		if decodeErr != nil {
			t.Fatalf("decode %s: %v", fileName, decodeErr)
		}
		if got := imageValue.Bounds().Size(); got.X != 16 || got.Y != 16 {
			t.Fatalf("%s dimensions = %dx%d, want 16x16", fileName, got.X, got.Y)
		}
		assertSiteFaviconPalette(t, fileName, imageValue)
	}

}

func TestSiteFaviconPathRejectsSymlinkOverride(t *testing.T) {
	frontendDir := t.TempDir()
	assetDir := filepath.Join(frontendDir, "icons", "site_favicons")
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(): %v", err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, "site-initial-f-v1-16.png"), []byte("png"), 0o644); err != nil {
		t.Fatalf("WriteFile(): %v", err)
	}
	if err := os.Symlink("site-initial-f-v1-16.png", filepath.Join(assetDir, "selected.png")); err != nil {
		t.Fatalf("Symlink(): %v", err)
	}

	if got := SiteFaviconPath(frontendDir, "Unknown", "selected.png"); got != defaultSiteFaviconPath {
		t.Fatalf("SiteFaviconPath() = %q, want fallback", got)
	}
}

func assertSiteFaviconPalette(t *testing.T, fileName string, imageValue image.Image) {
	t.Helper()
	for y := 0; y < imageValue.Bounds().Dy(); y++ {
		for x := 0; x < imageValue.Bounds().Dx(); x++ {
			r, g, b, a := imageValue.At(x, y).RGBA()
			if a == 0 {
				continue
			}
			pixel := [3]uint8{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8)}
			if pixel != [3]uint8{255, 255, 255} && pixel != [3]uint8{55, 83, 121} {
				t.Fatalf("%s has unexpected pixel at %d,%d: %v", fileName, x, y, pixel)
			}
		}
	}
}
