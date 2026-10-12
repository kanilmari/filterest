// tree_response_fixture_test.go
// Records the real navigation handler's response for E2E recovery tests.
// Bridges scripted SQL rows, the authenticated handler and a shared JSON fixture.
// Prevents TypeScript fakes from losing structural nodes without using sockets.
package vanilla_tree

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/sessions"
)

type treeFixtureDriver struct{}
type treeFixtureConnection struct{}
type treeFixtureRows struct {
	columns []string
	values  [][]driver.Value
}

func (treeFixtureDriver) Open(string) (driver.Conn, error) { return treeFixtureConnection{}, nil }
func (treeFixtureConnection) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("fixture permits direct read queries only")
}
func (treeFixtureConnection) Close() error { return nil }
func (treeFixtureConnection) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("fixture permits no transactions")
}
func (rows *treeFixtureRows) Columns() []string { return rows.columns }
func (rows *treeFixtureRows) Close() error      { return nil }
func (rows *treeFixtureRows) Next(destination []driver.Value) error {
	if len(rows.values) == 0 {
		return io.EOF
	}
	copy(destination, rows.values[0])
	rows.values = rows.values[1:]
	return nil
}

// SQL input rows are scripted; node construction and JSON encoding belong to
// GetTreeDataHandler itself. Unexpected queries fail instead of reaching a DB.
func (treeFixtureConnection) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM system_user_group_memberships"):
		return &treeFixtureRows{[]string{"admin"}, [][]driver.Value{{int64(1)}}}, nil
	case strings.Contains(query, "FROM system_table_folders"):
		return &treeFixtureRows{[]string{"id", "folder_name", "parent_id", "is_current_project"}, [][]driver.Value{
			{int64(15), "database", nil, false},
			{int64(150), "other_tables", int64(15), false},
			{int64(919), "nested_folder", int64(150), false},
		}}, nil
	case strings.Contains(query, "FROM system_db_tables t"):
		columns := []string{"id", "table_name", "table_uid", "folder_id", "display_name", "search_slogan",
			"search_placeholder", "cover", "background", "icon_key", "cover_hidden", "background_hidden",
			"default_view_id", "default_view_name", "filterbar_visible_by_default"}
		return &treeFixtureRows{columns, [][]driver.Value{
			{int64(31), "e2e_recorded", int64(919), int64(919), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil},
			{int64(32), "nested_dataset", int64(921), int64(919), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil},
			// Registered SQL views are selected from the dataset registry too.
			{int64(33), "registered_view", int64(920), int64(150), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil},
		}}, nil
	case query == unregisteredPublicViewsQuery:
		return &treeFixtureRows{[]string{"table_name", "table_uid"}, [][]driver.Value{{"unregistered_view", nil}}}, nil
	case strings.Contains(query, "FROM system_column_details c"):
		return &treeFixtureRows{columns: []string{"table_uid", "table_name"}}, nil
	default:
		return nil, fmt.Errorf("unexpected fixture query: %s", query)
	}
}

func init() { sql.Register("e2e_tree_response_fixture", treeFixtureDriver{}) }

// TestE2EDatasetTreeResponseFixture checks the fixture on every package test run.
// Regenerate intentionally with UPDATE_E2E_TREE_FIXTURE=1 go test
// ./backend/reusable_components/vanilla_tree -run TestE2EDatasetTreeResponseFixture.
func TestE2EDatasetTreeResponseFixture(t *testing.T) {
	db, err := sql.Open("e2e_tree_response_fixture", "")
	if err != nil {
		t.Fatal(err)
	}
	previousDB, previousStore, previousName := backend.Db, e_sessions.Store, e_sessions.SessionName
	backend.Db = db
	e_sessions.Store = sessions.NewCookieStore([]byte("e2e-tree-fixture-cookie-key-32bytes"))
	e_sessions.SessionName = "e2e_tree_fixture"
	t.Cleanup(func() {
		backend.Db, e_sessions.Store, e_sessions.SessionName = previousDB, previousStore, previousName
		db.Close()
	})
	request := httptest.NewRequest("GET", "/api/tree_data", nil)
	session, err := e_sessions.Store.Get(request, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = 4
	cookies := httptest.NewRecorder()
	if err := session.Save(request, cookies); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range cookies.Result().Cookies() {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	GetTreeDataHandler(response, request)
	if response.Code != 200 {
		t.Fatalf("tree handler status %d: %s", response.Code, response.Body)
	}
	var formatted bytes.Buffer
	if err := json.Indent(&formatted, response.Body.Bytes(), "", "  "); err != nil {
		t.Fatal(err)
	}
	fixturePath := filepath.Join("..", "..", "..", "testing", "shared_contracts", "e2e_dataset_tree_response.json")
	if os.Getenv("UPDATE_E2E_TREE_FIXTURE") == "1" {
		if err := os.WriteFile(fixturePath, formatted.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}
	}
	fixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(fixture, formatted.Bytes()) {
		t.Fatal("E2E tree fixture differs from GetTreeDataHandler; regenerate with UPDATE_E2E_TREE_FIXTURE=1 and review reader regressions")
	}
}
