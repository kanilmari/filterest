// front_page_article_buttons_store_test.go
// Proves absent defaults and stale/competing writes without PostgreSQL access.
// Connects the actual saver to a small SQL driver tracking revision state.
// Ensures failed revision checks cannot issue a configuration write.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	config "easelect/backend/core_components/system_config_checks"
)

type articleButtonsTestDriver struct{ state *articleButtonsTestState }
type articleButtonsTestState struct {
	raw              []byte
	updated          string
	valueType        int64
	writes           int
	competingCreator bool
}
type articleButtonsTestConn struct{ state *articleButtonsTestState }
type articleButtonsTestRows struct {
	values []driver.Value
	read   bool
}

func (d articleButtonsTestDriver) Open(string) (driver.Conn, error) {
	return &articleButtonsTestConn{d.state}, nil
}
func (c *articleButtonsTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c *articleButtonsTestConn) Close() error              { return nil }
func (c *articleButtonsTestConn) Begin() (driver.Tx, error) { return frontPageBackgroundTx{}, nil }
func (c *articleButtonsTestConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "pg_advisory_xact_lock") {
		return nil, fmt.Errorf("unexpected exec %s", query)
	}
	return driver.RowsAffected(1), nil
}
func (c *articleButtonsTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	s := c.state
	if strings.HasPrefix(query, "SELECT EXISTS") {
		return &articleButtonsTestRows{values: []driver.Value{s.raw != nil}}, nil
	}
	if strings.HasPrefix(query, "INSERT") && s.competingCreator {
		s.raw, s.valueType = []byte(`{"schema_version":1,"placement":"top_row","items":[]}`), 5
		return &articleButtonsTestRows{}, nil
	}
	if strings.HasPrefix(query, "INSERT") || strings.HasPrefix(query, "UPDATE") {
		s.writes++
		s.raw, s.updated, s.valueType = []byte(args[0].Value.(string)), fmt.Sprint(s.writes), 5
	}
	if s.raw == nil {
		return &articleButtonsTestRows{}, nil
	}
	return &articleButtonsTestRows{values: []driver.Value{s.raw, s.updated, s.valueType}}, nil
}
func (r *articleButtonsTestRows) Columns() []string {
	if len(r.values) == 1 {
		return []string{"exists"}
	}
	return []string{"json_value", "updated", "value_type"}
}
func (r *articleButtonsTestRows) Close() error { return nil }
func (r *articleButtonsTestRows) Next(dest []driver.Value) error {
	if r.read || r.values == nil {
		return io.EOF
	}
	r.read = true
	copy(dest, r.values)
	return nil
}

func articleButtonsUnitDB(t *testing.T, state *articleButtonsTestState) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("article_buttons_%d", frontPageBackgroundDriverID.Add(1))
	sql.Register(name, articleButtonsTestDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func articleButtonsTestSave(db *sql.DB, raw []byte, version string) (string, error) {
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	revision, err := saveFrontPageArticleButtons(dbutils.SetLazyTx(context.Background(), lazy), raw, version)
	if err == nil {
		err = lazy.Commit()
	}
	return revision, err
}

func TestFrontPageArticleButtonsRevisionGuard(t *testing.T) {
	state := &articleButtonsTestState{}
	db := articleButtonsUnitDB(t, state)
	value, revision, err := readFrontPageArticleButtons(context.Background(), db)
	if err != nil || revision != "none" || value.Placement != "below_text" || value.Items == nil || len(value.Items) != 0 {
		t.Fatal(value, revision, err)
	}
	raw, _ := json.Marshal(config.EmptyFrontPageArticleButtons())
	revision, err = articleButtonsTestSave(db, raw, "none")
	if err != nil || revision == "none" || state.writes != 1 {
		t.Fatal(revision, err, state.writes)
	}
	if _, err := articleButtonsTestSave(db, raw, "none"); !errors.Is(err, errFrontPageConflict) || state.writes != 1 {
		t.Fatal("stale first editor wrote", err, state.writes)
	}
	newer, err := articleButtonsTestSave(db, raw, revision)
	if err != nil || newer == revision || state.writes != 2 {
		t.Fatal(newer, err, state.writes)
	}
	if _, err := articleButtonsTestSave(db, raw, revision); !errors.Is(err, errFrontPageConflict) || state.writes != 2 {
		t.Fatal("stale update wrote", err, state.writes)
	}
	state.updated = ""
	_, unstamped, err := readFrontPageArticleButtons(context.Background(), db)
	if err != nil || unstamped == "none" {
		t.Fatal(unstamped, err)
	}
	state.raw = []byte(`{"schema_version":1,"placement":"top_row","items":[]}`)
	if _, err := articleButtonsTestSave(db, raw, unstamped); !errors.Is(err, errFrontPageConflict) {
		t.Fatal("content-only change escaped guard", err)
	}
	_, current, _ := readFrontPageArticleButtons(context.Background(), db)
	state.valueType = 2
	if _, err := articleButtonsTestSave(db, raw, current); !errors.Is(err, errFrontPageConflict) {
		t.Fatal("value type change escaped guard", err)
	}
}

func TestFrontPageArticleButtonsFirstSaveCompetingCreator(t *testing.T) {
	state := &articleButtonsTestState{competingCreator: true}
	db := articleButtonsUnitDB(t, state)
	raw, _ := json.Marshal(config.EmptyFrontPageArticleButtons())
	if _, err := articleButtonsTestSave(db, raw, "none"); !errors.Is(err, errFrontPageConflict) || state.writes != 0 {
		t.Fatal(err, state.writes)
	}
	value, _, err := readFrontPageArticleButtons(context.Background(), db)
	if err != nil || value.Placement != "top_row" {
		t.Fatal("competing value overwritten", value, err)
	}
}

func TestFrontPageArticleButtonsGenericDeletionPreservesRevision(t *testing.T) {
	state := &articleButtonsTestState{}
	db := articleButtonsUnitDB(t, state)
	if err := config.RefuseArticleButtonsDeletion(db, "system_config", []int{1}); err != nil {
		t.Fatal(err)
	}
	state.raw = []byte(`{"schema_version":1,"placement":"below_text","items":[]}`)
	var refusal *httpresponse.Refusal
	if err := config.RefuseArticleButtonsDeletion(db, "system_config", []int{1}); !errors.As(err, &refusal) || refusal.Status != 400 {
		t.Fatal("generic deletion reset revision", err)
	}
	if err := config.RefuseArticleButtonsDeletion(db, "other_dataset", []int{1}); err != nil {
		t.Fatal(err)
	}
	if err := config.RefuseArticleButtonsDeletion(db, "system_config", nil); err != nil {
		t.Fatal(err)
	}
}
