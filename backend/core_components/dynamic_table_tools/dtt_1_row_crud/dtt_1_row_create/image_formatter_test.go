// image_formatter_test.go
// Verifies image decode dimension, pixel, and memory budgets before thumbnail generation.
// Bridges synthetic image headers and the upload image formatter's allocation boundary.
// Exists to prevent decompression-bomb regressions in WebP, TIFF, and other decoders.

package dtt_1_row_create

import (
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateImageDimensionsWithinDecodeBudget(t *testing.T) {
	tests := []struct {
		name        string
		width       int
		height      int
		wantErrPart string
	}{
		{name: "ordinary camera image", width: 6000, height: 4000},
		{name: "non-positive dimension", width: 0, height: 4000, wantErrPart: "must be positive"},
		{name: "single dimension too large", width: maxDecodedImageDimension + 1, height: 1, wantErrPart: "maximum dimension"},
		{name: "pixel count too large", width: 8000, height: 6000, wantErrPart: "maximum pixel count"},
		{name: "decoded memory too large", width: 7000, height: 5000, wantErrPart: "decoded memory budget"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateImageDimensionsWithinDecodeBudget(test.width, test.height)
			if test.wantErrPart == "" {
				if err != nil {
					t.Fatalf("validateImageDimensionsWithinDecodeBudget returned error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.wantErrPart) {
				t.Fatalf("error = %v, want substring %q", err, test.wantErrPart)
			}
		})
	}
}

func TestWebPInputUsesMagicHeaderInsteadOfFilenameExtension(t *testing.T) {
	tempDir := t.TempDir()
	sourcePath := filepath.Join(tempDir, "source.png")
	webPPath := filepath.Join(tempDir, "encoded.webp")
	disguisedPath := filepath.Join(tempDir, "disguised.png")

	sourceFile, err := os.Create(sourcePath)
	if err != nil {
		t.Fatalf("create source image: %v", err)
	}
	sourceImage := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	sourceImage.Set(0, 0, color.NRGBA{R: 255, A: 255})
	sourceImage.Set(1, 0, color.NRGBA{B: 255, A: 255})
	if err := png.Encode(sourceFile, sourceImage); err != nil {
		_ = sourceFile.Close()
		t.Fatalf("encode source PNG: %v", err)
	}
	if err := sourceFile.Close(); err != nil {
		t.Fatalf("close source image: %v", err)
	}

	if err := ResizeImageMaxDimension(sourcePath, webPPath, 2); err != nil {
		t.Fatalf("encode WebP fixture: %v", err)
	}
	if err := os.Rename(webPPath, disguisedPath); err != nil {
		t.Fatalf("rename WebP fixture: %v", err)
	}

	if err := validateImageDecodeBudget(disguisedPath); err != nil {
		t.Fatalf("validate disguised WebP budget: %v", err)
	}
	decodedImage, err := decodeSourceImage(disguisedPath)
	if err != nil {
		t.Fatalf("decode disguised WebP: %v", err)
	}
	if got := decodedImage.Bounds().Size(); got.X != 2 || got.Y != 1 {
		t.Fatalf("decoded WebP size = %v, want (2,1)", got)
	}
}

func TestResizeImageMaxDimensionRejectsOversizedHeaderBeforeDecode(t *testing.T) {
	tempDir := t.TempDir()
	sourcePath := filepath.Join(tempDir, "oversized.png")
	destinationPath := filepath.Join(tempDir, "400", "oversized.png")
	writePNGHeader(t, sourcePath, 7000, 5000)

	err := ResizeImageMaxDimension(sourcePath, destinationPath, 400)
	if err == nil || !strings.Contains(err.Error(), "decoded memory budget") {
		t.Fatalf("ResizeImageMaxDimension error = %v, want decoded memory budget rejection", err)
	}
	if _, statErr := os.Stat(destinationPath); !os.IsNotExist(statErr) {
		t.Fatalf("destination file should not exist after budget rejection; stat error = %v", statErr)
	}
}

func writePNGHeader(t *testing.T, path string, width, height uint32) {
	t.Helper()

	data := make([]byte, 13)
	binary.BigEndian.PutUint32(data[0:4], width)
	binary.BigEndian.PutUint32(data[4:8], height)
	data[8] = 8 // bit depth
	data[9] = 6 // RGBA color type

	chunkTypeAndData := append([]byte("IHDR"), data...)
	fileBytes := append([]byte{}, 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n')
	length := make([]byte, 4)
	binary.BigEndian.PutUint32(length, uint32(len(data)))
	fileBytes = append(fileBytes, length...)
	fileBytes = append(fileBytes, chunkTypeAndData...)
	checksum := make([]byte, 4)
	binary.BigEndian.PutUint32(checksum, crc32.ChecksumIEEE(chunkTypeAndData))
	fileBytes = append(fileBytes, checksum...)

	if err := os.WriteFile(path, fileBytes, 0o644); err != nil {
		t.Fatalf("write PNG header: %v", err)
	}
}
