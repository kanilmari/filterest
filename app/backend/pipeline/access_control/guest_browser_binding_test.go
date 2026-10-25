// guest_browser_binding_test.go
// Proves guest cleanup, functional session persistence and cookie logging hygiene.
// Connects access control to an in-memory session store and scripted SQL driver.
package access_control

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"
)

func TestEnsureGuestSessionClearsBindingsAndKeepsFunctionalState(t *testing.T) {
	store := setupTestStore(t)
	for _, userID := range []interface{}{nil, 0, -1, 1, 42} {
		for _, stale := range []bool{false, true} {
			r := buildReq(t, store, http.MethodGet, "/api/list", userID, nil, "")
			session, err := e_sessions.Load(r)
			if err != nil {
				t.Fatal(err)
			}
			session.Values["csrf_token"] = "functional-csrf"
			session.Values["lang"] = "fi"
			if stale {
				session.Values["device_id"] = "old-device"
				session.Values["fingerprint_hash"] = "old-fingerprint"
			}
			r.AddCookie(&http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: "old-device"})
			r.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: "old-fingerprint"})
			w := httptest.NewRecorder()
			ensureGuestSession(w, r, session)
			if userID == 42 {
				if len(w.Result().Cookies()) != 0 || session.Values["user_id"] != 42 {
					t.Fatal("signed-in session changed")
				}
				continue
			}
			for _, key := range []string{"device_id", "fingerprint_hash"} {
				if _, exists := session.Values[key]; exists {
					t.Fatalf("guest kept %s", key)
				}
			}
			for _, name := range []string{e_sessions.DeviceIDCookieName(), e_sessions.FingerprintCookieName()} {
				found := false
				for _, cookie := range w.Result().Cookies() {
					if cookie.Name == name {
						found = true
						if cookie.Value != "" || cookie.MaxAge != -1 {
							t.Fatalf("binding not expired: %+v", cookie)
						}
					}
				}
				if !found {
					t.Fatalf("no expiry for %s", name)
				}
			}
			// A later generic session save must not resurrect old guest bindings.
			persisted := httptest.NewRecorder()
			if err := e_sessions.Save(persisted, r, session); err != nil {
				t.Fatal(err)
			}
			next := httptest.NewRequest(http.MethodGet, "/", nil)
			for _, cookie := range persisted.Result().Cookies() {
				next.AddCookie(cookie)
			}
			cleaned, err := e_sessions.Load(next)
			if err != nil {
				t.Fatal(err)
			}
			if cleaned.Values["user_id"] != 1 || cleaned.Values["csrf_token"] != "functional-csrf" || cleaned.Values["lang"] != "fi" {
				t.Fatal("functional guest state was lost")
			}
			if _, ok := cleaned.Values["device_id"]; ok {
				t.Fatal("generic save restored device")
			}
			if _, ok := cleaned.Values["fingerprint_hash"]; ok {
				t.Fatal("generic save restored fingerprint")
			}
		}
	}
}

func TestAccessControlClearsReturningGuestBindingsWithoutLoggingSessionCookie(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{permissionGranted: true})
	r := buildReq(t, store, http.MethodGet, "/api/list", 1, nil, "")
	session, err := e_sessions.Load(r)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["device_id"] = "old-device"
	session.Values["fingerprint_hash"] = "old-fingerprint"
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previous) })
	w := httptest.NewRecorder()
	called := false
	WithAccessControl("/api/list", "guest-proof", noopHandler(&called))(w, r)
	if !called || w.Code != http.StatusOK {
		t.Fatal("returning guest could not browse")
	}
	if _, exists := session.Values["device_id"]; exists {
		t.Fatal("returning guest kept device")
	}
	if _, exists := session.Values["fingerprint_hash"]; exists {
		t.Fatal("returning guest kept fingerprint")
	}
	cookie, err := r.Cookie(e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(logs.String(), "session-cookie:") || strings.Contains(logs.String(), cookie.Value[:12]) {
		t.Fatal("access control logged session cookie material")
	}
}
