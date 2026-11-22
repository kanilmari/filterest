// export_table_csv_test.go
// Exercises the real export pipeline with a local SQL driver and real temporary files.
// Injects late row, write, sync, permission, close, rename and cleanup failures.
// Ensures a failed export reports no path and leaves the previous file for imports.
package devtools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtimepaths"
)

const (
	csvExportWant     = "title,created,empty\n\"a,b\",2026-10-17T00:00:00Z,\n"
	csvExportPrevious = "title\nprevious complete export\n"
)

type csvExportDriver struct{ iterationErr, queryErr error }
type csvExportConn struct{ csvExportDriver }
type csvExportRows struct {
	values       [][]driver.Value
	iterationErr error
}
type csvExportTx struct{}

func (d csvExportDriver) Open(string) (driver.Conn, error)             { return csvExportConn{d}, nil }
func (d csvExportDriver) Connect(context.Context) (driver.Conn, error) { return d.Open("") }
func (d csvExportDriver) Driver() driver.Driver                        { return d }
func (csvExportConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (csvExportConn) Close() error              { return nil }
func (csvExportConn) Begin() (driver.Tx, error) { return csvExportTx{}, nil }
func (csvExportTx) Commit() error               { return nil }
func (csvExportTx) Rollback() error             { return nil }
func (c csvExportConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "information_schema.columns") {
		return &csvExportRows{values: [][]driver.Value{{"title"}, {"created"}, {"empty"}}}, nil
	}
	if query != `SELECT "title","created","empty" FROM "export_fixture"` {
		return nil, errors.New("unexpected export query: " + query)
	}
	if c.queryErr != nil {
		return nil, c.queryErr
	}
	return &csvExportRows{values: [][]driver.Value{{[]byte("a,b"), time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC), nil}}, iterationErr: c.iterationErr}, nil
}
func (r *csvExportRows) Columns() []string {
	if len(r.values) > 0 && len(r.values[0]) == 3 || r.iterationErr != nil {
		return []string{"title", "created", "empty"}
	}
	return []string{"column_name"}
}
func (*csvExportRows) Close() error { return nil }
func (r *csvExportRows) Next(dest []driver.Value) error {
	if len(r.values) == 0 {
		if r.iterationErr != nil {
			return r.iterationErr
		}
		return io.EOF
	}
	copy(dest, r.values[0])
	r.values = r.values[1:]
	return nil
}

// faultyCSVFile wraps a real temporary file so the bytes on disk stay real.
type faultyCSVFile struct {
	*os.File
	writeErr, syncErr, chownErr, chmodErr, closeErr error
	shortWrite                                      bool
	onWrite                                         func()
	closes                                          int
}

func (f *faultyCSVFile) Write(data []byte) (int, error) {
	if f.onWrite != nil {
		f.onWrite()
	}
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	if f.shortWrite && len(data) > 1 {
		n, err := f.File.Write(data[:len(data)-1])
		return n, err
	}
	return f.File.Write(data)
}
func (f *faultyCSVFile) Sync() error {
	if f.syncErr != nil {
		return f.syncErr
	}
	return f.File.Sync()
}
func (f *faultyCSVFile) Chown(uid, gid int) error {
	if f.chownErr != nil {
		return f.chownErr
	}
	return f.File.Chown(uid, gid)
}
func (f *faultyCSVFile) Chmod(mode os.FileMode) error {
	if f.chmodErr != nil {
		return f.chmodErr
	}
	return f.File.Chmod(mode)
}
func (f *faultyCSVFile) Close() error {
	f.closes++
	closeErr := f.File.Close()
	if f.closeErr != nil {
		return f.closeErr
	}
	return closeErr
}

func configureCSVExportDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	paths, err := runtimepaths.Resolve(root, root, false)
	if err != nil {
		t.Fatal(err)
	}
	configureTableCSVRuntimePathsForTest(t, paths)
	if err := os.MkdirAll(tableCSVDataDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	return tableCSVDataDir()
}

func csvExportContext(t *testing.T, d csvExportDriver) context.Context {
	t.Helper()
	db := sql.OpenDB(d)
	t.Cleanup(func() { _ = db.Close() })
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	return dbutils.SetTx(context.Background(), tx)
}

func leftoverCSVTemps(t *testing.T, dir string) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(dir, ".*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	return matches
}

func currentUmaskDefault(t *testing.T) os.FileMode {
	t.Helper()
	probe := filepath.Join(t.TempDir(), "probe")
	f, err := os.OpenFile(probe, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	info, err := os.Stat(probe)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}

func TestExportTableCSVFailuresKeepPreviousExport(t *testing.T) {
	iterationErr := errors.New("late row iteration failure")
	writeErr := errors.New("disk full during flush")
	syncErr := errors.New("delayed write error reported by fsync")
	chmodErr := errors.New("permission bits refused")
	chownErr := errors.New("owner change refused")
	rulesErr := errors.New("access rules refused")
	closeErr := errors.New("output close failed")
	renameErr := errors.New("rename refused")
	removeErr := errors.New("cleanup refused")
	queryErr := errors.New("query refused")
	for _, test := range []struct {
		name                           string
		driver                         csvExportDriver
		file                           faultyCSVFile
		renameErr, removeErr, rulesErr error
		want                           string
		causes                         []error
		wantLeftover, wantNoTempEvent  bool
	}{
		{name: "late iteration", driver: csvExportDriver{iterationErr: iterationErr}, want: "error iterating rows", causes: []error{iterationErr}},
		{name: "query fails before any file", driver: csvExportDriver{queryErr: queryErr}, want: "error querying table", wantNoTempEvent: true},
		{name: "write during flush", file: faultyCSVFile{writeErr: writeErr}, want: "error flushing csv", causes: []error{writeErr}},
		{name: "short write", file: faultyCSVFile{shortWrite: true}, want: "error flushing csv", causes: []error{io.ErrShortWrite}},
		{name: "sync", file: faultyCSVFile{syncErr: syncErr}, want: "error syncing csv", causes: []error{syncErr}},
		{name: "keeping owner and group", file: faultyCSVFile{chownErr: chownErr}, want: "error keeping csv owner and group", causes: []error{chownErr}},
		{name: "keeping permissions", file: faultyCSVFile{chmodErr: chmodErr}, want: "error keeping csv permissions", causes: []error{chmodErr}},
		{name: "keeping access rules", rulesErr: rulesErr, want: "error keeping csv access rules", causes: []error{rulesErr}},
		{name: "close", file: faultyCSVFile{closeErr: closeErr}, want: "error closing csv", causes: []error{closeErr}},
		{name: "iteration and close", driver: csvExportDriver{iterationErr: iterationErr}, file: faultyCSVFile{closeErr: closeErr}, want: "error iterating rows", causes: []error{iterationErr, closeErr}},
		{name: "rename", renameErr: renameErr, want: "error publishing csv", causes: []error{renameErr}},
		{name: "rename and cleanup", renameErr: renameErr, removeErr: removeErr, want: "error removing unfinished csv", causes: []error{renameErr, removeErr}, wantLeftover: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.file.chownErr != nil && runtime.GOOS != "linux" {
				t.Skip("owner and group are kept only on Linux")
			}
			dir := configureCSVExportDir(t)
			target := filepath.Join(dir, "export_fixture.csv")
			if err := os.WriteFile(target, []byte(csvExportPrevious), 0o640); err != nil {
				t.Fatal(err)
			}
			// Independent of the runner's umask.
			if err := os.Chmod(target, 0o640); err != nil {
				t.Fatal(err)
			}
			var opened *faultyCSVFile
			fsys := csvExportFS{
				createTemp: func(dir, name string, perm os.FileMode) (csvExportFile, error) {
					real, err := createExclusiveCSVTemp(dir, name, perm)
					if err != nil {
						return nil, err
					}
					opened = &faultyCSVFile{}
					*opened = test.file
					opened.File = real.(*os.File)
					return opened, nil
				},
				copyAccessRules: func(from, to string) error {
					if test.rulesErr != nil {
						return test.rulesErr
					}
					return copyCSVAccessRules(from, to)
				},
				rename: func(from, to string) error {
					if test.renameErr != nil {
						return test.renameErr
					}
					return os.Rename(from, to)
				},
				remove: func(path string) error {
					if test.removeErr != nil {
						return test.removeErr
					}
					return os.Remove(path)
				},
			}
			path, table, err := exportTableCSVToFile(csvExportContext(t, test.driver), "export_fixture", fsys)
			if err == nil || !strings.Contains(err.Error(), test.want) || path != "" || table != "" {
				t.Fatalf("export reported success or the wrong failure: path=%q table=%q err=%v", path, table, err)
			}
			for _, cause := range test.causes {
				if !errors.Is(err, cause) {
					t.Fatalf("lost failure cause %v: %v", cause, err)
				}
			}
			if test.wantNoTempEvent {
				if opened != nil {
					t.Fatal("a temporary file was created before the query succeeded")
				}
			} else if opened == nil || opened.closes != 1 {
				t.Fatalf("temporary file must be closed exactly once, got %+v", opened)
			}
			if got, readErr := os.ReadFile(target); readErr != nil || string(got) != csvExportPrevious {
				t.Fatalf("previous export changed: %q %v", got, readErr)
			}
			if info, _ := os.Stat(target); info.Mode().Perm() != 0o640 {
				t.Fatalf("previous export mode changed to %v", info.Mode().Perm())
			}
			if leftovers := leftoverCSVTemps(t, dir); len(leftovers) != map[bool]int{false: 0, true: 1}[test.wantLeftover] {
				t.Fatalf("temporary files left: %v", leftovers)
			}
		})
	}
}

func TestExportTableCSVReplacesAndKeepsPermissions(t *testing.T) {
	defaultMode := currentUmaskDefault(t)
	for _, test := range []struct {
		name     string
		existing os.FileMode // zero: no previous export
		wantMode os.FileMode
	}{
		{name: "new export", wantMode: defaultMode},
		{name: "private 0600 export", existing: 0o600, wantMode: 0o600},
		{name: "group 0640 export", existing: 0o640, wantMode: 0o640},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := configureCSVExportDir(t)
			target := filepath.Join(dir, "export_fixture.csv")
			if test.existing != 0 {
				if err := os.WriteFile(target, []byte(csvExportPrevious), test.existing); err != nil {
					t.Fatal(err)
				}
				if err := os.Chmod(target, test.existing); err != nil {
					t.Fatal(err)
				}
			}
			// The production entry point and opener, not a test seam.
			path, table, err := ExportTableCSVToFile(csvExportContext(t, csvExportDriver{}), "export_fixture")
			if err != nil || path != target || table != "export_fixture" {
				t.Fatal(path, table, err)
			}
			got, err := os.ReadFile(target)
			if err != nil || string(got) != csvExportWant {
				t.Fatalf("export content %q %v", got, err)
			}
			if info, _ := os.Stat(target); info.Mode().Perm() != test.wantMode {
				t.Fatalf("mode %v, want %v", info.Mode().Perm(), test.wantMode)
			}
			if leftovers := leftoverCSVTemps(t, dir); len(leftovers) != 0 {
				t.Fatalf("temporary files left: %v", leftovers)
			}
		})
	}
}

// ImportTableCSV opens the final path. While an export is still writing, that
// path must hold the previous complete file, never a partial one.
func TestExportTableCSVImportPathNeverSeesPartialFile(t *testing.T) {
	dir := configureCSVExportDir(t)
	target := filepath.Join(dir, "export_fixture.csv")
	if err := os.WriteFile(target, []byte(csvExportPrevious), 0o644); err != nil {
		t.Fatal(err)
	}
	observed := false
	fsys := osCSVExportFS
	fsys.createTemp = func(dir, name string, perm os.FileMode) (csvExportFile, error) {
		real, err := createExclusiveCSVTemp(dir, name, perm)
		if err != nil {
			return nil, err
		}
		return &faultyCSVFile{File: real.(*os.File), onWrite: func() {
			got, err := os.ReadFile(tableCSVFilePath("export_fixture"))
			if err != nil || string(got) != csvExportPrevious {
				t.Errorf("import path saw a partial export: %q %v", got, err)
			}
			observed = true
		}}, nil
	}
	if _, _, err := exportTableCSVToFile(csvExportContext(t, csvExportDriver{}), "export_fixture", fsys); err != nil {
		t.Fatal(err)
	}
	if !observed {
		t.Fatal("the export never wrote")
	}
	if got, _ := os.ReadFile(target); string(got) != csvExportWant {
		t.Fatalf("export not published: %q", got)
	}
}

func TestExportTableCSVConcurrentExportsPublishOneCompleteFile(t *testing.T) {
	dir := configureCSVExportDir(t)
	var wg sync.WaitGroup
	errs := make([]error, 4)
	for i := range errs {
		ctx := csvExportContext(t, csvExportDriver{})
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, errs[i] = ExportTableCSVToFile(ctx, "export_fixture")
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "export_fixture.csv")); string(got) != csvExportWant {
		t.Fatalf("concurrent exports published %q", got)
	}
	if leftovers := leftoverCSVTemps(t, dir); len(leftovers) != 0 {
		t.Fatalf("temporary files left: %v", leftovers)
	}
}

// A replacement must not change who may read the export: an ACL that denies one
// account stays in force after the export is replaced.
func TestExportTableCSVKeepsAccessControlList(t *testing.T) {
	setfacl, err := exec.LookPath("setfacl")
	if err != nil {
		t.Skip("setfacl unavailable")
	}
	dir := configureCSVExportDir(t)
	target := filepath.Join(dir, "export_fixture.csv")
	if err := os.WriteFile(target, []byte(csvExportPrevious), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(setfacl, "-m", "u:nobody:---", target).CombinedOutput(); err != nil {
		t.Skipf("filesystem refuses POSIX ACLs: %v %s", err, out)
	}
	before, err := exec.Command("getfacl", "--omit-header", "--absolute-names", target).Output()
	if err != nil {
		t.Skip("getfacl unavailable")
	}
	if _, _, err := ExportTableCSVToFile(csvExportContext(t, csvExportDriver{}), "export_fixture"); err != nil {
		t.Fatal(err)
	}
	after, err := exec.Command("getfacl", "--omit-header", "--absolute-names", target).Output()
	if err != nil || string(after) != string(before) || !strings.Contains(string(after), "user:nobody:---") {
		t.Fatalf("access rules changed:\nbefore:\n%s\nafter:\n%s (%v)", before, after, err)
	}
	if got, _ := os.ReadFile(target); string(got) != csvExportWant {
		t.Fatalf("export not published: %q", got)
	}
}

// Writing through a symlinked export reached the link's target before; the
// replacement does too and leaves the link itself in place.
func TestExportTableCSVReplacesSymlinkedExportAtItsTarget(t *testing.T) {
	dir := configureCSVExportDir(t)
	elsewhere := filepath.Join(t.TempDir(), "kept_export.csv")
	if err := os.WriteFile(elsewhere, []byte(csvExportPrevious), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "export_fixture.csv")
	if err := os.Symlink(elsewhere, link); err != nil {
		t.Skip("symlinks unavailable")
	}
	if _, _, err := ExportTableCSVToFile(csvExportContext(t, csvExportDriver{}), "export_fixture"); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("the export link was replaced by a file", err)
	}
	if got, _ := os.ReadFile(elsewhere); string(got) != csvExportWant {
		t.Fatalf("link target not updated: %q", got)
	}
	if leftovers := leftoverCSVTemps(t, filepath.Dir(elsewhere)); len(leftovers) != 0 {
		t.Fatalf("temporary files left: %v", leftovers)
	}
}

func requirePOSIXACLs(t *testing.T, path string) (setfacl, getfacl string) {
	t.Helper()
	setfacl, err := exec.LookPath("setfacl")
	if err != nil {
		t.Skip("setfacl unavailable")
	}
	getfacl, err = exec.LookPath("getfacl")
	if err != nil {
		t.Skip("getfacl unavailable")
	}
	if out, err := exec.Command(setfacl, "-m", "u:nobody:---", path).CombinedOutput(); err != nil {
		t.Skipf("filesystem refuses POSIX ACLs: %v %s", err, out)
	}
	if out, err := exec.Command(setfacl, "-b", path).CombinedOutput(); err != nil {
		t.Fatalf("clear probe ACL: %v %s", err, out)
	}
	return setfacl, getfacl
}

// A default ACL on the export directory must not reach the replacement of an
// export that had no ACL: chmod would otherwise bring the inherited entry into force.
func TestExportTableCSVDropsInheritedACLWhenPreviousHadNone(t *testing.T) {
	dir := configureCSVExportDir(t)
	target := filepath.Join(dir, "export_fixture.csv")
	if err := os.WriteFile(target, []byte(csvExportPrevious), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(target, 0o640); err != nil {
		t.Fatal(err)
	}
	setfacl, getfacl := requirePOSIXACLs(t, target)
	if out, err := exec.Command(setfacl, "-d", "-m", "u:nobody:r", dir).CombinedOutput(); err != nil {
		t.Skipf("directory refuses default ACLs: %v %s", err, out)
	}
	if _, _, err := ExportTableCSVToFile(csvExportContext(t, csvExportDriver{}), "export_fixture"); err != nil {
		t.Fatal(err)
	}
	after, err := exec.Command(getfacl, "--omit-header", "--absolute-names", target).Output()
	if err != nil || strings.Contains(string(after), "user:nobody") {
		t.Fatalf("replacement gained the directory's default ACL:\n%s (%v)", after, err)
	}
	if info, _ := os.Stat(target); info.Mode().Perm() != 0o640 {
		t.Fatalf("mode %v, want 0640", info.Mode().Perm())
	}
}

// Access rules must be in place before the permission bits widen.
func TestExportTableCSVInstallsAccessRulesWhileFileIsPrivate(t *testing.T) {
	dir := configureCSVExportDir(t)
	target := filepath.Join(dir, "export_fixture.csv")
	if err := os.WriteFile(target, []byte(csvExportPrevious), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(target, 0o644); err != nil {
		t.Fatal(err)
	}
	checked := false
	fsys := osCSVExportFS
	fsys.copyAccessRules = func(from, to string) error {
		info, err := os.Stat(to)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Errorf("replacement was not private while its access rules were set: %v %v", info.Mode().Perm(), err)
		}
		checked = true
		return copyCSVAccessRules(from, to)
	}
	if _, _, err := exportTableCSVToFile(csvExportContext(t, csvExportDriver{}), "export_fixture", fsys); err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(target); !checked || info.Mode().Perm() != 0o644 {
		t.Fatalf("checked=%t mode=%v", checked, info.Mode().Perm())
	}
}

// A broken link is refused: replacing it with a file would silently drop the link.
func TestExportTableCSVRefusesBrokenLink(t *testing.T) {
	for name, destination := range map[string]func(dir string) string{
		"absolute": func(string) string { return filepath.Join(t.TempDir(), "missing", "export.csv") },
		"relative": func(string) string { return filepath.Join("missing", "export.csv") },
	} {
		t.Run(name, func(t *testing.T) {
			dir := configureCSVExportDir(t)
			link := filepath.Join(dir, "export_fixture.csv")
			if err := os.Symlink(destination(dir), link); err != nil {
				t.Skip("symlinks unavailable")
			}
			path, _, err := ExportTableCSVToFile(csvExportContext(t, csvExportDriver{}), "export_fixture")
			if err == nil || path != "" || !strings.Contains(err.Error(), "error resolving csv link") {
				t.Fatalf("broken link accepted: path=%q err=%v", path, err)
			}
			if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
				t.Fatal("the broken link was replaced", err)
			}
			if leftovers := leftoverCSVTemps(t, dir); len(leftovers) != 0 {
				t.Fatalf("temporary files left: %v", leftovers)
			}
		})
	}
}
