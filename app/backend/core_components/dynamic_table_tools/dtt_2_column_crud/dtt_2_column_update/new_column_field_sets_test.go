// new_column_field_sets_test.go
// Exercises scoped new-column membership and transaction failure behavior.
// Uses database/sql with a stateful driver; no application database is touched.
package dtt_2_column_update

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/lib/pq"
)

type newFieldMember struct{ uid, order, width int }
type newFieldSet struct {
	tableUID int
	members  []newFieldMember
}
type newFieldMetadata struct {
	tableUID, uid int
	table, name   string
}
type newFieldsState struct {
	sets               map[int64]newFieldSet
	metadata           []newFieldMetadata
	queries, mutations int
	locked             []int64
	failure            string
}
type newFieldsDriver struct{ state *newFieldsState }
type newFieldsConn struct {
	state  *newFieldsState
	before map[int64]newFieldSet
}
type newFieldsTx struct{ conn *newFieldsConn }
type newFieldsRows struct {
	names  []string
	values [][]driver.Value
	index  int
}

var newFieldsDriverID atomic.Uint64

func cloneNewFieldSets(input map[int64]newFieldSet) map[int64]newFieldSet {
	result := make(map[int64]newFieldSet, len(input))
	for id, set := range input {
		set.members = append([]newFieldMember(nil), set.members...)
		result[id] = set
	}
	return result
}
func (d *newFieldsDriver) Open(string) (driver.Conn, error) {
	return &newFieldsConn{state: d.state}, nil
}
func (*newFieldsConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*newFieldsConn) Close() error { return nil }
func (c *newFieldsConn) Begin() (driver.Tx, error) {
	c.before = cloneNewFieldSets(c.state.sets)
	return &newFieldsTx{conn: c}, nil
}
func (tx *newFieldsTx) Commit() error      { tx.conn.before = nil; return nil }
func (tx *newFieldsTx) Rollback() error    { tx.conn.state.sets = tx.conn.before; return nil }
func (r *newFieldsRows) Columns() []string { return r.names }
func (*newFieldsRows) Close() error        { return nil }
func (r *newFieldsRows) Next(values []driver.Value) error {
	if r.index == len(r.values) {
		return io.EOF
	}
	copy(values, r.values[r.index])
	r.index++
	return nil
}
func (c *newFieldsConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.queries++
	rows := &newFieldsRows{}
	switch {
	case strings.Contains(query, "FROM public.system_db_tables AS tables"):
		if c.state.failure == "lookup" {
			return nil, errors.New("lookup failure")
		}
		if !strings.Contains(query, "details.column_name = ANY($2)") ||
			!strings.Contains(query, "tables.table_name = $1") ||
			!strings.Contains(query, "ORDER BY details.co_number NULLS LAST, details.column_uid") {
			return nil, errors.New("metadata lookup lost exact target or physical order")
		}
		var names pq.StringArray
		if err := names.Scan(args[1].Value); err != nil {
			return nil, err
		}
		wanted := map[string]bool{}
		for _, name := range names {
			wanted[name] = true
		}
		rows.names = []string{"table_uid", "column_uid", "column_name"}
		for _, field := range c.state.metadata {
			if field.table == args[0].Value && wanted[field.name] {
				rows.values = append(rows.values, []driver.Value{int64(field.tableUID), int64(field.uid), field.name})
			}
		}
	case strings.Contains(query, "FROM public.system_column_field_sets"):
		if c.state.failure == "lock" {
			return nil, errors.New("lock failure")
		}
		if !strings.Contains(query, "ORDER BY id") || !strings.Contains(query, "FOR UPDATE") {
			return nil, errors.New("field-set locks must be deterministic")
		}
		ids := []int64{}
		for id, set := range c.state.sets {
			if int64(set.tableUID) == args[0].Value {
				ids = append(ids, id)
			}
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		c.state.locked = append(c.state.locked, ids...)
		rows.names = []string{"id"}
		for _, id := range ids {
			rows.values = append(rows.values, []driver.Value{id})
		}
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
	return rows, nil
}
func (c *newFieldsConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "INSERT INTO public.system_column_field_set_members") ||
		!strings.Contains(query, "WITH ORDINALITY") || !strings.Contains(query, "WHERE NOT EXISTS") ||
		!strings.Contains(query, "max(existing.sort_order)") {
		return nil, fmt.Errorf("unexpected membership mutation: %s", query)
	}
	id := args[0].Value.(int64)
	if c.state.failure == fmt.Sprintf("append:%d", id) {
		return nil, errors.New("append failure")
	}
	set := c.state.sets[id]
	if int64(set.tableUID) != args[1].Value {
		return nil, errors.New("cross-dataset member")
	}
	var uids pq.Int64Array
	if err := uids.Scan(args[2].Value); err != nil {
		return nil, err
	}
	maxOrder := 0
	seen := map[int]bool{}
	for _, member := range set.members {
		seen[member.uid] = true
		if member.order > maxOrder {
			maxOrder = member.order
		}
	}
	added := int64(0)
	for _, uid := range uids {
		if seen[int(uid)] {
			continue
		}
		maxOrder++
		set.members = append(set.members, newFieldMember{uid: int(uid), order: maxOrder})
		seen[int(uid)] = true
		added++
	}
	c.state.sets[id] = set
	c.state.mutations++
	return driver.RowsAffected(added), nil
}
func newFieldsFixture(t *testing.T) (*sql.Tx, *newFieldsState) {
	t.Helper()
	state := &newFieldsState{
		// UID 2 exists but was explicitly hidden in both existing collections.
		sets: map[int64]newFieldSet{
			10: {tableUID: 7, members: []newFieldMember{{uid: 1, order: 1, width: 220}}},
			11: {tableUID: 7, members: []newFieldMember{{uid: 1, order: 3, width: 140}}},
			90: {tableUID: 8, members: []newFieldMember{{uid: 8, order: 1, width: 80}}},
		},
		metadata: []newFieldMetadata{
			{tableUID: 7, uid: 1, table: "travel_info", name: "id"},
			{tableUID: 7, uid: 2, table: "travel_info", name: "old_hidden"},
			{tableUID: 7, uid: 3, table: "travel_info", name: "destination"},
			{tableUID: 7, uid: 4, table: "travel_info", name: "expiry_date"},
			{tableUID: 8, uid: 8, table: "other_table", name: "destination"},
		},
	}
	name := fmt.Sprintf("new-column-fieldsets-%d", newFieldsDriverID.Add(1))
	sql.Register(name, &newFieldsDriver{state: state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	tx, err := db.Begin()
	if err != nil {
		db.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(); _ = db.Close() })
	return tx, state
}

func TestAppendNewColumnsPreservesOldHiddenFieldsOrderWidthsAndOtherDatasets(t *testing.T) {
	tx, state := newFieldsFixture(t)
	before := cloneNewFieldSets(state.sets)
	// Request order differs from metadata/physical order, and DDL folds case.
	if err := AppendNewColumnsToFieldSets(tx, "TRAVEL_INFO", []string{"Expiry_Date", "Destination"}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{10, 11} {
		got := state.sets[id].members
		previous := before[id].members
		want := append(append([]newFieldMember(nil), previous...),
			newFieldMember{uid: 3, order: previous[0].order + 1},
			newFieldMember{uid: 4, order: previous[0].order + 2})
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("set %d = %#v, want %#v", id, got, want)
		}
	}
	if !reflect.DeepEqual(state.sets[90], before[90]) {
		t.Fatal("other dataset changed")
	}
	if !reflect.DeepEqual(state.locked, []int64{10, 11}) {
		t.Fatalf("locks=%v", state.locked)
	}
	after := cloneNewFieldSets(state.sets)
	if err := AppendNewColumnsToFieldSets(tx, "travel_info", []string{"destination", "expiry_date"}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(state.sets, after) {
		t.Fatal("repeated append changed memberships")
	}
}
func TestAppendNewColumnsEmptySelectionDoesNothing(t *testing.T) {
	if err := AppendNewColumnsToFieldSets(nil, "", nil); err != nil {
		t.Fatal(err)
	}
}
func TestAppendNewColumnsWithoutSavedSetsStillValidatesMetadata(t *testing.T) {
	tx, state := newFieldsFixture(t)
	state.sets = map[int64]newFieldSet{}
	if err := AppendNewColumnsToFieldSets(tx, "travel_info", []string{"destination"}); err != nil {
		t.Fatal(err)
	}
	if state.mutations != 0 {
		t.Fatal("unexpected mutation without sets")
	}
}
func TestAppendNewColumnsMissingMetadataFailsBeforeMutation(t *testing.T) {
	tx, state := newFieldsFixture(t)
	err := AppendNewColumnsToFieldSets(tx, "travel_info", []string{"destination", "missing"})
	if err == nil || !strings.Contains(err.Error(), "metadata missing") {
		t.Fatalf("error=%v", err)
	}
	if len(state.locked) != 0 || state.mutations != 0 {
		t.Fatal("partial mutation before validating all UIDs")
	}
}
func TestAppendNewColumnsRejectsInvalidOrDuplicateNames(t *testing.T) {
	for _, names := range [][]string{{"bad-name"}, {"destination", "Destination"}} {
		tx, state := newFieldsFixture(t)
		if err := AppendNewColumnsToFieldSets(tx, "travel_info", names); err == nil {
			t.Fatalf("accepted %v", names)
		}
		if state.queries != 0 {
			t.Fatal("database queried for invalid input")
		}
	}
}
func TestAppendNewColumnsPropagatesFailuresForCallerRollback(t *testing.T) {
	for _, failure := range []string{"lookup", "lock", "append:11"} {
		t.Run(failure, func(t *testing.T) {
			tx, state := newFieldsFixture(t)
			before := cloneNewFieldSets(state.sets)
			state.failure = failure
			if err := AppendNewColumnsToFieldSets(tx, "travel_info", []string{"destination"}); err == nil {
				t.Fatal("failure swallowed")
			}
			if failure == "append:11" && state.mutations != 1 {
				t.Fatal("fixture did not exercise a partial transaction")
			}
			if err := tx.Rollback(); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(state.sets, before) {
				t.Fatal("rollback left partial membership change")
			}
		})
	}
}
