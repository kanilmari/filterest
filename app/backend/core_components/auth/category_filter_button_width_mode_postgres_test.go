// category_filter_button_width_mode_postgres_test.go
// Proves that a changed category layout reaches the next handler call without restart.
// Uses the existing explicitly opted-in disposable PostgreSQL handler fixture.
// Confines all setting writes and cleanup to that fixture's temporary database.
package auth

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCategoryButtonWidthNextHandlerReadsChangedPostgresSetting(t *testing.T) {
	db := loginNameDisposableCluster(t)
	store := setupAuthModesTestStore(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20261030000346_add_category_filter_button_width_mode.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{defaultCategoryFilterButtonWidthMode, "fit_to_label", defaultCategoryFilterButtonWidthMode} {
		if _, err := db.Exec(`UPDATE system_config SET text_value=$1 WHERE key=$2`, mode, categoryFilterButtonWidthModeKey); err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		GetAuthModesHandler(response, buildAuthModesReq(t, store, "/api/auth-modes", nil))
		var body AuthModesResponse
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(response.Code, err)
		}
		if response.Code != 200 || body.CategoryFilterButtonWidthMode != mode {
			t.Fatal(response.Code, body, mode)
		}
	}
}
