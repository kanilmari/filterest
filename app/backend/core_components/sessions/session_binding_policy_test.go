// session_binding_policy_test.go
// Pins the single identity exemption shared by the pipeline, storage and SSE.
// Bridges authenticated, delegated and automation session markers with browser-binding policy.
// Prevents account type or cached role from becoming an implicit binding exemption.
package e_sessions

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gorilla/sessions"
)

func TestSessionRequiresBrowserBinding(t *testing.T) {
	for _, test := range []struct {
		name   string
		values map[interface{}]interface{}
		want   bool
	}{
		{"anonymous", nil, false},
		{"guest", map[interface{}]interface{}{"user_id": 1}, false},
		{"zero", map[interface{}]interface{}{"user_id": 0}, false},
		{"negative", map[interface{}]interface{}{"user_id": -1}, false},
		{"unreadable", map[interface{}]interface{}{"user_id": "42"}, false},
		{"signed-in", map[interface{}]interface{}{"user_id": 42}, true},
		{"administrator", map[interface{}]interface{}{"user_id": 42, "user_role": "admin"}, true},
		{"automation", map[interface{}]interface{}{"user_id": 42, "automation_api_authenticated": true, "api_only": true}, true},
		{"delegated", map[interface{}]interface{}{"user_id": 42, "site_assistant_delegation_id": "delegation"}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := SessionRequiresBrowserBinding(&sessions.Session{Values: test.values}); got != test.want {
				t.Fatalf("requires binding = %v, want %v", got, test.want)
			}
		})
	}
	if SessionRequiresBrowserBinding(nil) {
		t.Fatal("absent session requires a binding")
	}
}

func TestAnonymizeUnboundSessionClearsCachedIdentityAndClonesOnlyCookies(t *testing.T) {
	initSessionTestStore(t)
	for _, userID := range []int{0, 1, 42} {
		for _, bound := range []bool{false, true} {
			request, session := renewalTestSession(t, "stored-device", "stored-fingerprint")
			session.Values["user_id"] = userID
			session.Values["authenticated"] = true
			withBindingCookies(request, "stored-device", "")
			if bound {
				withBindingCookies(request, "", "stored-fingerprint")
			}
			recorder := httptest.NewRecorder()
			if err := Save(recorder, request, session); err != nil {
				t.Fatal(err)
			}
			request.AddCookie(recorder.Result().Cookies()[0])
			request.Method = http.MethodHead
			request.Header.Set("Range", "bytes=2-4")
			request.Header.Set("If-Modified-Since", "Sun, 18 Oct 2026 12:00:00 GMT")
			type contextKey struct{}
			request = request.WithContext(context.WithValue(request.Context(), contextKey{}, "preserved"))
			headers := request.Header.Clone()
			anonymous := AnonymizeUnboundSession(request, session)
			if userID <= 1 || bound {
				if anonymous != request || session.Values["user_id"] != userID || len(session.Values) != 4 {
					t.Fatal("guest or bound request changed")
				}
				continue
			}
			if anonymous == request || !reflect.DeepEqual(request.Header, headers) {
				t.Fatal("downgrade did not preserve the original request headers")
			}
			headers.Del("Cookie")
			if !reflect.DeepEqual(anonymous.Header, headers) || anonymous.Method != request.Method ||
				anonymous.URL.String() != request.URL.String() || anonymous.Context().Value(contextKey{}) != "preserved" {
				t.Fatal("downgrade changed delivery or request context")
			}
			cached, err := Load(anonymous)
			if err != nil || cached != session || len(cached.Values) != 0 || !cached.IsNew ||
				!reflect.DeepEqual(cached.Options, SessionCookieOptions()) {
				t.Fatal("request registry retained a signed-in identity or wrong cookie options")
			}
		}
	}
}
