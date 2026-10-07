// release_output_file_writer_test.go
// Injects failed writes/syncs and verifies exclusive publication and retry behavior.
// Connects same-directory temporary files to shared key/signature output writing.
// Ensures failures cannot leave truncated targets or remove someone else's output.
package release_updates

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestReleaseOutputFailureCleanupAndExclusivity(t *testing.T) {
	for _, step := range []string{"write", "sync"} {
		t.Run(step, func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "result")
			err := writeNewReleaseFile(target, []byte("complete"), func(file *os.File, data []byte) error {
				count := 2
				if step == "sync" {
					count = len(data)
				}
				if _, err := file.Write(data[:count]); err != nil {
					return err
				}
				return errors.New("injected " + step + " failure")
			}, os.Link)
			if err == nil {
				t.Fatal("failed output claimed success")
			}
			if _, err := os.Stat(target); !os.IsNotExist(err) {
				t.Fatal("failed write left target")
			}
			entries, err := os.ReadDir(dir)
			if err != nil || len(entries) != 0 {
				t.Fatal("temporary file leaked")
			}
			if err := WriteNewReleaseFile(target, []byte("complete")); err != nil {
				t.Fatal("retry blocked", err)
			}
			if err := WriteNewReleaseFile(target, []byte("replacement")); err == nil {
				t.Fatal("existing file replaced")
			}
			got, err := os.ReadFile(target)
			if err != nil || !bytes.Equal(got, []byte("complete")) {
				t.Fatal("existing file changed")
			}
		})
	}
	dir := t.TempDir()
	existing := filepath.Join(dir, "existing")
	link := filepath.Join(dir, "link")
	if err := os.WriteFile(existing, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(existing, link); err != nil {
		t.Fatal(err)
	}
	if err := WriteNewReleaseFile(link, []byte("overwrite")); err == nil {
		t.Fatal("symlink replaced")
	}
	data, err := os.ReadFile(existing)
	if err != nil || string(data) != "keep" {
		t.Fatal("symlink target changed")
	}
}

func TestReleaseOutputUnsupportedLinkFallback(t *testing.T) {
	for _, linkError := range []error{syscall.EPERM, syscall.EOPNOTSUPP, syscall.ENOTSUP, syscall.EXDEV} {
		t.Run(linkError.Error(), func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "result")
			link := func(string, string) error { return &os.LinkError{Op: "link", Err: linkError} }
			calls := 0
			write := func(file *os.File, data []byte) error {
				calls++
				if _, err := file.Write(data); err != nil {
					return err
				}
				return file.Sync()
			}
			if err := writeNewReleaseFile(target, []byte("complete"), write, link); err != nil || calls != 2 {
				t.Fatalf("fallback failed: %v, writes=%d", err, calls)
			}
			if err := writeNewReleaseFile(target, []byte("replacement"), write, link); !errors.Is(err, os.ErrExist) {
				t.Fatalf("existing fallback output not protected: %v", err)
			}
			got, err := os.ReadFile(target)
			if err != nil || string(got) != "complete" {
				t.Fatal("fallback replaced existing file")
			}
			alias := filepath.Join(dir, "alias")
			if err := os.Symlink(target, alias); err != nil {
				t.Fatal(err)
			}
			if err := writeNewReleaseFile(alias, []byte("replacement"), write, link); !errors.Is(err, os.ErrExist) {
				t.Fatalf("fallback replaced symlink: %v", err)
			}
			entries, err := os.ReadDir(dir)
			if err != nil || len(entries) != 2 {
				t.Fatal("fallback leaked temporary file")
			}
		})
	}
	// Unexpected link errors must fail without creating a final output.
	target := filepath.Join(t.TempDir(), "result")
	if err := writeNewReleaseFile(target, []byte("complete"), func(file *os.File, data []byte) error { _, err := file.Write(data); return err }, func(string, string) error { return syscall.EIO }); !errors.Is(err, syscall.EIO) {
		t.Fatal("unexpected link failure hidden", err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("unexpected link failure created output")
	}
}

func TestReleaseOutputFallbackFailureCleanupAndRetry(t *testing.T) {
	for _, step := range []string{"write", "sync"} {
		t.Run(step, func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "result")
			calls := 0
			write := func(file *os.File, data []byte) error {
				calls++
				if calls == 2 {
					count := 2
					if step == "sync" {
						count = len(data)
					}
					if _, err := file.Write(data[:count]); err != nil {
						return err
					}
					return errors.New("injected fallback " + step + " failure")
				}
				if _, err := file.Write(data); err != nil {
					return err
				}
				return file.Sync()
			}
			link := func(string, string) error { return syscall.EPERM }
			if err := writeNewReleaseFile(target, []byte("complete"), write, link); err == nil || calls != 2 {
				t.Fatal("fallback failure claimed success")
			}
			entries, err := os.ReadDir(dir)
			if err != nil || len(entries) != 0 {
				t.Fatal("fallback failure leaked its output")
			}
			if err := writeNewReleaseFile(target, []byte("complete"), write, link); err != nil {
				t.Fatal("failed fallback blocked retry", err)
			}
		})
	}
}
