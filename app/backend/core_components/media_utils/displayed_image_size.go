// Measures the same stored file a card requests, and builds its metadata hint.
// Shared by upload, preview adoption, media reuse and the explicit admin tool.
package media_utils

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const DisplayedImageSizeKey = "displayed_image_size"

type DisplayedImageSize struct {
	WidthPx  int    `json:"width_px"`
	HeightPx int    `json:"height_px"`
	File     string `json:"file"`
}

// MeasureDisplayedImageSize chooses the first existing file, even if that file
// cannot be decoded. Library URLs always display original, unlike row URLs.
// Errors deliberately contain no paths, filenames or file contents.
func MeasureDisplayedImageSize(ownerFolder, filename string, library bool) (*DisplayedImageSize, error) {
	if filename == "" || filepath.Base(filename) != filename || strings.ContainsAny(filename, `/\\`) {
		return nil, errors.New("image size: invalid reference")
	}
	if strings.EqualFold(filepath.Ext(filename), ".svg") {
		return nil, nil
	}
	variant := "1000"
	if library {
		variant = OriginalVariant
	}
	for _, folder := range FallbackOrder(variant) {
		p := filepath.Join(ownerFolder, folder, filename)
		info, err := os.Stat(p)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("image size: file unavailable")
		}
		config, err := readImageConfig(p)
		if err != nil {
			return nil, errors.New("image size: unreadable header")
		}
		if config.Width <= 0 || config.Height <= 0 {
			return nil, nil
		}
		if tag := JPEGOrientation(p); tag >= 5 && tag <= 8 {
			config.Width, config.Height = config.Height, config.Width
		}
		return &DisplayedImageSize{config.Width, config.Height, filename}, nil
	}
	return nil, nil
}

// ImageSizePatch is an object even when there is no measurable image.
func ImageSizePatch(size *DisplayedImageSize) []byte {
	patch := map[string]interface{}{}
	if size != nil {
		patch[DisplayedImageSizeKey] = size
	}
	raw, _ := json.Marshal(patch)
	return raw
}

// CopyDisplayedImageSize accepts only a complete positive size object and
// rewrites its file identity; unrelated source metadata never leaves this helper.
func CopyDisplayedImageSize(raw []byte, filename string) *DisplayedImageSize {
	var metadata map[string]json.RawMessage
	if json.Unmarshal(raw, &metadata) != nil {
		return nil
	}
	var size DisplayedImageSize
	if json.Unmarshal(metadata[DisplayedImageSizeKey], &size) != nil || size.WidthPx <= 0 || size.HeightPx <= 0 || size.File == "" {
		return nil
	}
	size.File = filename
	return &size
}
