// get_filter_options_delivery_test.go
// Proves filter values and labels obey the result reader's delivery boundary.
// Uses the SEC4 in-memory driver, without installation data or external services.
package dtt_1_row_read

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
)

func TestSEC4FilterOptionsUsesResultColumns(t *testing.T) {
	for _, role := range []string{"basic", "admin"} {
		t.Run(role, func(t *testing.T) {
			for _, column := range []string{
				"internal_notes", "embedding_vector", "search_vector_simple", "hidden_notes",
				"id", "name", "slug", "admin_notes", "",
			} {
				name := column
				if name == "" {
					name = "default_id"
				}
				t.Run(name, func(t *testing.T) {
					valueQueries := sec4FilterOptionDeliveryFixture(t, role, "name", nil)
					path := "/api/get-filter-options?dataset=private_data"
					if column != "" {
						path += "&value_column=" + column
					}
					req := queryfixture.Request(t, http.MethodGet, path, "", 42, role)
					rec := httptest.NewRecorder()
					GetFilterOptionsHandler(rec, req)

					included := column == "" || column == "id" || column == "name" || column == "slug" || (column == "admin_notes" && role == "admin")
					if !included {
						if rec.Code != http.StatusForbidden || *valueQueries != 0 {
							t.Fatalf("excluded value: status=%d value queries=%d; want 403 before any value query: %s", rec.Code, *valueQueries, rec.Body)
						}
						return
					}
					if rec.Code != http.StatusOK || *valueQueries != 1 {
						t.Fatalf("included value: status=%d value queries=%d; want 200 and one query: %s", rec.Code, *valueQueries, rec.Body)
					}
					var options []filterOption
					if err := json.Unmarshal(rec.Body.Bytes(), &options); err != nil {
						t.Fatal(err)
					}
					if len(options) != 1 || options[0].Value != "visible-key" || options[0].Label != "Row name" {
						t.Fatalf("included option changed: %#v", options)
					}
				})
			}
		})
	}
}

func TestSEC4FilterOptionsRejectsUnreadableDisplayColumn(t *testing.T) {
	for _, role := range []string{"basic", "admin"} {
		for _, label := range []string{"internal_notes", "embedding_vector", "search_vector_simple", "hidden_notes", "admin_notes"} {
			if role == "admin" && label == "admin_notes" {
				continue // The administrator's included columns are covered above.
			}
			t.Run(role+"/"+label, func(t *testing.T) {
				valueQueries := sec4FilterOptionDeliveryFixture(t, role, label, nil)
				req := queryfixture.Request(t, http.MethodGet, "/api/get-filter-options?dataset=private_data&value_column=slug", "", 42, role)
				rec := httptest.NewRecorder()
				GetFilterOptionsHandler(rec, req)
				if rec.Code != http.StatusForbidden || *valueQueries != 0 {
					t.Fatalf("excluded label: status=%d value queries=%d; want 403 before any value query: %s", rec.Code, *valueQueries, rec.Body)
				}
			})
		}
	}
}

func TestSEC4FilterOptionsMetadataFailurePrecedesValues(t *testing.T) {
	valueQueries := sec4FilterOptionDeliveryFixture(t, "basic", "name", errors.New("metadata unavailable"))
	req := queryfixture.Request(t, http.MethodGet, "/api/get-filter-options?dataset=private_data&value_column=slug", "", 42, "basic")
	rec := httptest.NewRecorder()
	GetFilterOptionsHandler(rec, req)
	if rec.Code != http.StatusInternalServerError || *valueQueries != 0 {
		t.Fatalf("metadata failure: status=%d value queries=%d; want 500 before any value query: %s", rec.Code, *valueQueries, rec.Body)
	}
}

func sec4FilterOptionDeliveryFixture(t *testing.T, role, displayColumn string, metadataErr error) *int {
	t.Helper()
	valueQueries := 0
	db := queryfixture.Open(t, func(q string, _ []driver.NamedValue) (driver.Rows, error) {
		switch {
		case strings.Contains(q, "information_schema.column_privileges"):
			// All excluded fields are SELECT-granted. admin_notes is included in
			// client metadata but has an administrator-only database grant.
			// internal_notes is server_only text; hidden_notes is globally hidden.
			// Both vector columns have include delivery but reserved names.
			grants := [][]driver.Value{{"id"}, {"name"}, {"slug"}, {"internal_notes"}, {"embedding_vector"}, {"search_vector_simple"}, {"hidden_notes"}}
			if role == "admin" {
				grants = append(grants, []driver.Value{"admin_notes"})
			}
			return queryfixture.Rows([]string{"column_name"}, grants...), nil
		case strings.Contains(q, "SELECT cd.column_uid"):
			if metadataErr != nil {
				return nil, metadataErr
			}
			// Model the result reader's filtered metadata projection. Assert its
			// actual SQL contract so removing a delivery exclusion breaks the proof.
			for _, predicate := range []string{
				"COALESCE(cd.client_delivery_mode, 'include') = 'include'",
				"cd.column_name NOT IN ('embedding_vector', 'search_vector_simple')",
				"COALESCE(cd.hide_everywhere, false) = false",
			} {
				if !strings.Contains(q, predicate) {
					t.Errorf("result metadata query lost %q", predicate)
				}
			}
			columns := []string{"column_uid", "column_name", "data_type", "co_number", "is_nullable", "is_identity", "column_default", "card_element", "is_multilingual"}
			var values [][]driver.Value
			for i, name := range []string{"id", "name", "slug", "admin_notes"} {
				values = append(values, []driver.Value{int64(i + 1), name, "text", int64(i + 1), "YES", "NO", nil, "", false})
			}
			return queryfixture.Rows(columns, values...), nil
		case strings.Contains(q, "SELECT fk_display_column"):
			return queryfixture.Rows([]string{"fk_display_column"}, []driver.Value{displayColumn}), nil
		case strings.Contains(q, "SELECT EXISTS"):
			return queryfixture.Rows([]string{"exists"}, []driver.Value{true}), nil
		case strings.Contains(q, "SELECT table_uid"):
			return queryfixture.Rows([]string{"table_uid"}, []driver.Value{int64(7)}), nil
		case strings.Contains(q, "must_be_true_unless_own"):
			return queryfixture.Rows([]string{"column_name"}), nil
		case strings.HasPrefix(q, "SELECT DISTINCT "):
			valueQueries++
			return queryfixture.Rows([]string{"value", "label"}, []driver.Value{"visible-key", "Row name"}), nil
		default:
			return nil, fmt.Errorf("unexpected filter-options query: %s", q)
		}
	})
	old, oldBasic, oldAdmin := backend.Db, backend.DbBasic, backend.DbAdmin
	backend.Db, backend.DbBasic, backend.DbAdmin = db, db, db
	t.Cleanup(func() { backend.Db, backend.DbBasic, backend.DbAdmin = old, oldBasic, oldAdmin })
	return &valueQueries
}
