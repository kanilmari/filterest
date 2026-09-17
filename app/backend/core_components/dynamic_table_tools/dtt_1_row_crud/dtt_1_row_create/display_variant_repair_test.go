package dtt_1_row_create

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func writeTestPNG(t *testing.T, path string, width, height int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, width, height))); err != nil {
		t.Fatalf("encode: %v", err)
	}
	if err := os.WriteFile(path, buffer.Bytes(), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestRepairUpscaledDisplayVariantsReplacesOnlyEnlargedVariants(t *testing.T) {
	storage := t.TempDir()
	// Row asset, dataset media and media library layouts share the original/<size> shape.
	rowOriginal := filepath.Join(storage, "104", "7", "original", "104_7_1.png")
	writeTestPNG(t, rowOriginal, 40, 20)
	writeTestPNG(t, filepath.Join(storage, "104", "7", "300", "104_7_1.png"), 40, 20)
	writeTestPNG(t, filepath.Join(storage, "104", "7", "1000", "104_7_1.png"), 1000, 500)
	writeTestPNG(t, filepath.Join(storage, "104", "7", "2160", "104_7_1.png"), 2160, 1080)

	datasetOriginal := filepath.Join(storage, "104", "dataset_media", "background", "original", "bg.png")
	writeTestPNG(t, datasetOriginal, 1200, 800)
	writeTestPNG(t, filepath.Join(storage, "104", "dataset_media", "background", "1000", "bg.png"), 1000, 667)
	writeTestPNG(t, filepath.Join(storage, "104", "dataset_media", "background", "2160", "bg.png"), 2160, 1440)

	libraryOriginal := filepath.Join(storage, "media", "0b4d2f7e-8c1a-4c55-9f0e-2a4b6c8d0e1f", "original", "image.png")
	writeTestPNG(t, libraryOriginal, 300, 300)
	writeTestPNG(t, filepath.Join(storage, "media", "0b4d2f7e-8c1a-4c55-9f0e-2a4b6c8d0e1f", "1000", "image.png"), 1000, 1000)

	// Unreadable formats and symlinked variants are left untouched.
	svgDir := filepath.Join(storage, "105", "1")
	if err := os.MkdirAll(filepath.Join(svgDir, "original"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svgDir, "original", "logo.svg"), []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.png")
	writeTestPNG(t, outside, 4000, 4000)
	symlinkOriginal := filepath.Join(storage, "106", "1", "original", "x.png")
	writeTestPNG(t, symlinkOriginal, 10, 10)
	if err := os.MkdirAll(filepath.Join(storage, "106", "1", "300"), 0o755); err != nil {
		t.Fatal(err)
	}
	symlinkVariant := filepath.Join(storage, "106", "1", "300", "x.png")
	if err := os.Symlink(outside, symlinkVariant); err != nil {
		t.Fatal(err)
	}

	result, err := RepairUpscaledDisplayVariants(storage)
	if err != nil {
		t.Fatalf("repair: %v", err)
	}
	if result.CheckedVariants != 6 || result.ReplacedVariants != 4 || result.FailedVariants != 0 {
		t.Fatalf("result = %+v, want 6 checked, 4 replaced, 0 failed", result)
	}

	sameBytes := func(variant, original string) bool {
		a, _ := os.ReadFile(variant)
		b, _ := os.ReadFile(original)
		return bytes.Equal(a, b)
	}
	for _, variant := range []string{
		filepath.Join(storage, "104", "7", "1000", "104_7_1.png"),
		filepath.Join(storage, "104", "7", "2160", "104_7_1.png"),
	} {
		if !sameBytes(variant, rowOriginal) {
			t.Fatalf("upscaled row variant not replaced: %s", variant)
		}
	}
	if !sameBytes(filepath.Join(storage, "104", "dataset_media", "background", "2160", "bg.png"), datasetOriginal) {
		t.Fatal("upscaled dataset background variant not replaced")
	}
	if config, _ := readImageConfig(filepath.Join(storage, "104", "dataset_media", "background", "1000", "bg.png")); config.Width != 1000 {
		t.Fatalf("genuine downscaled variant changed: %+v", config)
	}
	if !sameBytes(filepath.Join(storage, "media", "0b4d2f7e-8c1a-4c55-9f0e-2a4b6c8d0e1f", "1000", "image.png"), libraryOriginal) {
		t.Fatal("upscaled media library variant not replaced")
	}
	if target, err := os.Readlink(symlinkVariant); err != nil || target != outside {
		t.Fatalf("symlinked variant must stay untouched: %q %v", target, err)
	}
	if config, _ := readImageConfig(outside); config.Width != 4000 {
		t.Fatal("file outside storage must not be modified")
	}
	leftovers, _ := filepath.Glob(filepath.Join(storage, "*", "*", "*", ".variant-*"))
	if len(leftovers) != 0 {
		t.Fatalf("temporary files left behind: %v", leftovers)
	}

	again, err := RepairUpscaledDisplayVariants(storage)
	if err != nil || again.ReplacedVariants != 0 {
		t.Fatalf("second run = %+v, %v; want no replacements", again, err)
	}
}

func TestRepairUpscaledDisplayVariantsToleratesMissingStorage(t *testing.T) {
	result, err := RepairUpscaledDisplayVariants(filepath.Join(t.TempDir(), "missing"))
	if err != nil || result != (DisplayVariantRepairResult{}) {
		t.Fatalf("missing storage = %+v, %v", result, err)
	}
}

func TestRepairUpscaledDisplayVariantsReplacesVariantsHeavierThanOriginal(t *testing.T) {
	storage := t.TempDir()
	original := filepath.Join(storage, "10005", "126", "original", "photo.png")
	writeTestPNG(t, original, 1280, 836)
	heavy := filepath.Join(storage, "10005", "126", "1000", "photo.png")
	if err := os.MkdirAll(filepath.Dir(heavy), 0o755); err != nil {
		t.Fatal(err)
	}
	// Fewer pixels, more bytes: a noisy 1000 px variant next to a flat original.
	noisy := image.NewRGBA(image.Rect(0, 0, 1000, 653))
	for index := range noisy.Pix {
		noisy.Pix[index] = uint8(index * 131)
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, noisy); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(heavy, buffer.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := RepairUpscaledDisplayVariants(storage)
	if err != nil || result.CheckedVariants != 1 || result.ReplacedVariants != 1 {
		t.Fatalf("result = %+v, %v; want 1 checked, 1 replaced", result, err)
	}
	originalBytes, _ := os.ReadFile(original)
	variantBytes, _ := os.ReadFile(heavy)
	if !bytes.Equal(originalBytes, variantBytes) {
		t.Fatal("variant heavier than its original must be replaced by the original")
	}
}
