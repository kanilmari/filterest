// storage_archive_merge_test.go
// Proves archive merges retain every media file when earlier deletions created the folder.
// Connects real temporary trees, no-replace renames and injected cross-device failures.
// Protects recovery content, preflight refusal and retryable partial progress.
package storagecleanup

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func writeArchiveTestFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0640); err != nil {
		t.Fatal(err)
	}
}

func assertArchiveTestFile(t *testing.T, path, want string) {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil || string(contents) != want {
		t.Fatalf("%s = %q, want %q, error = %v", path, contents, want, err)
	}
}

func TestMovePathToDeletedStorageMergesExistingVariantFolders(t *testing.T) {
	for _, crossDevice := range []bool{false, true} {
		name := "rename"
		if crossDevice {
			name = "cross-device"
		}
		t.Run(name, func(t *testing.T) {
			withWorkingDirectory(t)
			if crossDevice {
				forceCrossFilesystemRename(t)
			}
			source := filepath.Join(StorageRootDir, "3926", "1")
			archive := filepath.Join(StorageDeletedRootDir, "3926", "1")
			writeArchiveTestFile(t, filepath.Join(archive, "original", "first.jpg"), "first original")
			writeArchiveTestFile(t, filepath.Join(archive, "300", "first.jpg"), "first thumbnail")
			files := map[string]string{
				"original/second.jpg": "second original",
				"300/second.jpg":      "second thumbnail",
				"original/own.pdf":    "row attachment",
				"new/nested/own.txt":  "nested media",
			}
			for relative, content := range files {
				writeArchiveTestFile(t, filepath.Join(source, relative), content)
			}
			if err := os.MkdirAll(filepath.Join(source, "empty"), 0750); err != nil {
				t.Fatal(err)
			}
			if err := MovePathToDeletedStorage(source, archive); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(source); !os.IsNotExist(err) {
				t.Fatalf("source directory remains: %v", err)
			}
			for relative, content := range files {
				assertArchiveTestFile(t, filepath.Join(archive, relative), content)
			}
			assertArchiveTestFile(t, filepath.Join(archive, "original", "first.jpg"), "first original")
			assertArchiveTestFile(t, filepath.Join(archive, "300", "first.jpg"), "first thumbnail")
			if mode := fileMode(t, filepath.Join(archive, "original", "second.jpg")); mode != 0640 {
				t.Fatalf("archived mode = %o", mode)
			}
		})
	}
}

func TestStorageArchiveMergeClashNamesKeepExtensionsAndSkipOccupiedCounters(t *testing.T) {
	withWorkingDirectory(t)
	source := filepath.Join(StorageRootDir, "3926", "1")
	archive := filepath.Join(StorageDeletedRootDir, "3926", "1")
	archivedAt := time.Date(2026, 10, 7, 2, 3, 4, 5, time.FixedZone("test", 3600))
	clashPrefix := "photo.deleted-20261007T010304.000000005Z-"
	writeArchiveTestFile(t, filepath.Join(source, "photo.jpg"), "incoming")
	writeArchiveTestFile(t, filepath.Join(archive, "photo.jpg"), "earlier")
	writeArchiveTestFile(t, filepath.Join(archive, clashPrefix+"1.jpg"), "occupied counter")
	info, err := os.Lstat(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := moveStorageArchiveEntry(source, archive, info, archivedAt); err != nil {
		t.Fatal(err)
	}
	assertArchiveTestFile(t, filepath.Join(archive, "photo.jpg"), "earlier")
	assertArchiveTestFile(t, filepath.Join(archive, clashPrefix+"1.jpg"), "occupied counter")
	assertArchiveTestFile(t, filepath.Join(archive, clashPrefix+"2.jpg"), "incoming")
}

func TestStorageArchiveMergeKeepsDirectoryAndFileClashes(t *testing.T) {
	for _, incomingDirectory := range []bool{false, true} {
		name := "incoming-file"
		if incomingDirectory {
			name = "incoming-directory"
		}
		t.Run(name, func(t *testing.T) {
			withWorkingDirectory(t)
			source := filepath.Join(StorageRootDir, "3926", "1")
			archive := filepath.Join(StorageDeletedRootDir, "3926", "1")
			if incomingDirectory {
				writeArchiveTestFile(t, filepath.Join(source, "variant", "new.jpg"), "new")
				writeArchiveTestFile(t, filepath.Join(archive, "variant"), "earlier file")
			} else {
				writeArchiveTestFile(t, filepath.Join(source, "variant.jpg"), "new")
				writeArchiveTestFile(t, filepath.Join(archive, "variant.jpg", "old.txt"), "earlier directory")
			}
			if err := MovePathToDeletedStorage(source, archive); err != nil {
				t.Fatal(err)
			}
			pattern := "variant.deleted-*"
			if !incomingDirectory {
				pattern += ".jpg"
			}
			clashes, err := filepath.Glob(filepath.Join(archive, pattern))
			if err != nil || len(clashes) != 1 {
				t.Fatalf("clashes = %v, err = %v", clashes, err)
			}
			if incomingDirectory {
				assertArchiveTestFile(t, filepath.Join(clashes[0], "new.jpg"), "new")
				assertArchiveTestFile(t, filepath.Join(archive, "variant"), "earlier file")
			} else {
				assertArchiveTestFile(t, clashes[0], "new")
				assertArchiveTestFile(t, filepath.Join(archive, "variant.jpg", "old.txt"), "earlier directory")
			}
		})
	}
}

func TestStorageArchiveMergeRefusesSymlinkBeforeMovingAnyEntry(t *testing.T) {
	for _, location := range []string{"source", "destination", "destination-root", "source-parent"} {
		t.Run(location, func(t *testing.T) {
			root := withWorkingDirectory(t)
			source := filepath.Join(StorageRootDir, "3926", "1")
			archive := filepath.Join(StorageDeletedRootDir, "3926", "1")
			writeArchiveTestFile(t, filepath.Join(source, "a-safe.txt"), "live")
			writeArchiveTestFile(t, filepath.Join(archive, "a-old.txt"), "archive")
			outside := filepath.Join(root, "outside")
			writeArchiveTestFile(t, filepath.Join(outside, "untouched.txt"), "outside")
			link := filepath.Join(source, "z-late", "link")
			if location == "destination" {
				link = filepath.Join(archive, "z-late", "link")
			} else if location == "destination-root" || location == "source-parent" {
				link = archive
				if location == "source-parent" {
					link = filepath.Dir(source)
				}
				if err := os.Rename(link, link+"-real"); err != nil {
					t.Fatal(err)
				}
				if location == "source-parent" {
					source = filepath.Join(link+"-real", "1")
				}
			}
			if err := os.MkdirAll(filepath.Dir(link), 0750); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, link); err != nil {
				t.Fatal(err)
			}
			attemptSource := source
			if location == "source-parent" {
				attemptSource = filepath.Join(StorageRootDir, "3926", "1")
			}
			err := MovePathToDeletedStorage(attemptSource, archive)
			if err == nil || !strings.Contains(err.Error(), link) {
				t.Fatalf("expected refusal naming %s, got %v", link, err)
			}
			assertArchiveTestFile(t, filepath.Join(source, "a-safe.txt"), "live")
			archiveReal := archive
			if location == "destination-root" {
				archiveReal += "-real"
			}
			assertArchiveTestFile(t, filepath.Join(archiveReal, "a-old.txt"), "archive")
			assertArchiveTestFile(t, filepath.Join(outside, "untouched.txt"), "outside")
			if _, err := os.Lstat(filepath.Join(archiveReal, "a-safe.txt")); !os.IsNotExist(err) {
				t.Fatalf("safe sibling moved before refusal: %v", err)
			}
		})
	}
}

func TestStorageArchiveMergeHalfwayFailureKeepsEachFileOnceAndCanRetry(t *testing.T) {
	for _, crossDevice := range []bool{false, true} {
		name := "rename"
		if crossDevice {
			name = "copy"
		}
		t.Run(name, func(t *testing.T) {
			withWorkingDirectory(t)
			source := filepath.Join(StorageRootDir, "3926", "1")
			archive := filepath.Join(StorageDeletedRootDir, "3926", "1")
			writeArchiveTestFile(t, filepath.Join(archive, "original", "old.jpg"), "earlier")
			for _, file := range []string{"a.jpg", "b.jpg", "c.jpg"} {
				writeArchiveTestFile(t, filepath.Join(source, "original", file), file)
			}
			originalRename, originalCopier := storagePathRename, storageRegularFileCopier
			t.Cleanup(func() { storagePathRename, storageRegularFileCopier = originalRename, originalCopier })
			if crossDevice {
				forceCrossFilesystemRename(t)
				storageRegularFileCopier = func(src, dst string, info fs.FileInfo) error {
					if filepath.Base(src) == "b.jpg" {
						if err := os.WriteFile(dst, []byte("partial"), 0600); err != nil {
							return err
						}
						return errors.New("injected copy failure")
					}
					return originalCopier(src, dst, info)
				}
			} else {
				storagePathRename = func(src, dst string) error {
					if filepath.Base(src) == "b.jpg" {
						return syscall.EIO
					}
					return originalRename(src, dst)
				}
			}
			err := MovePathToDeletedStorage(source, archive)
			if err == nil || !strings.Contains(err.Error(), filepath.Join(source, "original", "b.jpg")) {
				t.Fatalf("failure must name remaining file, got %v", err)
			}
			assertArchiveTestFile(t, filepath.Join(archive, "original", "a.jpg"), "a.jpg")
			assertArchiveTestFile(t, filepath.Join(archive, "original", "old.jpg"), "earlier")
			for _, file := range []string{"a.jpg", "b.jpg", "c.jpg"} {
				_, liveErr := os.Lstat(filepath.Join(source, "original", file))
				_, archiveErr := os.Lstat(filepath.Join(archive, "original", file))
				if (liveErr == nil) == (archiveErr == nil) {
					t.Fatalf("%s must exist exactly once: live=%v archive=%v", file, liveErr, archiveErr)
				}
				if file != "a.jpg" {
					assertArchiveTestFile(t, filepath.Join(source, "original", file), file)
				}
			}
			entries, err := os.ReadDir(filepath.Join(archive, "original"))
			if err != nil || len(entries) != 2 {
				t.Fatalf("partial copy left archive debris: %v, %v", entries, err)
			}
			storagePathRename, storageRegularFileCopier = originalRename, originalCopier
			if err := MovePathToDeletedStorage(source, archive); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(source); !os.IsNotExist(err) {
				t.Fatalf("retry left source directory: %v", err)
			}
			for _, file := range []string{"a.jpg", "b.jpg", "c.jpg"} {
				assertArchiveTestFile(t, filepath.Join(archive, "original", file), file)
			}
		})
	}
}

func TestArchiveTableStorageFolderMergesRepeatedFileClashes(t *testing.T) {
	withWorkingDirectory(t)
	source := filepath.Join(StorageRootDir, "3926")
	archive := filepath.Join(StorageDeletedRootDir, "3926")
	writeArchiveTestFile(t, filepath.Join(source, "1", "original", "photo.jpg"), "incoming")
	writeArchiveTestFile(t, filepath.Join(archive, "1", "original", "photo.jpg"), "earlier")
	writeArchiveTestFile(t, filepath.Join(archive, "1", "original", "photo.jpg.archived"), "previous clash")
	if err := ArchiveTableStorageFolder("3926"); err != nil {
		t.Fatal(err)
	}
	assertArchiveTestFile(t, filepath.Join(archive, "1", "original", "photo.jpg"), "earlier")
	assertArchiveTestFile(t, filepath.Join(archive, "1", "original", "photo.jpg.archived"), "previous clash")
	clashes, err := filepath.Glob(filepath.Join(archive, "1", "original", "photo.deleted-*.jpg"))
	if err != nil || len(clashes) != 1 {
		t.Fatalf("incoming archive copy = %v, %v", clashes, err)
	}
	assertArchiveTestFile(t, clashes[0], "incoming")
	if _, err := os.Lstat(source); !os.IsNotExist(err) {
		t.Fatalf("dataset storage remains: %v", err)
	}
}

func TestArchiveTableStorageFolderRefusesUnsafeTreeBeforeMoving(t *testing.T) {
	root := withWorkingDirectory(t)
	source := filepath.Join(StorageRootDir, "3926")
	archive := filepath.Join(StorageDeletedRootDir, "3926")
	writeArchiveTestFile(t, filepath.Join(source, "1", "original", "safe.jpg"), "live")
	writeArchiveTestFile(t, filepath.Join(archive, "1", "original", "old.jpg"), "earlier")
	outside := filepath.Join(root, "outside.jpg")
	writeArchiveTestFile(t, outside, "outside")
	if err := os.Symlink(outside, filepath.Join(source, "z-unsafe")); err != nil {
		t.Fatal(err)
	}
	if err := ArchiveTableStorageFolder("3926"); err == nil {
		t.Fatal("dataset archive accepted a source symlink")
	}
	assertArchiveTestFile(t, filepath.Join(source, "1", "original", "safe.jpg"), "live")
	assertArchiveTestFile(t, filepath.Join(archive, "1", "original", "old.jpg"), "earlier")
	if _, err := os.Lstat(filepath.Join(archive, "1", "original", "safe.jpg")); !os.IsNotExist(err) {
		t.Fatalf("dataset archive moved a safe sibling before refusal: %v", err)
	}
}
