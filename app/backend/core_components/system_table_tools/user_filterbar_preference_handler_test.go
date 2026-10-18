// user_filterbar_preference_handler_test.go
// Exercises explicit copying, site permission and strict account preference validation.
// Connects signed session requests to a small transaction-aware SQL fixture.
// Keeps account order site-wide and prevents arbitrary configuration from entering it.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dbutils/queryfixture"
)

type filterbarPreferenceFixture struct {
	allow, admin, saved bool
	mode, order, memory string
	owner               int64
	configJSON          string
}
type filterbarPreferenceConn struct{ fixture *filterbarPreferenceFixture }
type filterbarPreferenceTx struct{}

func (f *filterbarPreferenceFixture) Connect(context.Context) (driver.Conn, error) {
	return &filterbarPreferenceConn{f}, nil
}
func (f *filterbarPreferenceFixture) Driver() driver.Driver { return f }
func (f *filterbarPreferenceFixture) Open(string) (driver.Conn, error) {
	return &filterbarPreferenceConn{f}, nil
}
func (c *filterbarPreferenceConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (c *filterbarPreferenceConn) Close() error              { return nil }
func (c *filterbarPreferenceConn) Begin() (driver.Tx, error) { return filterbarPreferenceTx{}, nil }
func (filterbarPreferenceTx) Commit() error                  { return nil }
func (filterbarPreferenceTx) Rollback() error                { return nil }
func (c *filterbarPreferenceConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	f := c.fixture
	switch {
	case strings.Contains(query, "FROM system_config"):
		if f.configJSON != "" {
			return queryfixture.Rows([]string{"json"}, []driver.Value{[]byte(f.configJSON)}), nil
		}
		return queryfixture.Rows([]string{"json"}, []driver.Value{[]byte(fmt.Sprintf(`{"section_order":["style","views"],"allow_own_order":%t}`, f.allow))}), nil
	case strings.Contains(query, "admin_access_allowed"):
		f.owner = args[0].Value.(int64)
		return queryfixture.Rows([]string{"admin"}, []driver.Value{f.admin}), nil
	case strings.Contains(query, "filterbar_order_mode"):
		if f.mode == "" {
			return queryfixture.Rows([]string{"mode", "order", "memory"}), nil
		}
		return queryfixture.Rows([]string{"mode", "order", "memory"}, []driver.Value{f.mode, []byte(f.order), f.memory}), nil
	}
	return nil, fmt.Errorf("unexpected query: %s", query)
}
func (c *filterbarPreferenceConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.Contains(query, "pg_advisory_xact_lock") {
		return driver.RowsAffected(1), nil
	}
	if strings.Contains(query, "INSERT INTO system_config") {
		c.fixture.configJSON = args[1].Value.(string)
		return driver.RowsAffected(1), nil
	}
	if !strings.Contains(query, "INSERT INTO public.system_user_visual_preferences") {
		return nil, fmt.Errorf("unexpected write: %s", query)
	}
	f := c.fixture
	f.owner = args[0].Value.(int64)
	f.mode = args[1].Value.(string)
	f.order = args[2].Value.(string)
	f.memory = args[3].Value.(string)
	f.saved = true
	return driver.RowsAffected(1), nil
}

func callUserFilterbarPreference(t *testing.T, fixture *filterbarPreferenceFixture, method, body string, userID int) *httptest.ResponseRecorder {
	t.Helper()
	db := sql.OpenDB(fixture)
	defer db.Close()
	request := queryfixture.Request(t, method, "/api/user-filterbar-preference?user_id=99&dataset=other", body, userID, "user")
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	request = request.WithContext(dbutils.SetLazyTx(request.Context(), lazy))
	response := httptest.NewRecorder()
	UserFilterbarPreferenceHandler(response, request)
	return response
}

func TestUserFilterbarPreferenceCopiesOnlyOnExplicitChoice(t *testing.T) {
	f := &filterbarPreferenceFixture{allow: true}
	response := callUserFilterbarPreference(t, f, "GET", "", 42)
	if response.Code != 200 || f.saved || f.owner != 42 || strings.Contains(response.Body.String(), `"style"`) {
		t.Fatalf("GET must not copy or accept an owner selector: %d %s %+v", response.Code, response.Body, f)
	}
	response = callUserFilterbarPreference(t, f, "PATCH", `{"order_mode":"own"}`, 42)
	if response.Code != 200 || !f.saved || f.owner != 42 || !strings.HasPrefix(f.order, `["style","views"`) {
		t.Fatalf("explicit copy: %d %s %+v", response.Code, response.Body, f)
	}
	f.saved = false
	response = callUserFilterbarPreference(t, f, "PATCH", `{"visibility_memory":"dataset"}`, 42)
	if response.Code != 200 || f.memory != "dataset" || !strings.HasPrefix(f.order, `["style","views"`) {
		t.Fatalf("visibility must preserve own order: %d %s", response.Code, response.Body)
	}
}

func TestUserFilterbarPreferenceEnforcesSitePolicy(t *testing.T) {
	for _, admin := range []bool{false, true} {
		f := &filterbarPreferenceFixture{admin: admin}
		response := callUserFilterbarPreference(t, f, "PATCH", `{"order_mode":"own"}`, 42)
		want := 403
		if admin {
			want = 200
		}
		if response.Code != want || f.saved != admin {
			t.Fatalf("admin=%t status=%d saved=%t", admin, response.Code, f.saved)
		}
	}
	f := &filterbarPreferenceFixture{mode: "own", order: `["style"]`, memory: "shared"}
	response := callUserFilterbarPreference(t, f, "GET", "", 42)
	var got userFilterbarPreference
	json.Unmarshal(response.Body.Bytes(), &got)
	if got.OrderMode != "shared" || len(got.SectionOrder) != 0 || f.mode != "own" {
		t.Fatalf("disabled policy must hide, preserve own order: %s", response.Body)
	}
	if callUserFilterbarPreference(t, f, "GET", "", 1).Code != 401 {
		t.Fatal("guest must not have an account preference")
	}
}

func TestUserFilterbarPreferenceRejectsInvalidSettings(t *testing.T) {
	for _, body := range []string{`{"order_mode":"dataset"}`, `{"visibility_memory":"always"}`, `{"section_order":["unknown"]}`, `{"section_order":["style","style"]}`, `{"section_order":[]}`, `{"user_id":99}`, `{"dataset":"other"}`, `{} {}`} {
		f := &filterbarPreferenceFixture{allow: true}
		response := callUserFilterbarPreference(t, f, "PATCH", body, 42)
		if response.Code != 400 || f.saved {
			t.Fatalf("%s accepted: %d", body, response.Code)
		}
	}
	f := &filterbarPreferenceFixture{allow: true}
	if callUserFilterbarPreference(t, f, "PATCH", `{"section_order":["style"]}`, 42).Code != 400 {
		t.Fatal("reordering must not silently choose own mode")
	}
}

func TestSharedFilterbarLayoutRejectsInvalidSettings(t *testing.T) {
	for _, body := range []string{`null`, `{"section_order":["unknown"]}`, `{"section_order":["style","style"]}`, `{"section_order":[]}`, `{"section_collapsed":{"other":true}}`, `{"allow_own_order":"yes"}`, `{"arbitrary":"value"}`, `{} {}`} {
		request := queryfixture.Request(t, "POST", "/api/filterbar-section-layout/save", body, 42, "user")
		response := httptest.NewRecorder()
		SaveFilterbarSectionLayoutHandler(response, request)
		if response.Code != 400 {
			t.Fatalf("%s status=%d", body, response.Code)
		}
	}
}

func TestSharedFilterbarOrderEditPreservesCollapseDefaultsAndPolicy(t *testing.T) {
	f := &filterbarPreferenceFixture{configJSON: `{"section_order":["style"],"section_collapsed":{"filters":true,"style":false},"allow_own_order":true}`}
	db := sql.OpenDB(f)
	defer db.Close()
	for _, body := range []string{`{"section_order":["views","style"]}`, `{"section_collapsed":{"style":null}}`} {
		request := queryfixture.Request(t, "POST", "/api/filterbar-section-layout/save", body, 42, "user")
		lazy := dbutils.NewLazyTx(db)
		response := httptest.NewRecorder()
		SaveFilterbarSectionLayoutHandler(response, request.WithContext(dbutils.SetLazyTx(request.Context(), lazy)))
		lazy.Rollback()
		if response.Code != 200 {
			t.Fatalf("save: %d %s", response.Code, response.Body)
		}
	}
	var got filterbarSectionLayoutConfig
	json.Unmarshal([]byte(f.configJSON), &got)
	if !got.AllowOwnOrder || !got.SectionCollapsed["filters"] || got.SectionOrder[0] != "views" {
		t.Fatalf("unrelated defaults overwritten: %s", f.configJSON)
	}
	if _, found := got.SectionCollapsed["style"]; found {
		t.Fatal("explicit null must restore an absent collapse default")
	}
}
