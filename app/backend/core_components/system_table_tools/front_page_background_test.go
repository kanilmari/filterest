// front_page_background_test.go
// Verifies the shared saver, conservative image allowlist and complete variant cleanup.
// Uses real image bytes and temporary storage without installation or network access.
// Covers the added Home boxes and video contracts without a live database.
package system_table_tools

import (
	"bytes"
	"image"
	"image/png"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func frontPageTestPNG(t *testing.T) []byte {
	t.Helper()
	var content bytes.Buffer
	if err := png.Encode(&content, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	return content.Bytes()
}

func TestFrontPageBackgroundSaverVariantsAndCleanup(t *testing.T) {
	root := t.TempDir()
	header := datasetMediaTestFileHeader(t, "photo.png", frontPageTestPNG(t))
	saved, err := savePresentationMediaFile(root, frontPageBackgroundRoot, header, isAllowedFrontPageMediaExtension, frontPageBackgroundMaxBytes,
		func(name, ext string) error {
			return createPresentationMediaDisplayVariants(root, frontPageBackgroundRoot, name, ext, []int{1000, 2160}, true)
		})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(saved.StorageKey, "site_media/front_page/original/") || saved.MIMEType != "image/png" {
		t.Fatal(saved)
	}
	for _, variant := range []string{"original", "1000", "2160"} {
		if _, err := os.Stat(filepath.Join(root, frontPageBackgroundRoot, variant, filepath.Base(saved.StorageKey))); err != nil {
			t.Fatal(err)
		}
	}
	removePresentationMediaFiles(root, frontPageBackgroundRoot, filepath.Base(saved.StorageKey))
	for _, variant := range []string{"original", "1000", "2160"} {
		if _, err := os.Stat(filepath.Join(root, frontPageBackgroundRoot, variant, filepath.Base(saved.StorageKey))); !os.IsNotExist(err) {
			t.Fatal("cleanup", variant, err)
		}
	}
}

func TestFrontPageBackgroundRejectsTypeSignatureSizeAndBrokenImage(t *testing.T) {
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".webp"} {
		if !isAllowedFrontPageMediaExtension(ext) {
			t.Fatal(ext)
		}
	}
	for _, tc := range []struct {
		name     string
		data     []byte
		oversize bool
	}{
		{"image.svg", []byte("<svg></svg>"), false}, {"image.gif", []byte("GIF89a"), false},
		{"image.jpg", frontPageTestPNG(t), false}, {"image.png", []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, false},
		{"large.png", frontPageTestPNG(t), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			header := datasetMediaTestFileHeader(t, tc.name, tc.data)
			if tc.oversize {
				header.Size = frontPageBackgroundMaxBytes + 1
			}
			_, err := savePresentationMediaFile(root, frontPageBackgroundRoot, header, isAllowedFrontPageMediaExtension, frontPageBackgroundMaxBytes,
				func(name, ext string) error {
					return createPresentationMediaDisplayVariants(root, frontPageBackgroundRoot, name, ext, []int{1000, 2160}, true)
				})
			if err == nil {
				t.Fatal("accepted unsupported image")
			}
			_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
				if err == nil && !entry.IsDir() {
					t.Error("failed saver left a file", path)
				}
				return err
			})
		})
	}
	if validFrontPageFocalPoint(-1, 0.5) || validFrontPageFocalPoint(0.5, 2) || !validFrontPageFocalPoint(0, 1) {
		t.Fatal("focal validation")
	}
	response := httptest.NewRecorder()
	FrontPageBackgroundHandler(response, httptest.NewRequest("GET", "/api/admin/front-page/background", nil))
	if response.Code != 405 {
		t.Fatal(response.Code)
	}
}

func TestFrontPageVideoSaverOriginalOnlyAndSignatureRefusal(t *testing.T) {
	for name, data := range map[string][]byte{
		"movie.mp4":  {0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'm', 'p', '4', '2'},
		"movie.webm": {0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 'w', 'e', 'b', 'm'},
	} {
		root := t.TempDir()
		header := datasetMediaTestFileHeader(t, name, data)
		saved, err := savePresentationMediaFile(root, frontPageBackgroundRoot, header, isAllowedFrontPageMediaExtension, frontPageVideoMaxBytes, func(string, string) error { return nil })
		if err != nil || !strings.HasPrefix(saved.MIMEType, "video/") {
			t.Fatal(saved, err)
		}
		if _, err := os.Stat(filepath.Join(root, saved.StorageKey)); err != nil {
			t.Fatal(err)
		}
		for _, variant := range []string{"1000", "2160"} {
			if _, err := os.Stat(filepath.Join(root, frontPageBackgroundRoot, variant, filepath.Base(saved.StorageKey))); !os.IsNotExist(err) {
				t.Fatal("resized video", err)
			}
		}
		bad := datasetMediaTestFileHeader(t, name, frontPageTestPNG(t))
		if _, err := savePresentationMediaFile(root, frontPageBackgroundRoot, bad, isAllowedFrontPageMediaExtension, frontPageVideoMaxBytes, func(string, string) error { return nil }); err == nil {
			t.Fatal("renamed video accepted")
		}
		header.Size = frontPageVideoMaxBytes + 1
		if _, err := savePresentationMediaFile(root, frontPageBackgroundRoot, header, isAllowedFrontPageMediaExtension, frontPageVideoMaxBytes, func(string, string) error { return nil }); err == nil {
			t.Fatal("oversized video accepted")
		}
	}
}
