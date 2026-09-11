// Verifies the actual create handler rolls schema and metadata back if assigning
// a valid role fails late in its transaction. The driver records transaction
// boundaries without connecting to or mutating any application database.
package dtt_crud_workflows

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type roleTxState struct {
	created       bool
	schemaPending bool
	columnInserts int
	roleAttempts  int
	commits       int
	rollbacks     int
}
type roleTxDriver struct{ state *roleTxState }
type roleTxConn struct{ state *roleTxState }
type roleTx struct{ state *roleTxState }

func TestCreateHandlerRollsBackSchemaAndMetadataAfterRoleAssignmentFailure(t *testing.T) {
	state := &roleTxState{}
	name := fmt.Sprintf("role-rollback-%d", time.Now().UnixNano())
	sql.Register(name, &roleTxDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/create_dataset", strings.NewReader(
		`{"dataset_name":"sample","columns":{"id":"SERIAL","title":"TEXT"},"folder_id":1,"column_card_roles":{"title":"header"}}`))
	rec := httptest.NewRecorder()
	CreateTableHandler(rec, withWorkflowTx(req, db))
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "card role assignment failed") {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	if !state.created || state.columnInserts != 2 || state.roleAttempts != 1 {
		t.Fatalf("failure must follow physical creation and metadata inserts: %+v", state)
	}
	if state.commits != 0 || state.rollbacks != 1 || state.schemaPending {
		t.Fatalf("creation was not fully rolled back: %+v", state)
	}
}

func (d *roleTxDriver) Open(string) (driver.Conn, error) { return &roleTxConn{d.state}, nil }
func (c *roleTxConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c *roleTxConn) Close() error              { return nil }
func (c *roleTxConn) Begin() (driver.Tx, error) { return &roleTx{c.state}, nil }
func (tx *roleTx) Commit() error                { tx.state.commits++; return nil }
func (tx *roleTx) Rollback() error              { tx.state.rollbacks++; tx.state.schemaPending = false; return nil }

func (c *roleTxConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	compact := strings.Join(strings.Fields(query), " ")
	if strings.HasPrefix(compact, "CREATE TABLE IF NOT EXISTS sample") {
		c.state.created = true
		c.state.schemaPending = true
	}
	if strings.Contains(compact, "INSERT INTO system_column_details") {
		c.state.columnInserts++
	}
	if strings.Contains(compact, "SET card_element = $1") {
		c.state.roleAttempts++
		return nil, errors.New("injected role-assignment failure")
	}
	return &workflowQueueResult{rowsAffected: 1}, nil
}

func (*roleTxConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	compact := strings.Join(strings.Fields(query), " ")
	rows := &workflowQueueRows{}
	switch {
	case strings.Contains(compact, "SELECT t.table_name, a.alias_slug"):
		rows.cols = []string{"table_name", "alias_slug"}
	case strings.Contains(compact, "SELECT table_uid, table_name"):
		rows.cols = []string{"table_uid", "table_name"}
	case strings.Contains(compact, "SELECT id, table_name"):
		rows.cols = []string{"id", "table_name"}
	case strings.Contains(compact, "SELECT EXISTS(SELECT 1 FROM system_table_folders"):
		rows.cols = []string{"exists"}
		rows.data = [][]driver.Value{{true}}
	case strings.Contains(compact, "SELECT id FROM system_table_folders"):
		rows.cols = []string{"id"}
		rows.data = [][]driver.Value{{int64(1)}}
	case strings.Contains(compact, "SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name"):
		rows.cols = []string{"oid", "schema_name", "table_name"}
		rows.data = [][]driver.Value{{int64(123), "public", "sample"}}
	case strings.Contains(compact, "SELECT table_name, table_uid"):
		rows.cols = []string{"table_name", "table_uid"}
		rows.data = [][]driver.Value{{"sample", int64(123)}}
	case strings.Contains(compact, "FROM pg_attribute a"):
		rows.cols = []string{"attname", "attnum", "data_type"}
		rows.data = [][]driver.Value{{"id", int64(1), "integer"}, {"title", int64(2), "text"}}
	case strings.Contains(compact, "SELECT column_name, column_uid, data_type"):
		rows.cols = []string{"column_name", "column_uid", "data_type"}
	default:
		return nil, fmt.Errorf("unexpected query: %s", compact)
	}
	return rows, nil
}
