// release_output_file_writer.go
// Publishes complete signing outputs exclusively from a same-directory temporary file.
// Connects encrypted key generation and detached signatures to local storage.
// Prevents failed writes from leaving truncated outputs or replacing existing files.
package release_updates

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

// WriteNewReleaseFile publishes a synced private temporary file without replacing
// outputs. Filesystems without hard links use exclusive create, full write/sync;
// failed writes remove only outputs created by this invocation.
func WriteNewReleaseFile(path string, data []byte) error {
	return writeNewReleaseFile(path, data, func(file *os.File, data []byte) error {
		n, err := file.Write(data)
		if err != nil {
			return err
		}
		if n != len(data) {
			return io.ErrShortWrite
		}
		return file.Sync()
	}, os.Link)
}

// Private hooks cover write/sync errors and filesystems without hard-link support.
func writeNewReleaseFile(path string, data []byte, writeAndSync func(*os.File, []byte) error, link func(string, string) error) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".release-signing-*")
	if err != nil {
		return fmt.Errorf("create temporary release output: %w", err)
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if err := writeAndSync(file, data); err != nil {
		file.Close()
		return fmt.Errorf("write/sync release output: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close release output: %w", err)
	}
	if err := link(temporary, path); err != nil {
		if errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EOPNOTSUPP) || errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.EXDEV) {
			return writeExclusiveReleaseFile(path, data, writeAndSync)
		}
		return fmt.Errorf("publish release output exclusively: %w", err)
	}
	return nil
}

func writeExclusiveReleaseFile(path string, data []byte, writeAndSync func(*os.File, []byte) error) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create release output exclusively: %w", err)
	}
	if err := writeAndSync(file, data); err != nil {
		file.Close()
		os.Remove(path)
		return fmt.Errorf("write/sync exclusive release output: %w", err)
	}
	if err := file.Close(); err != nil {
		os.Remove(path)
		return fmt.Errorf("close exclusive release output: %w", err)
	}
	return nil
}
