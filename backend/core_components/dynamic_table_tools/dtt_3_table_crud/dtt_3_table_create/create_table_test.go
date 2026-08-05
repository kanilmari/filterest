// create_table_test.go
// Unit tests for dynamic table creation helpers.
// Uses a package-local database/sql driver double so query/exec behavior can be verified without a live PostgreSQL instance or production refactors.
package dtt_3_table_create

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

type queuedCreateQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type queuedCreateExec struct {
	err error
}

type createTableState struct {
	mu sync.Mutex

	queries []queuedCreateQuery
	execs   []queuedCreateExec

	execCalls []string
}

type createTableDriver struct {
	state *createTableState
}

type createTableConn struct {
	state *createTableState
}

type createTableRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var createTableDriverRegisterMu sync.Mutex

func (d *createTableDriver) Open(string) (driver.Conn, error) {
	return &createTableConn{state: d.state}, nil
}

func (c *createTableConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in create table test driver")
}

func (c *createTableConn) Close() error { return nil }

func (c *createTableConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not supported in create table test driver")
}

func (c *createTableConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *createTableConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	if len(c.state.queries) == 0 {
		return nil, errors.New("unexpected query")
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}
	return &createTableRows{
		cols: append([]string(nil), next.cols...),
		rows: cloneCreateTableRows(next.rows),
	}, nil
}

func (c *createTableConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *createTableConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
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

func (r *createTableRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *createTableRows) Close() error      { return nil }

func (r *createTableRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func cloneCreateTableRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openCreateTableDB(t *testing.T, queries []queuedCreateQuery, execs []queuedCreateExec) (*sql.DB, *createTableState) {
	t.Helper()
	createTableDriverRegisterMu.Lock()
	defer createTableDriverRegisterMu.Unlock()

	state := &createTableState{
		queries: append([]queuedCreateQuery(nil), queries...),
		execs:   append([]queuedCreateExec(nil), execs...),
	}
	driverName := fmt.Sprintf("create_table_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &createTableDriver{state: state})

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

func TestCreateTableInDatabaseRejectsInvalidIdentifiersAndMissingPrimaryKey(t *testing.T) {
	db, _ := openCreateTableDB(t, nil, nil)

	err := CreateTableInDatabase(db, "bad-name", map[string]string{"id": "serial"}, nil)
	if err == nil || err.Error() != "invalid identifier: bad-name" {
		t.Fatalf("err = %v, want invalid table identifier", err)
	}

	err = CreateTableInDatabase(db, "users", map[string]string{"bad-name": "text"}, nil)
	if err == nil || err.Error() != "invalid identifier: bad-name" {
		t.Fatalf("err = %v, want invalid column identifier", err)
	}

	err = CreateTableInDatabase(db, "users", map[string]string{"title": "text"}, nil)
	var missingPK *ErrMissingPrimaryKey
	if !errors.As(err, &missingPK) {
		t.Fatalf("err = %v, want ErrMissingPrimaryKey", err)
	}
	if missingPK.LangKey != "error_table_creation_missing_primary_key" {
		t.Fatalf("LangKey = %q, want missing-primary-key key", missingPK.LangKey)
	}
}

func TestCreateTableInDatabaseBuildsCreateTableAndUpdatedTriggerQueries(t *testing.T) {
	db, state := openCreateTableDB(t, nil, []queuedCreateExec{{}, {}, {}})

	err := CreateTableInDatabase(db, "users", map[string]string{
		"id":      "serial",
		"title":   "text",
		"updated": "timestamp",
	}, []ForeignKeyDefinition{
		{
			ReferencingColumn: "title",
			ReferencedTable:   "other_table",
			ReferencedColumn:  "id",
		},
	})
	if err != nil {
		t.Fatalf("CreateTableInDatabase returned error: %v", err)
	}

	if len(state.execCalls) != 3 {
		t.Fatalf("exec calls = %d, want 3", len(state.execCalls))
	}

	createQuery := state.execCalls[0]
	for _, want := range []string{
		"CREATE TABLE IF NOT EXISTS users",
		"id SERIAL PRIMARY KEY",
		"title TEXT",
		"updated TIMESTAMP",
		"CONSTRAINT fk_users_title FOREIGN KEY (title) REFERENCES other_table (id)",
	} {
		if !strings.Contains(createQuery, want) {
			t.Fatalf("create query missing %q: %s", want, createQuery)
		}
	}
	if !strings.Contains(state.execCalls[1], "CREATE OR REPLACE FUNCTION set_users_updated_timestamp()") {
		t.Fatalf("trigger function query = %q, want users updated function", state.execCalls[1])
	}
	if !strings.Contains(state.execCalls[2], "CREATE TRIGGER update_users_timestamp") {
		t.Fatalf("trigger statement query = %q, want users timestamp trigger", state.execCalls[2])
	}
}

func TestCreateTableInDatabasePropagatesExecErrors(t *testing.T) {
	t.Run("create table exec", func(t *testing.T) {
		db, _ := openCreateTableDB(t, nil, []queuedCreateExec{{err: errors.New("create boom")}})

		err := CreateTableInDatabase(db, "users", map[string]string{"id": "serial"}, nil)
		if err == nil || err.Error() != "error creating table: create boom" {
			t.Fatalf("err = %v, want wrapped create-table error", err)
		}
	})

	t.Run("trigger function exec", func(t *testing.T) {
		db, _ := openCreateTableDB(t, nil, []queuedCreateExec{{}, {err: errors.New("function boom")}})

		err := CreateTableInDatabase(db, "users", map[string]string{"id": "serial", "updated": "timestamp"}, nil)
		if err == nil || err.Error() != "error creating trigger function: function boom" {
			t.Fatalf("err = %v, want wrapped trigger function error", err)
		}
	})

	t.Run("trigger statement exec", func(t *testing.T) {
		db, _ := openCreateTableDB(t, nil, []queuedCreateExec{{}, {}, {err: errors.New("trigger boom")}})

		err := CreateTableInDatabase(db, "users", map[string]string{"id": "serial", "updated": "timestamp"}, nil)
		if err == nil || err.Error() != "error creating trigger: trigger boom" {
			t.Fatalf("err = %v, want wrapped trigger statement error", err)
		}
	})
}

func TestInsertNewTablesHandlesQueryAndScanErrors(t *testing.T) {
	t.Run("query error", func(t *testing.T) {
		db, _ := openCreateTableDB(t, []queuedCreateQuery{
			{
				cols: []string{"id"},
				rows: [][]driver.Value{{int64(41)}},
			},
			{
				cols: []string{"id"},
				rows: [][]driver.Value{{int64(150)}},
			},
			{err: errors.New("query boom")},
		}, nil)

		err := InsertNewTables(db)
		if err == nil || !strings.Contains(err.Error(), "error fetching new tables") {
			t.Fatalf("err = %v, want wrapped query error", err)
		}
	})

	t.Run("scan error", func(t *testing.T) {
		db, _ := openCreateTableDB(t, []queuedCreateQuery{
			{
				cols: []string{"id"},
				rows: [][]driver.Value{{int64(41)}},
			},
			{
				cols: []string{"id"},
				rows: [][]driver.Value{{int64(150)}},
			},
			{
				cols: []string{"oid", "schema_name", "table_name"},
				rows: [][]driver.Value{{"bad-int", "public", "users"}},
			},
		}, nil)

		err := InsertNewTables(db)
		if err == nil || !strings.Contains(err.Error(), "error scanning table info") {
			t.Fatalf("err = %v, want wrapped scan error", err)
		}
	})
}

func TestInsertNewTablesUsesConflictSafeInserts(t *testing.T) {
	db, state := openCreateTableDB(t, []queuedCreateQuery{
		{
			cols: []string{"id"},
			rows: [][]driver.Value{{int64(41)}},
		},
		{
			cols: []string{"id"},
			rows: [][]driver.Value{{int64(150)}},
		},
		{
			cols: []string{"oid", "schema_name", "table_name"},
			rows: [][]driver.Value{
				{int64(10), "public", "users"},
				{int64(11), "public", "projects"},
			},
		},
	}, []queuedCreateExec{
		{},
		{},
	})

	err := InsertNewTables(db)
	if err != nil {
		t.Fatalf("InsertNewTables returned error: %v", err)
	}
	if len(state.execCalls) != 2 {
		t.Fatalf("exec calls = %d, want 2", len(state.execCalls))
	}
	if !strings.Contains(state.execCalls[0], "INSERT INTO system_db_tables") || !strings.Contains(state.execCalls[1], "INSERT INTO system_db_tables") {
		t.Fatalf("exec calls = %#v, want system_db_tables inserts", state.execCalls)
	}
	if !strings.Contains(state.execCalls[0], "ON CONFLICT DO NOTHING") || !strings.Contains(state.execCalls[1], "ON CONFLICT DO NOTHING") {
		t.Fatalf("exec calls = %#v, want conflict-safe system_db_tables inserts", state.execCalls)
	}
}

func TestInsertNewTablesReturnsNonConflictInsertErrors(t *testing.T) {
	db, state := openCreateTableDB(t, []queuedCreateQuery{
		{
			cols: []string{"id"},
			rows: [][]driver.Value{{int64(41)}},
		},
		{
			cols: []string{"id"},
			rows: [][]driver.Value{{int64(150)}},
		},
		{
			cols: []string{"oid", "schema_name", "table_name"},
			rows: [][]driver.Value{
				{int64(10), "public", "users"},
				{int64(11), "public", "projects"},
			},
		},
	}, []queuedCreateExec{
		{err: errors.New("insert boom")},
		{},
	})

	err := InsertNewTables(db)
	if err == nil || !strings.Contains(err.Error(), "error inserting table users into system_db_tables: insert boom") {
		t.Fatalf("err = %v, want wrapped insert error", err)
	}
	if len(state.execCalls) != 1 {
		t.Fatalf("exec calls = %d, want fail-fast after 1", len(state.execCalls))
	}
}
