// session_expiry_responder_test.go
// Verifies the one answer the application gives when a sign-in can no longer be accepted.
// Between the authentication pipeline stages and the browser or script that asked.
// Exists because the earlier answer — a redirect to the login page — reached a
// background request as the login page's own HTML with a success status, and the
// application had no way to tell that apart from real data.
// Uses no database and no network.
package session_expiry

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gorillaSessions "github.com/gorilla/sessions"
)

func signedInSession() *gorillaSessions.Session {
	store := gorillaSessions.NewCookieStore([]byte("test-secret-key-32-bytes-padding!"))
	session := gorillaSessions.NewSession(store, "session")
	session.Options = &gorillaSessions.Options{Path: "/", MaxAge: 3600}
	session.Values["user_id"] = 42
	session.Values["username"] = "someone"
	session.Values["authenticated"] = true
	return session
}

func apiRequest() *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/api/user-permissions", nil)
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	return request
}

func pageRequest(target string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	return request
}

// The regression this whole change exists for: a request for data must never be
// answered with a redirect that a browser silently follows to a page.
func TestDataRequestIsToldInsteadOfBeingSentToThePage(t *testing.T) {
	recorder := httptest.NewRecorder()

	RespondSignInNoLongerValid(recorder, apiRequest(), signedInSession(), "test")

	if recorder.Code == http.StatusSeeOther || recorder.Code == http.StatusFound {
		t.Fatalf("a data request was redirected to a page: status %d, Location %q",
			recorder.Code, recorder.Header().Get("Location"))
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", recorder.Code, http.StatusForbidden)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
		t.Fatalf("Content-Type: got %q, want JSON", contentType)
	}

	var body map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode answer: %v", err)
	}
	if body["auth_failure"] != true {
		t.Fatalf("the answer does not say the sign-in ended: %#v", body)
	}
	if body["error"] != SessionNoLongerValidMessage {
		t.Fatalf("reason: got %#v, want %q", body["error"], SessionNoLongerValidMessage)
	}
}

func TestPageNavigationReachesTheLoginPageWithItsExplanation(t *testing.T) {
	recorder := httptest.NewRecorder()

	RespondSignInNoLongerValid(recorder, pageRequest("/reports?view=card"), signedInSession(), "test")

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status: got %d, want %d", recorder.Code, http.StatusSeeOther)
	}
	location := recorder.Header().Get("Location")
	if !strings.HasPrefix(location, "/login?") {
		t.Fatalf("Location: got %q, want the login page", location)
	}
	if !strings.Contains(location, AuthNoticeParameter+"="+SessionEndedNotice) {
		t.Fatalf("Location carries no explanation for the person: %q", location)
	}
	if !strings.Contains(location, "redirect=%2Freports%3Fview%3Dcard") {
		t.Fatalf("Location does not bring the person back: %q", location)
	}
}

// Without this, GET /login sends an apparently signed-in visitor straight back to
// the page that just refused them, and the person never reaches a sign-in form.
func TestTheEndedSignInIsDroppedFromTheSession(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		request *http.Request
	}{
		{"data request", apiRequest()},
		{"page navigation", pageRequest("/reports")},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			session := signedInSession()
			RespondSignInNoLongerValid(httptest.NewRecorder(), testCase.request, session, "test")

			for _, key := range []string{"user_id", "username", "authenticated"} {
				if _, remains := session.Values[key]; remains {
					t.Fatalf("the ended sign-in still carries %q", key)
				}
			}
		})
	}
}

func TestPageNavigationRemembersWhereThePersonWasGoing(t *testing.T) {
	session := signedInSession()
	RespondSignInNoLongerValid(httptest.NewRecorder(), pageRequest("/reports?view=card"), session, "test")

	if session.Values["redirect_after_login"] != "/reports?view=card" {
		t.Fatalf("return address: got %#v", session.Values["redirect_after_login"])
	}
}

func TestTheLoginPageIsNeverOfferedAsAReturnAddress(t *testing.T) {
	session := signedInSession()
	RespondSignInNoLongerValid(httptest.NewRecorder(), pageRequest("/login?redirect=%2Freports"), session, "test")

	if session.Values["redirect_after_login"] != "/" {
		t.Fatalf("return address: got %#v, want /", session.Values["redirect_after_login"])
	}
}

func TestAMissingSessionIsStillAnswered(t *testing.T) {
	recorder := httptest.NewRecorder()

	RespondSignInNoLongerValid(recorder, apiRequest(), nil, "test")

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

func TestOnlyARealPageNavigationCountsAsOne(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		request func() *http.Request
		want    bool
	}{
		{
			name:    "a person opening an address",
			request: func() *http.Request { return pageRequest("/reports") },
			want:    true,
		},
		{
			name: "an address opened without the fetch-mode header",
			request: func() *http.Request {
				request := pageRequest("/reports")
				request.Header.Del("Sec-Fetch-Mode")
				return request
			},
			want: true,
		},
		{
			name:    "a background request for data",
			request: apiRequest,
			want:    false,
		},
		{
			name: "a script asking for a page",
			request: func() *http.Request {
				request := pageRequest("/reports")
				request.Header.Set("Sec-Fetch-Mode", "cors")
				return request
			},
			want: false,
		},
		{
			name: "a form submission",
			request: func() *http.Request {
				request := httptest.NewRequest(http.MethodPost, "/reports", nil)
				request.Header.Set("Accept", "text/html")
				request.Header.Set("Sec-Fetch-Mode", "navigate")
				return request
			},
			want: false,
		},
		{
			name:    "no request at all",
			request: func() *http.Request { return nil },
			want:    false,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsBrowserDocumentNavigation(testCase.request()); got != testCase.want {
				t.Fatalf("IsBrowserDocumentNavigation: got %v, want %v", got, testCase.want)
			}
		})
	}
}
