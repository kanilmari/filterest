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
	"strings"
	"testing"

	"easelect/backend/core_components/dev_tools"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/system_table_tools"
)

// readMethods are the methods the assistant guard lets through unapproved.
var readMethods = []string{http.MethodGet, http.MethodHead}

func TestHandlersThatChangeDataRefuseReadMethods(t *testing.T) {
	// Each of these rewrites stored data: catalog metadata, translations, or
	// whole rows. None of them has a meaning as a read.
	mutatingHandlers := map[string]http.HandlerFunc{
		"/api/update-oids":            system_table_tools.HandleUpdateOidsAndTableNames,
		"/api/generate-translations":  lang.GenerateTranslationsHandler,
		"/api/fix-table-translations": lang.FixTableTranslationsHandler,
		"/api/import-table-csv":       devtools.ImportTableCSVHandler,
	}

	for address, handler := range mutatingHandlers {
		for _, method := range readMethods {
			request := httptest.NewRequest(method, address, strings.NewReader(""))
			recorder := httptest.NewRecorder()

			handler(recorder, request)

			if recorder.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s answered %d; a handler that changes data must refuse a read with %d",
					method, address, recorder.Code, http.StatusMethodNotAllowed)
			}
		}
	}
}
