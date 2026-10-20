// page_view_access_test.go
// Proves Page's canonical dataset boundary runs before any row or projection work.
// Connects real GetResults/session handling to a permission-only database driver.
// Guards same-dataset grants, legacy views and the existing development recovery rule.
package dtt_1_row_read

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

type pagePermissionState struct {
	dataset               string // the dataset a table-scoped Page grant names ("" = none)
	global                bool   // a global (NULL-target) Page grant exists
	related               bool   // the Page catalogue row is dataset-specific
	fail, admin, disabled bool
	queries               int
}
type pagePermissionDriver struct{ state *pagePermissionState }
type pagePermissionConn struct{ state *pagePermissionState }
type pagePermissionRows struct {
	value    driver.Value
	ok, read bool
}

func (d pagePermissionDriver) Open(string) (driver.Conn, error) {
	return pagePermissionConn{d.state}, nil
}
func (c pagePermissionConn) Close() error { return nil }
func (c pagePermissionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected projection/row prepare")
}
func (c pagePermissionConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected row transaction")
}
func (r *pagePermissionRows) Columns() []string { return []string{"value"} }
func (r *pagePermissionRows) Close() error      { return nil }
func (r *pagePermissionRows) Next(dest []driver.Value) error {
	if r.read || !r.ok {
		return io.EOF
	}
	r.read = true
	dest[0] = r.value
	return nil
}
func (c pagePermissionConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.queries++
	if strings.Contains(query, "FROM system_group_table_func_rights") {
		if args[0].Value != "/ui/view/image_first_page_view" || args[1].Value != int64(42) {
			return nil, fmt.Errorf("wrong Page route or user: %v", args)
		}
		if c.state.fail {
			return nil, errors.New("permission lookup failed")
		}
		// The canonical scope: a dataset-specific route names the dataset; a tableless one asks for a global grant.
		if c.state.related {
			if len(args) != 3 || args[2].Value != "fixture" || !strings.Contains(query, "sdt.table_name = $3") {
				return nil, fmt.Errorf("wrong dataset-specific Page scope: %v", args)
			}
			return &pagePermissionRows{value: int64(1), ok: c.state.dataset == "fixture"}, nil
		}
		if len(args) != 2 || !strings.Contains(query, "target_table_uid IS NULL") {
			return nil, fmt.Errorf("wrong tableless Page scope: %v %s", args, query)
		}
		return &pagePermissionRows{value: int64(1), ok: c.state.global}, nil
	}
	if strings.Contains(query, "FROM system_functions WHERE") {
		return &pagePermissionRows{value: c.state.related, ok: !c.state.disabled}, nil
	}
	if strings.Contains(query, "group_id = 1") {
		return &pagePermissionRows{value: int64(1), ok: c.state.admin}, nil
	}
	return nil, errors.New("row/projection query before Page check")
}
func pagePermissionDB(t *testing.T, state *pagePermissionState) {
	t.Helper()
	name := fmt.Sprintf("page_permission_%d", uiReadDriverID.Add(1))
	sql.Register(name, pagePermissionDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { db.Close(); backend.Db = old })
}
func pageResultRequest(t *testing.T) *http.Request {
	t.Helper()
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store = sessions.NewCookieStore([]byte("page-view-access-test-cookie-signing"))
	e_sessions.SessionName = "session"
	t.Cleanup(func() { e_sessions.Store = oldStore; e_sessions.SessionName = oldName })
	req := httptest.NewRequest("GET", "/api/get-results?dataset=fixture&id=987654321&view_key=%20IMAGE_FIRST_PAGE_VIEW%20", nil)
	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = 42
	session.Values["user_role"] = "basic"
	response := httptest.NewRecorder()
	if err := session.Save(req, response); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range response.Result().Cookies() {
		req.AddCookie(cookie)
	}
	return req
}

// F1 (20.10.): the Page right uses its catalogue's own scope, like the route pipeline and Home visibility.
// Production's Page function is tableless and granted globally (target NULL); a forced dataset scope denied
// everyone there. A dataset-specific catalogue row still counts only that dataset's grant.
func TestPageViewAccessCanonicalDatasetScope(t *testing.T) {
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "")
	for _, test := range []struct {
		name    string
		state   pagePermissionState
		allowed bool
	}{
		{"tableless/no grant", pagePermissionState{}, false},
		{"tableless/global grant", pagePermissionState{global: true}, true},
		{"tableless/dataset grant only", pagePermissionState{dataset: "fixture"}, false},
		{"related/same dataset", pagePermissionState{related: true, dataset: "fixture"}, true},
		{"related/another dataset", pagePermissionState{related: true, dataset: "another_dataset"}, false},
		{"related/global only", pagePermissionState{related: true, global: true}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := test.state
			pagePermissionDB(t, &state)
			response := httptest.NewRecorder()
			allowed := allowResultsPresentationRead(response, "fixture", 42, normalizeResultsViewKey(" IMAGE_FIRST_PAGE_VIEW "))
			if allowed != test.allowed || state.queries != 2 {
				t.Fatal(allowed, state.queries)
			}
			if !allowed && (response.Code != 403 || response.Body.String() != `{"error":"403 - Forbidden (single table)","code":403}`+"\n") {
				t.Fatal(response.Code, response.Body.String())
			}
		})
	}
}
func TestPageViewGetResultsDeniesBeforeRowsProjectionAndLogs(t *testing.T) {
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "")
	state := &pagePermissionState{related: true, dataset: "another_dataset"}
	pagePermissionDB(t, state)
	request := pageResultRequest(t)
	var logs bytes.Buffer
	oldLog := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(oldLog) })
	response := httptest.NewRecorder()
	GetResults(response, request)
	if response.Code != 403 || state.queries != 2 || strings.Contains(response.Body.String(), "987654321") || strings.Contains(logs.String(), "987654321") {
		t.Fatal(response.Code, state.queries, response.Body.String(), logs.String())
	}
}
func TestPageViewOtherKeysKeepExistingBoundary(t *testing.T) {
	for _, key := range []string{"", "table", "card", "article", "article_view", "image_first_view", "map", "product_card"} {
		if !allowResultsPresentationRead(httptest.NewRecorder(), "fixture", 42, normalizeResultsViewKey(key)) {
			t.Fatal(key)
		}
	}
}
func TestPageViewAdministratorRecoveryMatchesRowRoute(t *testing.T) {
	for _, test := range []struct {
		environment, mode string
		admin, fail, want bool
	}{
		{"dev", "1", true, false, true}, {"dev", "", true, false, false}, {"prod", "1", true, false, false},
		{"dev", "1", false, false, false}, {"dev", "1", true, true, false},
	} {
		t.Run(fmt.Sprint(test), func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", test.environment)
			t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", test.mode)
			pagePermissionDB(t, &pagePermissionState{admin: test.admin, fail: test.fail})
			if got := allowResultsPresentationRead(httptest.NewRecorder(), "fixture", 42, "image_first_page_view"); got != test.want {
				t.Fatal(got, test)
			}
		})
	}
}

func TestPageViewRecoveryDoesNotReviveDisabledFunction(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "1")
	pagePermissionDB(t, &pagePermissionState{admin: true, disabled: true})
	if allowResultsPresentationRead(httptest.NewRecorder(), "fixture", 42, "image_first_page_view") {
		t.Fatal("recovery revived a disabled or unregistered Page route")
	}
}
