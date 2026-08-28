// image_formatter.go
// Image processing utilities for resizing uploaded images proportionally.
// Bridges the file upload path and the filesystem with format-aware scaling (WebP, JPEG, PNG).
// Exists to enforce max-dimension constraints on uploaded images before storage.

package dtt_1_row_create

import (
	"fmt"
	"image"
	"io"
	"os"
	"path/filepath"
	"strings"

	webp "github.com/chai2010/webp" // WebP encoding
	"github.com/disintegration/imaging"
	xwebp "golang.org/x/image/webp"
)

const (
	maxDecodedImageDimension        = 16_384
	maxDecodedImagePixels    uint64 = 40_000_000
	maxDecodedImageBytes     uint64 = 256 << 20
	estimatedBytesPerPixel   uint64 = 8
)

// CreateImageDisplayVariant creates one stored display variant for uploaded images.
// Between: upload/media repair flows -> ResizeImageMaxDimension or passthrough storage.
// Why: Keeps browser-displayable formats working even when local Go decoders cannot resize them yet.
func CreateImageDisplayVariant(sourcePath, destinationPath string, maxDimension int) error {
	if shouldCopySourceAsDisplayVariant(sourcePath) {
		return copySourceAsDisplayVariant(sourcePath, destinationPath)
	}
	return ResizeImageMaxDimension(sourcePath, destinationPath, maxDimension)
}

// ResizeImageMaxDimension scales an image so its longest side is maxDimension pixels.
// Between: validated source images and format-aware thumbnail files on disk.
// Why: Produces bounded display variants while preserving the source aspect ratio.
func ResizeImageMaxDimension(sourcePath, destinationPath string, maxDimension int) error {
	if err := validateImageDecodeBudget(sourcePath); err != nil {
		return err
	}

	sourceImage, err := decodeSourceImage(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open source image %q: %w", sourcePath, err)
	}

	sourceWidth := sourceImage.Bounds().Dx()
	sourceHeight := sourceImage.Bounds().Dy()

	var resizedImage image.Image
	if sourceWidth >= sourceHeight {
		resizedImage = imaging.Resize(sourceImage, maxDimension, 0, imaging.Lanczos)
	} else {
		resizedImage = imaging.Resize(sourceImage, 0, maxDimension, imaging.Lanczos)
	}

	// Ensure the destination directory exists before opening the output file.
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	// Encode WebP separately because imaging does not provide a WebP encoder.
	if strings.EqualFold(filepath.Ext(destinationPath), ".webp") {
		f, err := os.Create(destinationPath)
		if err != nil {
			return fmt.Errorf("failed to create destination file: %w", err)
		}
		defer f.Close()

		options := &webp.Options{
			Lossless: false,
			Quality:  85,
		}
		if err := webp.Encode(f, resizedImage, options); err != nil {
			return fmt.Errorf("webp encode failed: %w", err)
		}
		return nil
	}

	// imaging handles the remaining registered formats (JPEG, PNG, GIF, TIFF, BMP).
	if err := imaging.Save(resizedImage, destinationPath); err != nil {
		return fmt.Errorf("failed to save image: %w", err)
	}
	return nil
}

// decodeSourceImage routes WebP input explicitly through x/image's patched decoder.
// Between: validated upload files and the in-memory image used by the resizer.
// Why: The CGO encoder dependency also registers a decoder, so generic dispatch is unsafe for WebP.
func decodeSourceImage(sourcePath string) (image.Image, error) {
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open source image %q: %w", sourcePath, err)
	}
	defer sourceFile.Close()

	isWebP, err := readerHasWebPHeader(sourceFile)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect source image %q: %w", sourcePath, err)
	}
	if isWebP {
		decodedImage, err := xwebp.Decode(sourceFile)
		if err != nil {
			return nil, fmt.Errorf("failed to decode WebP source image %q: %w", sourcePath, err)
		}
		return decodedImage, nil
	}

	decodedImage, err := imaging.Open(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open source image %q: %w", sourcePath, err)
	}
	return decodedImage, nil
}

// validateImageDecodeBudget inspects image dimensions without decoding the full pixel buffer.
// Between: stored upload files and imaging.Open's format-specific decoders.
// Why: Rejects decompression bombs and pathological dimensions before expensive allocations.
func validateImageDecodeBudget(sourcePath string) error {
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open source image for budget validation: %w", err)
	}
	defer sourceFile.Close()

	isWebP, err := readerHasWebPHeader(sourceFile)
	if err != nil {
		return fmt.Errorf("failed to inspect source image header: %w", err)
	}

	var config image.Config
	if isWebP {
		config, err = xwebp.DecodeConfig(sourceFile)
	} else {
		config, _, err = image.DecodeConfig(sourceFile)
	}
	if err != nil {
		return fmt.Errorf("failed to inspect source image dimensions: %w", err)
	}

	return validateImageDimensionsWithinDecodeBudget(config.Width, config.Height)
}

// readerHasWebPHeader detects RIFF/WebP independently of the file extension and rewinds the reader.
func readerHasWebPHeader(reader io.ReadSeeker) (bool, error) {
	header := make([]byte, 12)
	bytesRead, readErr := io.ReadFull(reader, header)
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return false, readErr
	}
	if _, err := reader.Seek(0, io.SeekStart); err != nil {
		return false, err
	}

	return bytesRead == len(header) &&
		string(header[0:4]) == "RIFF" &&
		string(header[8:12]) == "WEBP", nil
}

// validateImageDimensionsWithinDecodeBudget applies overflow-safe pixel and memory limits.
// Between: image format metadata and the full decoder allocation boundary.
// Why: Keeps malformed or highly compressed uploads within a bounded server working set.
func validateImageDimensionsWithinDecodeBudget(width, height int) error {
	if width <= 0 || height <= 0 {
		return fmt.Errorf("image dimensions must be positive, got %dx%d", width, height)
	}
	if width > maxDecodedImageDimension || height > maxDecodedImageDimension {
		return fmt.Errorf(
			"image dimensions %dx%d exceed maximum dimension %d",
			width,
			height,
			maxDecodedImageDimension,
		)
	}

	widthPixels := uint64(width)
	heightPixels := uint64(height)
	if widthPixels > maxDecodedImagePixels/heightPixels {
		return fmt.Errorf(
			"image dimensions %dx%d exceed maximum pixel count %d",
			width,
			height,
			maxDecodedImagePixels,
		)
	}

	pixelCount := widthPixels * heightPixels
	if pixelCount > maxDecodedImageBytes/estimatedBytesPerPixel {
		return fmt.Errorf(
			"image dimensions %dx%d exceed decoded memory budget %d bytes",
			width,
			height,
			maxDecodedImageBytes,
		)
	}

	return nil
}

func shouldCopySourceAsDisplayVariant(sourcePath string) bool {
	switch strings.TrimPrefix(strings.ToLower(filepath.Ext(sourcePath)), ".") {
	case "avif", "heic", "heif":
		return true
	default:
		return false
	}
}

func copySourceAsDisplayVariant(sourcePath, destinationPath string) error {
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
		return fmt.Errorf("failed to create display variant directory: %w", err)
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open display variant source: %w", err)
	}
	defer sourceFile.Close()

	destinationFile, err := os.Create(destinationPath)
	if err != nil {
		return fmt.Errorf("failed to create display variant file: %w", err)
	}
	defer destinationFile.Close()

	if _, err := io.Copy(destinationFile, sourceFile); err != nil {
		return fmt.Errorf("failed to copy display variant file: %w", err)
	}
	return nil
}
