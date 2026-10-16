// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package dtt_foreign_keys

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSEC4UnscopedCataloguesOmitUnreadableDatasets(t *testing.T) {
	db := queryfixture.Open(t, func(q string, args []driver.NamedValue) (driver.Rows, error) {
		switch {
		case strings.Contains(q, "system_group_table_func_rights"):
			if args[len(args)-1].Value == "visible" {
				return queryfixture.Rows([]string{"allowed"}, []driver.Value{int64(1)}), nil
			}
			return queryfixture.Rows([]string{"allowed"}), nil
		case strings.Contains(q, "FROM system_db_tables ORDER BY table_name"):
			return queryfixture.Rows([]string{"table_uid", "table_name", "schema_name"}, []driver.Value{int64(1), "visible", "public"}, []driver.Value{int64(2), "hidden", "public"}, []driver.Value{int64(3), "unlisted_view", "public"}), nil
		case strings.Contains(q, "FROM system_db_table_aliases"):
			return queryfixture.Rows([]string{"table_uid", "alias_slug", "is_primary"}, []driver.Value{int64(1), "visible-alias", true}, []driver.Value{int64(2), "hidden-alias", true}, []driver.Value{int64(3), "unlisted-view-alias", true}), nil
		case strings.Contains(q, "information_schema.tables"):
			return queryfixture.Rows([]string{"table_name"}, []driver.Value{"visible"}, []driver.Value{"hidden"}), nil
		default:
			return queryfixture.Rows([]string{"constraint_name", "source", "source_col", "target", "target_col"}, []driver.Value{"visible_fk", "visible", "parent_id", "visible", "id"}, []driver.Value{"hidden_fk", "visible", "private_id", "hidden", "id"}), nil
		}
	})
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	for _, role := range []string{"guest", "basic", "admin"} {
		for _, path := range []string{"/api/dataset-names", "/api/dataset-names?with_aliases=1", "/api/foreign_keys"} {
			t.Run(role+path, func(t *testing.T) {
				principal := 42
				if role == "guest" {
					principal = 1
				}
				req := queryfixture.Request(t, "GET", path, "", principal, role)
				rec := httptest.NewRecorder()
				if strings.HasPrefix(path, "/api/dataset-names") {
					GetTableNamesHandler(rec, req)
				} else {
					GetForeignKeys(rec, req)
				}
				if rec.Code != 200 {
					t.Fatalf("%s %s: status=%d", role, path, rec.Code)
				}
				if strings.Contains(path, "with_aliases") && strings.Contains(rec.Body.String(), "unlisted-view-alias") != (role == "admin") {
					t.Fatal("administrator alias inventory changed or private alias leaked")
				}
				if strings.Contains(rec.Body.String(), "hidden") != (role == "admin") {
					t.Fatalf("%s %s leaked/removed metadata: %s", role, path, rec.Body)
				}
			})
		}
	}
}

// Existing discovery tests are administrator inventory proofs.
func foreignKeyAdminReadRequest(t *testing.T, path string, _ io.Reader) *http.Request {
	return queryfixture.Request(t, "GET", path, "", 42, "admin")
}
