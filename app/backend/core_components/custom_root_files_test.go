// custom_root_files_test.go
// Proves directory confinement, file limits and administrator-only deployment status.
// Exercises real filesystem handles and the existing narrow SQL driver, without a server.
// Keeps missing settings compatible while refusing malformed or unsafe files.
package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestReadCustomRootSwitchAbsentBooleanAndInvalid(t *testing.T) {
	for _, tc := range []struct {
		name    string
		values  map[string]driver.Value
		want    bool
		invalid bool
	}{
		{"absent", map[string]driver.Value{}, false, false},
		{"off", map[string]driver.Value{DisplayIndexHTMLAtStartupKey: false}, false, false},
		{"on", map[string]driver.Value{DisplayIndexHTMLAtStartupKey: true}, true, false},
		{"null", map[string]driver.Value{DisplayIndexHTMLAtStartupKey: nil}, false, true},
		{"text", map[string]driver.Value{DisplayIndexHTMLAtStartupKey: "invalid"}, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			name := fmt.Sprintf("custom_root_%d", frontPageSwitchDriverID.Add(1))
			sql.Register(name, frontPageSwitchDriver{tc.values})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			settings, err := ReadFrontPageSettings(context.Background(), db)
			if (err != nil) != tc.invalid || (!tc.invalid && settings.DisplayIndexHTMLAtStartup != tc.want) {
				t.Fatal(settings, err)
			}
		})
	}
}

func TestCustomRootFileTypesAndSizeLimits(t *testing.T) {
	storage := t.TempDir()
	directory := filepath.Join(storage, "site_root")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	for extension, fileType := range customRootFileTypes {
		t.Run(extension, func(t *testing.T) {
			name := "file" + extension
			filePath := filepath.Join(directory, name)
			if err := os.WriteFile(filePath, []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
			file, info, mime, err := OpenSiteRootFile(storage, name)
			if err != nil {
				t.Fatal(err)
			}
			file.Close()
			if mime != fileType.mime || info.Size() != 7 {
				t.Fatal(mime, info.Size())
			}
			if err := os.Truncate(filePath, fileType.maxSize); err != nil {
				t.Fatal(err)
			}
			file, _, _, err = OpenSiteRootFile(storage, name)
			if err != nil {
				t.Fatal("maximum accepted size", err)
			}
			file.Close()
			if err := os.Truncate(filePath, fileType.maxSize+1); err != nil {
				t.Fatal(err)
			}
			if file, _, _, err = OpenSiteRootFile(storage, name); err == nil {
				file.Close()
				t.Fatal("oversized file accepted")
			}
		})
	}
}

func TestCustomRootRefusesUnsafeNamesDirectoriesAndSymlinks(t *testing.T) {
	storage := t.TempDir()
	directory := filepath.Join(storage, "site_root")
	if err := os.MkdirAll(filepath.Join(directory, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"", ".", "..", "../index.html", "/index.html", "nested/../index.html", "nested//index.html", "nested/", `nested\index.html`, "index%2f.html", "index%252f.html", "nested/.hidden.css", "index.html?secret", "private.sql", "private.json", ".env", "index.HTML", "nested"} {
		t.Run(name, func(t *testing.T) {
			if file, _, _, err := OpenSiteRootFile(storage, name); err == nil {
				file.Close()
				t.Fatal("unsafe name accepted")
			}
		})
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "private.css"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, target string }{
		{"escape.css", filepath.Join(outside, "private.css")},
		{"inside.html", filepath.Join(directory, "index.html")},
		{"linked", outside},
	} {
		if err := os.Symlink(tc.target, filepath.Join(directory, tc.name)); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"escape.css", "inside.html", "linked/private.css"} {
		if file, _, _, err := OpenSiteRootFile(storage, name); err == nil {
			file.Close()
			t.Fatal("symlink accepted", name)
		}
	}
	if err := os.RemoveAll(directory); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, directory); err != nil {
		t.Fatal(err)
	}
	if file, _, _, err := OpenSiteRootFile(storage, "private.css"); err == nil {
		file.Close()
		t.Fatal("site_root symlink accepted")
	}
}

func TestCustomRootPrivateStatusMissingReadyAndOversized(t *testing.T) {
	storage := t.TempDir()
	wantPath := filepath.Join(storage, "site_root", "index.html")
	if status := ReadSiteRootStatus(storage); status.Exists || status.Ready || status.Path != wantPath {
		t.Fatal(status)
	}
	if err := os.Mkdir(filepath.Dir(wantPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(wantPath, []byte("home"), 0600); err != nil {
		t.Fatal(err)
	}
	if status := ReadSiteRootStatus(storage); !status.Exists || !status.Ready {
		t.Fatal(status)
	}
	if err := os.Truncate(wantPath, (2<<20)+1); err != nil {
		t.Fatal(err)
	}
	if status := ReadSiteRootStatus(storage); !status.Exists || status.Ready {
		t.Fatal(status)
	}
}
