// lang_key_pause_test.go
// Exercises the real language-key startup step with an aged orphan candidate.
// Connects startup scanning/marking to an in-memory recording SQL driver.
// Proves server startup preserves copy while still maintaining orphan markers.
package startup

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtimepaths"
)

type startupPauseDriver struct{ calls *[]string }
type startupPauseConn struct{ calls *[]string }
type startupPauseTx struct{}
type startupPauseRows struct {
	columns []string
	values  []driver.Value
	done    bool
}

func (d startupPauseDriver) Open(string) (driver.Conn, error) { return &startupPauseConn{d.calls}, nil }
func (c *startupPauseConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("use context methods")
}
func (c *startupPauseConn) Close() error              { return nil }
func (c *startupPauseConn) Begin() (driver.Tx, error) { return startupPauseTx{}, nil }
func (startupPauseTx) Commit() error                  { return nil }
func (startupPauseTx) Rollback() error                { return nil }
func (c *startupPauseConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	*c.calls = append(*c.calls, query)
	if strings.Contains(query, "AS has_live_usage") {
		return &startupPauseRows{columns: []string{"id", "key", "en", "type", "live"}, values: []driver.Value{int64(42), "unused_startup_key", "Copy", "ui", false}}, nil
	}
	if strings.Contains(query, "SELECT src.lang_key_id, src.last_seen") {
		return &startupPauseRows{columns: []string{"id", "date"}, values: []driver.Value{int64(42), "2020-01-01"}}, nil
	}
	return &startupPauseRows{columns: []string{"empty"}}, nil
}
func (c *startupPauseConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	*c.calls = append(*c.calls, query)
	return driver.RowsAffected(1), nil
}
func (r *startupPauseRows) Columns() []string { return r.columns }
func (r *startupPauseRows) Close() error      { return nil }
func (r *startupPauseRows) Next(dest []driver.Value) error {
	if r.done || len(r.values) == 0 {
		return io.EOF
	}
	r.done = true
	copy(dest, r.values)
	return nil
}
func TestStartupLangKeyPauseKeepsAgedOrphanAndMarks(t *testing.T) {
	installation := t.TempDir()
	root := filepath.Join(installation, "app")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"frontend", "backend"} {
		if err := os.Mkdir(filepath.Join(root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range []string{"go.mod", "VERSION_APP"} {
		if err := os.WriteFile(filepath.Join(root, file), []byte("test\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	oldPaths := runtimepaths.Current()
	// The pre-startup defaults are relative. Restore their equivalent absolute
	// paths through Configure, whose public contract requires absolute roots.
	for _, value := range []*string{&oldPaths.InstallationRoot, &oldPaths.ApplicationRoot,
		&oldPaths.DataRoot, &oldPaths.StorageRoot, &oldPaths.StorageDeletedRoot, &oldPaths.RuntimeRoot} {
		absolute, err := filepath.Abs(*value)
		if err != nil {
			t.Fatal(err)
		}
		*value = absolute
	}
	paths, err := runtimepaths.Resolve(root, installation, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := runtimepaths.Configure(oldPaths); err != nil {
			t.Error(err)
		}
	})
	var calls []string
	sql.Register("startup_lang_key_pause", startupPauseDriver{&calls})
	db, err := sql.Open("startup_lang_key_pause", "")
	if err != nil {
		t.Fatal(err)
	}
	oldDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = oldDB; _ = db.Close() })
	runStartupLangKeyMaintenance()
	marked := false
	for _, query := range calls {
		normalized := strings.Join(strings.Fields(query), " ")
		if strings.Contains(normalized, "system_lang_keys_archive") || strings.Contains(normalized, "DELETE FROM system_lang_keys ") || strings.Contains(normalized, "SELECT src.lang_key_id, src.last_seen") {
			t.Errorf("startup still retires keys: %s", normalized)
		}
		marked = marked || strings.Contains(query, "FROM UNNEST")
	}
	if !marked {
		t.Fatal("startup no longer marks orphans")
	}
}
