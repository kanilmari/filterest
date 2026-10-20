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
	upgraded          bool
	completed         bool
	findings          int
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
	if strings.Contains(query, "information_schema.columns") {
		return &baselineScalarRows{value: d.upgraded}, nil
	}
	if strings.Contains(query, "system_data_repair_records") {
		return &baselineScalarRows{value: d.completed}, nil
	}
	if strings.Contains(query, "app_check_article_bundles") {
		return &baselineScalarRows{value: int64(d.findings)}, nil
	}
	columns := []string{"id", "name"}
	if strings.Contains(query, "FROM public.system_db_tables") {
		columns = []string{"table_uid", "table_name", "schema_name", "article_section_initial_open", "opener_policy"}
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
	if !connector.began || !connector.rolledBack || connector.reads != 4 {
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

// A scalar driver response makes phase checks fail closed without PostgreSQL.
type baselineScalarRows struct {
	value driver.Value
	done  bool
}

func (*baselineScalarRows) Columns() []string { return []string{"value"} }
func (*baselineScalarRows) Close() error      { return nil }
func (r *baselineScalarRows) Next(v []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	v[0] = r.value
	return nil
}
func TestArticleExportPhaseGuards(t *testing.T) {
	for _, test := range []struct {
		name                       string
		after, upgraded, completed bool
		findings                   int
		want                       error
	}{
		{name: "before rejects upgraded", upgraded: true, want: ErrArticleBaselineUpgraded},
		{name: "after rejects legacy", after: true, want: ErrArticleAfterIncomplete},
		{name: "after rejects incomplete", after: true, upgraded: true, want: ErrArticleAfterIncomplete},
		{name: "after rejects broken bundles", after: true, upgraded: true, completed: true, findings: 1, want: ErrArticleAfterIncomplete},
		{name: "after snapshot", after: true, upgraded: true, completed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			connector := &baselineSnapshotDriver{upgraded: test.upgraded, completed: test.completed, findings: test.findings}
			db := sql.OpenDB(connector)
			defer db.Close()
			_, err := readArticlePresentationSnapshot(context.Background(), db, test.after)
			if !errors.Is(err, test.want) || !connector.began || !connector.rolledBack {
				t.Fatalf("phase guard: %v, %+v", err, connector)
			}
		})
	}
}
