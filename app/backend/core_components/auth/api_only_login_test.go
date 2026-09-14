// api_only_login_test.go
// Verifies automation credentials require JSON API channel and produce signed markers.
// Bridges credential fixtures with the real login handlers and Gorilla cookie store.
// Exists to prevent browser login and preserve human/CSRF/password authentication rules.
package auth

import (
	"bytes"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"golang.org/x/crypto/bcrypt"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestAPIOnlyLoginChannelAndSignedMarker(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, header, password, csrf string
		api, legacy                  bool
		status                       int
		marker                       bool
	}{
		{"API login", "1", "correct-password", "token", true, false, 200, true},
		{"browser JSON", "", "correct-password", "token", true, false, 403, false},
		{"wrong header", "true", "correct-password", "token", true, false, 403, false},
		{"wrong password", "1", "incorrect", "token", true, false, 401, false},
		{"CSRF required", "1", "correct-password", "wrong", true, false, 403, false},
		{"legacy with header", "1", "correct-password", "token", true, true, 403, false},
		{"ordinary JSON", "", "correct-password", "token", false, false, 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", "dev")
			t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
			resetLoginFailureLimiter()
			cfg := credentialMockConfig{userLookupOK: true, userID: 42, hashedPassword: string(hash), adminGroupMember: true, apiOnly: tc.api, authGeneration: 4}
			oldDB, oldConf, oldGuest := backend.Db, backend.DbConfidential, backend.DbGuest
			db := openCredentialMockDB(t, cfg)
			backend.Db = db
			backend.DbConfidential = db
			backend.DbGuest = db
			defer func() { backend.Db = oldDB; backend.DbConfidential = oldConf; backend.DbGuest = oldGuest }()
			st := prepareLoginHandlerSessionStore(t)
			body, _ := json.Marshal(map[string]string{"username": "renamed", "password": tc.password, "csrf_token": tc.csrf, "fingerprint": "fixture"})
			r := httptest.NewRequest("POST", "/api/login", bytes.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			if tc.legacy {
				form := url.Values{"username": {"renamed"}, "password": {tc.password}, "csrf_token": {tc.csrf}, "fingerprint": {"fixture"}}
				r = httptest.NewRequest("POST", "/login", bytes.NewBufferString(form.Encode()))
				r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			}
			if tc.header != "" {
				r.Header.Set(auth_generation.AutomationHeader, tc.header)
			}
			seed := httptest.NewRequest("GET", "/", nil)
			s, _ := st.New(seed, e_sessions.SessionName)
			s.Values["csrf_token"] = "token"
			cookies := httptest.NewRecorder()
			if err = s.Save(seed, cookies); err != nil {
				t.Fatal(err)
			}
			for _, c := range cookies.Result().Cookies() {
				r.AddCookie(c)
			}
			w := httptest.NewRecorder()
			LoginAPIHandler(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d want %d body=%s", w.Code, tc.status, w.Body)
			}
			check := httptest.NewRequest("GET", "/", nil)
			for _, c := range w.Result().Cookies() {
				if c.Name == e_sessions.SessionName && c.MaxAge >= 0 {
					check.Header.Del("Cookie")
					check.AddCookie(c)
				}
			}
			signed, err := st.Get(check, e_sessions.SessionName)
			if err != nil {
				t.Fatal(err)
			}
			marked, _ := signed.Values[auth_generation.AutomationSessionKey].(bool)
			if marked != tc.marker {
				t.Fatalf("signed marker=%v want=%v", marked, tc.marker)
			}
			if tc.status != 200 && signed.Values["authenticated"] == true {
				t.Fatal("denied login authenticated")
			}
			if tc.status == 200 {
				if g, ok := auth_generation.SessionValue(signed); !ok || g != 4 {
					t.Fatalf("generation=%d %v", g, ok)
				}
			}
		})
	}
}

func TestAPIOnlyPendingFactorCannotSwitchToBrowserChannel(t *testing.T) {
	cfg := credentialMockConfig{userID: 42, apiOnly: true, authGeneration: 4, verificationMethod: "fixed_pin"}
	oldDB, oldConf := backend.Db, backend.DbConfidential
	db := openCredentialMockDB(t, cfg)
	backend.Db = db
	backend.DbConfidential = db
	defer func() { backend.Db = oldDB; backend.DbConfidential = oldConf }()
	st := prepareLoginHandlerSessionStore(t)
	r := httptest.NewRequest("POST", "/api/login", nil)
	s, _ := st.New(r, "session")
	setPendingLoginState(s, 42, "renamed", "fixture", 4)
	w := httptest.NewRecorder()
	handleLoginOTPVerify(w, r, s, loginJSONRequest{OTPCode: "1234"})
	if w.Code != 403 || s.Values["authenticated"] == true {
		t.Fatalf("status=%d session=%v", w.Code, s.Values["authenticated"])
	}
}
