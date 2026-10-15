// article_baseline_transaction_test.go
// Verifies snapshot isolation and enforced read-only transaction requests offline.
// Connects the exporter to a strict database/sql driver that permits SELECT only.
// Proves cleanup and complete empty output without requiring PostgreSQL access.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"testing"
)

type baselineSnapshotDriver struct {
	began, rolledBack bool
	reads             int
	failAt            int
}

func (d *baselineSnapshotDriver) Connect(context.Context) (driver.Conn, error) { return d, nil }
func (d *baselineSnapshotDriver) Driver() driver.Driver                        { return d }
func (d *baselineSnapshotDriver) Open(string) (driver.Conn, error)             { return d, nil }
func (d *baselineSnapshotDriver) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared statement")
}
func (d *baselineSnapshotDriver) Close() error { return nil }
func (d *baselineSnapshotDriver) Begin() (driver.Tx, error) {
	return nil, errors.New("transaction options required")
}
func (d *baselineSnapshotDriver) BeginTx(_ context.Context, options driver.TxOptions) (driver.Tx, error) {
	if !options.ReadOnly || options.Isolation != driver.IsolationLevel(sql.LevelRepeatableRead) {
		return nil, errors.New("read-only repeatable-read snapshot required")
	}
	d.began = true
	return d, nil
}
func (d *baselineSnapshotDriver) Commit() error   { return errors.New("baseline must roll back") }
func (d *baselineSnapshotDriver) Rollback() error { d.rolledBack = true; return nil }
func (d *baselineSnapshotDriver) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if !d.began || !strings.HasPrefix(strings.TrimSpace(query), "SELECT ") {
		return nil, errors.New("only SELECT inside the snapshot is allowed")
	}
	d.reads++
	if d.failAt == d.reads {
		return nil, errors.New("fixture read failure")
	}
	columns := []string{"id", "name"}
	if strings.Contains(query, "FROM public.system_db_tables") {
		columns = []string{"table_uid", "table_name", "schema_name", "article_section_initial_open"}
	}
	return baselineEmptyRows{columns: columns}, nil
}

type baselineEmptyRows struct{ columns []string }

func (r baselineEmptyRows) Columns() []string       { return r.columns }
func (baselineEmptyRows) Close() error              { return nil }
func (baselineEmptyRows) Next([]driver.Value) error { return io.EOF }
func TestArticleBaselineSnapshotTransaction(t *testing.T) {
	connector := &baselineSnapshotDriver{}
	db := sql.OpenDB(connector)
	defer db.Close()
	report, err := ReadArticlePresentationBaseline(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if !connector.began || !connector.rolledBack || connector.reads != 3 {
		t.Fatalf("snapshot lifecycle: %+v", connector)
	}
	if report.Datasets == nil || report.Users == nil || report.Groups == nil {
		t.Fatal("empty inventories must be JSON arrays, not null")
	}
}

func TestArticleBaselineSnapshotFailure(t *testing.T) {
	connector := &baselineSnapshotDriver{failAt: 3}
	db := sql.OpenDB(connector)
	defer db.Close()
	report, err := ReadArticlePresentationBaseline(context.Background(), db)
	if err == nil || report.Datasets != nil || !connector.rolledBack {
		t.Fatal("failed snapshot must roll back and return no partial evidence")
	}
}
