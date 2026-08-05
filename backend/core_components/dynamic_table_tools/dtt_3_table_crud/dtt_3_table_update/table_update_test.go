// table_update_test.go
// Unit tests for UpdateOidsAndTableNames.
// Uses a package-local database/sql driver double so the update sequence and callback behavior can be verified without a live PostgreSQL instance or production refactors.
package dtt_3_table_update

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
)

type queuedUpdateExec struct {
	err error
}

type tableUpdateState struct {
	mu sync.Mutex

	execs []queuedUpdateExec

	execCalls []string
}

type tableUpdateDriver struct {
	state *tableUpdateState
}

type tableUpdateConn struct {
	state *tableUpdateState
}

var tableUpdateDriverRegisterMu sync.Mutex

func (d *tableUpdateDriver) Open(string) (driver.Conn, error) {
	return &tableUpdateConn{state: d.state}, nil
}

func (c *tableUpdateConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in table update test driver")
}

func (c *tableUpdateConn) Close() error { return nil }

func (c *tableUpdateConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not supported in table update test driver")
}

func (c *tableUpdateConn) Query(string, []driver.Value) (driver.Rows, error) {
	return nil, errors.New("query not supported in table update test driver")
}

func (c *tableUpdateConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return nil, errors.New("query context not supported in table update test driver")
}

func (c *tableUpdateConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *tableUpdateConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execCalls = append(c.state.execCalls, query)
	if len(c.state.execs) == 0 {
		return nil, errors.New("unexpected exec")
	}

	next := c.state.execs[0]
	c.state.execs = c.state.execs[1:]
	if next.err != nil {
		return nil, next.err
	}
	return driver.RowsAffected(1), nil
}

func openTableUpdateDB(t *testing.T, execs []queuedUpdateExec) (*sql.DB, *tableUpdateState) {
	t.Helper()
	tableUpdateDriverRegisterMu.Lock()
	defer tableUpdateDriverRegisterMu.Unlock()

	state := &tableUpdateState{
		execs: append([]queuedUpdateExec(nil), execs...),
	}

	driverName := fmt.Sprintf("table_update_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &tableUpdateDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	return db, state
}

func TestUpdateOidsAndTableNamesPropagatesExecErrors(t *testing.T) {
	tests := []struct {
		name    string
		execs   []queuedUpdateExec
		wantErr string
	}{
		{
			name:    "ghost cleanup failure",
			execs:   []queuedUpdateExec{{err: errors.New("cleanup boom")}},
			wantErr: "error cleaning up ghost entries: cleanup boom",
		},
		{
			name:    "fill schema by oid failure",
			execs:   []queuedUpdateExec{{}, {err: errors.New("oid boom")}},
			wantErr: "error updating schema names by OID: oid boom",
		},
		{
			name:    "fill schema by name failure",
			execs:   []queuedUpdateExec{{}, {}, {err: errors.New("name boom")}},
			wantErr: "error updating schema names by name: name boom",
		},
		{
			name:    "update name failure",
			execs:   []queuedUpdateExec{{}, {}, {}, {err: errors.New("rename boom")}},
			wantErr: "\x1b[31merror updating table names: rename boom\x1b[0m",
		},
		{
			name:    "update oid failure",
			execs:   []queuedUpdateExec{{}, {}, {}, {}, {err: errors.New("cached oid boom")}},
			wantErr: "\x1b[31merror updating OID values: cached oid boom\x1b[0m",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, _ := openTableUpdateDB(t, tt.execs)

			err := UpdateOidsAndTableNames(
				db,
				func(dbutils.Querier) error { return nil },
				func(dbutils.Querier) error { return nil },
			)
			if err == nil || err.Error() != tt.wantErr {
				t.Fatalf("err = %v, want %q", err, tt.wantErr)
			}
		})
	}
}

func TestUpdateOidsAndTableNamesPropagatesCallbackErrors(t *testing.T) {
	t.Run("delete callback", func(t *testing.T) {
		db, _ := openTableUpdateDB(t, []queuedUpdateExec{{}, {}, {}, {}, {}})
		deleteErr := errors.New("delete callback boom")
		var insertCalled bool

		err := UpdateOidsAndTableNames(
			db,
			func(q dbutils.Querier) error {
				if q != db {
					t.Fatalf("delete callback querier = %T, want original db", q)
				}
				return deleteErr
			},
			func(dbutils.Querier) error {
				insertCalled = true
				return nil
			},
		)
		if !errors.Is(err, deleteErr) {
			t.Fatalf("err = %v, want delete callback error", err)
		}
		if insertCalled {
			t.Fatal("insert callback should not run after delete callback error")
		}
	})

	t.Run("insert callback", func(t *testing.T) {
		db, _ := openTableUpdateDB(t, []queuedUpdateExec{{}, {}, {}, {}, {}})
		insertErr := errors.New("insert callback boom")

		err := UpdateOidsAndTableNames(
			db,
			func(q dbutils.Querier) error {
				if q != db {
					t.Fatalf("delete callback querier = %T, want original db", q)
				}
				return nil
			},
			func(q dbutils.Querier) error {
				if q != db {
					t.Fatalf("insert callback querier = %T, want original db", q)
				}
				return insertErr
			},
		)
		if !errors.Is(err, insertErr) {
			t.Fatalf("err = %v, want insert callback error", err)
		}
	})
}

func TestUpdateOidsAndTableNamesExecutesAllStepsInOrder(t *testing.T) {
	db, state := openTableUpdateDB(t, []queuedUpdateExec{{}, {}, {}, {}, {}})
	var steps []string

	err := UpdateOidsAndTableNames(
		db,
		func(q dbutils.Querier) error {
			if q != db {
				t.Fatalf("delete callback querier = %T, want original db", q)
			}
			steps = append(steps, "delete")
			return nil
		},
		func(q dbutils.Querier) error {
			if q != db {
				t.Fatalf("insert callback querier = %T, want original db", q)
			}
			steps = append(steps, "insert")
			return nil
		},
	)
	if err != nil {
		t.Fatalf("UpdateOidsAndTableNames returned error: %v", err)
	}

	if got := len(state.execCalls); got != 5 {
		t.Fatalf("exec call count = %d, want 5", got)
	}
	wantSubstrings := []string{
		"WITH ghost_entries AS",
		"SET schema_name = n.nspname",
		"SET\n                       cached_oid = table_oids.oid",
		"SET\n\t\t\ttable_name  = table_oids.table_name",
		"SET cached_oid = table_oids.oid",
	}
	for i, want := range wantSubstrings {
		if !strings.Contains(state.execCalls[i], want) {
			t.Fatalf("exec call %d missing %q:\n%s", i, want, state.execCalls[i])
		}
	}

	if fmt.Sprintf("%v", steps) != "[delete insert]" {
		t.Fatalf("callback order = %v, want [delete insert]", steps)
	}
}
