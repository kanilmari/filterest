// intelligent_result_shape_test.go
// Proves ordered search retains null when requested IDs yield no readable rows.
// Connects the real fetcher and JSON response shape through an in-memory SQL driver.
// Prevents shared serialization from changing the established empty-search contract.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

type orderedShapeDriver struct{ empty bool }
type orderedShapeConn struct{ empty bool }
type orderedShapeRows struct {
	columns []string
	values  [][]driver.Value
}

var orderedShapeDriverID atomic.Int64

func (d orderedShapeDriver) Open(string) (driver.Conn, error) { return orderedShapeConn(d), nil }
func (orderedShapeConn) Close() error                         { return nil }
func (orderedShapeConn) Begin() (driver.Tx, error)            { return nil, driver.ErrSkip }
func (orderedShapeConn) Prepare(string) (driver.Stmt, error)  { return nil, driver.ErrSkip }
func (r *orderedShapeRows) Columns() []string                 { return r.columns }
func (*orderedShapeRows) Close() error                        { return nil }
func (r *orderedShapeRows) Next(destination []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	copy(destination, r.values[0])
	r.values = r.values[1:]
	return nil
}

func (c orderedShapeConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "information_schema.column_privileges"), strings.Contains(query, "LEFT JOIN system_column_details"):
		return &orderedShapeRows{columns: []string{"column_name"}, values: [][]driver.Value{{"id"}}}, nil
	case strings.Contains(query, "SELECT table_uid"):
		// Exercise the fetcher's supported plain-column fallback.
		return nil, fmt.Errorf("fixture has no registered metadata")
	case strings.Contains(query, "WITH wanted"):
		if len(args) < 1 || args[0].Value != "{404}" {
			return nil, fmt.Errorf("unexpected requested IDs: %v", args)
		}
		rows := &orderedShapeRows{columns: []string{"id"}}
		if !c.empty {
			rows.values = [][]driver.Value{{int64(404)}}
		}
		return rows, nil
	default:
		return nil, fmt.Errorf("unexpected fixture query: %s", query)
	}
}

func TestOrderedSearchResponseKeepsNullForNonemptyIDsWithZeroRows(t *testing.T) {
	for _, empty := range []bool{true, false} {
		t.Run(fmt.Sprintf("empty=%t", empty), func(t *testing.T) {
			name := fmt.Sprintf("ordered_shape_%d", orderedShapeDriverID.Add(1))
			sql.Register(name, orderedShapeDriver{empty: empty})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			previousDB := backend.Db
			backend.Db = db
			t.Cleanup(func() { backend.Db = previousDB; db.Close() })
			data, columns, err := fetchRowsInOrder(db, "clock_fixture", []int{404}, intelligentSearchAuthorization{})
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(map[string]interface{}{"columns": columns, "data": data})
			if err != nil {
				t.Fatal(err)
			}
			want := `{"columns":["id"],"data":[{"id":404}]}`
			if empty {
				want = `{"columns":["id"],"data":null}`
			}
			if string(encoded) != want {
				t.Fatalf("response = %s, want %s", encoded, want)
			}
		})
	}
}
