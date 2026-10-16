// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package system_table_tools

import (
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSEC4MetadataRequiresDatasetRead(t *testing.T) {
	db := queryfixture.Open(t, func(q string, _ []driver.NamedValue) (driver.Rows, error) {
		if strings.Contains(q, "system_group_table_func_rights") {
			return queryfixture.Rows([]string{"allowed"}), nil
		}
		if strings.Contains(q, "system_child_tab_config") {
			return queryfixture.Rows([]string{"id", "parent_table", "tab_key", "tab_order", "hidden"}), nil
		}
		return queryfixture.Rows([]string{"sort_column", "sort_direction", "scope"}), nil
	})
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	for _, test := range []struct {
		name, path, body string
		handler          http.HandlerFunc
	}{
		{"tabs", "/api/child-tab-config/hidden", "", GetChildTabConfigHandler},
		{"sort", "/api/dataset-sort-default?dataset=hidden", "", GetDatasetSortDefaultHandler},
		{"personal", "/api/dataset-sort-default/personal", `{"dataset":"hidden","value":"__newest:DESC"}`, SavePersonalDatasetSortDefaultHandler},
	} {
		t.Run(test.name, func(t *testing.T) {
			method := "GET"
			if test.body != "" {
				method = "POST"
			}
			principal, role := 42, "basic"
			if test.name == "sort" {
				principal, role = 1, "guest"
			}
			req := queryfixture.Request(t, method, test.path, test.body, principal, role)
			if test.name == "personal" {
				priorSave := datasetSortDefaultSave
				datasetSortDefaultSave = func(w http.ResponseWriter, _ *http.Request, _, _, _ string, _ int) {
					w.WriteHeader(http.StatusNoContent)
				}
				t.Cleanup(func() { datasetSortDefaultSave = priorSave })
			}
			rec := httptest.NewRecorder()
			test.handler(rec, req)
			if rec.Code != 403 {
				t.Fatalf("status=%d want 403: %s", rec.Code, rec.Body)
			}
		})
	}
}
func TestSEC4AboutRequiresApproval(t *testing.T) {
	db := queryfixture.Open(t, func(q string, _ []driver.NamedValue) (driver.Rows, error) {
		if strings.Contains(q, "admin_approved = TRUE") {
			return queryfixture.Rows([]string{"title", "description"}), nil
		}
		return queryfixture.Rows([]string{"title", "description"}, []driver.Value{"draft", "private"}), nil
	})
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	rec := httptest.NewRecorder()
	GetAboutRowHandler(rec, httptest.NewRequest("GET", "/api/about?id=7", nil))
	if rec.Code != 404 || strings.Contains(rec.Body.String(), "private") {
		t.Fatalf("unapproved row disclosed: %d %s", rec.Code, rec.Body)
	}
}
