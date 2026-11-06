// search_helper_error_logs_test.go
// Exercises error printers below search handlers, including optional enrichment.
// Connects shared metadata and row readers to wrapped, search-bearing SQL failures.
// Prevents a lower-level duplicate log from bypassing the site's privacy setting.
package dtt_1_row_read

import (
	"context"
	"database/sql/driver"
	"fmt"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils/queryfixture"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/system_config_cache"

	"github.com/lib/pq"
)

func TestSearchHelperErrorsRespectSearchTermSetting(t *testing.T) {
	for _, helper := range []string{"selectable", "types", "joins", "policy", "card", "map", "kind", "rows"} {
		for _, enabled := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/on=%t", helper, enabled), func(t *testing.T) {
				wrapped := fmt.Errorf("search %s: %w", searchLogMarker, &pq.Error{Code: "42601", Message: searchLogMarker})
				db := queryfixture.Open(t, func(q string, args []driver.NamedValue) (driver.Rows, error) {
					switch {
					case strings.Contains(q, "SELECT boolean_value FROM system_config"):
						return queryfixture.Rows([]string{"boolean_value"}, []driver.Value{enabled}), nil
					case strings.Contains(q, "SELECT EXISTS"):
						return queryfixture.Rows([]string{"exists"}, []driver.Value{false}), nil
					case strings.Contains(q, "SELECT table_uid FROM system_db_tables"):
						return queryfixture.Rows([]string{"uid"}, []driver.Value{int64(161)}), nil
					case q == "e2e_delayed_rows":
						return &searchErrorRows{Rows: queryfixture.Rows([]string{"id"}), err: wrapped}, nil
					}
					return nil, wrapped
				})
				previousDB := backend.Db
				backend.Db = db
				t.Cleanup(func() {
					backend.Db = previousDB
					system_config_cache.Delete(middlewares.AppLogSearchTermsKey)
					resetJoinMetadataCacheForTests()
				})
				resetJoinMetadataCacheForTests()
				logs := captureSearchErrorLogs(t, func() {
					switch helper {
					case "selectable":
						fetchUserSelectableColumns(db, supportFixtureDataset)
					case "types":
						getColumnDataTypesWithFK(supportFixtureDataset, db)
					case "joins":
						loadJoinMetadata(db, supportFixtureDataset)
					case "policy":
						getMustBeTrueColumnsWithOwner(db, supportFixtureDataset)
					case "card":
						logCardSupportEnrichmentWarning(supportFixtureDataset, wrapped)
					case "map":
						logMapSupportEnrichmentWarning(supportFixtureDataset, wrapped)
					case "kind":
						readDatasetKindCapabilities(context.Background(), supportFixtureDataset)
					case "rows":
						rows, err := db.Query("e2e_delayed_rows")
						if err != nil {
							t.Fatal(err)
						}
						defer rows.Close()
						FormatRowsToMaps(rows)
					}
				})
				if strings.Contains(logs, searchLogMarker) != enabled {
					t.Fatalf("on=%t logs=%q", enabled, logs)
				}
				if enabled && !strings.Contains(logs, wrapped.Error()) {
					t.Fatalf("former error text missing: %q", logs)
				}
				identity := "error_class=*pq.Error sqlstate=42601 handler="
				if helper == "joins" {
					// This legacy helper returns a message-only error without %w.
					identity = "error_class=*errors.errorString sqlstate=unknown handler="
				}
				if !enabled && !strings.Contains(logs, identity) {
					t.Fatalf("safe diagnostic missing: %q", logs)
				}
			})
		}
	}
}
