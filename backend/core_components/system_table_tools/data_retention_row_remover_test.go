// data_retention_row_remover_test.go
// Verifies configurable data-retention parsing and preview/prune execution with a DB-driver double.
// Bridges policy JSON normalization, allowlisted retention targets, and HTTP-free maintenance execution.
// Exists to keep automatic deletion rules safe without requiring a live PostgreSQL instance.
package system_table_tools

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
)

type dataRetentionQueryCall struct {
	query string
	args  []driver.NamedValue
}

type dataRetentionExecCall struct {
	query string
	args  []driver.NamedValue
}

type dataRetentionMockState struct {
	mu sync.Mutex

	counts map[string]int64
	calls  []dataRetentionQueryCall
	execs  []dataRetentionExecCall
}

type dataRetentionMockDriver struct{ state *dataRetentionMockState }
type dataRetentionMockConn struct{ state *dataRetentionMockState }
type dataRetentionMockTx struct{}

type dataRetentionMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var dataRetentionDriverCounter int64

func (d *dataRetentionMockDriver) Open(string) (driver.Conn, error) {
	return &dataRetentionMockConn{state: d.state}, nil
}

func (c *dataRetentionMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented in data retention mock")
}

func (c *dataRetentionMockConn) Close() error { return nil }
func (c *dataRetentionMockConn) Begin() (driver.Tx, error) {
	return &dataRetentionMockTx{}, nil
}
func (c *dataRetentionMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &dataRetentionMockTx{}, nil
}

func (*dataRetentionMockTx) Commit() error   { return nil }
func (*dataRetentionMockTx) Rollback() error { return nil }

func (r *dataRetentionMockRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *dataRetentionMockRows) Close() error      { return nil }

func (r *dataRetentionMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func (c *dataRetentionMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *dataRetentionMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.calls = append(c.state.calls, dataRetentionQueryCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

	if strings.Contains(query, "information_schema.tables") {
		return &dataRetentionMockRows{
			cols: []string{"exists"},
			rows: [][]driver.Value{{true}},
		}, nil
	}

	if strings.Contains(query, `SELECT id FROM "dev_agent_tasks"`) {
		return &dataRetentionMockRows{
			cols: []string{"id"},
			rows: [][]driver.Value{{int64(41)}, {int64(42)}},
		}, nil
	}

	for tableName, count := range c.state.counts {
		if strings.Contains(query, fmt.Sprintf(`FROM "%s"`, tableName)) && strings.Contains(strings.ToUpper(query), "COUNT(") {
			return &dataRetentionMockRows{
				cols: []string{"count"},
				rows: [][]driver.Value{{count}},
			}, nil
		}
	}

	return nil, fmt.Errorf("unexpected query: %s", query)
}

func (c *dataRetentionMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *dataRetentionMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	c.state.execs = append(c.state.execs, dataRetentionExecCall{
		query: query,
		args:  append([]driver.NamedValue(nil), args...),
	})

	switch {
	case strings.Contains(query, `DELETE FROM "regfetch_conversations"`):
		return driver.RowsAffected(c.state.counts["regfetch_conversations"]), nil
	case strings.Contains(query, `DELETE FROM bee_messages`):
		return driver.RowsAffected(2), nil
	case strings.Contains(query, `DELETE FROM system_comments`):
		return driver.RowsAffected(2), nil
	case strings.Contains(query, `DELETE FROM dev_agent_tasks`):
		return driver.RowsAffected(2), nil
	default:
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}
}

func openDataRetentionMockDB(t *testing.T, counts map[string]int64) (*sql.DB, *dataRetentionMockState) {
	t.Helper()
	state := &dataRetentionMockState{counts: counts}
	driverName := fmt.Sprintf("data_retention_%d", atomic.AddInt64(&dataRetentionDriverCounter, 1))
	sql.Register(driverName, &dataRetentionMockDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db, state
}

func TestParseDataRetentionPoliciesAcceptsQueueScopedCalendarPolicy(t *testing.T) {
	policies, err := parseDataRetentionPolicies([]byte(`[
		{
			"name":"queue-1-retention",
			"enabled":true,
			"table_name":"dev_agent_tasks",
			"timestamp_column":"updated",
			"filter_column":"queue_id",
			"filter_value":1,
			"mode":"calendar_years_plus_current",
			"keep_years":3
		}
	]`))
	if err != nil {
		t.Fatalf("parseDataRetentionPolicies returned error: %v", err)
	}
	if len(policies) != 1 {
		t.Fatalf("len(policies) = %d, want 1", len(policies))
	}
	if policies[0].FilterValue.(int64) != 1 {
		t.Fatalf("queue filter = %v, want 1", policies[0].FilterValue)
	}
}

func TestResolveDataRetentionPolicyCutoffModes(t *testing.T) {
	now := time.Date(2026, time.April, 28, 12, 30, 0, 0, time.Local)

	calendarCutoff := resolveDataRetentionPolicyCutoff(dataRetentionPolicy{
		Mode:      dataRetentionModeCalendarYearsCurrent,
		KeepYears: 3,
	}, now)
	if got := calendarCutoff.Format(time.RFC3339); !strings.HasPrefix(got, "2023-01-01T00:00:00") {
		t.Fatalf("calendar cutoff = %s, want 2023-01-01T00:00:00...", got)
	}

	rollingCutoff := resolveDataRetentionPolicyCutoff(dataRetentionPolicy{
		Mode:      dataRetentionModeRollingYears,
		KeepYears: 5,
	}, now)
	if got := rollingCutoff.Format(time.RFC3339); !strings.HasPrefix(got, "2021-04-28T12:30:00") {
		t.Fatalf("rolling cutoff = %s, want 2021-04-28T12:30:00...", got)
	}
}

func TestRunDataRetentionDryRunCountsGenericRows(t *testing.T) {
	db, state := openDataRetentionMockDB(t, map[string]int64{
		"regfetch_conversations": 4,
	})

	response, err := runDataRetentionAt(db, []dataRetentionPolicy{
		{
			Name:            "regfetch-default",
			Enabled:         true,
			TableName:       "regfetch_conversations",
			TimestampColumn: "updated_at",
			Mode:            dataRetentionModeRollingYears,
			KeepYears:       1,
		},
	}, true, time.Date(2026, time.April, 28, 0, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatalf("runDataRetentionAt returned error: %v", err)
	}
	if response.TotalMatched != 4 {
		t.Fatalf("TotalMatched = %d, want 4", response.TotalMatched)
	}
	if response.TotalDeleted != 0 {
		t.Fatalf("TotalDeleted = %d, want 0", response.TotalDeleted)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.execs) != 0 {
		t.Fatalf("exec count = %d, want 0 in dry run", len(state.execs))
	}
}

func TestRunDataRetentionPrunesTicketRowsAndRelatedMessages(t *testing.T) {
	db, state := openDataRetentionMockDB(t, map[string]int64{
		"dev_agent_tasks": 2,
	})

	response, err := runDataRetentionAt(db, []dataRetentionPolicy{
		{
			Name:             "queue-1-ticket-retention",
			Enabled:          true,
			TableName:        "dev_agent_tasks",
			TimestampColumn:  "updated",
			FilterColumn:     "queue_id",
			FilterValue:      int64(1),
			FilterValueLabel: "1",
			Mode:             dataRetentionModeCalendarYearsCurrent,
			KeepYears:        3,
		},
	}, false, time.Date(2026, time.April, 28, 0, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatalf("runDataRetentionAt returned error: %v", err)
	}
	if response.TotalDeleted != 2 {
		t.Fatalf("TotalDeleted = %d, want 2", response.TotalDeleted)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.execs) != 3 {
		t.Fatalf("exec count = %d, want 3 (comments, bee_messages, tasks)", len(state.execs))
	}
}
