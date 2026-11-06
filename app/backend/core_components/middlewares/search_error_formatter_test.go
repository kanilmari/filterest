// search_error_formatter_test.go
// Proves private diagnostics preserve identity without error or SQL contents.
// Connects wrapped PostgreSQL failures to the site's cached logging opt-in.
// Guards message, detail, query and invalid-SQLSTATE reflection boundaries.
package middlewares

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/system_config_cache"

	"github.com/lib/pq"
)

func TestSearchErrorFormatterRetainsOnlyDiagnosticIdentity(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(fmt.Sprint(enabled), func(t *testing.T) {
			oldDB := backend.Db
			backend.Db = queryfixture.Open(t, func(string, []driver.NamedValue) (driver.Rows, error) {
				return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{enabled}), nil
			})
			t.Cleanup(func() { backend.Db = oldDB; system_config_cache.Delete(AppLogSearchTermsKey) })
			for _, code := range []pq.ErrorCode{"42601", "e2e_private_search"} {
				cause := &pq.Error{Code: code, Message: "e2e_private_search", Detail: "e2e_private_search", InternalQuery: "e2e_private_search"}
				err := fmt.Errorf("search e2e_private_search: %w", cause)
				got := AppLogSearchError(err, "GetResults", "e2e_dataset")
				if enabled {
					if got != err.Error() {
						t.Fatal("opt-in error changed", got)
					}
				} else {
					state := "42601"
					if code != "42601" {
						state = "unknown"
					}
					want := `error_class=*pq.Error sqlstate=` + state + ` handler=GetResults dataset="e2e_dataset"`
					if got != want || strings.Contains(got, "e2e_private_search") {
						t.Fatalf("diagnostic=%q, want %q", got, want)
					}
				}
			}
		})
	}
}
