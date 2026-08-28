// get_columns_test.go
// Unit tests for query-only column metadata readers.
// Uses a small database/sql driver double so the package can be verified without a live PostgreSQL instance or production refactors.
package dtt_2_column_read

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

	backend "easelect/backend/core_components"
)

type queuedColumnQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type columnReadState struct {
	mu      sync.Mutex
	queries []queuedColumnQuery
}

type columnReadDriver struct {
	state *columnReadState
}

type columnReadConn struct {
	state *columnReadState
}

type columnReadRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var columnReadDriverRegisterMu sync.Mutex

func (d *columnReadDriver) Open(string) (driver.Conn, error) {
	return &columnReadConn{state: d.state}, nil
}

func (c *columnReadConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported in column read test driver")
}

func (c *columnReadConn) Close() error { return nil }

func (c *columnReadConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not supported in column read test driver")
}

func (c *columnReadConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *columnReadConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
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

	return &columnReadRows{
		cols: append([]string(nil), next.cols...),
		rows: cloneColumnReadRows(next.rows),
	}, nil
}

func (r *columnReadRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *columnReadRows) Close() error      { return nil }

func (r *columnReadRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func cloneColumnReadRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func openColumnReadDB(t *testing.T, queries []queuedColumnQuery) *sql.DB {
	t.Helper()
	columnReadDriverRegisterMu.Lock()
	defer columnReadDriverRegisterMu.Unlock()

	state := &columnReadState{
		queries: append([]queuedColumnQuery(nil), queries...),
	}
	driverName := fmt.Sprintf("column_read_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &columnReadDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func withColumnReadDB(t *testing.T, db *sql.DB) {
	t.Helper()
	orig := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = orig
	})
}

func TestGetColumnsMapForTableWrapsTableUIDLookupError(t *testing.T) {
	db := openColumnReadDB(t, []queuedColumnQuery{
		{err: errors.New("boom")},
	})
	withColumnReadDB(t, db)

	_, err := GetColumnsMapForTable("users")
	if err == nil || !strings.Contains(err.Error(), "error fetching table_uid for table users") {
		t.Fatalf("err = %v, want wrapped table_uid lookup error", err)
	}
}

func TestGetColumnsMapForTableFallbackQueryError(t *testing.T) {
	db := openColumnReadDB(t, []queuedColumnQuery{
		{
			cols: []string{"table_uid"},
			rows: nil, // QueryRow.Scan -> sql.ErrNoRows
		},
		{
			err: errors.New("fallback boom"),
		},
	})
	withColumnReadDB(t, db)

	_, err := GetColumnsMapForTable("view_users")
	if err == nil || !strings.Contains(err.Error(), "info_schema query for view view_users") {
		t.Fatalf("err = %v, want wrapped fallback query error", err)
	}
}

func TestGetColumnsMapForTableFallbackScanError(t *testing.T) {
	db := openColumnReadDB(t, []queuedColumnQuery{
		{
			cols: []string{"table_uid"},
			rows: nil,
		},
		{
			cols: []string{"ordinal_position", "column_name", "data_type", "is_nullable", "is_identity", "column_default"},
			rows: [][]driver.Value{
				{"bad-int", "name", "text", "YES", "NO", nil},
			},
		},
	})
	withColumnReadDB(t, db)

	_, err := GetColumnsMapForTable("view_users")
	if err == nil || !strings.Contains(err.Error(), "scan error for view view_users") {
		t.Fatalf("err = %v, want wrapped fallback scan error", err)
	}
}

func TestGetColumnsMapForTableFallbackHappyPath(t *testing.T) {
	db := openColumnReadDB(t, []queuedColumnQuery{
		{
			cols: []string{"table_uid"},
			rows: nil,
		},
		{
			cols: []string{"ordinal_position", "column_name", "data_type", "is_nullable", "is_identity", "column_default"},
			rows: [][]driver.Value{
				{int64(1), "title", "text", "YES", "NO", "untitled"},
				{int64(2), "slug", "text", "NO", "NO", nil},
			},
		},
	})
	withColumnReadDB(t, db)

	columns, err := GetColumnsMapForTable("view_users")
	if err != nil {
		t.Fatalf("GetColumnsMapForTable returned error: %v", err)
	}
	if len(columns) != 2 {
		t.Fatalf("len(columns) = %d, want 2", len(columns))
	}
	if columns[1].ColumnName != "title" || columns[1].ColumnDefault.String != "untitled" {
		t.Fatalf("columns[1] = %#v, want title with default", columns[1])
	}
	if columns[2].ColumnUid != 2 || columns[2].ColumnDefault.Valid {
		t.Fatalf("columns[2] = %#v, want uid 2 with null default", columns[2])
	}
}

func TestGetColumnsMapForTableSystemTableHappyPath(t *testing.T) {
	db := openColumnReadDB(t, []queuedColumnQuery{
		{
			cols: []string{"table_uid"},
			rows: [][]driver.Value{{int64(42)}},
		},
		{
			cols: []string{
				"column_uid", "column_name", "data_type", "co_number",
				"is_nullable", "is_identity", "column_default", "card_element", "is_multilingual",
			},
			rows: [][]driver.Value{
				{int64(11), "title", "text", int64(1), "YES", "NO", "untitled", "headline", true},
			},
		},
	})
	withColumnReadDB(t, db)

	columns, err := GetColumnsMapForTable("users")
	if err != nil {
		t.Fatalf("GetColumnsMapForTable returned error: %v", err)
	}
	col := columns[11]
	if col.ColumnName != "title" || col.CardElement != "headline" || !col.IsMultilingual {
		t.Fatalf("col = %#v, want title/headline/multilingual", col)
	}
	if !col.ColumnDefault.Valid || col.ColumnDefault.String != "untitled" {
		t.Fatalf("col.ColumnDefault = %#v, want valid untitled default", col.ColumnDefault)
	}
}

func TestGetColumnsForDatasetHandlesQueryErrorAndSuccess(t *testing.T) {
	t.Run("query error", func(t *testing.T) {
		db := openColumnReadDB(t, []queuedColumnQuery{
			{err: errors.New("boom")},
		})
		withColumnReadDB(t, db)

		_, err := GetColumnsForDataset("users")
		if err == nil || err.Error() != "boom" {
			t.Fatalf("err = %v, want query error", err)
		}
	})

	t.Run("success", func(t *testing.T) {
		db := openColumnReadDB(t, []queuedColumnQuery{
			{
				cols: []string{"column_name"},
				rows: [][]driver.Value{{"id"}, {"title"}},
			},
		})
		withColumnReadDB(t, db)

		columns, err := GetColumnsForDataset("users")
		if err != nil {
			t.Fatalf("GetColumnsForDataset returned error: %v", err)
		}
		if len(columns) != 2 || columns[0] != "id" || columns[1] != "title" {
			t.Fatalf("columns = %#v, want [id title]", columns)
		}
	})
}

func TestGetColumnIDsForTableUIDHandlesQueryAndScanErrorsAndSuccess(t *testing.T) {
	t.Run("query error", func(t *testing.T) {
		db := openColumnReadDB(t, []queuedColumnQuery{
			{err: errors.New("boom")},
		})
		withColumnReadDB(t, db)

		_, err := GetColumnIDsForTableUID(42)
		if err == nil || err.Error() != "boom" {
			t.Fatalf("err = %v, want query error", err)
		}
	})

	t.Run("scan error", func(t *testing.T) {
		db := openColumnReadDB(t, []queuedColumnQuery{
			{
				cols: []string{"column_uid"},
				rows: [][]driver.Value{{"bad-int"}},
			},
		})
		withColumnReadDB(t, db)

		_, err := GetColumnIDsForTableUID(42)
		if err == nil {
			t.Fatal("expected scan error, got nil")
		}
	})

	t.Run("success", func(t *testing.T) {
		db := openColumnReadDB(t, []queuedColumnQuery{
			{
				cols: []string{"column_uid"},
				rows: [][]driver.Value{{int64(10)}, {int64(20)}},
			},
		})
		withColumnReadDB(t, db)

		columnIDs, err := GetColumnIDsForTableUID(42)
		if err != nil {
			t.Fatalf("GetColumnIDsForTableUID returned error: %v", err)
		}
		if len(columnIDs) != 2 || columnIDs[0] != 10 || columnIDs[1] != 20 {
			t.Fatalf("columnIDs = %#v, want [10 20]", columnIDs)
		}
	})
}
