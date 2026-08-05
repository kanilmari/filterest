// upload_signature.go
// Validates uploaded file contents against their declared extensions.
// Bridges multipart upload handlers and conservative magic-byte checks before persistence.
// Exists to keep extension allowlists from accepting arbitrary renamed content.
package filevalidation

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"strings"
	"unicode/utf8"
)

const (
	signatureSampleSize = 4096
	maxSVGValidationLen = 1 << 20
)

// ValidateExtensionSignature checks that the file's leading bytes match the
// normalized extension. It rewinds the file before returning.
func ValidateExtensionSignature(file multipart.File, extension string) error {
	ext := normalizeExtension(extension)
	if ext == "" {
		return fmt.Errorf("missing file extension")
	}
	if ext == "svg" {
		return validateSVG(file)
	}

	sample := make([]byte, signatureSampleSize)
	n, err := file.Read(sample)
	if err != nil && err != io.EOF {
		_, _ = file.Seek(0, io.SeekStart)
		return fmt.Errorf("read file signature: %w", err)
	}
	if _, seekErr := file.Seek(0, io.SeekStart); seekErr != nil {
		return fmt.Errorf("rewind file after signature read: %w", seekErr)
	}
	if n == 0 {
		return fmt.Errorf("empty file")
	}
	if !signatureMatchesExtension(ext, sample[:n]) {
		return fmt.Errorf("file content does not match .%s", ext)
	}
	return nil
}

// IsInlineSafeImageExtension reports whether storage can display this extension
// inline without treating it as a generic attachment.
func IsInlineSafeImageExtension(extension string) bool {
	switch normalizeExtension(extension) {
	case "jpg", "jpeg", "jfif", "png", "webp", "gif", "bmp", "ico", "tif", "tiff", "avif", "heic", "heif", "svg":
		return true
	default:
		return false
	}
}

func normalizeExtension(extension string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(extension)), ".")
}

func signatureMatchesExtension(ext string, sample []byte) bool {
	switch ext {
	case "jpg", "jpeg", "jfif":
		return bytes.HasPrefix(sample, []byte{0xff, 0xd8, 0xff})
	case "png":
		return bytes.HasPrefix(sample, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	case "gif":
		return bytes.HasPrefix(sample, []byte("GIF87a")) || bytes.HasPrefix(sample, []byte("GIF89a"))
	case "webp":
		return len(sample) >= 12 && bytes.Equal(sample[:4], []byte("RIFF")) && bytes.Equal(sample[8:12], []byte("WEBP"))
	case "bmp":
		return bytes.HasPrefix(sample, []byte("BM"))
	case "ico":
		return bytes.HasPrefix(sample, []byte{0x00, 0x00, 0x01, 0x00})
	case "tif", "tiff":
		return bytes.HasPrefix(sample, []byte{'I', 'I', 0x2a, 0x00}) || bytes.HasPrefix(sample, []byte{'M', 'M', 0x00, 0x2a})
	case "avif":
		return hasISOBrand(sample, "avif")
	case "heic", "heif":
		return hasISOBrand(sample, "heic") || hasISOBrand(sample, "heif") || hasISOBrand(sample, "heix") ||
			hasISOBrand(sample, "hevc") || hasISOBrand(sample, "hevx") || hasISOBrand(sample, "mif1")
	case "pdf":
		return bytes.HasPrefix(sample, []byte("%PDF-"))
	case "zip", "docx", "xlsx", "odt":
		return hasZipMagic(sample)
	case "doc", "xls":
		return bytes.HasPrefix(sample, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})
	case "7z":
		return bytes.HasPrefix(sample, []byte{0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c})
	case "rar":
		return bytes.HasPrefix(sample, []byte{0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00}) ||
			bytes.HasPrefix(sample, []byte{0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00})
	case "rtf":
		return bytes.HasPrefix(bytes.TrimSpace(sample), []byte(`{\rtf`))
	case "txt", "csv":
		return isLikelyText(sample)
	default:
		return false
	}
}

func hasZipMagic(sample []byte) bool {
	return bytes.HasPrefix(sample, []byte{'P', 'K', 0x03, 0x04}) ||
		bytes.HasPrefix(sample, []byte{'P', 'K', 0x05, 0x06}) ||
		bytes.HasPrefix(sample, []byte{'P', 'K', 0x07, 0x08})
}

func hasISOBrand(sample []byte, brand string) bool {
	if len(sample) < 12 || !bytes.Equal(sample[4:8], []byte("ftyp")) {
		return false
	}
	return bytes.Contains(sample[:min(len(sample), 64)], []byte(brand))
}

func isLikelyText(sample []byte) bool {
	return !bytes.Contains(sample, []byte{0x00}) && utf8.Valid(sample)
}

func validateSVG(file multipart.File) error {
	data, err := io.ReadAll(io.LimitReader(file, maxSVGValidationLen+1))
	if seekErr := rewind(file); seekErr != nil {
		return seekErr
	}
	if err != nil {
		return fmt.Errorf("read svg content: %w", err)
	}
	if len(data) == 0 {
		return fmt.Errorf("empty file")
	}
	if len(data) > maxSVGValidationLen {
		return fmt.Errorf("svg file is too large")
	}

	lower := strings.ToLower(string(data))
	if !strings.Contains(lower, "<svg") {
		return fmt.Errorf("file content does not match .svg")
	}
	unsafeTokens := []string{
		"<script",
		"<foreignobject",
		"javascript:",
		"data:text/html",
		"onload=",
		"onerror=",
		"onmouseover=",
		"onclick=",
	}
	for _, token := range unsafeTokens {
		if strings.Contains(lower, token) {
			return fmt.Errorf("svg contains active content")
		}
	}
	return nil
}

func rewind(file multipart.File) error {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind file after validation read: %w", err)
	}
	return nil
}
