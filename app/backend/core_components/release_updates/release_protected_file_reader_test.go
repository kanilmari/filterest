// release_protected_file_reader_test.go
// Exercises local file ownership, bounds and nonblocking descriptor defenses.
// Connects synthetic fstat metadata and real files/FIFOs to release input readers.
// Guards the security boundary without requiring privileged filesystem changes.
package release_updates

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestReleaseProtectedFileReaderBoundaries(t *testing.T) {
	dir := t.TempDir()
	for _, test := range []struct {
		name    string
		data    []byte
		maximum int
	}{{"empty", nil, 32}, {"oversized", []byte("too long"), 3}} {
		path := filepath.Join(dir, test.name)
		if err := os.WriteFile(path, test.data, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readProtectedReleaseFile(path, test.maximum, 0022); err == nil {
			t.Fatalf("accepted %s", test.name)
		}
	}
	if _, err := readProtectedReleaseFile(filepath.Join(dir, "missing"), 32, 0022); err == nil {
		t.Fatal("accepted missing file")
	}
	if _, err := readProtectedReleaseFile(dir, 32, 0022); err == nil {
		t.Fatal("accepted directory")
	}
	wrongOwner := unix.Stat_t{Uid: uint32(os.Geteuid()) + 1, Mode: unix.S_IFREG | 0600}
	if err := validateProtectedReleaseFile(&wrongOwner, 0); err == nil || !strings.Contains(err.Error(), "belong") {
		t.Fatal("wrong owner accepted")
	}
	owner := unix.Stat_t{Uid: uint32(os.Geteuid()), Mode: unix.S_IFREG | 0777}
	if err := validateProtectedReleaseFile(&owner, 0); err != nil {
		t.Fatal("encrypted drvfs container rejected")
	}
	if err := validateProtectedReleaseFile(&owner, 0022); err == nil {
		t.Fatal("writable policy accepted")
	}
	path := filepath.Join(dir, "fifo")
	if err := unix.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { _, err := readProtectedReleaseFile(path, 32, 0022); result <- err }()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("FIFO accepted")
		}
	case <-time.After(time.Second):
		t.Fatal("reader blocked on FIFO")
	}
	link := filepath.Join(dir, "symlink")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readProtectedReleaseFile(link, 32, 0022); err == nil {
		t.Fatal("symlink accepted")
	}
}
