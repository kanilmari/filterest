// app_log_search_terms_test.go
// Proves both page-load log lines omit queries unless a site opts in.
// Connects the actual dataset/admin handlers to a configuration SQL fixture.
// Captures emitted logs before template loading, without a server or database.
package router

import (
	"bytes"
	"database/sql/driver"
	"log"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/system_config_cache"
)

func TestPageLoadLogsRespectSearchTermSetting(t *testing.T) {
	for _, state := range []string{"off", "on", "missing"} {
		for _, page := range []string{"tablesHandler", "adminHandler"} {
			t.Run(state+"/"+page, func(t *testing.T) {
				oldDB, oldFrontend := backend.Db, localFrontendDir
				backend.Db = queryfixture.Open(t, func(string, []driver.NamedValue) (driver.Rows, error) {
					if state == "missing" {
						return queryfixture.Rows([]string{"boolean_value"}), nil
					}
					return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{state == "on"}), nil
				})
				// Stop after the log under test; no template/SEO database reads.
				localFrontendDir = filepath.Join(t.TempDir(), "no-frontend")
				t.Setenv("ENVIRONMENT_TYPE", "prod")
				var output bytes.Buffer
				oldOutput := log.Writer()
				log.SetOutput(&output)
				t.Cleanup(func() {
					log.SetOutput(oldOutput)
					backend.Db, localFrontendDir = oldDB, oldFrontend
					system_config_cache.Delete("app_log_search_terms")
				})
				req := httptest.NewRequest("GET", "/dataset?search=private+words&query=hidden&view=card", nil)
				if page == "tablesHandler" {
					tablesHandler(httptest.NewRecorder(), req, false, nil)
				} else {
					adminHandler(httptest.NewRecorder(), req)
				}
				want := page + ": user requested URL: /dataset"
				if state == "on" {
					want += "?search=private+words&query=hidden&view=card"
				}
				if !strings.Contains(output.String(), want+"\n") {
					t.Fatalf("log=%q, want %q", output.String(), want)
				}
				if state != "on" && (strings.Contains(output.String(), "private") || strings.Contains(output.String(), "hidden") || strings.Contains(output.String(), "?")) {
					t.Fatalf("search words leaked: %s", output.String())
				}
				if req.URL.RawQuery != "search=private+words&query=hidden&view=card" {
					t.Fatal("query was changed")
				}
			})
		}
	}
}
