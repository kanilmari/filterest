// database_phase_connector_test.go
// Verifies admission follows actual SQL lifetime rather than HTTP response lifetime.
// Exercises legacy contextless reads, lazy rows, transactions and prepared execution.
// Optional result metadata and result-set behavior survive the connector boundary.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"reflect"
	"testing"
)

type phaseWorkDriver struct{}
type phaseWorkConn struct{}
type phaseWorkTx struct{}
type phaseWorkStmt struct{}
type phaseWorkRows struct{ barrierRows }

func (d phaseWorkDriver) Connect(context.Context) (driver.Conn, error) { return phaseWorkConn{}, nil }
func (d phaseWorkDriver) Driver() driver.Driver                        { return d }
func (d phaseWorkDriver) Open(string) (driver.Conn, error)             { return d.Connect(context.Background()) }
func (phaseWorkConn) Prepare(string) (driver.Stmt, error)              { return phaseWorkStmt{}, nil }
func (phaseWorkConn) Close() error                                     { return nil }
func (phaseWorkConn) Begin() (driver.Tx, error)                        { return phaseWorkTx{}, nil }
func (phaseWorkConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &phaseWorkRows{barrierRows{value: true}}, nil
}
func (phaseWorkConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if query == `SELECT pg_advisory_xact_lock_shared(hashtext($1))` {
		return nil, errors.New("redundant lifecycle transaction lock")
	}
	return driver.RowsAffected(1), nil
}
func (phaseWorkTx) Commit() error                                { return nil }
func (phaseWorkTx) Rollback() error                              { return nil }
func (phaseWorkStmt) Close() error                               { return nil }
func (phaseWorkStmt) NumInput() int                              { return 0 }
func (phaseWorkStmt) Exec([]driver.Value) (driver.Result, error) { return driver.RowsAffected(1), nil }
func (phaseWorkStmt) Query([]driver.Value) (driver.Rows, error) {
	return &phaseWorkRows{barrierRows{value: true}}, nil
}
func (*phaseWorkRows) ColumnTypeDatabaseTypeName(int) string { return "BOOL" }
func (*phaseWorkRows) ColumnTypeScanType(int) reflect.Type   { return reflect.TypeOf(false) }

func TestDatabasePhaseConnectorGatesLegacyReadsRowsAndTransactions(t *testing.T) {
	lifecycle := sql.OpenDB(&barrierDriver{})
	defer lifecycle.Close()
	work := sql.OpenDB(DatabasePhaseConnector(phaseWorkDriver{}, func() *sql.DB { return lifecycle }, func() bool { return true }))
	defer work.Close()
	if lifecycle.Stats().InUse != 0 {
		t.Fatal("pool setup acquired admission")
	}
	rows, err := work.Query(`SELECT true`)
	if err != nil {
		t.Fatal(err)
	}
	if lifecycle.Stats().InUse != 1 {
		t.Fatal("pooled read bypassed admission")
	}
	types, err := rows.ColumnTypes()
	if err != nil || types[0].DatabaseTypeName() != "BOOL" || types[0].ScanType() != reflect.TypeOf(false) {
		t.Fatal("row metadata lost", types, err)
	}
	if rows.NextResultSet() {
		t.Fatal("invented a result set")
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if lifecycle.Stats().InUse != 0 {
		t.Fatal("closed rows retained admission")
	}
	statement, err := work.Prepare(`SELECT true`)
	if err != nil {
		t.Fatal(err)
	}
	defer statement.Close()
	if lifecycle.Stats().InUse != 0 {
		t.Fatal("prepared statement stayed admitted while idle")
	}
	var value bool
	if err := statement.QueryRow().Scan(&value); err != nil || !value {
		t.Fatal("prepared query failed", err)
	}
	if lifecycle.Stats().InUse != 0 {
		t.Fatal("prepared rows leaked admission")
	}
	tx, err := work.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := LockRuntimeRequestBarrier(context.Background(), tx); err != nil {
		t.Fatal("transaction reacquired lifecycle admission", err)
	}
	if _, err := tx.Exec(`SELECT true`); err != nil {
		t.Fatal(err)
	}
	if lifecycle.Stats().InUse != 1 {
		t.Fatal("transaction admission ended early")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if lifecycle.Stats().InUse != 0 {
		t.Fatal("committed transaction held idle admission")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := work.QueryContext(ctx, `SELECT true`); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled query was admitted", err)
	}
}
