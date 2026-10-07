// release_protected_file_reader.go
// Opens bounded release inputs through one nonblocking, no-follow descriptor.
// Connects operator-owned policy/key files and signing inputs to offline parsers.
// Prevents symlink/FIFO substitution and enforces the applicable ownership boundary.
package release_updates

import (
	"errors"
	"io"
	"os"

	"golang.org/x/sys/unix"
)

// readProtectedReleaseFile applies the caller's permission rule to the opened file.
func readProtectedReleaseFile(path string, maximum int, forbidden uint32) ([]byte, error) {
	return readBoundedReleaseFile(path, maximum, func(_ int, stat *unix.Stat_t) error {
		return validateProtectedReleaseFile(stat, forbidden)
	})
}

func validateProtectedReleaseFile(stat *unix.Stat_t, forbidden uint32) error {
	if stat.Uid != uint32(os.Geteuid()) && stat.Uid != 0 {
		return errors.New("protected release file must belong to the operator or root")
	}
	if stat.Mode&forbidden != 0 {
		return errors.New("protected release file permissions are too broad")
	}
	return nil
}

// ReadReleaseInputFile reads a regular, bounded signing input without following
// its final symlink or waiting for a FIFO writer. Inputs need no trusted ownership.
func ReadReleaseInputFile(path string, maximum int) ([]byte, error) {
	return readBoundedReleaseFile(path, maximum, nil)
}

func readBoundedReleaseFile(path string, maximum int, protect func(int, *unix.Stat_t) error) ([]byte, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("cannot open release file (regular file, no symlink required)")
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil || stat.Mode&unix.S_IFMT != unix.S_IFREG {
		return nil, errors.New("release input must be a regular file")
	}
	if protect != nil {
		if err := protect(fd, &stat); err != nil {
			return nil, err
		}
	}
	if maximum <= 0 || stat.Size <= 0 || stat.Size > int64(maximum) {
		return nil, errors.New("release file size is empty or exceeds limit")
	}
	data, err := io.ReadAll(io.LimitReader(file, int64(maximum)+1))
	if err != nil || len(data) == 0 || len(data) > maximum {
		return nil, errors.New("cannot read bounded release file")
	}
	return data, nil
}
