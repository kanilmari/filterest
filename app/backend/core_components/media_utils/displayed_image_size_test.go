// Proves displayed-file selection, bounded EXIF parsing and metadata copy shape.
package media_utils

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func sizePNG(t *testing.T, root, folder, file string, width, height int) {
	t.Helper()
	dir := filepath.Join(root, folder)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, width, height))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, file), data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestDisplayedImageSizeUsesBrowserFallbackAndLibraryOriginal(t *testing.T) {
	root := t.TempDir()
	for i, variant := range FallbackOrder("1000") {
		sizePNG(t, root, variant, "photo.png", 10+i, 20+i)
	}
	for i, variant := range FallbackOrder("1000") {
		size, err := MeasureDisplayedImageSize(root, "photo.png", false)
		if err != nil || size == nil || size.WidthPx != 10+i || size.HeightPx != 20+i || size.File != "photo.png" {
			t.Fatalf("variant %s: %v, %v", variant, size, err)
		}
		library, err := MeasureDisplayedImageSize(root, "photo.png", true)
		if err != nil || library == nil || library.WidthPx != 13 {
			t.Fatalf("library: %v, %v", library, err)
		}
		if err := os.Remove(filepath.Join(root, variant, "photo.png")); err != nil {
			t.Fatal(err)
		}
	}
	if size, _ := MeasureDisplayedImageSize(root, "photo.png", false); size != nil {
		t.Fatal("missing file has a size")
	}
}

func TestDisplayedImageSizeUnreadableSVGAndZeroGetNoSize(t *testing.T) {
	root := t.TempDir()
	sizePNG(t, root, "original", "bad.png", 4, 3)
	if err := os.MkdirAll(filepath.Join(root, "1000"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{"bad.png": []byte("unreadable"), "vector.svg": []byte(`<svg width="200" height="100"/>`), "zero.gif": []byte{'G', 'I', 'F', '8', '9', 'a', 0, 0, 1, 0, 0, 0, 0}} {
		if err := os.WriteFile(filepath.Join(root, "1000", name), data, 0600); err != nil {
			t.Fatal(err)
		}
		if size, _ := MeasureDisplayedImageSize(root, name, false); size != nil {
			t.Fatal("unsupported or unreadable file measured")
		}
	}
	config, err := ReadImageConfig(filepath.Join(root, "1000", "zero.gif"))
	if err != nil || config.Width != 0 || config.Height != 1 {
		t.Fatal("zero-dimension fixture is not a readable header", err)
	}

}

func exifJPEG(t *testing.T, tag int, order binary.ByteOrder) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 8, 3)), nil); err != nil {
		t.Fatal(err)
	}
	tiff := make([]byte, 26)
	copy(tiff, "II")
	if order == binary.BigEndian {
		copy(tiff, "MM")
	}
	order.PutUint16(tiff[2:], 42)
	order.PutUint32(tiff[4:], 8)
	order.PutUint16(tiff[8:], 1)
	order.PutUint16(tiff[10:], 0x112)
	order.PutUint16(tiff[12:], 3)
	order.PutUint32(tiff[14:], 1)
	order.PutUint16(tiff[18:], uint16(tag))
	payload := append([]byte("Exif\x00\x00"), tiff...)
	marker := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(marker[2:], uint16(len(payload)+2))
	result := append([]byte{0xff, 0xd8}, marker...)
	result = append(result, payload...)
	return append(result, encoded.Bytes()[2:]...)
}

func TestDisplayedImageSizeSwapsOnlyEXIFTagsFiveThroughEight(t *testing.T) {
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		for tag := 1; tag <= 8; tag++ {
			root := t.TempDir()
			if err := os.Mkdir(filepath.Join(root, "original"), 0700); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(root, "original", "photo.jpg")
			if err := os.WriteFile(file, exifJPEG(t, tag, order), 0600); err != nil {
				t.Fatal(err)
			}
			size, err := MeasureDisplayedImageSize(root, "photo.jpg", false)
			width, height := 8, 3
			if tag >= 5 {
				width, height = height, width
			}
			if err != nil || size == nil || size.WidthPx != width || size.HeightPx != height || JPEGOrientation(file) != tag {
				t.Fatalf("orientation %d: %v, %v", tag, size, err)
			}
		}
	}
}

func TestJPEGOrientationRejectsMalformedAndStopsAtBudget(t *testing.T) {
	for _, payload := range [][]byte{nil, []byte("not JPEG"), {0xff, 0xd8, 0xff, 0xe1, 0, 1}, []byte("II*\x00\xff\xff\xff\xff")} {
		if got := tiffOrientation(payload); got != 1 {
			t.Fatal("malformed TIFF accepted")
		}
	}
	data := []byte{0xff, 0xd8}
	for len(data) <= imageHeaderLimit {
		data = append(data, 0xff, 0xe2, 0xff, 0xff)
		data = append(data, make([]byte, 65533)...)
	}
	data = append(data, exifJPEG(t, 6, binary.LittleEndian)[2:]...)
	file := filepath.Join(t.TempDir(), "large.jpg")
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	if JPEGOrientation(file) != 1 {
		t.Fatal("read orientation past byte budget")
	}
	config, err := ReadImageConfig(file)
	if err != nil || config.Width != 8 || config.Height != 3 {
		t.Fatal("optional byte limit changed upload validation", err)
	}
	if _, err := readImageConfig(file); err == nil {
		t.Fatal("dimension hint exceeded its header budget")
	}
}

func TestCopyDisplayedImageSizeContainsOnlySizeAndRewritesFile(t *testing.T) {
	raw := []byte(`{"image_source":{"url":"private"},"caption":"kept by caller","displayed_image_size":{"width_px":7,"height_px":5,"file":"source.png"}}`)
	size := CopyDisplayedImageSize(raw, "image.png")
	var patch map[string]json.RawMessage
	if err := json.Unmarshal(ImageSizePatch(size), &patch); err != nil {
		t.Fatal(err)
	}
	if len(patch) != 1 || size == nil || size.File != "image.png" || size.WidthPx != 7 {
		t.Fatal("copy included unrelated metadata or lost dimensions")
	}
	for _, raw := range []string{`[]`, `null`, `{"displayed_image_size":{"width_px":0,"height_px":5,"file":"a"}}`, `{"displayed_image_size":"wrong"}`} {
		if CopyDisplayedImageSize([]byte(raw), "image.png") != nil {
			t.Fatal("copied invalid size")
		}
	}
}
