// csv_row_actors_test.go
// Checks backup actor normalization and the import's conflict-update boundary.
// Reuses the CSV driver's captured SQL and values, including the HTTP response.
// Restoring a row must never turn its importer into its original author.
package devtools

import (
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtimepaths"
	e_sessions "easelect/backend/core_components/sessions"
	"fmt"
	"github.com/gorilla/sessions"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type csvActorRows struct {
	cols  []string
	rows  [][]driver.Value
	index int
}

func (r *csvActorRows) Columns() []string { return r.cols }
func (r *csvActorRows) Close() error      { return nil }
func (r *csvActorRows) Next(dest []driver.Value) error {
	if r.index == len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}
func TestCSVRestorePreservesActorsAndReportsClearedReferences(t *testing.T) {
	oldStore := e_sessions.Store
	e_sessions.Store = sessions.NewCookieStore([]byte("test-secret-key-32-bytes-long!!"))
	t.Cleanup(func() { e_sessions.Store = oldStore })
	root := t.TempDir()
	paths, err := runtimepaths.Resolve(root, root, false)
	if err != nil {
		t.Fatal(err)
	}
	configureTableCSVRuntimePathsForTest(t, paths)
	if err := os.MkdirAll(tableCSVDataDir(), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tableCSVFilePath("notes"), []byte("id,title,created_by,user_id\n1,changed,4,9\n2,new,1,999\n3,new,-2,0\n4,new,,4\n"), 0600); err != nil {
		t.Fatal(err)
	}
	drv := &stubDriver{actorRows: [][]driver.Value{{"created_by", "creator"}, {"user_id", "owner"}}, users: map[int64]bool{4: true, 9: true}}
	name := fmt.Sprintf("csv-actors-%d", time.Now().UnixNano())
	sql.Register(name, drv)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	req := httptest.NewRequest("POST", "/?dataset=notes", nil)
	req = req.WithContext(dbutils.SetTx(req.Context(), tx))
	rec := httptest.NewRecorder()
	ImportTableCSVHandler(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "creator=2, owner=2") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	update := strings.Split(drv.lastQuery, "DO UPDATE SET ")
	if len(update) != 2 || strings.Contains(update[1], "created_by") || strings.Contains(update[1], "user_id") {
		t.Fatalf("restore can overwrite actors: %s", drv.lastQuery)
	}
	if drv.execArgs[0][2].Value != int64(4) || drv.execArgs[0][3].Value != int64(9) {
		t.Fatal("valid backup actors changed")
	}
	for _, i := range []int{1, 2} {
		if drv.execArgs[i][2].Value != nil || drv.execArgs[i][3].Value != nil {
			t.Fatal("invalid actors not cleared")
		}
	}
	if drv.userLookups != 3 {
		t.Fatalf("repeated users were not cached: %d", drv.userLookups)
	}
}
