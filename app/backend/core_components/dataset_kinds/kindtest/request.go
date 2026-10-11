// request.go
// Builds an authenticated local request for schema mutation regression tests.
// Connects cookie sessions with direct HTTP handler invocation, without sockets.
// Keeps cache lifecycle proofs independent of the running installation.
package kindtest

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func AuthenticatedRequest(t *testing.T, method, url string, body io.Reader) *http.Request {
	t.Helper()
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store = sessions.NewCookieStore([]byte("kind-invalidation-session-key-32-bytes"))
	e_sessions.SessionName = "session"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = oldStore, oldName })
	r := httptest.NewRequest(method, url, body)
	// The session store access guard allows reads and writes only through e_sessions.Load and e_sessions.Save.
	s, err := e_sessions.Load(r)
	if err != nil {
		t.Fatal(err)
	}
	s.Values["user_id"], s.Values["user_role"] = 42, "admin"
	w := httptest.NewRecorder()
	if err := e_sessions.Save(w, r, s); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range w.Result().Cookies() {
		r.AddCookie(cookie)
	}
	return r
}
