// front_page_scope_test.go
// Verifies whole-list inheritance and computed menu ordering without PostgreSQL.
// The database fixture supplies metadata; the implementation owns scope and cap decisions.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

type frontPageScopeFixture struct {
	saved   map[int][][]driver.Value
	visited []int
}
type frontPageScopeDriver struct{ state *frontPageScopeFixture }
type frontPageScopeConn struct{ state *frontPageScopeFixture }
type frontPageScopeRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

var frontPageScopeDriverID atomic.Int64

func (d frontPageScopeDriver) Open(string) (driver.Conn, error) {
	return frontPageScopeConn{d.state}, nil
}
func (c frontPageScopeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c frontPageScopeConn) Close() error { return nil }
func (c frontPageScopeConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected transaction")
}
func (r *frontPageScopeRows) Columns() []string { return r.columns }
func (r *frontPageScopeRows) Close() error      { return nil }
func (r *frontPageScopeRows) Next(dest []driver.Value) error {
	if r.index == len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}
func (c frontPageScopeConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(q, "FROM public.system_front_page_blocks") {
		scope := int(args[0].Value.(int64))
		c.state.visited = append(c.state.visited, scope)
		return &frontPageScopeRows{columns: []string{"id", "dataset", "limit", "sort_order", "enabled"}, rows: c.state.saved[scope]}, nil
	}
	if strings.Contains(q, "SELECT grouped.table_name") {
		rows := [][]driver.Value{{"z_main", true, true, true}, {"a_saved", true, false, true}, {"nested", false, false, true}, {"no_newest", true, false, false}, {"denied", true, false, true}}
		for i := 0; i < 15; i++ {
			rows = append(rows, []driver.Value{fmt.Sprintf("b_%02d", i), true, false, true})
		}
		return &frontPageScopeRows{columns: []string{"dataset", "top_level", "main", "newest"}, rows: rows}, nil
	}
	if strings.Contains(q, "SELECT tab_order_json") {
		return &frontPageScopeRows{columns: []string{"order"}, rows: [][]driver.Value{{[]byte(`[{"tab_id":"a_saved","sort_order":1},{"tab_id":"static:login","sort_order":2}]`)}}}, nil
	}
	return nil, fmt.Errorf("unexpected query: %s", q)
}

func TestFrontPageScopeHierarchyGuestAndDefaultMenu(t *testing.T) {
	state := &frontPageScopeFixture{saved: map[int][][]driver.Value{0: {{int64(1), "common", int64(5), int64(1), true}}, 42: {{int64(2), "own", int64(5), int64(1), false}}}}
	name := fmt.Sprintf("front_page_scope_%d", frontPageScopeDriverID.Add(1))
	sql.Register(name, frontPageScopeDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	for _, tc := range []struct {
		id              int
		source, dataset string
	}{{42, "user", "own"}, {73, "common", "common"}, {1, "common", "common"}} {
		blocks, source, err := resolveFrontPageBlocks(db, tc.id)
		if err != nil || source != tc.source || len(blocks) != 1 || blocks[0].Dataset != tc.dataset {
			t.Fatal(tc, blocks, source, err)
		}
	}
	for _, scope := range state.visited {
		if scope == 1 {
			t.Fatal("guest queried personal rows")
		}
	}
	delete(state.saved, 0)
	delete(state.saved, 42)
	canRead := frontPageCanRead
	frontPageCanRead = func(_ int, dataset string) bool { return dataset != "denied" }
	t.Cleanup(func() { frontPageCanRead = canRead })
	blocks, source, err := resolveFrontPageBlocks(db, 42)
	if err != nil || source != "default" || len(blocks) != 12 || blocks[0].Dataset != "a_saved" || blocks[1].Dataset != "z_main" {
		t.Fatal(blocks, source, err)
	}
	for _, block := range blocks {
		if block.Dataset == "nested" || block.Dataset == "no_newest" || block.Dataset == "denied" || block.ResultLimit != 5 || !block.Enabled {
			t.Fatal(block)
		}
	}
}
