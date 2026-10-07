// login_name_creators_postgres_test.go
// Proves LT8 setup choices, shared creators, automation and LT10 private-name channels.
// Uses the same opt-in disposable PostgreSQL and real handlers as parts A and B.
// Makes numbering, rollback, transaction support and value-free replies observable.
package auth

import (
	"bytes"
	"context"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth/credentials"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/otp"
	sessions "easelect/backend/core_components/sessions"
	"github.com/google/uuid"
)

func TestLoginNameFirstRunPostgres(t *testing.T) {
	for _, choice := range []string{"true", "false"} {
		t.Run("LT8 setup choice "+choice, func(t *testing.T) {
			db := loginNameDisposableCluster(t)
			if _, err := db.Exec(`UPDATE system_users SET admin_access_allowed=false,username='demoted_fixture_display' WHERE id=91001;
                DELETE FROM system_user_group_memberships WHERE user_id=91001 AND group_id=1;
                UPDATE system_config SET boolean_value=true WHERE key='first_run'`); err != nil {
				t.Fatal(err)
			}
			t.Setenv("FILTEREST_SITE_SLUG", "Northwind")
			get := httptest.NewRequest("GET", "/first-run", nil)
			response := httptest.NewRecorder()
			FirstRunAdminHandler(response, get)
			if response.Code != 200 || !strings.Contains(response.Body.String(), `value="admin_northwind"`) || !strings.Contains(response.Body.String(), `value="admin_1"`) || !strings.Contains(response.Body.String(), `value="true" checked`) {
				t.Fatalf("suggestions/default choice: %d %s", response.Code, response.Body.String())
			}
			cookie := latestPostgresCookie(t, response)
			decodedRequest := httptest.NewRequest("GET", "/", nil)
			decodedRequest.AddCookie(cookie)
			session, err := sessions.Load(decodedRequest)
			if err != nil {
				t.Fatal(err)
			}
			token, _ := session.Values["csrf_token"].(string)
			form := url.Values{"site_name": {"Fixture site"}, "username": {"chosen_setup_login"}, "display_name": {"admin_1"}, "email": {"setup@example.invalid"}, "password": {loginFixturePassword}, "confirm_password": {loginFixturePassword}, "installation_environment": {"prod"}, "verification_method": {"none"}, "display_name_may_equal_login_name": {choice}, "csrf_token": {token}}
			post := httptest.NewRequest("POST", "/first-run", strings.NewReader(form.Encode()))
			post.AddCookie(cookie)
			post.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			post.RemoteAddr = "192.0.2.219:1234"
			response = httptest.NewRecorder()
			FirstRunAdminHandler(response, post)
			if response.Code != 303 || strings.Contains(response.Header().Get("Location"), "chosen_setup_login") {
				t.Fatalf("setup: %d %s", response.Code, response.Body.String())
			}
			var saved, open bool
			if err = db.QueryRow(`SELECT boolean_value FROM system_config WHERE key='display_name_may_equal_login_name'`).Scan(&saved); err != nil || saved != (choice == "true") {
				t.Fatal("choice was not saved", err)
			}
			if err = db.QueryRow(`SELECT boolean_value FROM system_config WHERE key='first_run'`).Scan(&open); err != nil || open {
				t.Fatal("setup left open", err)
			}
			var display, login string
			if err = db.QueryRow(`SELECT u.username,ur.login_name FROM system_users u JOIN restricted.users_restricted ur USING(id) WHERE ur.email='setup@example.invalid'`).Scan(&display, &login); err != nil || display != "admin_1" || login != "chosen_setup_login" {
				t.Fatal("account names", err)
			}
		})
	}
	t.Run("LT8 missing setting and credential failure roll back all setup writes", func(t *testing.T) {
		db := loginNameDisposableCluster(t)
		if _, err := db.Exec(`UPDATE system_users SET admin_access_allowed=false,username='demoted_fixture_display' WHERE id=91001;
            DELETE FROM system_user_group_memberships WHERE user_id=91001 AND group_id=1;
            UPDATE system_config SET boolean_value=true WHERE key='first_run'`); err != nil {
			t.Fatal(err)
		}
		input := firstRunAdminInput{SiteName: "never committed", Username: "rollback_setup", Email: "rollback@example.invalid", Password: loginFixturePassword, Environment: "prod", VerificationMethod: "none", NamesMayEqual: "false"}
		// The missing-row failure must leave neither an account nor a partial setup choice.
		if _, err := db.Exec(`DELETE FROM system_config WHERE key='display_name_may_equal_login_name'`); err != nil {
			t.Fatal(err)
		}
		if err := createFirstRunAdmin(context.Background(), db, input); err == nil {
			t.Fatal("missing choice row accepted")
		}
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM restricted.users_restricted WHERE email=$1`, input.Email).Scan(&count); err != nil || count != 0 {
			t.Fatal("partial account", err)
		}
		if _, err := db.Exec(`INSERT INTO system_config(key,boolean_value,value_type,json_value) VALUES('display_name_may_equal_login_name',true,2,'{"value":true}')`); err != nil {
			t.Fatal(err)
		}
		input.Email = "91002@example.invalid"
		if err := createFirstRunAdmin(context.Background(), db, input); err == nil {
			t.Fatal("duplicate address accepted")
		}
		var saved bool
		if err := db.QueryRow(`SELECT boolean_value FROM system_config WHERE key='display_name_may_equal_login_name'`).Scan(&saved); err != nil || !saved {
			t.Fatal("choice escaped failed setup transaction", err)
		}
	})
}

func TestLoginNameCreatorsAndCanaryPostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	var output bytes.Buffer
	logging.SetOutput(&output)
	t.Cleanup(func() { logging.SetOutput(os.Stderr) })
	loginName := "secret_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	userLogin := "secret_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	id, err := credentials.CreateAdministratorAccount(context.Background(), tx, credentials.AdministratorAccountInput{LoginName: loginName, Email: "canary_admin@example.invalid", Password: loginFixturePassword, VerificationMethod: credentials.VerificationNone, CreationSpec: "LT10 canary"})
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var display string
	if err = db.QueryRow(`SELECT username FROM system_users WHERE id=$1`, id).Scan(&display); err != nil || !strings.HasPrefix(display, "admin_") {
		t.Fatal("administrator allocation", err)
	}
	for _, name := range []string{loginName, display} {
		w := postgresLogin(t, name, loginFixturePassword)
		want := 200
		if name == display {
			want = 401
		}
		if w.Code != want {
			t.Fatalf("created account sign-in: %d %s", w.Code, w.Body.String())
		}
		assertPrivateNameAbsent(t, w, loginName)
	}
	// Registration validates and stores the private name only in restricted credentials.
	userID, err := createRegisteredAccount(context.Background(), userLogin, "canary_user_display", "", "canary_user@example.invalid", "fixturehash", "", verificationNone, true)
	if err != nil || userID <= 1 {
		t.Fatal("ordinary canary creation", err)
	}
	tx, err = db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	_, err = credentials.CreateAdministratorAccount(context.Background(), tx, credentials.AdministratorAccountInput{LoginName: "custom_private", DisplayName: "Custom Display", Email: "custom@example.invalid", Password: loginFixturePassword, VerificationMethod: credentials.VerificationNone, CreationSpec: "LT8 explicit display"})
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	automation := NewAutomationAccountProvisioner(db)
	created, err := automation.Provision(context.Background(), loginFixturePassword)
	if err != nil || created.Username != "auto_1" || !created.FixedLoginName {
		t.Fatal("automation creation", err)
	}
	status, err := automation.Status(context.Background())
	if err != nil || status.UserID != created.UserID || !status.Ready || !status.FixedLoginName {
		t.Fatal("automation status", err)
	}
	if strings.Contains(fmt.Sprintf("%+v", status), credentials.AutomationLoginName) {
		t.Fatal("automation status exposed its login name")
	}
	rotated, err := automation.Provision(context.Background(), loginFixturePassword)
	if err != nil || rotated.UserID != created.UserID || rotated.Username != created.Username || rotated.AuthenticationGeneration != created.AuthenticationGeneration+1 {
		t.Fatal("automation rotation", err)
	}
	for _, canary := range []string{loginName, userLogin} {
		if strings.Contains(output.String(), canary) {
			t.Fatal("private name in application log")
		}
		assertPrivateNameAbsentFromPublic(t, db, canary)
		var retained bool
		if err = db.QueryRow(`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE login_name=$1)`, canary).Scan(&retained); err != nil || !retained {
			t.Fatal("positive restricted control", err)
		}
	}
}

func assertPrivateNameAbsent(t *testing.T, w *httptest.ResponseRecorder, name string) {
	t.Helper()
	if strings.Contains(w.Body.String(), name) || strings.Contains(fmt.Sprint(w.Header()), name) {
		t.Fatal("private name in HTTP response")
	}
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name != sessions.SessionName || cookie.MaxAge < 0 {
			continue
		}
		request := httptest.NewRequest("GET", "/", nil)
		request.AddCookie(cookie)
		session, err := sessions.Load(request)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(fmt.Sprint(session.Values), name) {
			t.Fatal("private name in decoded cookie")
		}
	}
}

func TestPasswordResetTransactionPostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	type resetMail struct{ address, code, name string }
	delivered := make(chan resetMail, 1)
	oldSend := sendResetEmail
	sendResetEmail = func(address, code, name, _, _, _ string) error {
		delivered <- resetMail{address, code, name}
		return nil
	}
	t.Cleanup(func() { sendResetEmail = oldSend })
	request := httptest.NewRequest("POST", "/api/request-password-reset-otp", strings.NewReader(`{"csrf_token":"postgres-csrf","identifier":"ordinary_login"}`))
	request.AddCookie(seedSessionCookie(t, map[interface{}]interface{}{"csrf_token": "postgres-csrf"}))
	response := httptest.NewRecorder()
	RequestPasswordResetOTPHandler(response, request)
	if response.Code != 200 {
		t.Fatalf("request reset: %d %s", response.Code, response.Body.String())
	}
	cookie := latestPostgresCookie(t, response)
	var issued resetMail
	select {
	case issued = <-delivered:
	case <-time.After(5 * time.Second):
		t.Fatal("reset mail not delivered")
	}
	if issued.address != "91002@example.invalid" || issued.name != "ordinary_login" || issued.code == "" {
		t.Fatal("reset mail did not identify the requested account and code")
	}
	// Read the issued snapshot and challenge without consuming it. This localizes
	// failures to cookie identity, profile/hash/expiry, or the confirmation handler.
	decoded := httptest.NewRequest("GET", "/", nil)
	decoded.AddCookie(cookie)
	session, err := sessions.Load(decoded)
	if err != nil {
		t.Fatal(err)
	}
	pending, _ := session.Values["password_reset_pending"].(string)
	if id, generation := sessions.OpenPasswordResetPending(pending); id != 91002 || generation != 1 {
		t.Fatal("issued reset snapshot cannot be opened for the requested account")
	}
	var matches bool
	if err = db.QueryRow(`SELECT code_hash=$1 AND expires_at>NOW() AND attempts=0 FROM restricted.verification_codes WHERE user_id=91002 AND purpose=$2`, otp.HashCode(issued.code), passwordResetPurpose).Scan(&matches); err != nil || !matches {
		t.Fatal("delivered reset code differs from the active challenge", err)
	}
	request = httptest.NewRequest("POST", "/api/reset-password", strings.NewReader(fmt.Sprintf(`{"csrf_token":"postgres-csrf","otp_code":%q,"new_password":"changed-reset-password-123"}`, issued.code)))
	request.AddCookie(cookie)
	response = httptest.NewRecorder()
	ResetPasswordWithOTPHandler(response, request)
	if response.Code != 200 {
		t.Fatalf("real transactional reset: %d %s", response.Code, response.Body.String())
	}
	if backend.DbConfidential != db {
		t.Fatal("OTP and reset used different connections")
	}
	response = postgresLogin(t, "ordinary_login", "changed-reset-password-123")
	if response.Code != 200 {
		t.Fatal("replacement password failed", response.Body.String())
	}
	replay := httptest.NewRecorder()
	request = httptest.NewRequest("POST", "/api/reset-password", strings.NewReader(fmt.Sprintf(`{"csrf_token":"postgres-csrf","otp_code":%q,"new_password":"another-reset-password-123"}`, issued.code)))
	request.AddCookie(cookie)
	ResetPasswordWithOTPHandler(replay, request)
	if replay.Code != 401 || !strings.Contains(replay.Body.String(), "wrong_otp") {
		t.Fatal("consumed OTP replay succeeded")
	}
}
