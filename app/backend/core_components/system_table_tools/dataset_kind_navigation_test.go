// dataset_kind_navigation_test.go
// Proves navigation kind metadata requires an enabled ordinary row-read grant.
// Connects real cookie sessions and permission queries to a database-free handler.
// Keeps proven catalogue entries when optional rechecks or evidence fail.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

var kindNavigationSequence atomic.Int64

type kindNavigationDriver struct {
	mode          string
	t             *testing.T
	evidenceReads *int
	denyCatalogue bool
}
type kindNavigationConn struct{ kindNavigationDriver }
type kindNavigationRows struct {
	columns []string
	rows    [][]driver.Value
}

func (d kindNavigationDriver) Open(string) (driver.Conn, error) { return &kindNavigationConn{d}, nil }
func (*kindNavigationConn) Close() error                        { return nil }
func (*kindNavigationConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected transaction")
}
func (*kindNavigationConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (r *kindNavigationRows) Columns() []string { return r.columns }
func (*kindNavigationRows) Close() error        { return nil }
func (r *kindNavigationRows) Next(v []driver.Value) error {
	if len(r.rows) == 0 {
		return io.EOF
	}
	copy(v, r.rows[0])
	r.rows = r.rows[1:]
	return nil
}
func (c *kindNavigationConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	rows := func(columns []string, v ...[]driver.Value) driver.Rows { return &kindNavigationRows{columns, v} }
	switch {
	case strings.Contains(q, "WITH registrations AS ("):
		*c.evidenceReads++
		if c.mode == "query" {
			return nil, errors.New("fixture unavailable")
		}
		raw := `{"registrations":[{"table_uid":22,"name":"public.fixture","table_kind":"ordinary"}],"shapes":[{"name":"public.fixture"}]}`
		if c.mode == "decode" {
			raw = `false`
		}
		return rows([]string{"snapshot"}, []driver.Value{[]byte(raw)}), nil
	case strings.Contains(q, "WITH RECURSIVE current_project_roots"):
		return rows([]string{"id", "uid", "name", "default", "filterbar", "main", "about", "folder", "project", "top", "icon", "media"},
			[]driver.Value{int64(1), int64(22), "fixture", false, false, false, false, int64(1), true, true, nil, false}), nil
	case strings.Contains(q, "SELECT DISTINCT dataset.table_uid"):
		userID := int64(42)
		if c.mode == "guest" {
			userID = 1
		}
		if len(args) != 2 || args[0].Value != userID || args[1].Value != false {
			c.t.Fatal("wrong catalogue principal/recovery policy", q, args)
		}
		for _, clause := range []string{
			"function.url_route_endpoint = '/api/get-results'",
			"function.disabled = false OR function.disabled IS NULL",
			"rights.target_table_uid = dataset.table_uid",
			"membership.user_id = $1",
			"COALESCE(NULLIF(dataset.schema_name, ''), 'public') = 'public'",
			"dataset.table_uid > 0",
			"NOT dataset.ui_hidden OR EXISTS",
			"admin.user_id = $1 AND admin.group_id = 1",
		} {
			if !strings.Contains(q, clause) {
				c.t.Fatal("catalogue missing read/visibility proof", clause, q)
			}
		}
		if c.denyCatalogue || c.mode == "guest" {
			return rows([]string{"uid"}), nil
		}
		// The optional denial cases model rights/visibility changing after this
		// successful catalogue read, not a permanently unreadable listing.
		return rows([]string{"uid"}, []driver.Value{int64(22)}), nil
	case strings.Contains(q, "SELECT table_uid, table_name,"):
		return rows([]string{"uid", "name", "schema"}, []driver.Value{int64(22), "fixture", "public"}), nil
	case strings.Contains(q, "FROM system_db_table_aliases"):
		return rows([]string{"uid", "alias", "primary"}), nil
	case strings.Contains(q, "system_group_table_func_rights"):
		if len(args) != 3 || args[0].Value != "/api/get-results" || args[1].Value != int64(42) || args[2].Value != "22" || !strings.Contains(q, "f.disabled") {
			c.t.Fatal("wrong read proof", q, args)
		}
		if c.mode == "write only" || c.mode == "disabled" {
			return rows([]string{"allowed"}), nil
		}
		if c.mode == "permission failure" {
			return nil, errors.New("permission unavailable")
		}
		return rows([]string{"allowed"}, []driver.Value{int64(1)}), nil
	case strings.Contains(q, "dataset.ui_hidden"):
		return rows([]string{"hidden"}, []driver.Value{c.mode == "hidden"}), nil
	case strings.Contains(q, "FROM system_user_group_memberships"):
		return rows([]string{"admin"}), nil
	case strings.Contains(q, "SELECT EXISTS"):
		return rows([]string{"exists"}, []driver.Value{false}), nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", q)
	}
}

func TestKindNavigationRequiresRowReadAndDegradesOnEvidenceFailure(t *testing.T) {
	for _, mode := range []string{"read", "write only", "disabled", "hidden", "guest", "query", "decode", "permission failure"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "0")
			count := 0
			name := fmt.Sprintf("kind_navigation_%d", kindNavigationSequence.Add(1))
			sql.Register(name, kindNavigationDriver{mode: mode, t: t, evidenceReads: &count})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			oldDB, oldStore, oldName := backend.Db, esessions.Store, esessions.SessionName
			backend.Db = db
			esessions.Store = sessions.NewCookieStore([]byte("navigation-kind-cookie-key-32"))
			esessions.SessionName = "session"
			t.Cleanup(func() { backend.Db = oldDB; esessions.Store, esessions.SessionName = oldStore, oldName; db.Close() })
			r := httptest.NewRequest("GET", "/api/get-grouped-tables", nil)
			session, err := esessions.Store.Get(r, esessions.SessionName)
			if err != nil {
				t.Fatal(err)
			}
			session.Values["user_id"], session.Values["user_role"] = 42, "basic"
			if mode == "guest" {
				session.Values["user_id"], session.Values["user_role"] = 1, "guest"
			}
			cookies := httptest.NewRecorder()
			if err := session.Save(r, cookies); err != nil {
				t.Fatal(err)
			}
			for _, cookie := range cookies.Result().Cookies() {
				r.AddCookie(cookie)
			}
			w := httptest.NewRecorder()
			GetGroupedTables(w, r)
			if w.Code != 200 {
				t.Fatalf("navigation failed: %d %s", w.Code, w.Body.String())
			}
			var body struct {
				Datasets []map[string]json.RawMessage `json:"datasets"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if mode == "guest" {
				if len(body.Datasets) != 0 || count != 0 {
					t.Fatal("guest without grants received evidence", w.Body.String(), count)
				}
				return
			}
			if len(body.Datasets) != 1 {
				t.Fatal("old navigation entry removed", w.Body.String())
			}
			if (body.Datasets[0]["kind_capabilities"] != nil) != (mode == "read") {
				t.Fatal("wrong disclosure", w.Body.String())
			}
			if mode == "write only" || mode == "disabled" || mode == "hidden" || mode == "permission failure" {
				if count != 0 {
					t.Fatal("evidence read without proof")
				}
			}
			if w.Header().Get("Content-Type") != "application/json" {
				t.Fatal(w.Header())
			}
		})
	}
}

func TestKindNavigationCatalogueOmitsUnreadableDatasets(t *testing.T) {
	for _, mode := range []string{"write only", "disabled", "hidden"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "0")
			count := 0
			name := fmt.Sprintf("kind_navigation_%d", kindNavigationSequence.Add(1))
			sql.Register(name, kindNavigationDriver{mode: mode, t: t, evidenceReads: &count, denyCatalogue: true})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			oldDB, oldStore, oldName := backend.Db, esessions.Store, esessions.SessionName
			backend.Db = db
			esessions.Store = sessions.NewCookieStore([]byte("navigation-kind-cookie-key-32"))
			esessions.SessionName = "session"
			t.Cleanup(func() { backend.Db = oldDB; esessions.Store, esessions.SessionName = oldStore, oldName; db.Close() })
			w := httptest.NewRecorder()
			GetGroupedTables(w, catalogueRequest(t, 42))
			var body struct {
				Datasets []json.RawMessage `json:"datasets"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != 200 || body.Datasets == nil || len(body.Datasets) != 0 || count != 0 || strings.Contains(w.Body.String(), "fixture") {
				t.Fatal("unreadable catalogue disclosed a dataset or evidence", w.Code, w.Body.String(), count)
			}
		})
	}
}
