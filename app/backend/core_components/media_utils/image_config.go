// Reads image headers for upload validation and stored display dimensions.
// Shares the patched WebP decoder without allocating a pixel buffer.
package media_utils

import (
	"bufio"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	"golang.org/x/image/webp"
)

const imageHeaderLimit = 1 << 20

// ReadImageConfig preserves the existing upload validator's header reader.
// Its caller still enforces the pixel budget. An optional dimension hint's
// byte budget must never make an otherwise supported upload fail validation.
func ReadImageConfig(filename string) (image.Config, error) {
	return readImageConfigWithLimit(filename, 0)
}

func readImageConfig(filename string) (image.Config, error) {
	return readImageConfigWithLimit(filename, imageHeaderLimit)
}

func readImageConfigWithLimit(filename string, limit int64) (image.Config, error) {
	f, err := os.Open(filename)
	if err != nil {
		return image.Config{}, err
	}
	defer f.Close()
	var source io.Reader = f
	if limit > 0 {
		source = io.LimitReader(f, limit)
	}
	r := bufio.NewReader(source)
	header, _ := r.Peek(12)
	if len(header) == 12 && string(header[:4]) == "RIFF" && string(header[8:]) == "WEBP" {
		return webp.DecodeConfig(r)
	}
	c, _, err := image.DecodeConfig(r)
	return c, err
}
