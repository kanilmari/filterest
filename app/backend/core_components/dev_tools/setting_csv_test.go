// setting_csv_test.go
// Exercises setting checks through the CSV helper and HTTP import handler.
// Reuses the existing transaction driver and temporary runtime-path fixtures.
// Exists to prove refusals write no row and retain their translated 400 reason.
package devtools

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtimepaths"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func TestSettingCSVImportChecksBeforeInsert(t *testing.T) {
	oldStore := e_sessions.Store
	e_sessions.Store = sessions.NewCookieStore([]byte("wl119-csv-disposable-session-key"))
	t.Cleanup(func() { e_sessions.Store = oldStore })
	for _, test := range []struct {
		key, raw       string
		status, writes int
	}{
		{"absolute_sign_in_limit", `{"limit_enabled":true,"limit_unit":"unknown","limit_amount":1}`, 400, 0},
		{"absolute_sign_in_limit", `{"limit_enabled":true,"limit_unit":"months","limit_amount":1}`, 200, 1},
		{"unregistered_setting", `{"anything":true}`, 200, 1},
	} {
		t.Run(test.key+test.raw, func(t *testing.T) {
			root := t.TempDir()
			paths, err := runtimepaths.Resolve(root, root, false)
			if err != nil {
				t.Fatal(err)
			}
			configureTableCSVRuntimePathsForTest(t, paths)
			if err := os.MkdirAll(tableCSVDataDir(), 0700); err != nil {
				t.Fatal(err)
			}
			file, err := os.Create(tableCSVFilePath("system_config"))
			if err != nil {
				t.Fatal(err)
			}
			writer := csv.NewWriter(file)
			if err := writer.WriteAll([][]string{{"id", "key", "value_type", "json_value"}, {"44", test.key, "5", test.raw}}); err != nil {
				t.Fatal(err)
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			state := &stubDriver{}
			name := fmt.Sprintf("setting-csv-%d", time.Now().UnixNano())
			sql.Register(name, state)
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
			rec := httptest.NewRecorder()
			req := httptest.NewRequest("POST", "/?dataset=system_config", nil)
			ImportTableCSVHandler(rec, req.WithContext(dbutils.SetTx(req.Context(), tx)))
			if rec.Code != test.status || len(state.execArgs) != test.writes+1 {
				t.Fatalf("%d %s; SQL executions %d (including the table lock)", rec.Code, rec.Body, len(state.execArgs))
			}
			if test.writes == 0 && !strings.HasPrefix(state.lastQuery, "LOCK TABLE") {
				t.Fatalf("refusal reached a write: %s", state.lastQuery)
			}
			if test.status == 400 && !strings.Contains(rec.Body.String(), `"error_lang_key":"error_setting_duration_invalid"`) {
				t.Fatal(rec.Body)
			}
		})
	}
}
