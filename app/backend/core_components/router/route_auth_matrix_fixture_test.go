// route_auth_matrix_fixture_test.go
// Supplies isolated PostgreSQL identities and rights for the real pipeline.
// Reuses the router's disposable cluster and bound-session test helpers.
// All SQL below is fixture setup in that owned cluster, never application data.
package router

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"
	"easelect/backend/pipeline"
	"easelect/backend/pipeline/audit"
	"easelect/backend/pipeline/rate_limiting"
)

type matrixFixture struct {
	db   *sql.DB
	csrf http.HandlerFunc
}

func matrixExec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func newMatrixFixture(t *testing.T, routes []RouteDefinition) *matrixFixture {
	t.Helper()
	db := routeIdentityDisposableDB(t)
	setupRootHandlerSessionStore(t)
	// matrixServeHTTP captures per-request diagnostics, redacts their details,
	// and rejects unknown messages instead of hiding infrastructure failures.
	oldPools := []*sql.DB{backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest, backend.DbConfidential, backend.DbReaderOnly, backend.DbLifecycle}
	backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest = db, db, db, db
	backend.DbConfidential, backend.DbReaderOnly, backend.DbLifecycle = db, db, db
	t.Cleanup(func() {
		// Drain while the matrix database is still installed. This cleanup was
		// registered after the disposable database's cleanup, so it runs first.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := audit.Flush(ctx); err != nil {
			t.Errorf("drain matrix audit events before restoring database: %v", err)
		}
		backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest = oldPools[0], oldPools[1], oldPools[2], oldPools[3]
		backend.DbConfidential, backend.DbReaderOnly, backend.DbLifecycle = oldPools[4], oldPools[5], oldPools[6]
	})
	matrixExec(t, db, `
 ALTER TABLE system_group_table_func_rights
   ADD COLUMN user_group_id integer, ADD COLUMN target_schema_name text,
   ADD COLUMN target_table_uid integer;
 CREATE TABLE system_users(id integer PRIMARY KEY, username text, enabled boolean, admin_access_allowed boolean);
 INSERT INTO system_users VALUES (1,'matrix_guest',true,false),(42,'matrix_user',true,false),(43,'matrix_admin',true,true);
 CREATE TABLE system_user_groups(id integer PRIMARY KEY,name text);
 INSERT INTO system_user_groups VALUES (1,'admins'),(2,'guests'),(3,'users');
 CREATE TABLE system_user_group_memberships(user_id integer,group_id integer);
 INSERT INTO system_user_group_memberships VALUES (1,2),(42,3),(43,1);
 CREATE SCHEMA restricted;
 CREATE TABLE restricted.users_restricted(id integer PRIMARY KEY, authentication_generation bigint,
   surviving_sign_in_id text, surviving_sign_in_generation bigint, api_only boolean);
 INSERT INTO restricted.users_restricted VALUES (42,1,NULL,NULL,false),(43,1,NULL,NULL,false);
 CREATE TABLE system_revoked_sign_ins(sign_in_id text PRIMARY KEY,expires_at timestamptz);
 CREATE TABLE system_config(key text PRIMARY KEY,boolean_value boolean,json_value jsonb);
 INSERT INTO system_config VALUES ('login_to_browse',true,NULL),('only_admin_can_login',false,NULL);
 CREATE TABLE matrix_dataset_a(id integer PRIMARY KEY);
 CREATE TABLE matrix_dataset_b(id integer PRIMARY KEY);
 CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY,table_name text,schema_name text);
 INSERT INTO system_db_tables VALUES (101,'matrix_dataset_a','public'),(102,'matrix_dataset_b','public');
 CREATE TABLE system_audit_log(created_at timestamptz,user_id integer,username text,handler_name text,
   http_method text,url_path text,table_name text,operation_type text,success boolean,ip_address text,duration_ms integer);
 `)
	matrixExec(t, db, `INSERT INTO system_config(key,json_value)
 VALUES($1,'{"limit_enabled":true,"limit_unit":"days","limit_amount":7}')`, sign_in_deadline.ConfigKey)
	// The matrix registers every function without a rate limit. rate_limiting caches limits per function name
	// process-wide, so forget them before and after the matrix: neither side may see the other's limits.
	rate_limiting.ResetRateLimitCache()
	t.Cleanup(rate_limiting.ResetRateLimitCache)
	// Generate function metadata from the registration defaults, not the oracle.
	// Admins use the product's real startup grant helpers. The separate update
	// capability belongs to real handlers in layer B, not these route grants.
	// Handler aliases retain the same function row.
	for _, route := range routes {
		matrixExec(t, db, `INSERT INTO system_functions(name,"package",disabled,specific_table_related,
 url_route_endpoint,rate_limit_amount,rate_limit_minutes,ui_only)
 VALUES($1,$2,false,$3,$4,0,20,false) ON CONFLICT(name) DO NOTHING`,
			route.HandlerName, getPackageNameFromHandler(route.HandlerName), defaultSpecificTableRelated(route.HandlerName), route.UrlPattern)
	}
	if err := backend.EnsureAdminPermissions(db); err != nil {
		t.Fatal(err)
	}
	if err := backend.EnsureAdminTablePermissions(db); err != nil {
		t.Fatal(err)
	}
	fixture := &matrixFixture{db: db}
	for _, route := range routes {
		if route.UrlPattern == "/api/csrf-token" {
			// Only provisioning invokes this real public handler; the matrix
			// request to the same route still goes to its named 200 stub.
			fixture.csrf = pipeline.BuildHandler(enforceRouteMethods(auth.CSRFTokenHandler, route.HandlerName,
				RouteMethodContract{Methods: route.Methods, Source: route.MethodSource}),
				pipeline.RouteContext{URLPattern: route.UrlPattern, HandlerName: route.HandlerName, DB: db}, pipeline.GetProfile(route.HandlerName))
		}
	}
	if fixture.csrf == nil {
		t.Fatal("real CSRF provisioning route missing")
	}
	return fixture
}

func (f *matrixFixture) setPersona(t *testing.T, persona string) {
	t.Helper()
	matrixExec(t, f.db, `UPDATE system_config SET boolean_value=$1 WHERE key='login_to_browse'`, persona != "guest")
}

func (f *matrixFixture) setGrant(t *testing.T, row matrixExpectation, grant string) {
	t.Helper()
	// Rights are isolated per cell. Admin route grants remain startup-owned.
	matrixExec(t, f.db, `DELETE FROM system_group_table_func_rights WHERE user_group_id IN (2,3)`)
	if grant == "nogrant" {
		return
	}
	var target any
	if row.Scoped {
		target = 101
	}
	matrixExec(t, f.db, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_schema_name,target_table_uid)
 SELECT g.id,f.id,'public',$2::integer FROM system_user_groups g CROSS JOIN system_functions f
 WHERE g.id IN (2,3) AND f.name=$1`, row.Handler, target)
}

func (f *matrixFixture) request(t *testing.T, row matrixExpectation, persona, grant, method string, csrf bool) *http.Request {
	t.Helper()
	request := httptest.NewRequest(method, matrixRequestPath(row, grant), strings.NewReader(`{}`))
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.RemoteAddr = "192.0.2.25:45000"
	// Anonymous and guest begin without cookies. Only unsafe requests obtain
	// an anonymous CSRF session; the auth stage alone chooses guest user 1.
	if persona == "user" || persona == "admin" {
		userID := 42
		if persona == "admin" {
			userID = 43
		}
		attachRootHandlerSessionUser(t, request, userID)
		session, err := e_sessions.Load(request)
		if err != nil {
			t.Fatal(err)
		}
		if err := auth_generation.Set(session, 1); err != nil {
			t.Fatal(err)
		}
		signInID, err := sign_in_revocation.NewSignInID()
		if err != nil {
			t.Fatal(err)
		}
		session.Values[sign_in_revocation.SessionKey] = signInID
		session.Values["authenticated"] = true
		role, err := backend.ResolveUserRole(userID)
		if err != nil {
			t.Fatal(err)
		}
		session.Values["user_role"] = role
		if err := sign_in_deadline.Stamp(context.Background(), f.db, session); err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		if err := e_sessions.Save(response, request, session); err != nil {
			t.Fatal(err)
		}
		matrixMergeCookies(request, response.Result().Cookies())
	}
	if matrixUnsafe(method) && csrf {
		provision := httptest.NewRequest(http.MethodGet, "/api/csrf-token", nil)
		provision.Header.Set("Accept", "application/json")
		matrixMergeCookies(provision, request.Cookies())
		response := matrixServeHTTP(f.csrf, provision)
		var body struct {
			CSRF string `json:"csrf_token"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != 200 || body.CSRF == "" || response.diagnostic != "" {
			t.Fatalf("CSRF provisioning failed: HTTP %d (%v); %s", response.Code, err, response.diagnostic)
		}
		matrixMergeCookies(request, response.Result().Cookies())
		request.Header.Set("X-CSRF-Token", body.CSRF)
	}
	// Session helpers cache decoded sessions on their request. Send a fresh
	// request so provisioning's new cookie is decoded just as on the wire.
	wireRequest := httptest.NewRequest(method, request.URL.String(), strings.NewReader(`{}`))
	wireRequest.Header = request.Header.Clone()
	wireRequest.RemoteAddr = request.RemoteAddr
	return wireRequest
}

// Last Set-Cookie wins, as in a browser; old signed session cookies must never
// shadow the generation stamp or CSRF session returned by provisioning.
func matrixMergeCookies(request *http.Request, cookies []*http.Cookie) {
	values := map[string]*http.Cookie{}
	for _, cookie := range request.Cookies() {
		values[cookie.Name] = cookie
	}
	for _, cookie := range cookies {
		values[cookie.Name] = cookie
	}
	request.Header.Del("Cookie")
	for _, cookie := range values {
		request.AddCookie(cookie)
	}
}

func TestRouteAuthorizationMatrixRequestPaths(t *testing.T) {
	row := matrixExpectation{Path: "/api/jobs/{id}/decisions", Scoped: true}
	if got := matrixRequestPath(row, "other_dataset"); got != "/api/jobs/1/decisions?dataset=matrix_dataset_b" {
		t.Fatal(fmt.Sprintf("wrong scoped path: %s", got))
	}
}
