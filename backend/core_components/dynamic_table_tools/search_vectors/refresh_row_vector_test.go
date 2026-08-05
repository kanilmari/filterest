// refresh_row_vector_test.go
// Tests for RefreshRowSearchVector helper.
package dtt_search_vectors

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

type scriptedDriver struct {
	columns         []string
	hasSearchVector bool
	searchResults   [][]driver.Value
	execQueries     []string
	lastExecArgs    [][]driver.Value
}

type scriptedConn struct {
	drv *scriptedDriver
}

type scriptedTx struct{}

type simpleRows struct {
	cols   []string
	values [][]driver.Value
	idx    int
}

func (d *scriptedDriver) Open(name string) (driver.Conn, error) {
	return &scriptedConn{drv: d}, nil
}

func (c *scriptedConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (c *scriptedConn) Close() error { return nil }

func (c *scriptedConn) Begin() (driver.Tx, error) { return &scriptedTx{}, nil }

func (c *scriptedConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	return &scriptedTx{}, nil
}

func (c *scriptedConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *scriptedConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "column_name = 'search_vector_simple'"):
		if c.drv.hasSearchVector {
			return &simpleRows{cols: []string{"1"}, values: [][]driver.Value{{int64(1)}}}, nil
		}
		return &simpleRows{cols: []string{"1"}, values: nil}, nil
	case strings.Contains(query, "column_name NOT IN ('embedding_vector', 'position')"):
		rows := make([][]driver.Value, len(c.drv.columns))
		for i, col := range c.drv.columns {
			rows[i] = []driver.Value{col}
		}
		return &simpleRows{cols: []string{"column_name"}, values: rows}, nil
	case strings.Contains(query, "column_name = $2"):
		if len(args) < 2 {
			return nil, fmt.Errorf("missing column arg for tableHasColumn: %q", query)
		}
		colName, _ := args[1].Value.(string)
		for _, cName := range append(c.drv.columns, "search_vector_simple") {
			if cName == colName {
				return &simpleRows{cols: []string{"1"}, values: [][]driver.Value{{int64(1)}}}, nil
			}
		}
		return &simpleRows{cols: []string{"1"}, values: nil}, nil
	case strings.Contains(query, "to_tsquery('simple', $1)"):
		return &simpleRows{cols: []string{"id", "header", "rank"}, values: c.drv.searchResults}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (c *scriptedConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *scriptedConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.drv.execQueries = append(c.drv.execQueries, query)
	values := make([]driver.Value, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	c.drv.lastExecArgs = append(c.drv.lastExecArgs, values)
	return driver.RowsAffected(1), nil
}

func (t *scriptedTx) Commit() error   { return nil }
func (t *scriptedTx) Rollback() error { return nil }

func (r *simpleRows) Columns() []string { return r.cols }

func (r *simpleRows) Close() error { return nil }

func (r *simpleRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.idx])
	r.idx++
	return nil
}

func registerDriver(d *scriptedDriver) string {
	name := fmt.Sprintf("sv_helper_%d", time.Now().UnixNano())
	sql.Register(name, d)
	return name
}

func TestRefreshRowSearchVectorUpdatesVector(t *testing.T) {
	driver := &scriptedDriver{columns: []string{"header", "description"}, hasSearchVector: true}
	name := registerDriver(driver)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql open: %v", err)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}

	if err := RefreshRowSearchVector(context.Background(), tx, "dev_todo", 5); err != nil {
		t.Fatalf("RefreshRowSearchVector error: %v", err)
	}
	if len(driver.execQueries) != 1 {
		t.Fatalf("expected 1 exec, got %d", len(driver.execQueries))
	}
	expected := `UPDATE "dev_todo" SET search_vector_simple = to_tsvector('simple', coalesce("header"::text,'') || ' ' || coalesce("description"::text,'')) WHERE id = $1`
	if driver.execQueries[0] != expected {
		t.Fatalf("unexpected update query: %s", driver.execQueries[0])
	}
	if got := driver.lastExecArgs[0][0]; got != int64(5) {
		t.Fatalf("expected id arg 5, got %v", got)
	}
}

func TestRefreshRowSearchVectorSkipsMissingColumn(t *testing.T) {
	driver := &scriptedDriver{columns: []string{"header"}, hasSearchVector: false}
	name := registerDriver(driver)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql open: %v", err)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}

	if err := RefreshRowSearchVector(context.Background(), tx, "dev_todo", 2); err != nil {
		t.Fatalf("RefreshRowSearchVector error: %v", err)
	}
	if len(driver.execQueries) != 0 {
		t.Fatalf("expected no exec queries, got %d", len(driver.execQueries))
	}
}

func TestFullTextSearchFindsFreshValues(t *testing.T) {
	driver := &scriptedDriver{
		columns:         []string{"header"},
		hasSearchVector: true,
		searchResults:   [][]driver.Value{{int64(9), "Fresh berries", float64(0.9)}},
	}
	name := registerDriver(driver)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql open: %v", err)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := RefreshRowSearchVector(context.Background(), tx, "dev_todo", 9); err != nil {
		t.Fatalf("refresh error: %v", err)
	}

	tsQuery := buildTestTsQuery("fresh berries")
	const searchSQL = `
               WITH q AS (
                       SELECT to_tsquery('simple', $1) AS query
               )
               SELECT "dev_todo".id,
                      "dev_todo"."header",
                      ts_rank("dev_todo".search_vector_simple, q.query) AS rank
               FROM "dev_todo", q
               WHERE "dev_todo".search_vector_simple @@ q.query
               ORDER BY rank DESC
               LIMIT 10`
	rows, err := db.Query(searchSQL, tsQuery)
	if err != nil {
		t.Fatalf("search query error: %v", err)
	}
	defer rows.Close()
	if !rows.Next() {
		t.Fatalf("expected one search row")
	}
	var id int
	var header string
	var rank float64
	if err := rows.Scan(&id, &header, &rank); err != nil {
		t.Fatalf("scan error: %v", err)
	}
	if id != 9 {
		t.Fatalf("expected row id 9, got %d", id)
	}
	if rows.Next() {
		t.Fatalf("expected a single row")
	}
}

func buildTestTsQuery(input string) string {
	words := strings.Fields(strings.ToLower(input))
	if len(words) == 0 {
		return ""
	}
	for i, w := range words {
		words[i] = w + ":*"
	}
	return strings.Join(words, " | ")
}
