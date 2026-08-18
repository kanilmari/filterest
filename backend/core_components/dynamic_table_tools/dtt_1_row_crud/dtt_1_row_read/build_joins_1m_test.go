package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

type buildJoinsQueryCounter struct {
	mu     sync.Mutex
	counts map[string]int
}

func (c *buildJoinsQueryCounter) add(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.counts[name]++
}

func (c *buildJoinsQueryCounter) get(name string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.counts[name]
}

type buildJoinsMockDriver struct {
	counter        *buildJoinsQueryCounter
	foreignKeyMode bool
}

type buildJoinsMockConn struct {
	counter        *buildJoinsQueryCounter
	foreignKeyMode bool
}

type buildJoinsMockStmt struct{}

type buildJoinsMockTx struct{}

type buildJoinsMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

func (d *buildJoinsMockDriver) Open(_ string) (driver.Conn, error) {
	return &buildJoinsMockConn{
		counter:        d.counter,
		foreignKeyMode: d.foreignKeyMode,
	}, nil
}

func (c *buildJoinsMockConn) Prepare(_ string) (driver.Stmt, error) {
	return &buildJoinsMockStmt{}, nil
}

func (c *buildJoinsMockConn) Close() error {
	return nil
}

func (c *buildJoinsMockConn) Begin() (driver.Tx, error) {
	return &buildJoinsMockTx{}, nil
}

func (s *buildJoinsMockStmt) Close() error {
	return nil
}

func (s *buildJoinsMockStmt) NumInput() int {
	return -1
}

func (s *buildJoinsMockStmt) Exec(_ []driver.Value) (driver.Result, error) {
	return nil, fmt.Errorf("exec not supported")
}

func (s *buildJoinsMockStmt) Query(_ []driver.Value) (driver.Rows, error) {
	return nil, fmt.Errorf("query not supported")
}

func (t *buildJoinsMockTx) Commit() error {
	return nil
}

func (t *buildJoinsMockTx) Rollback() error {
	return nil
}

func (r *buildJoinsMockRows) Columns() []string {
	return r.cols
}

func (r *buildJoinsMockRows) Close() error {
	return nil
}

func (r *buildJoinsMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *buildJoinsMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, value := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: value}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *buildJoinsMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "SELECT table_uid FROM system_db_tables WHERE table_name = $1"):
		c.counter.add("table_uid")
		return &buildJoinsMockRows{
			cols: []string{"table_uid"},
			rows: [][]driver.Value{{"42"}},
		}, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m fr"):
		c.counter.add("fk_relations")
		return &buildJoinsMockRows{
			cols: []string{
				"source_table_name",
				"source_column_name",
				"target_table_name",
				"target_column_name",
				"cached_name_col_in_src",
				"name_col_in_tgt",
			},
			rows: [][]driver.Value{},
		}, nil
	case strings.Contains(query, "information_schema.table_constraints AS tc"):
		c.counter.add("foreign_keys")
		if c.foreignKeyMode {
			return &buildJoinsMockRows{
				cols: []string{"referencing_column", "referenced_table", "referenced_column"},
				rows: [][]driver.Value{{"table_uid", "system_db_tables", "table_uid"}},
			}, nil
		}
		return &buildJoinsMockRows{
			cols: []string{"referencing_column", "referenced_table", "referenced_column"},
			rows: [][]driver.Value{},
		}, nil
	case strings.Contains(query, "SELECT fk_display_column FROM system_db_tables") && c.foreignKeyMode:
		return &buildJoinsMockRows{
			cols: []string{"fk_display_column"},
			rows: [][]driver.Value{{"table_name"}},
		}, nil
	case strings.Contains(query, "SELECT EXISTS (") && c.foreignKeyMode:
		return &buildJoinsMockRows{
			cols: []string{"exists"},
			rows: [][]driver.Value{{true}},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func openBuildJoinsForeignKeyMockDB(t *testing.T, counter *buildJoinsQueryCounter) *sql.DB {
	t.Helper()

	driverName := fmt.Sprintf(
		"build_joins_fk_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&buildJoinsDriverCounter, 1),
	)
	sql.Register(driverName, &buildJoinsMockDriver{
		counter:        counter,
		foreignKeyMode: true,
	})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open foreign-key mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

var buildJoinsDriverCounter int64

func openBuildJoinsMockDB(t *testing.T, counter *buildJoinsQueryCounter) *sql.DB {
	t.Helper()

	driverName := fmt.Sprintf(
		"build_joins_cache_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&buildJoinsDriverCounter, 1),
	)
	sql.Register(driverName, &buildJoinsMockDriver{counter: counter})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func TestBuildJoinsWith1MRelationsCachesMetadataAcrossCalls(t *testing.T) {
	resetJoinMetadataCacheForTests()

	counter := &buildJoinsQueryCounter{counts: map[string]int{}}
	db := openBuildJoinsMockDB(t, counter)

	origDB := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = origDB
		resetJoinMetadataCacheForTests()
	})

	columnsMap := map[int]dtt_models.ColumnInfo{
		1: {ColumnName: "id"},
		2: {ColumnName: "name"},
	}
	columnUIDs := []int{1, 2}

	firstSelect, firstJoins, firstExpressions, err := buildJoinsWith1MRelations(db, "app_service_catalog", columnsMap, columnUIDs)
	if err != nil {
		t.Fatalf("first buildJoinsWith1MRelations returned error: %v", err)
	}
	secondSelect, secondJoins, secondExpressions, err := buildJoinsWith1MRelations(db, "app_service_catalog", columnsMap, columnUIDs)
	if err != nil {
		t.Fatalf("second buildJoinsWith1MRelations returned error: %v", err)
	}

	if firstSelect != secondSelect {
		t.Fatalf("select columns changed between calls: %q vs %q", firstSelect, secondSelect)
	}
	if firstJoins != secondJoins {
		t.Fatalf("join clauses changed between calls: %q vs %q", firstJoins, secondJoins)
	}
	if len(firstExpressions) != len(secondExpressions) {
		t.Fatalf("column expression count changed between calls: %d vs %d", len(firstExpressions), len(secondExpressions))
	}

	if got := counter.get("table_uid"); got != 1 {
		t.Fatalf("table_uid query count = %d, want 1", got)
	}
	if got := counter.get("fk_relations"); got != 1 {
		t.Fatalf("fk_relations query count = %d, want 1", got)
	}
	if got := counter.get("foreign_keys"); got != 1 {
		t.Fatalf("foreign_keys query count = %d, want 1", got)
	}
}

func TestBuildJoinsWith1MRelationsAddsTableNameAliasForColumnMetadataTableUID(t *testing.T) {
	resetJoinMetadataCacheForTests()

	counter := &buildJoinsQueryCounter{counts: map[string]int{}}
	db := openBuildJoinsForeignKeyMockDB(t, counter)

	origDB := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = origDB
		resetJoinMetadataCacheForTests()
	})

	columnsMap := map[int]dtt_models.ColumnInfo{
		1: {ColumnName: "table_uid"},
	}

	selectColumns, joinClauses, columnExpressions, err := buildJoinsWith1MRelations(
		db,
		"system_column_details",
		columnsMap,
		[]int{1},
	)
	if err != nil {
		t.Fatalf("buildJoinsWith1MRelations returned error: %v", err)
	}

	for _, fragment := range []string{
		`"system_column_details"."table_uid" AS "table_uid"`,
		`"table_uid_alias1"."table_name" AS "table_name (ln)"`,
	} {
		if !strings.Contains(selectColumns, fragment) {
			t.Fatalf("select columns %q do not contain %q", selectColumns, fragment)
		}
	}

	wantJoin := `LEFT JOIN "system_db_tables" AS "table_uid_alias1" ON "system_column_details"."table_uid" = "table_uid_alias1"."table_uid"`
	if !strings.Contains(joinClauses, wantJoin) {
		t.Fatalf("join clauses %q do not contain %q", joinClauses, wantJoin)
	}
	if got := columnExpressions["table_name (ln)"]; got != `"table_uid_alias1"."table_name"` {
		t.Fatalf("table_name alias expression = %q, want joined display column", got)
	}
}
