// mutating_routes_refuse_reads_test.go
// Verifies that a handler which changes stored data will not answer a read.
// Bridges route registration with the site assistant's approval rule.
// Exists because that rule requires approval only of writes, and decides what a
// write is from the request method alone. A handler that changes data while
// answering a GET is therefore reachable without anyone approving the change,
// and these four were.
package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// readMethods are the methods the assistant guard lets through unapproved.
var readMethods = []string{http.MethodGet, http.MethodHead}

func TestHandlersThatChangeDataRefuseReadMethods(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	RegisterRoutes(t.TempDir(), t.TempDir())
	t.Cleanup(ResetRouteDefinitions)

	// Each of these rewrites stored data: catalog metadata, translations, or
	// whole rows. None of them has a meaning as a read.
	mutatingRoutes := map[string]string{
		"/api/update-oids":            "system_table_tools.HandleUpdateOidsAndTableNames",
		"/api/generate-translations":  "lang.GenerateTranslationsHandler",
		"/api/fix-table-translations": "lang.FixTableTranslationsHandler",
		"/api/import-table-csv":       "devtools.ImportTableCSVHandler",
	}

	for address, handlerName := range mutatingRoutes {
		var route *RouteDefinition
		for _, definition := range GetRouteDefinitions() {
			if definition.HandlerName == handlerName {
				definitionCopy := definition
				route = &definitionCopy
				break
			}
		}
		if route == nil {
			t.Fatalf("route %s (%s) is not registered", address, handlerName)
		}
		for _, method := range readMethods {
			request := httptest.NewRequest(method, address, nil)
			recorder := httptest.NewRecorder()

			route.HandlerFunc(recorder, request)

			if recorder.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s answered %d; a handler that changes data must refuse a read with %d",
					method, address, recorder.Code, http.StatusMethodNotAllowed)
			}
		}
	}
}
