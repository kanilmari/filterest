// completion.go
// Supplies the empty-catalogue completion reads for dedicated handler unit tests.
// Reuses the part-A snapshot fixture; PostgreSQL tests exercise real ACL deltas.
// Separates policy SQL from the business-query queues and their existing assertions.
package granttest

import (
	"database/sql/driver"
	"strings"
)

func BoundaryQuery(query string, args []driver.NamedValue) (driver.Rows, bool) {
	if result, ok := SnapshotQuery(query, args); ok {
		return result, true
	}
	if strings.Contains(query, "string_agg(row_to_json(a)::text") {
		return &rows{1, [][]driver.Value{{""}}}, true
	}
	if strings.Contains(query, "CROSS JOIN LATERAL aclexplode") {
		return &rows{7, nil}, true
	}
	if strings.Contains(query, "FROM actual WHERE wanted IS DISTINCT FROM present") {
		return &rows{9, nil}, true
	}
	if strings.Contains(query, "SELECT COALESCE(to_regclass(format('%I.%I'") {
		return &rows{1, nil}, true
	}
	return nil, false
}
