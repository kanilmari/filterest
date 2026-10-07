// login_name_postgres_test.go
// Verifies the real account handlers on a disposable pre-upgrade PostgreSQL fixture.
// Bridges historical bootstrap, K1, sign-in, profile, registration, recovery and OTP.
// Exists because mocks cannot prove account constraints, rollback or session generations.
package auth

import (
	"context"
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth/credentials"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"fmt"
	_ "github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const loginFixturePassword = "disposable-correct-password-123"

func loginNameDisposableCluster(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for disposable PostgreSQL handler proofs")
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	root := t.TempDir()
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "pgdata")
	run := func(name string, args ...string) {
		t.Helper()
		if out, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			if name == "pg_ctl" {
				// pg_ctl hides the server's startup error in this separate log.
				serverLog, _ := os.ReadFile(filepath.Join(root, "postgres.log"))
				out = append(out, serverLog...)
			}
			if strings.Contains(string(out), "Operation not permitted") {
				t.Skip("sandbox cannot start disposable PostgreSQL")
			}
			t.Fatalf("%s failed: %v %s", name, err, out)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", fmt.Sprintf("-h '' -k '%s' -p 55132", socket), "-w", "start")
	dsn := fmt.Sprintf("host=%s port=55132 user=test_owner dbname=postgres sslmode=disable", socket)
	owner, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	if _, err = owner.Exec(`CREATE DATABASE login_name_disposable`); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("postgres", strings.Replace(dsn, "dbname=postgres", "dbname=login_name_disposable", 1))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	app := filepath.Join("..", "..", "..")
	schema, err := os.ReadFile(filepath.Join(app, "server_tools/versioning/schema_snapshots/db-9.9.2.sql"))
	if err != nil {
		t.Fatal(err)
	}
	seed, err := exec.Command("git", "show", "ec288eb:app/server_tools/public_bootstrap/seed_data.sql").Output()
	if err != nil {
		t.Fatal(err)
	}
	for _, sqlText := range []string{string(schema), string(seed)} {
		if _, err = db.Exec(sqlText); err != nil {
			t.Fatal(err)
		}
	}
	paths, err := filepath.Glob(filepath.Join(app, "server_tools/migrations/202610050000*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		if filepath.Base(path) >= "20261005000011" {
			break
		}
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(string(body)); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(loginFixturePassword), bcrypt.DefaultCost)
	if _, err = db.Exec(`INSERT INTO system_users(id,username,enabled,admin_access_allowed) VALUES(91001,'former_admin_login',true,true),(91002,'ordinary_login',true,false),(91003,'disabled_login',false,false),(91004,'other_login',true,false); INSERT INTO system_user_group_memberships(user_id,group_id) VALUES(91001,1),(91002,2),(91003,2),(91004,2)`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO restricted.users_restricted(id,password,email,login_verification_method) SELECT id,$1,id||'@example.invalid','none' FROM system_users WHERE id BETWEEN 91001 AND 91004`, string(hash)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"20261005000011_separate_login_names.sql", "20261005000013_seed_login_name_keys.sql", "20261005000014_add_password_reset_dummy_work.sql"} {
		body, err := os.ReadFile(filepath.Join(app, "server_tools/migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(string(body)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(`UPDATE system_config SET boolean_value=false WHERE key='only_admin_can_login'; UPDATE system_config SET text_value='Disposable site' WHERE key='site_name'; UPDATE system_config SET text_value='filterest_sibling' WHERE key='instance_kind'; UPDATE system_config SET boolean_value=true WHERE key='overwrite_possible'`); err != nil {
		t.Fatal(err)
	}
	old, conf, admin, guest := backend.Db, backend.DbConfidential, backend.DbAdmin, backend.DbGuest
	backend.Db, backend.DbConfidential, backend.DbAdmin, backend.DbGuest = db, db, db, db
	t.Cleanup(func() { backend.Db, backend.DbConfidential, backend.DbAdmin, backend.DbGuest = old, conf, admin, guest })
	oldFrontend := frontend_dir
	frontend_dir = filepath.Join(app, "frontend")
	t.Cleanup(func() { frontend_dir = oldFrontend })
	prepareLoginHandlerSessionStore(t)
	t.Setenv("SESSION_KEY", "disposable-login-handler-signing-key")
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	return db
}

func postgresLogin(t *testing.T, name, password string) *httptest.ResponseRecorder {
	t.Helper()
	cookie := seedSessionCookie(t, map[interface{}]interface{}{"csrf_token": "postgres-csrf", "username": "retired-login-canary"})
	payload, _ := json.Marshal(map[string]string{"username": name, "password": password, "fingerprint": "browser-fixture", "csrf_token": "postgres-csrf"})
	r := httptest.NewRequest("POST", "/api/login", strings.NewReader(string(payload)))
	r.AddCookie(cookie)
	r.Header.Set("Content-Type", "application/json")
	r.RemoteAddr = "192.0.2.211:1234"
	w := httptest.NewRecorder()
	LoginAPIHandler(w, r)
	return w
}

func postgresOwnCookie(t *testing.T, id int) *http.Cookie {
	t.Helper()
	r := httptest.NewRequest("GET", "/", nil)
	session, err := sessions.GetOrCreateSession(nil, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = setAuthenticatedSessionIdentity(session, id); err != nil {
		t.Fatal(err)
	}
	session.Values["csrf_token"] = "postgres-csrf"
	w := httptest.NewRecorder()
	if err = sessions.Save(w, r, session); err != nil {
		t.Fatal(err)
	}
	return w.Result().Cookies()[0]
}

func postgresProfile(t *testing.T, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("POST", "/api/update-profile", strings.NewReader(body))
	r.AddCookie(cookie)
	r.Header.Set("X-CSRF-Token", "postgres-csrf")
	w := httptest.NewRecorder()
	UserProfileUpdateHandler(w, r)
	return w
}

func latestPostgresCookie(t *testing.T, w *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	if cookie := issuedPostgresCookie(w); cookie != nil {
		return cookie
	}
	t.Fatal("no saved current session")
	return nil
}

// issuedPostgresCookie returns the session cookie a response issued, or nil when it kept the browser's cookie.
func issuedPostgresCookie(w *httptest.ResponseRecorder) *http.Cookie {
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == sessions.SessionName && cookie.MaxAge >= 0 {
			return cookie
		}
	}
	return nil
}

func TestLoginNamePostgresHandlers(t *testing.T) {
	db := loginNameDisposableCluster(t)
	t.Run("LT1 former administrator name and case", func(t *testing.T) {
		var display, login string
		if err := db.QueryRow(`SELECT u.username,ur.login_name FROM system_users u JOIN restricted.users_restricted ur ON ur.id=u.id WHERE u.id=91001`).Scan(&display, &login); err != nil {
			t.Fatal(err)
		}
		if login != "former_admin_login" || display == login {
			t.Fatalf("migration result=%s/%s", display, login)
		}
		for _, name := range []string{"FORMER_ADMIN_LOGIN", display} {
			w := postgresLogin(t, name, loginFixturePassword)
			want := 200
			if name == display {
				want = 401
			}
			if w.Code != want {
				t.Fatalf("sign-in=%d %s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "former_admin_login") {
				t.Fatal("private name in response")
			}
		}
		w := postgresLogin(t, "ORDINARY_LOGIN", loginFixturePassword)
		if w.Code != 200 {
			t.Fatalf("ordinary=%d %s", w.Code, w.Body.String())
		}
		for _, cookie := range w.Result().Cookies() {
			if cookie.Name != sessions.SessionName || cookie.MaxAge < 0 {
				continue
			}
			r := httptest.NewRequest("GET", "/", nil)
			r.AddCookie(cookie)
			decoded, err := sessions.Load(r)
			if err != nil {
				t.Fatal(err)
			}
			for _, key := range sessions.RetiredSessionKeys {
				if _, ok := decoded.Values[key]; ok {
					t.Fatalf("retired key %s persisted", key)
				}
			}
		}
	})
	t.Run("LT6 K203 and login-name change under both choices", func(t *testing.T) {
		for _, allow := range []bool{true, false} {
			if _, err := db.Exec(`DELETE FROM restricted.otp_send_events WHERE user_id=91002 AND purpose='profile_current_password'`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`UPDATE system_config SET boolean_value=$1 WHERE key='display_name_may_equal_login_name'`, allow); err != nil {
				t.Fatal(err)
			}
			first, other := postgresOwnCookie(t, 91002), postgresOwnCookie(t, 91002)
			unrelated := postgresOwnCookie(t, 91004)
			for _, password := range []string{"", "wrong"} {
				w := postgresProfile(t, first, `{"sign_out_other_devices":true,"current_password":"`+password+`"}`)
				if w.Code != 400 {
					t.Fatalf("wrong password=%d %s", w.Code, w.Body.String())
				}
			}
			w := postgresProfile(t, first, `{"sign_out_other_devices":true,"user_id":91004,"current_password":"`+loginFixturePassword+`"}`)
			if w.Code != 200 {
				t.Fatalf("sign-out=%d %s", w.Code, w.Body.String())
			}
			check := httptest.NewRequest("GET", "/", nil)
			check.AddCookie(unrelated)
			unrelatedSession, _ := sessions.Load(check)
			if valid, err := backend.AuthenticatedSessionMatches(context.Background(), db, unrelatedSession, 91004); err != nil || !valid {
				t.Fatal("submitted id ended another account's sign-in")
			}
			current := latestPostgresCookie(t, w)
			csrfRequest := httptest.NewRequest("POST", "/api/sign-out-other-devices", strings.NewReader(`{"current_password":"`+loginFixturePassword+`"}`))
			csrfRequest.AddCookie(current)
			csrfResponse := httptest.NewRecorder()
			SignOutOtherDevicesHandler(csrfResponse, csrfRequest)
			if csrfResponse.Code != 403 {
				t.Fatal("device revocation accepted no CSRF proof")
			}
			for _, test := range []struct {
				cookie *http.Cookie
				valid  bool
			}{{current, true}, {other, false}} {
				r := httptest.NewRequest("GET", "/", nil)
				r.AddCookie(test.cookie)
				session, err := sessions.Load(r)
				if err != nil {
					t.Fatal(err)
				}
				valid, err := backend.AuthenticatedSessionMatches(context.Background(), db, session, 91002)
				if err != nil || valid != test.valid {
					t.Fatalf("generation matches=%v err=%v", valid, err)
				}
			}
			if _, err := db.Exec(`DELETE FROM restricted.otp_send_events WHERE user_id=91002 AND purpose='login_name_change'`); err != nil {
				t.Fatal(err)
			}
			// Wrong password, reserved name and a successful change each consume one account attempt.
			for index, body := range []string{
				`{"login_name":"changed-private","current_password":"wrong"}`,
				`{"login_name":"admin_7","current_password":"` + loginFixturePassword + `"}`,
				`{"login_name":"ordinary-renamed","current_password":"` + loginFixturePassword + `"}`,
				`{"login_name":"another-private","current_password":"` + loginFixturePassword + `"}`,
			} {
				w = postgresProfile(t, current, body)
				want := []int{400, 409, 200, 429}[index]
				if w.Code != want {
					t.Fatalf("attempt %d=%d %s", index, w.Code, w.Body.String())
				}
				if index == 2 {
					current = latestPostgresCookie(t, w)
				}
			}
			equal := postgresProfile(t, current, `{"username":"ordinary-renamed","current_password":"`+loginFixturePassword+`"}`)
			want := 200
			if !allow {
				want = 409
			}
			if equal.Code != want {
				t.Fatalf("equal pair setting=%v status=%d %s", allow, equal.Code, equal.Body.String())
			}
			// Restore a distinct display name before the second choice is tested.
			if _, err := db.Exec(`UPDATE system_users SET username='ordinary_display' WHERE id=91002`); err != nil {
				t.Fatal(err)
			}
		}
	})
	t.Run("LT5 public fields allow-list and guest", func(t *testing.T) {
		cookie := postgresOwnCookie(t, 91002)
		w := postgresProfile(t, cookie, `{"website":"https://example.invalid","bio_social_medias":"Biography","id":91004,"admin_access_allowed":true,"privileged":true}`)
		if w.Code != 200 {
			t.Fatalf("public fields=%d %s", w.Code, w.Body.String())
		}
		var website, bio string
		var admin bool
		if err := db.QueryRow(`SELECT website,bio_social_medias,admin_access_allowed FROM system_users WHERE id=91002`).Scan(&website, &bio, &admin); err != nil {
			t.Fatal(err)
		}
		if website != "https://example.invalid" || bio != "Biography" || admin {
			t.Fatal("profile allow-list failed")
		}
		request := httptest.NewRequest("GET", "/api/user-profile", nil)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		UserProfileFetchHandler(response, request)
		if response.Code != 200 || !strings.Contains(response.Body.String(), "Biography") || strings.Contains(response.Body.String(), "ordinary-renamed") {
			t.Fatal(response.Body.String())
		}
		guest := seedSessionCookie(t, map[interface{}]interface{}{"user_id": 1, "csrf_token": "postgres-csrf"})
		w = postgresProfile(t, guest, `{"website":"forged"}`)
		if w.Code != 401 {
			t.Fatal("guest profile write allowed")
		}
	})
	t.Run("LT4 administrator profile, promotion and change", func(t *testing.T) {
		cookie := postgresOwnCookie(t, 91001)
		w := postgresProfile(t, cookie, `{"username":"FORMER_ADMIN_LOGIN","website":"must-rollback","current_password":"`+loginFixturePassword+`"}`)
		if w.Code != 409 || !strings.Contains(w.Body.String(), "error_admin_display_name_equals_login_name") {
			t.Fatalf("admin profile=%d %s", w.Code, w.Body.String())
		}
		if _, err := db.Exec(`UPDATE system_users SET username='chosen_administrator_display' WHERE id=91001`); err != nil {
			t.Fatal(err)
		}
		var display string
		if err := db.QueryRow(`SELECT username FROM system_users WHERE id=91001`).Scan(&display); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`DELETE FROM restricted.otp_send_events WHERE user_id=91001`); err != nil {
			t.Fatal(err)
		}
		w = postgresProfile(t, cookie, `{"login_name":"`+display+`","current_password":"`+loginFixturePassword+`"}`)
		if w.Code != 409 {
			t.Fatalf("admin change=%d %s", w.Code, w.Body.String())
		}
		// A membership-based promotion must be rejected with equal names by the database rule.
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(`INSERT INTO system_user_group_memberships(user_id,group_id) VALUES(91004,1)`)
		refusal := httpresponseAccountRefusal(err)
		if refusal != "error_admin_display_name_equals_login_name" {
			t.Fatalf("membership error=%v", err)
		}
		_ = tx.Rollback()
	})
	t.Run("LT6 registration rollback and both taken names", func(t *testing.T) {
		hash, _ := bcrypt.GenerateFromPassword([]byte(loginFixturePassword), bcrypt.DefaultCost)
		for _, allow := range []bool{true, false} {
			_, err := db.Exec(`UPDATE system_config SET boolean_value=$1 WHERE key='display_name_may_equal_login_name'`, allow)
			if err != nil {
				t.Fatal(err)
			}
			name := fmt.Sprintf("registration_equal_%v", allow)
			id, err := createRegisteredAccount(context.Background(), name, name, "", name+"@example.invalid", string(hash), "", verificationNone, true)
			if allow && err != nil {
				t.Fatal(err)
			}
			if !allow && httpresponseAccountRefusal(err) != "error_user_display_name_equals_login_name" {
				t.Fatalf("K205 false=%v", err)
			}
			var count int
			_ = db.QueryRow(`SELECT count(*) FROM system_users WHERE username=$1`, name).Scan(&count)
			if !allow && count != 0 {
				t.Fatal("half registration committed")
			}
			if allow && id <= 1 {
				t.Fatal("no registered account")
			}
		}
		var takenLogin, takenDisplay string
		if err := db.QueryRow(`SELECT ur.login_name,u.username FROM system_users u JOIN restricted.users_restricted ur USING(id) WHERE u.id=91002`).Scan(&takenLogin, &takenDisplay); err != nil {
			t.Fatal(err)
		}
		for _, test := range []struct{ login, display, key string }{{strings.ToUpper(takenLogin), "unique_display", "login_name_exists"}, {"unique_login", strings.ToUpper(takenDisplay), "username_exists"}, {"auto_2", "another_display", "login_name_reserved"}} {
			_, err := createRegisteredAccount(context.Background(), test.login, test.display, "", "unused@example.invalid", string(hash), "", verificationNone, true)
			if httpresponseAccountRefusal(err) != test.key {
				t.Fatalf("taken error=%v", err)
			}
		}
		// Force the last membership step to fail: both prior inserts must roll back.
		if _, err := db.Exec(`CREATE FUNCTION public.test_registration_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id NOT IN (91001,91002,91003,91004) THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_registration_fail BEFORE INSERT ON system_user_group_memberships FOR EACH ROW EXECUTE FUNCTION public.test_registration_fail()`); err != nil {
			t.Fatal(err)
		}
		_, err := createRegisteredAccount(context.Background(), "forced_rollback", "forced_display", "", "forced@example.invalid", string(hash), "", verificationNone, true)
		if err == nil {
			t.Fatal("forced failure succeeded")
		}
		var count int
		_ = db.QueryRow(`SELECT count(*) FROM system_users WHERE username='forced_display'`).Scan(&count)
		if count != 0 {
			t.Fatal("half account")
		}
		_, _ = db.Exec(`DROP TRIGGER test_registration_fail ON system_user_group_memberships; DROP FUNCTION test_registration_fail()`)
	})
	t.Run("LT6 fixed accounts and name-free audit", func(t *testing.T) {
		if _, err := db.Exec(`UPDATE restricted.users_restricted SET api_only=true WHERE id=91004`); err != nil {
			t.Fatal(err)
		}
		tx, _ := db.Begin()
		_, err := credentials.ChangeLoginName(tx, 91004, "new_program_name")
		if httpresponseAccountRefusal(err) != "login_name_fixed" {
			t.Fatalf("fixed account=%v", err)
		}
		_ = tx.Rollback()
		var audit string
		_ = db.QueryRow(`SELECT COALESCE(string_agg(details::text,' '),'') FROM system_audit_log WHERE handler_name='account.security'`).Scan(&audit)
		for _, name := range []string{"ordinary-renamed", "former_admin_login", "changed-private"} {
			if strings.Contains(audit, name) {
				t.Fatal("private name in audit")
			}
		}
	})
	t.Run("LT8 promotion allocates display before granting administrator access", func(t *testing.T) {
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		request := httptest.NewRequest("POST", "/api/admin/user-authentication", strings.NewReader(`{"user_id":91004,"verification_method":"none"}`))
		request = request.WithContext(dbutils.SetTx(request.Context(), tx))
		// Use an ordinary equal-name account, after removing the fixed-account test marker.
		if _, err = db.Exec(`UPDATE restricted.users_restricted SET api_only=false WHERE id=91004`); err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		provisionAdminUserAuthentication(response, request)
		if response.Code != 200 || strings.Contains(response.Body.String(), "other_login") || !strings.Contains(response.Body.String(), "admin_") {
			t.Fatalf("promotion=%d %s", response.Code, response.Body.String())
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("LT6 administrator route and operator recovery", func(t *testing.T) {
		administrator := postgresOwnCookie(t, 91001)
		var before, after string
		snapshot := `SELECT to_jsonb(ur)::text FROM restricted.users_restricted ur WHERE id=91001`
		if err := db.QueryRow(snapshot).Scan(&before); err != nil {
			t.Fatal(err)
		}
		selfRequest := httptest.NewRequest("POST", "/api/admin/user-login-name", strings.NewReader(`{"user_id":91001,"login_name":"self-bypass"}`))
		selfRequest.AddCookie(administrator)
		selfRequest.Header.Set("X-CSRF-Token", "postgres-csrf")
		selfResponse := httptest.NewRecorder()
		AdminUserLoginNameHandler(selfResponse, selfRequest)
		if selfResponse.Code != 400 || !strings.Contains(selfResponse.Body.String(), "login_name_change_use_profile") {
			t.Fatal("self-target accepted", selfResponse.Code, selfResponse.Body.String())
		}
		if err := db.QueryRow(snapshot).Scan(&after); err != nil || after != before {
			t.Fatal("self-target changed credentials", err)
		}
		oldTarget := postgresOwnCookie(t, 91004)
		request := httptest.NewRequest("POST", "/api/admin/user-login-name", strings.NewReader(`{"user_id":91004,"login_name":"administrator_selected_login"}`))
		request.AddCookie(administrator)
		request.Header.Set("X-CSRF-Token", "postgres-csrf")
		response := httptest.NewRecorder()
		AdminUserLoginNameHandler(response, request)
		if response.Code != 200 || !strings.Contains(response.Body.String(), "notice_email_not_configured") || strings.Contains(response.Body.String(), "administrator_selected_login") {
			t.Fatalf("administrator change=%d %s", response.Code, response.Body.String())
		}
		check := httptest.NewRequest("GET", "/", nil)
		check.AddCookie(oldTarget)
		session, _ := sessions.Load(check)
		if valid, err := backend.AuthenticatedSessionMatches(context.Background(), db, session, 91004); err != nil || valid {
			t.Fatal("target's old sign-in survived administrator change")
		}
		editor := credentials.NewRecoveryEditor(db)
		identity, err := editor.ReadInstanceIdentity(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		var generation int64
		if err = db.QueryRow(`SELECT authentication_generation FROM restricted.users_restricted WHERE id=91001`).Scan(&generation); err != nil {
			t.Fatal(err)
		}
		recovered, err := editor.RecoverAdministrator(context.Background(), credentials.RecoveryInput{UserID: 91001, NewLoginName: "operator_recovered_login", NewPassword: loginFixturePassword, VerificationMethod: credentials.VerificationNone, AllowPasswordOnly: true, ExpectedAuthenticationGeneration: generation, ExpectedVerificationMethod: credentials.VerificationNone, TargetIdentity: identity})
		if err != nil || recovered.AuthenticationGeneration != generation+1 || recovered.MailStatus != "notice_email_not_configured" {
			t.Fatalf("recovery=%+v %v", recovered, err)
		}
	})
	t.Run("LT6 welcome delivery follows commit and reports failure", func(t *testing.T) {
		oldEnabled := registrationEnabledFunc
		registrationEnabledFunc = func() bool { return true }
		defer func() { registrationEnabledFunc = oldEnabled }()
		oldTransport := http.DefaultTransport
		defer func() { http.DefaultTransport = oldTransport }()
		t.Setenv("POSTMARK_API_KEY", "disposable-postmark-token")
		t.Setenv("EMAIL_FROM_ADDRESS", "sender@example.invalid")
		http.DefaultTransport = loginNoticeRoundTrip(func(request *http.Request) (*http.Response, error) {
			var message map[string]interface{}
			if err := json.NewDecoder(request.Body).Decode(&message); err != nil {
				t.Fatal(err)
			}
			var committed bool
			if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE email=$1)`, message["To"]).Scan(&committed); err != nil || !committed {
				t.Fatal("welcome mail preceded commit")
			}
			return &http.Response{StatusCode: 422, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"ErrorCode":400,"Message":"provider echoed private login"}`))}, nil
		})
		cookie := seedSessionCookie(t, map[interface{}]interface{}{"csrf_token": "postgres-csrf"})
		form := url.Values{"username": {"mail_login"}, "display_name": {"mail_display"}, "password": {loginFixturePassword}, "email": {"mail@example.invalid"}, "verification_method": {"none"}, "csrf_token": {"postgres-csrf"}}
		request := httptest.NewRequest("POST", "/api/register_ndYOyXV0INOK3F", strings.NewReader(form.Encode()))
		request.AddCookie(cookie)
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		request.Header.Set("Accept", "application/json")
		response := httptest.NewRecorder()
		RegisterAPIHandler(response, request)
		if response.Code != 200 || !strings.Contains(response.Body.String(), "registration_email_failed") || strings.Contains(response.Body.String(), "mail_login") {
			t.Fatalf("registration mail=%d %s", response.Code, response.Body.String())
		}
	})
	t.Run("LT7 reset lookup, equal replies and confirmation", func(t *testing.T) {
		for _, identifier := range []string{"OPERATOR_RECOVERED_LOGIN", "91001@EXAMPLE.INVALID"} {
			id, address, _, found, err := lookupPasswordResetUser(identifier)
			if err != nil || !found || id != 91001 || address != "91001@example.invalid" {
				t.Fatalf("reset lookup=%d %s %v %v", id, address, found, err)
			}
		}
		// Test the actual response with a transport blocked until the acknowledgement exists.
		original := sendResetEmail
		done := make(chan struct{}, 2)
		var mailLogin string
		sendResetEmail = func(_, _, name, _, _, _ string) error { mailLogin = name; done <- struct{}{}; return nil }
		t.Cleanup(func() { sendResetEmail = original })
		var firstBody string
		cookieLength := 0
		for _, identifier := range []string{"operator_recovered_login", "missing_login", "disabled_login"} {
			cookie := seedSessionCookie(t, map[interface{}]interface{}{"csrf_token": "postgres-csrf"})
			body, _ := json.Marshal(map[string]string{"identifier": identifier, "csrf_token": "postgres-csrf"})
			request := httptest.NewRequest("POST", "/api/request-password-reset-otp", strings.NewReader(string(body)))
			request.AddCookie(cookie)
			response := httptest.NewRecorder()
			RequestPasswordResetOTPHandler(response, request)
			if response.Code != 200 {
				t.Fatalf("reset=%d %s", response.Code, response.Body.String())
			}
			if firstBody == "" {
				firstBody = response.Body.String()
			}
			if response.Body.String() != firstBody {
				t.Fatal("enumerating reset body")
			}
			saved := latestPostgresCookie(t, response)
			if cookieLength == 0 {
				cookieLength = len(saved.Value)
			}
			if len(saved.Value) != cookieLength {
				t.Fatal("enumerating cookie length")
			}
			confirm := httptest.NewRequest("POST", "/api/reset-password", strings.NewReader(`{"csrf_token":"postgres-csrf","otp_code":"bad","new_password":"new-strong-password-123"}`))
			confirm.AddCookie(saved)
			answer := httptest.NewRecorder()
			ResetPasswordWithOTPHandler(answer, confirm)
			if answer.Code != 401 || !strings.Contains(answer.Body.String(), "wrong_otp") {
				t.Fatalf("confirmation=%d %s", answer.Code, answer.Body.String())
			}
		}
		select {
		case <-done:
			if mailLogin != "operator_recovered_login" {
				t.Fatal("recovery mail lost login name")
			}
		case <-time.After(5 * time.Second):
			t.Fatal("recovery mail never attempted")
		}
	})
}

// A small adapter keeps the assertion wording identical to the public mapper contract.
func httpresponseAccountRefusal(err error) string {
	if refusal := httpresponse.AccountNameRefusal(err); refusal != nil {
		return refusal.LangKey
	}
	return ""
}

// In-memory transport: outbound mail tests never open a socket.
type loginNoticeRoundTrip func(*http.Request) (*http.Response, error)

func (transport loginNoticeRoundTrip) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}
