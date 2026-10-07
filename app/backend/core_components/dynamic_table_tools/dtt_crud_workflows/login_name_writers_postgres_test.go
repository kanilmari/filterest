// login_name_writers_postgres_test.go
// Proves editor and add-row name refusals on the generated public bootstrap.
// Bridges the real entry points, trusted administrator guard and PostgreSQL constraints.
// Exists because a mapped synthetic error cannot prove the application reaches the rule.
package dtt_crud_workflows_test

import (
	"bytes"
	"context"
	"database/sql"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/dbutils"
	create "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/permissions"
	"easelect/backend/core_components/runtime_grants/granttest"
	sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"
	gorilla "github.com/gorilla/sessions"
)

func TestLoginNameEditorAndAddRowPostgres(t *testing.T) {
	db, _ := workflows.RegistrationDisposableDBForTest(t)
	workflows.LoadPublicBootstrapForTest(t, db)
	exec := func(t *testing.T, query string, args ...interface{}) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	oldDB, oldConf, oldAdmin := backend.Db, backend.DbConfidential, backend.DbAdmin
	oldStore, oldName := sessions.Store, sessions.SessionName
	backend.Db, backend.DbConfidential, backend.DbAdmin = db, db, db
	sessions.Store = gorilla.NewCookieStore([]byte("login-name-editor-test-session-secret"))
	sessions.SessionName = "login_name_editor"
	t.Cleanup(func() {
		backend.Db, backend.DbConfidential, backend.DbAdmin = oldDB, oldConf, oldAdmin
		sessions.Store, sessions.SessionName = oldStore, oldName
	})
	exec(t, `INSERT INTO system_users(id,username,enabled,admin_access_allowed) VALUES
        (91201,'admin_fixture_display',true,true),(91202,'ordinary_equal_name',true,false),
        (91203,'ordinary_display',true,false),(91204,'flag_only_display',true,true),
        (91205,'membership_only_display',true,false);
        INSERT INTO restricted.users_restricted(id,login_name,password,email,login_verification_method) VALUES
        (91201,'private_administrator_login','fixture','91201@example.invalid','none'),
        (91202,'ordinary_equal_name','fixture','91202@example.invalid','none'),
        (91203,'private_ordinary_login','fixture','91203@example.invalid','none'),
        (91204,'flag_only_login','fixture','91204@example.invalid','none'),
        (91205,'membership_only_login','fixture','91205@example.invalid','none');
        INSERT INTO system_user_group_memberships(user_id,group_id) VALUES
        (91201,1),(91202,2),(91203,2),(91204,2),(91205,1);
        UPDATE system_column_details SET editable_in_ui=true,insertable=true
        WHERE table_uid IN (SELECT table_uid FROM system_db_tables
        WHERE table_name IN ('system_users','system_user_group_memberships'))
		AND column_name IN ('username','user_id','group_id');
			UPDATE system_config SET boolean_value=false WHERE key='only_admin_can_login'`)
	// The foreign-key guard requires explicit dataset read rights before checking
	// row visibility. An administrator actor/flag/membership does not replace them.
	exec(t, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid,target_schema_name)
        SELECT 1,f.id,d.table_uid,'public' FROM system_functions f CROSS JOIN system_db_tables d
        WHERE f.url_route_endpoint='/api/get-results' AND f.disabled=false
          AND d.table_name IN ('system_users','system_user_groups')
          AND NOT EXISTS (SELECT 1 FROM system_group_table_func_rights r
              WHERE r.user_group_id=1 AND r.function_id=f.id AND r.target_table_uid=d.table_uid)`)
	// Check the exact prerequisites of the membership INSERT, using the same
	// actor and visibility readers as the handler, so a fixture fault is localized.
	visibilityTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer visibilityTx.Rollback()
	if err = dbutils.ApplyRequestActorToTx(visibilityTx, dbutils.NewRequestActorContext(91201, "admin")); err != nil {
		t.Fatal(err)
	}
	for _, reference := range []struct {
		table string
		id    int64
	}{{"system_users", 91202}, {"system_user_groups", 1}} {
		allowed, err := permissions.CheckRouteTablePermission(visibilityTx, "/api/get-results", 91201, permissions.RouteTableScope{TableName: reference.table}, permissions.StrictRouteTableOptions())
		if err != nil || !allowed {
			t.Fatalf("administrator fixture lacks foreign dataset read rights for %s: %v", reference.table, err)
		}
		visible, err := read.RowsVisibleForRead(visibilityTx, reference.table, "admin", 91201, []int64{reference.id})
		if err != nil || !visible {
			t.Fatalf("administrator fixture cannot read referenced %s row %d: %v", reference.table, reference.id, err)
		}
	}
	if err = visibilityTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	cookie := func(t *testing.T, id int) *http.Cookie {
		t.Helper()
		r := httptest.NewRequest("GET", "/", nil)
		session, err := sessions.GetOrCreateSession(nil, r)
		if err != nil {
			t.Fatal(err)
		}
		session.Values["user_id"], session.Values["authenticated"], session.Values["user_role"] = id, true, "admin"
		var generation int64
		if err = db.QueryRow(`SELECT authentication_generation FROM restricted.users_restricted WHERE id=$1`, id).Scan(&generation); err != nil {
			t.Fatal(err)
		}
		if err = auth_generation.Set(session, generation); err != nil {
			t.Fatal(err)
		}
		signInID, err := sign_in_revocation.NewSignInID()
		if err != nil {
			t.Fatal(err)
		}
		expiresAt, err := sign_in_deadline.Decide(context.Background(), db)
		if err != nil {
			t.Fatal(err)
		}
		session.Values[sign_in_revocation.SessionKey] = signInID
		session.Values[sign_in_deadline.SessionKey] = expiresAt
		w := httptest.NewRecorder()
		if err = sessions.Save(w, r, session); err != nil {
			t.Fatal(err)
		}
		return w.Result().Cookies()[0]
	}
	administrator := cookie(t, 91201)
	post := func(t *testing.T, table, body string, add bool, ownCookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		var request *http.Request
		if add {
			var buffer bytes.Buffer
			form := multipart.NewWriter(&buffer)
			if err := form.WriteField("jsonPayload", body); err != nil {
				t.Fatal(err)
			}
			if err := form.Close(); err != nil {
				t.Fatal(err)
			}
			request = httptest.NewRequest("POST", "/api/add-row-multipart", &buffer)
			request.Header.Set("Content-Type", form.FormDataContentType())
		} else {
			request = httptest.NewRequest("POST", "/api/update-row", strings.NewReader(body))
		}
		request.AddCookie(ownCookie)
		session, err := sessions.Load(request)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := session.Values["user_id"].(int)
		actor := dbutils.NewRequestActorContext(id, "basic")
		if id == 91201 {
			actor = dbutils.NewRequestActorContext(id, "admin")
		}
		// Foreign-key and row visibility use the same tx-local actor as real middleware.
		request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), actor))
		lazy := dbutils.NewLazyTxWithBeginHook(db, func(tx *sql.Tx) error { return dbutils.ApplyRequestActorToTx(tx, actor) })
		request = request.WithContext(dbutils.SetLazyTx(request.Context(), lazy))
		response := httptest.NewRecorder()
		recorder := granttest.Recorder{ResponseRecorder: response}
		if add {
			create.AddRowMultipartHandler(recorder, request, table)
		} else {
			update.UpdateRowHandler(recorder, request, table)
		}
		if response.Code >= 400 {
			_ = lazy.Rollback()
		} else if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
		return response
	}
	refusal := func(t *testing.T, response *httptest.ResponseRecorder, key string) {
		t.Helper()
		if response.Code != 409 || !strings.Contains(response.Body.String(), key) {
			t.Fatalf("refusal=%d %s", response.Code, response.Body.String())
		}
		for _, name := range []string{"private_administrator_login", "private_ordinary_login", "ordinary_equal_name", "admin_fixture_display"} {
			if strings.Contains(response.Body.String(), name) {
				t.Fatal("name leaked in refusal")
			}
		}
	}
	snapshot := func(t *testing.T) string {
		t.Helper()
		var result string
		if err := db.QueryRow(`SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM system_users u),'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM system_user_group_memberships m))::text`).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	t.Run("LT4 administrator name and case-insensitive duplicate", func(t *testing.T) {
		before := snapshot(t)
		refusal(t, post(t, "system_users", `{"id":91201,"column":"username","value":"private_administrator_login"}`, false, administrator), "error_admin_display_name_equals_login_name")
		refusal(t, post(t, "system_users", `{"id":91203,"column":"username","value":"ORDINARY_EQUAL_NAME"}`, false, administrator), "username_exists")
		refusal(t, post(t, "system_users", `{"username":"ORDINARY_EQUAL_NAME"}`, true, administrator), "username_exists")
		refusal(t, post(t, "system_user_group_memberships", `{"user_id":91202,"group_id":1}`, true, administrator), "error_admin_display_name_equals_login_name")
		if after := snapshot(t); after != before {
			t.Fatal("refused editor/add-row left writes")
		}
	})
	t.Run("LT4 K205 each setting and unchanged pair", func(t *testing.T) {
		for _, allow := range []bool{false, true} {
			exec(t, `UPDATE system_users SET username='ordinary_display' WHERE id=91203`)
			exec(t, `UPDATE system_config SET boolean_value=$1 WHERE key='display_name_may_equal_login_name'`, allow)
			response := post(t, "system_users", `{"id":91203,"column":"username","value":"private_ordinary_login"}`, false, administrator)
			if allow {
				if response.Code != 200 {
					t.Fatalf("allowed=%d %s", response.Code, response.Body.String())
				}
			} else {
				refusal(t, response, "error_user_display_name_equals_login_name")
			}
			response = post(t, "system_users", `{"id":91202,"column":"username","value":"ordinary_equal_name"}`, false, administrator)
			if response.Code != 200 {
				t.Fatalf("unchanged equal pair=%d %s", response.Code, response.Body.String())
			}
		}
	})
	t.Run("LT5 authoritative administrator requires flag and membership", func(t *testing.T) {
		before := snapshot(t)
		for _, id := range []int{91202, 91204, 91205} {
			for _, add := range []bool{false, true} {
				response := post(t, "system_users", `{"id":91203,"column":"username","value":"attempt","username":"attempt"}`, add, cookie(t, id))
				if response.Code != 403 || !strings.Contains(response.Body.String(), "error_identity_edit_requires_administrator") {
					t.Fatalf("guard=%d %s", response.Code, response.Body.String())
				}
			}
		}
		if after := snapshot(t); after != before {
			t.Fatal("untrusted editor left writes")
		}
	})
}
