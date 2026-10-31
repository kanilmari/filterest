// Reads only a bounded JPEG marker stream and TIFF orientation directory.
// Browser orientation affects displayed dimensions; resizing remains unchanged.
package media_utils

import (
	"encoding/binary"
	"io"
	"os"
)

// JPEGOrientation returns 1 when no usable orientation is present. At most one
// MiB is read, including skipped segments; no scan crosses the pixel stream.
func JPEGOrientation(filename string) int {
	f, err := os.Open(filename)
	if err != nil {
		return 1
	}
	defer f.Close()
	r := io.LimitReader(f, imageHeaderLimit)
	var pair [2]byte
	if _, err := io.ReadFull(r, pair[:]); err != nil || pair != [2]byte{0xff, 0xd8} {
		return 1
	}
	for {
		if _, err := io.ReadFull(r, pair[:]); err != nil || pair[0] != 0xff {
			return 1
		}
		for pair[1] == 0xff {
			if _, err := io.ReadFull(r, pair[1:]); err != nil {
				return 1
			}
		}
		marker := pair[1]
		if marker == 0xda || marker == 0xd9 {
			return 1
		}
		if marker == 0x01 || marker >= 0xd0 && marker <= 0xd7 {
			continue
		}
		if _, err := io.ReadFull(r, pair[:]); err != nil {
			return 1
		}
		n := int(binary.BigEndian.Uint16(pair[:])) - 2
		if n < 0 {
			return 1
		}
		if marker != 0xe1 {
			if _, err := io.CopyN(io.Discard, r, int64(n)); err != nil {
				return 1
			}
			continue
		}
		data := make([]byte, n) // JPEG segments are limited to 65533 bytes.
		if _, err := io.ReadFull(r, data); err != nil {
			return 1
		}
		if len(data) >= 6 && string(data[:6]) == "Exif\x00\x00" {
			return tiffOrientation(data[6:])
		}
	}
}

func tiffOrientation(data []byte) int {
	if len(data) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(data[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(data[2:4]) != 42 {
		return 1
	}
	offset := uint64(order.Uint32(data[4:8]))
	if offset < 8 || offset+2 > uint64(len(data)) {
		return 1
	}
	count := int(order.Uint16(data[offset : offset+2]))
	for pos, i := offset+2, 0; i < count && pos+12 <= uint64(len(data)); pos, i = pos+12, i+1 {
		e := data[pos : pos+12]
		if order.Uint16(e[:2]) == 0x112 && order.Uint16(e[2:4]) == 3 && order.Uint32(e[4:8]) == 1 {
			if tag := int(order.Uint16(e[8:10])); tag >= 1 && tag <= 8 {
				return tag
			}
		}
	}
	return 1
}
