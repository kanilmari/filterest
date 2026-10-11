// catalogue_refresh_reader_test.go
// Exercises automatic no-op maintenance through the actual HTTP handler.
// Uses a driver refusing transactions and statements beyond its drift SELECT.
// Proves a current catalogue cannot take the policy lock or start reconciliation.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

type currentCatalogueDriver struct{ reads int }
type currentCatalogueRows struct{ read bool }

func (d *currentCatalogueDriver) Connect(context.Context) (driver.Conn, error) { return d, nil }
func (d *currentCatalogueDriver) Driver() driver.Driver                        { return d }
func (d *currentCatalogueDriver) Open(string) (driver.Conn, error)             { return d, nil }
func (d *currentCatalogueDriver) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected statement")
}
func (d *currentCatalogueDriver) Close() error { return nil }
func (d *currentCatalogueDriver) Begin() (driver.Tx, error) {
	return nil, errors.New("read entered mutation transaction")
}
func (d *currentCatalogueDriver) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if query != catalogueRefreshRequiredSQL {
		return nil, errors.New("read attempted policy lock or reconciliation")
	}
	d.reads++
	return &currentCatalogueRows{}, nil
}
func (*currentCatalogueRows) Columns() []string { return []string{"changed"} }
func (*currentCatalogueRows) Close() error      { return nil }
func (r *currentCatalogueRows) Next(values []driver.Value) error {
	if r.read {
		return io.EOF
	}
	r.read = true
	values[0] = false
	return nil
}

func TestCurrentCatalogueRefreshNeverOpensPolicyMutation(t *testing.T) {
	state := &currentCatalogueDriver{}
	db := sql.OpenDB(state)
	defer db.Close()
	oldDB, oldAdmin := backend.Db, backend.DbAdmin
	backend.Db, backend.DbAdmin = db, db
	t.Cleanup(func() { backend.Db, backend.DbAdmin = oldDB, oldAdmin })
	response := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/api/update-oids?only_if_changed=true", nil)
	request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, "admin")))
	middlewares.WithLazyTransaction(http.HandlerFunc(HandleUpdateOidsAndTableNames)).ServeHTTP(response, request)
	if response.Code != 200 || state.reads != 1 {
		t.Fatalf("current catalogue entered mutation boundary: HTTP %d reads=%d body=%s", response.Code, state.reads, response.Body)
	}
	t.Log("automatic refresh: HTTP 200, one SELECT, no transaction or policy lock")
}
