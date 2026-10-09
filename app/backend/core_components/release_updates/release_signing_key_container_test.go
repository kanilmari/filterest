// release_signing_key_container_test.go
// Checks filesystem-specific permissions and Unicode passphrase contracts.
// Connects opened-file metadata and normalized secrets to encrypted containers.
// Guards workstation container custody using temporary files and throwaway test keys.
package release_updates

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestReleaseSigningContainerFilesystemPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key.container")
	encoded, err := EncryptSigningKey(contractFixtureKey(t, "public"), []byte("fixed TEST ONLY passphrase"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	for _, filesystem := range []struct {
		name    string
		typeID  int64
		relaxed bool
	}{{"ext4", 0xef53, false}, {"tmpfs", 0x01021994, false}, {"unknown", 0, false}, {"drvfs-9p", 0x01021997, true}, {"FAT", 0x4d44, true}, {"exFAT", 0x2011bab0, true}} {
		for _, mode := range []os.FileMode{0600, 0644, 0666, 0777} {
			t.Run(filesystem.name+"/"+mode.String(), func(t *testing.T) {
				if err := os.Chmod(path, mode); err != nil {
					t.Fatal(err)
				}
				calls := 0
				_, err := readSigningKeyContainerWithFilesystem(path, func(fd int, stat *unix.Statfs_t) error {
					calls++
					var actual unix.Stat_t
					if err := unix.Fstat(fd, &actual); err != nil || actual.Mode&0777 != uint32(mode) {
						t.Fatalf("filesystem probe did not use opened key: %v", err)
					}
					stat.Type = filesystem.typeID
					return nil
				})
				accepted := mode == 0600 || filesystem.relaxed
				if calls != 1 || (err == nil) != accepted {
					t.Fatalf("mode %o, accepted=%t, err=%v, calls=%d", mode, accepted, err, calls)
				}
			})
		}
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readSigningKeyContainerWithFilesystem(path, func(int, *unix.Statfs_t) error { return errors.New("injected probe failure") }); err == nil {
		t.Fatal("filesystem probe failure relaxed permissions")
	}
	// Exercise the real Fstatfs path too; this worktree's temporary filesystem
	// implements Unix permissions, so shared read/write permissions must fail.
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadSigningKeyFile(path, []byte("fixed TEST ONLY passphrase")); err == nil || !strings.Contains(err.Error(), "permissions") {
		t.Fatalf("shared container on local Unix filesystem accepted: %v", err)
	}
}

func TestReleaseSigningPassphraseLengthAndNFC(t *testing.T) {
	for _, passphrase := range []string{"elevenchars", strings.Repeat("é", 11), strings.Repeat("e\u0301", 11)} {
		if err := ValidateNewSigningKeyPassphrase([]byte(passphrase)); err == nil || !strings.Contains(err.Error(), "12 characters") {
			t.Fatalf("short normalized passphrase accepted: %v", err)
		}
		if _, err := EncryptSigningKey(contractFixtureKey(t, "public"), []byte(passphrase)); err == nil {
			t.Fatal("library encrypted with short passphrase")
		}
	}
	if err := ValidateNewSigningKeyPassphrase([]byte{0xff, 0xfe}); err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Fatalf("invalid Unicode passphrase accepted: %v", err)
	}
	composed := []byte(strings.Repeat("é", 12))
	decomposed := []byte(strings.Repeat("e\u0301", 12))
	for _, test := range []struct{ create, unlock []byte }{{decomposed, composed}, {composed, decomposed}} {
		path := filepath.Join(t.TempDir(), "key")
		encoded, err := EncryptSigningKey(contractFixtureKey(t, "public"), test.create)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, encoded, 0600); err != nil {
			t.Fatal(err)
		}
		private, err := ReadSigningKeyFile(path, test.unlock)
		if err != nil || !bytes.Equal(private, contractFixtureKey(t, "public")) {
			t.Fatalf("NFC-equivalent passphrase did not unlock: %v", err)
		}
		clear(private)
	}
}
