// surviving_sign_in_postgres_test.go
// Replays old browser cookies after real self-service handlers rotate credentials.
// Connects disposable PostgreSQL, real sign-in and the auth/fingerprint/device stages.
// Proves the acting sign-in survives while other, revoked and later-ended sign-ins fail.
package auth

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/otp"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_revocation"
	"easelect/backend/pipeline/auth_check"
	"easelect/backend/pipeline/device_id_check"
	"easelect/backend/pipeline/fingerprint_check"
)

type survivorBrowser map[string]*http.Cookie

func survivorLogin(t *testing.T, name string) survivorBrowser {
	t.Helper()
	response := postgresLogin(t, name, loginFixturePassword)
	if response.Code != http.StatusOK {
		t.Fatalf("sign-in=%d %s", response.Code, response.Body.String())
	}
	return survivorCookies(nil, response)
}

func survivorCookies(previous survivorBrowser, response *httptest.ResponseRecorder) survivorBrowser {
	updated := survivorBrowser{}
	for name, cookie := range previous {
		updated[name] = cookie
	}
	for _, cookie := range response.Result().Cookies() {
		if cookie.MaxAge < 0 {
			delete(updated, cookie.Name)
		} else {
			updated[cookie.Name] = cookie
		}
	}
	return updated
}

func survivorRequest(t *testing.T, browser survivorBrowser, method, path string, body map[string]interface{}) *http.Request {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	for _, cookie := range browser {
		request.AddCookie(cookie)
	}
	session, err := e_sessions.Load(request)
	if err != nil {
		t.Fatal(err)
	}
	csrf, _ := session.Values["csrf_token"].(string)
	if csrf == "" {
		t.Fatal("real sign-in has no CSRF token")
	}
	if body != nil {
		body["csrf_token"] = csrf
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		request = httptest.NewRequest(method, path, strings.NewReader(string(payload)))
		for _, cookie := range browser {
			request.AddCookie(cookie)
		}
	}
	request.Header.Set("X-CSRF-Token", csrf)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	return request
}

func survivorProtectedHandler(handler http.HandlerFunc) http.HandlerFunc {
	return auth_check.EnsureLoggedIn(fingerprint_check.WithFingerprintCheck(device_id_check.WithDeviceIDCheck(handler)))
}

func survivorCall(t *testing.T, browser survivorBrowser, method, path string, body map[string]interface{}, handler http.HandlerFunc, want int) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	survivorProtectedHandler(handler)(response, survivorRequest(t, browser, method, path, body))
	if response.Code != want {
		t.Fatalf("%s %s=%d want=%d %s", method, path, response.Code, want, response.Body.String())
	}
	return response
}

func survivorStoredState(t *testing.T, db *sql.DB, wantID string, wantSurvivor bool) int64 {
	t.Helper()
	var generation int64
	var id sql.NullString
	var survivorGeneration sql.NullInt64
	if err := db.QueryRow(`SELECT authentication_generation,surviving_sign_in_id,surviving_sign_in_generation
		FROM restricted.users_restricted WHERE id=91002`).Scan(&generation, &id, &survivorGeneration); err != nil {
		t.Fatal(err)
	}
	if wantSurvivor {
		if !id.Valid || id.String != wantID || !survivorGeneration.Valid || survivorGeneration.Int64 != generation {
			t.Fatal("the bump did not atomically record the acting sign-in")
		}
	} else if id.Valid || survivorGeneration.Valid {
		t.Fatal("an all-sign-ins bump retained a survivor")
	}
	return generation
}

func TestSurvivingSignInStaleCookiePostgres(t *testing.T) {
	for _, action := range []string{"other devices", "own login name", "own password", "own email"} {
		t.Run(action, func(t *testing.T) {
			db := loginNameDisposableCluster(t)
			// Public browsing reaches the profile handler as a guest after refusal,
			// which answers 401, exactly as the browser canary observes.
			if _, err := db.Exec(`UPDATE system_config SET boolean_value=false WHERE key='login_to_browse'`); err != nil {
				t.Fatal(err)
			}
			a, b := survivorLogin(t, "ordinary_login"), survivorLogin(t, "ordinary_login")
			beforeAction := a
			beforeRequest := survivorRequest(t, a, "GET", "/api/user-profile", nil)
			beforeSession, _ := e_sessions.Load(beforeRequest)
			signInID, _ := sign_in_revocation.SessionValue(beforeSession)
			body := map[string]interface{}{"current_password": loginFixturePassword}
			handler := http.HandlerFunc(UserProfileUpdateHandler)
			path := "/api/update-profile"
			switch action {
			case "other devices":
				path, handler = "/api/sign-out-other-devices", SignOutOtherDevicesHandler
			case "own login name":
				body["login_name"] = "survivor_renamed_login"
			case "own password":
				code, err := otp.CreateOTP(91002, otp.ProfilePasswordChange, "91002@example.invalid")
				if err != nil {
					t.Fatal(err)
				}
				body["new_password"], body["password_otp"] = "survivor-new-password-123", code
			case "own email":
				if _, err := db.Exec(`UPDATE restricted.users_restricted SET login_verification_method='email' WHERE id=91002`); err != nil {
					t.Fatal(err)
				}
				code, err := otp.CreateOTP(91002, otp.ProfileEmailChange, "new-survivor@example.invalid")
				if err != nil {
					t.Fatal(err)
				}
				body["email"], body["email_otp"] = "new-survivor@example.invalid", code
			}
			response := survivorCall(t, a, "POST", path, body, handler, 200)
			a = survivorCookies(a, response)
			generation := survivorStoredState(t, db, signInID, true)
			survivorCall(t, a, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 200)
			// An older response can overwrite all three cookies. Replay A's exact
			// pre-action cookies, while B keeps its independently minted sign-in.
			response = survivorCall(t, beforeAction, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 200)
			a = survivorCookies(beforeAction, response)
			renewed, err := e_sessions.Load(survivorRequest(t, a, "GET", "/api/user-profile", nil))
			if stored, ok := auth_generation.SessionValue(renewed); err != nil || !ok || stored != generation {
				t.Fatal("normal device renewal did not save the recovered generation", err)
			}
			survivorCall(t, b, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 401)
			// Password recovery ends every sign-in, unlike a self-service profile
			// change that explicitly keeps the acting sign-in. Use its real handler
			// from A to prove that a later all-sign-ins bump clears the survivor.
			request := survivorRequest(t, a, "POST", "/api/reset-password", nil)
			session, err := e_sessions.GetOrCreateSession(nil, request)
			if err != nil || setPendingPasswordResetState(session, 91002, generation) != nil {
				t.Fatal("could not prepare verified password recovery", err)
			}
			pending := httptest.NewRecorder()
			if err := e_sessions.Save(pending, request, session); err != nil {
				t.Fatal(err)
			}
			code, err := otp.CreateOTP(91002, otp.ProfilePasswordReset, "91002@example.invalid")
			if err != nil {
				t.Fatal(err)
			}
			reset := httptest.NewRecorder()
			ResetPasswordWithOTPHandler(reset, survivorRequest(t, survivorCookies(a, pending), "POST", "/api/reset-password",
				map[string]interface{}{"otp_code": code, "new_password": "survivor-reset-password-123"}))
			if reset.Code != 200 {
				t.Fatalf("later password reset=%d %s", reset.Code, reset.Body.String())
			}
			survivorStoredState(t, db, "", false)
			survivorCall(t, beforeAction, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 401)
			survivorCall(t, a, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 401)
		})
	}
}

func TestAdministratorLoginNameChangeClearsSurvivorPostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	a, b := survivorLogin(t, "ordinary_login"), survivorLogin(t, "ordinary_login")
	response := survivorCall(t, a, "POST", "/api/update-profile",
		map[string]interface{}{"sign_out_other_devices": true, "current_password": loginFixturePassword}, UserProfileUpdateHandler, 200)
	current := survivorCookies(a, response)
	admin := survivorLogin(t, "former_admin_login")
	// This administrator route takes its CSRF proof only from the header and refuses unknown body fields.
	request := survivorRequest(t, admin, "POST", "/api/admin/user-login-name", nil)
	request.Body = io.NopCloser(strings.NewReader(`{"user_id":91002,"login_name":"administrator_changed_login"}`))
	changed := httptest.NewRecorder()
	survivorProtectedHandler(AdminUserLoginNameHandler)(changed, request)
	if changed.Code != http.StatusOK {
		t.Fatalf("administrator login-name change=%d %s", changed.Code, changed.Body.String())
	}
	survivorStoredState(t, db, "", false)
	for _, browser := range []survivorBrowser{a, b, current} {
		survivorCall(t, browser, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 401)
	}
}

func TestSurvivingSignInInFlightResponsePostgres(t *testing.T) {
	db := loginNameDisposableCluster(t)
	a := survivorLogin(t, "ordinary_login")
	request := survivorRequest(t, a, "GET", "/api/user-profile", nil)
	slowResponse := httptest.NewRecorder()
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	go func() {
		defer close(done)
		survivorProtectedHandler(func(w http.ResponseWriter, r *http.Request) {
			// Device renewal has written the old-generation cookies already.
			close(entered)
			<-release
			UserProfileFetchHandler(w, r)
		})(slowResponse, request)
	}()
	defer func() { unblock(); <-done }()
	select {
	case <-entered:
	case <-done:
		t.Fatal("in-flight request did not reach the protected handler")
	case <-time.After(5 * time.Second):
		t.Fatal("in-flight request never reached the device renewal")
	}
	changed := survivorCall(t, a, "POST", "/api/update-profile",
		map[string]interface{}{"sign_out_other_devices": true, "current_password": loginFixturePassword}, UserProfileUpdateHandler, 200)
	current := survivorCookies(a, changed)
	survivorCall(t, current, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 200)
	unblock()
	<-done
	if slowResponse.Code != 200 {
		t.Fatal("in-flight handler failed", slowResponse.Code)
	}
	lateCookies := survivorCookies(current, slowResponse)
	lateSession, err := e_sessions.Load(survivorRequest(t, lateCookies, "GET", "/api/user-profile", nil))
	if stored, ok := auth_generation.SessionValue(lateSession); err != nil || !ok || stored != 1 {
		t.Fatal("fixture did not reproduce an old-generation response", err)
	}
	signInID, _ := sign_in_revocation.SessionValue(lateSession)
	survivorStoredState(t, db, signInID, true)
	survivorCall(t, lateCookies, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 200)
	// Recovery through the survivor does not allow either browser binding to fail.
	for _, binding := range []string{e_sessions.DeviceIDCookieName(), e_sessions.FingerprintCookieName()} {
		for _, value := range []string{"", "different-binding"} {
			badCookies := survivorCookies(lateCookies, httptest.NewRecorder())
			delete(badCookies, binding)
			if value != "" {
				badCookies[binding] = &http.Cookie{Name: binding, Value: value}
			}
			survivorCall(t, badCookies, "GET", "/api/user-profile", nil, UserProfileFetchHandler, http.StatusForbidden)
		}
	}
	// A real individual logout must still refuse this survivor's old cookie.
	survivorCall(t, current, "POST", "/api/logout", nil, LogoutHandler, http.StatusSeeOther)
	survivorCall(t, lateCookies, "GET", "/api/user-profile", nil, UserProfileFetchHandler, 401)
}
