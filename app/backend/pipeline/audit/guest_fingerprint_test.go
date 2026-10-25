// guest_fingerprint_test.go
// Exercises fingerprint checks through the actual audit wrapper and batch writer.
// Uses in-memory cookies and the scripted audit driver, with no live database.
package audit

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/auth"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func TestGuestFingerprintNoOpNeverWritesAnAuditRow(t *testing.T) {
	previousStore, previousName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store = sessions.NewCookieStore([]byte("audit-fingerprint-test-signing-key"))
	e_sessions.SessionName = "session"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = previousStore, previousName })
	db, state := openAuditFlushDB(nil)
	installAuditFlushDBs(t, db)
	checks := []struct {
		name        string
		userID      interface{}
		fingerprint string
		body        string
		status      int
		audited     bool
	}{
		{"anonymous", nil, "", `{"fingerprint":"browser"}`, http.StatusOK, false},
		{"guest enrollment", 1, "", `{"fingerprint":"browser"}`, http.StatusOK, false},
		{"guest mismatch", 1, auth.HMACFingerprint("old-browser"), `{"fingerprint":"browser"}`, http.StatusOK, false},
		{"unreadable identity", "42", "", `{}`, http.StatusOK, false},
		{"zero identity", 0, "", `{}`, http.StatusOK, false},
		{"negative identity", -1, "", `{}`, http.StatusOK, false},
		{"signed-in enrollment", 42, "", `{"fingerprint":"browser"}`, http.StatusOK, true},
		{"signed-in match", 42, auth.HMACFingerprint("browser"), `{"fingerprint":"browser"}`, http.StatusOK, true},
		{"signed-in mismatch ends sign-in", 42, auth.HMACFingerprint("old-browser"), `{"fingerprint":"browser"}`, http.StatusForbidden, true},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			carrier := httptest.NewRequest(http.MethodGet, "/", nil)
			session, err := e_sessions.Load(carrier)
			if err != nil {
				t.Fatal(err)
			}
			if check.userID != nil {
				session.Values["user_id"] = check.userID
			}
			if check.fingerprint != "" {
				session.Values["fingerprint_hash"] = check.fingerprint
			}
			saved := httptest.NewRecorder()
			if err := e_sessions.Save(saved, carrier, session); err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodPost, "/api/check-fingerprint", strings.NewReader(check.body))
			for _, cookie := range saved.Result().Cookies() {
				r.AddCookie(cookie)
			}
			before := len(state.inserted())
			w := httptest.NewRecorder()
			WithAudit("auth.CheckFingerprintHandler", auth.CheckFingerprintHandler)(w, r)
			flushAuditForTest(t)
			if w.Code != check.status {
				t.Fatalf("status=%d want=%d", w.Code, check.status)
			}
			wantRows := 0
			if check.audited {
				wantRows = 1
			}
			if got := len(state.inserted()) - before; got != wantRows {
				t.Fatalf("audit rows=%d want=%d", got, wantRows)
			}
			if !check.audited && len(w.Result().Cookies()) != 0 {
				t.Fatal("guest no-op wrote cookies")
			}
			if check.status == http.StatusForbidden {
				ended, err := e_sessions.Load(r)
				if err != nil {
					t.Fatal(err)
				}
				if uid, _ := ended.Values["user_id"].(int); uid > 1 {
					t.Fatal("mismatch kept authenticated identity")
				}
			}
		})
	}
}
