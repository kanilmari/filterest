//go:build linux

// storage_archive_merge_linux_test.go
// Verifies Linux special files are refused before an archive merge changes either tree.
// Connects real FIFO entries to the shared preflight instead of exercising device I/O.
// Prevents same-filesystem renames from bypassing the regular-file restriction.
package storagecleanup

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestStorageArchiveRefusesNonRegularFilesBeforeMoving(t *testing.T) {
	for _, location := range []string{"source", "destination", "fresh-destination"} {
		t.Run(location, func(t *testing.T) {
			withWorkingDirectory(t)
			source := filepath.Join(StorageRootDir, "3926", "1")
			archive := filepath.Join(StorageDeletedRootDir, "3926", "1")
			writeArchiveTestFile(t, filepath.Join(source, "a-safe.txt"), "live")
			fifo := filepath.Join(source, "z-fifo")
			if location != "fresh-destination" {
				writeArchiveTestFile(t, filepath.Join(archive, "old.txt"), "archive")
			}
			if location == "destination" {
				fifo = filepath.Join(archive, "z-fifo")
			}
			if err := syscall.Mkfifo(fifo, 0600); err != nil {
				t.Fatal(err)
			}
			err := MovePathToDeletedStorage(source, archive)
			if err == nil || !strings.Contains(err.Error(), fifo) {
				t.Fatalf("expected refusal naming %s, got %v", fifo, err)
			}
			assertArchiveTestFile(t, filepath.Join(source, "a-safe.txt"), "live")
			if _, err := os.Lstat(filepath.Join(archive, "a-safe.txt")); !os.IsNotExist(err) {
				t.Fatalf("regular sibling moved: %v", err)
			}
		})
	}
}
