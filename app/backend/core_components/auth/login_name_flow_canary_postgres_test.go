// login_name_flow_canary_postgres_test.go
// Exercises private-name canaries through real account handlers and operator recovery.
// Bridges random restricted identities, HTTP/cookie checks and captured owner-only mail.
// Proves LT10 across registration, profile, revocation, name changes, reset and sign-out.
package auth

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/auth/credentials"
	"easelect/backend/core_components/logging"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

func TestLoginNameEveryAccountFlowCanaryPostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	stdout, err := os.CreateTemp(t.TempDir(), "flow-stdout")
	if err != nil {
		t.Fatal(err)
	}
	oldStdout := os.Stdout
	os.Stdout = stdout
	t.Cleanup(func() { os.Stdout = oldStdout; stdout.Close() })
	var output, mail bytes.Buffer
	logging.SetOutput(&output)
	t.Cleanup(func() { logging.SetOutput(os.Stderr) })
	newName := func() string { return "a" + strings.ReplaceAll(uuid.NewString(), "-", "") }
	adminName, userName, ownReplacement, adminReplacement, recoveryName := newName(), newName(), newName(), newName(), newName()
	canaries := []string{adminName, userName, ownReplacement, adminReplacement, recoveryName}
	check := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("handler status=%d want=%d body=%s", w.Code, status, w.Body.String())
		}
		for _, name := range canaries {
			assertPrivateNameAbsent(t, w, name)
		}
	}
	type resetMail struct{ name, code string }
	resetDelivered := make(chan resetMail, 1)
	oldReset := sendResetEmail
	sendResetEmail = func(_, code, name, _, _, _ string) error { resetDelivered <- resetMail{name, code}; return nil }
	t.Cleanup(func() { sendResetEmail = oldReset })
	requestReset := func(name string) (*http.Cookie, resetMail) {
		t.Helper()
		r := httptest.NewRequest("POST", "/api/request-password-reset-otp", strings.NewReader(fmt.Sprintf(`{"identifier":%q,"csrf_token":"postgres-csrf"}`, name)))
		r.AddCookie(seedSessionCookie(t, map[interface{}]interface{}{"csrf_token": "postgres-csrf"}))
		w := httptest.NewRecorder()
		RequestPasswordResetOTPHandler(w, r)
		check(w, 200)
		select {
		case delivered := <-resetDelivered:
			if delivered.name != name {
				t.Fatal("positive mail control missing")
			}
			mail.WriteString(delivered.name)
			return latestPostgresCookie(t, w), delivered
		case <-time.After(5 * time.Second):
			t.Fatal("reset mail not delivered")
		}
		return nil, resetMail{}
	}
	oldTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	t.Setenv("POSTMARK_API_KEY", "disposable-postmark-token")
	t.Setenv("EMAIL_FROM_ADDRESS", "sender@example.invalid")
	http.DefaultTransport = loginNoticeRoundTrip(func(r *http.Request) (*http.Response, error) {
		payload, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, err
		}
		mail.Write(payload)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"ErrorCode":0,"MessageID":"fixture-mail"}`))}, nil
	})
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	adminID, err := credentials.CreateAdministratorAccount(context.Background(), tx, credentials.AdministratorAccountInput{
		LoginName: adminName, Email: "flow_admin@example.invalid", Password: loginFixturePassword,
		VerificationMethod: credentials.VerificationNone, CreationSpec: "LT10 all account flows",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	check(postgresLogin(t, adminName, loginFixturePassword), 200)
	requestReset(adminName)
	oldEnabled := registrationEnabledFunc
	registrationEnabledFunc = func() bool { return true }
	t.Cleanup(func() { registrationEnabledFunc = oldEnabled })
	// Local development registration creates an enabled ordinary account; remote
	// registration deliberately leaves it disabled, so it cannot sign in yet.
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	form := url.Values{"username": {userName}, "display_name": {"Flow Display"}, "password": {loginFixturePassword},
		"email": {"flow_user@example.invalid"}, "verification_method": {"none"}, "csrf_token": {"postgres-csrf"}}
	request := httptest.NewRequest("POST", "/api/register_ndYOyXV0INOK3F", strings.NewReader(form.Encode()))
	request.RemoteAddr = "127.0.0.1:1234"
	request.AddCookie(seedSessionCookie(t, map[interface{}]interface{}{"csrf_token": "postgres-csrf"}))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response := httptest.NewRecorder()
	RegisterAPIHandler(response, request)
	check(response, 200)
	var userID int
	var enabled bool
	if err = db.QueryRow(`SELECT u.id,u.enabled FROM restricted.users_restricted ur JOIN system_users u USING(id) WHERE ur.login_name=$1`, userName).Scan(&userID, &enabled); err != nil || !enabled {
		t.Fatal("local development registration did not create an enabled account", err)
	}
	check(postgresLogin(t, userName, "wrong password"), 401)
	check(postgresLogin(t, "Flow Display", loginFixturePassword), 401)
	response = postgresLogin(t, userName, loginFixturePassword)
	check(response, 200)
	cookie := latestPostgresCookie(t, response)
	// Fresh cookies have generated CSRF tokens; use the fixture's own valid proof below.
	cookie = postgresOwnCookie(t, userID)
	request = httptest.NewRequest("GET", "/api/user-profile", nil)
	request.AddCookie(cookie)
	response = httptest.NewRecorder()
	UserProfileFetchHandler(response, request)
	check(response, 200)
	// Seed the historical equal-name state, including its searchable private copy.
	if _, err = db.Exec(`UPDATE system_users SET username=$1::text,search_vector_simple=to_tsvector('simple',$1::text) WHERE id=$2`, userName, userID); err != nil {
		t.Fatal(err)
	}
	var searchable bool
	if err = db.QueryRow(`SELECT search_vector_simple @@ plainto_tsquery('simple',$1) FROM system_users WHERE id=$2`, userName, userID).Scan(&searchable); err != nil || !searchable {
		t.Fatal("search-vector positive control", err)
	}
	for index, body := range []string{
		`{"username":"Renamed Flow Display","website":"https://example.invalid","current_password":"` + loginFixturePassword + `"}`,
		`{"sign_out_other_devices":true,"current_password":"` + loginFixturePassword + `"}`,
		`{"login_name":"` + ownReplacement + `","current_password":"` + loginFixturePassword + `"}`,
	} {
		response = postgresProfile(t, cookie, body)
		check(response, 200)
		// A display-name and website edit keeps the session; signing out other
		// devices and changing the login name must re-issue it (K203).
		if index > 0 {
			cookie = latestPostgresCookie(t, response)
		}
	}
	check(postgresLogin(t, userName, loginFixturePassword), 401)
	check(postgresLogin(t, ownReplacement, loginFixturePassword), 200)
	request = httptest.NewRequest("POST", "/api/admin/user-login-name", strings.NewReader(fmt.Sprintf(`{"user_id":%d,"login_name":%q}`, userID, adminReplacement)))
	request.AddCookie(postgresOwnCookie(t, int(adminID)))
	request.Header.Set("X-CSRF-Token", "postgres-csrf")
	response = httptest.NewRecorder()
	AdminUserLoginNameHandler(response, request)
	check(response, 200)
	editor := credentials.NewRecoveryEditor(db)
	identity, err := editor.ReadInstanceIdentity(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var generation int64
	if err = db.QueryRow(`SELECT authentication_generation FROM restricted.users_restricted WHERE id=$1`, adminID).Scan(&generation); err != nil {
		t.Fatal(err)
	}
	result, err := editor.RecoverAdministrator(context.Background(), credentials.RecoveryInput{
		UserID: adminID, NewLoginName: recoveryName, NewPassword: loginFixturePassword, VerificationMethod: credentials.VerificationNone,
		AllowPasswordOnly: true, ExpectedAuthenticationGeneration: generation, ExpectedVerificationMethod: credentials.VerificationNone, TargetIdentity: identity,
	})
	if err != nil || result.UserID != adminID || result.MailStatus != "notice_email_sent" {
		t.Fatal("operator recovery", err)
	}
	for _, name := range canaries {
		if strings.Contains(fmt.Sprint(result), name) {
			t.Fatal("private name in recovery result")
		}
	}
	check(postgresLogin(t, recoveryName, loginFixturePassword), 200)
	// Capture the asynchronous reset mail after its acknowledgement, without network access.
	resetCookie, delivered := requestReset(adminReplacement)
	request = httptest.NewRequest("POST", "/api/reset-password", strings.NewReader(fmt.Sprintf(`{"otp_code":%q,"csrf_token":"postgres-csrf","new_password":"reset-canary-password-123"}`, delivered.code)))
	request.AddCookie(resetCookie)
	response = httptest.NewRecorder()
	ResetPasswordWithOTPHandler(response, request)
	check(response, 200)
	response = postgresLogin(t, adminReplacement, "reset-canary-password-123")
	check(response, 200)
	request = httptest.NewRequest("POST", "/api/logout", nil)
	request.AddCookie(latestPostgresCookie(t, response))
	response = httptest.NewRecorder()
	LogoutHandler(response, request)
	check(response, http.StatusSeeOther)
	// Both local second-step methods also pass through failed and successful cookie writes.
	for _, account := range []struct {
		id             int64
		name, password string
	}{
		{adminID, recoveryName, loginFixturePassword}, {int64(userID), adminReplacement, "reset-canary-password-123"},
	} {
		for _, method := range []string{"fixed_pin", "totp"} {
			const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
			pinHash, err := hashFixedPIN("246810")
			if err != nil {
				t.Fatal(err)
			}
			var pin, totp interface{}
			code := "246810"
			if method == "fixed_pin" {
				pin = pinHash
			} else {
				totp = secret
				code, err = totpCodeForCounter(secret, uint64(time.Now().Unix()/totpPeriod))
				if err != nil {
					t.Fatal(err)
				}
			}
			if _, err = db.Exec(`UPDATE restricted.users_restricted SET login_verification_method=$1,fixed_pin_hash=$2,totp_secret=$3 WHERE id=$4`, method, pin, totp, account.id); err != nil {
				t.Fatal(err)
			}
			response = postgresLogin(t, account.name, account.password)
			check(response, 200)
			if !strings.Contains(response.Body.String(), "otp_required") {
				t.Fatal("factor did not establish a pending sign-in")
			}
			pending := latestPostgresCookie(t, response)
			for index, proof := range []string{"bad", code} {
				request = httptest.NewRequest("POST", "/api/login", strings.NewReader(fmt.Sprintf(`{"otp_code":%q,"csrf_token":"postgres-csrf"}`, proof)))
				request.Header.Set("Content-Type", "application/json")
				request.AddCookie(pending)
				response = httptest.NewRecorder()
				LoginAPIHandler(response, request)
				check(response, []int{401, 200}[index])
				pending = latestPostgresCookie(t, response)
			}
		}
	}
	os.Stdout = oldStdout
	if _, err = stdout.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	capturedStdout, err := io.ReadAll(stdout)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range canaries {
		if bytes.Contains(capturedStdout, []byte(name)) {
			t.Fatal("canary in stdout")
		}
		if strings.Contains(output.String(), name) {
			t.Fatal("canary in app log")
		}
		if !strings.Contains(mail.String(), name) {
			t.Fatal("positive owner-mail control missing")
		}
		assertPrivateNameAbsentFromPublic(t, db, name)
	}
	for _, name := range []string{recoveryName, adminReplacement} {
		var retained bool
		if err = db.QueryRow(`SELECT EXISTS(SELECT 1 FROM restricted.users_restricted WHERE login_name=$1)`, name).Scan(&retained); err != nil || !retained {
			t.Fatal("positive restricted control", err)
		}
	}
}

func assertPrivateNameAbsentFromPublic(t *testing.T, db *sql.DB, name string) {
	t.Helper()
	rows, err := db.Query(`SELECT c.relname,a.attname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
		JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind='r'
		AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid IN ('text'::regtype,'varchar'::regtype,'json'::regtype,'jsonb'::regtype,'tsvector'::regtype)`)
	if err != nil {
		t.Fatal(err)
	}
	var columns [][2]string
	for rows.Next() {
		var pair [2]string
		if err = rows.Scan(&pair[0], &pair[1]); err != nil {
			t.Fatal(err)
		}
		columns = append(columns, pair)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	for _, pair := range columns {
		var leaked bool
		query := `SELECT EXISTS(SELECT 1 FROM public.` + pq.QuoteIdentifier(pair[0]) + ` WHERE strpos(` + pq.QuoteIdentifier(pair[1]) + `::text,$1)>0)`
		if err = db.QueryRow(query, name).Scan(&leaked); err != nil || leaked {
			t.Fatalf("public channel %s.%s leaked=%v err=%v", pair[0], pair[1], leaked, err)
		}
	}
}
