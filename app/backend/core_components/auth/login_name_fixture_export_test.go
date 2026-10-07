// login_name_fixture_export_test.go
// Exposes the disposable fixture only to external tests of this package.
// Lets startup lifecycle proofs exercise real auth schema without an import cycle.
// Never adds a production database entry point.
package auth

import (
	"database/sql"
	"testing"
)

func LoginNameDisposableClusterForTest(t *testing.T) *sql.DB {
	t.Helper()
	return loginNameDisposableCluster(t)
}
