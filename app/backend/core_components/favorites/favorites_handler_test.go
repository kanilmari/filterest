// favorites_handler_test.go
// Checks input and session ownership boundaries without database access.
// Follows the visual preference handler's injected persistence and session fixtures.
// Keeps client-supplied owner, table and row references outside the typed API.
package favorites

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func favoriteSession(t *testing.T, userID int) *http.Cookie {
	t.Helper()
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store = sessions.NewCookieStore([]byte("01234567890123456789012345678901"))
	e_sessions.SessionName = "session"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = oldStore, oldName })
	request := httptest.NewRequest("GET", "/", nil)
	response := httptest.NewRecorder()
	session, err := e_sessions.GetOrCreateSession(response, request)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = userID
	if err := session.Save(request, response); err != nil {
		t.Fatal(err)
	}
	return response.Result().Cookies()[0]
}

func TestFavoritesHandlerSessionOwnershipAndResponses(t *testing.T) {
	cookie := favoriteSession(t, 42)
	oldReader, oldAdder, oldDeleter := favoriteReader, favoriteAdder, favoriteDeleter
	t.Cleanup(func() { favoriteReader, favoriteAdder, favoriteDeleter = oldReader, oldAdder, oldDeleter })
	checkOwner := func(id int) {
		if id != 42 {
			t.Fatalf("owner = %d", id)
		}
	}
	favoriteReader = func(_ context.Context, id int) ([]favorite, error) { checkOwner(id); return []favorite{}, nil }
	favoriteAdder = func(_ context.Context, id int, route string) (favorite, bool, error) {
		checkOwner(id)
		if route == "/missing" {
			return favorite{}, false, errTargetNotFound
		}
		if route == "/error" {
			return favorite{}, false, errors.New("fixture")
		}
		return favorite{ID: 9, Type: "admin_tool", Route: route}, true, nil
	}
	favoriteDeleter = func(_ context.Context, id int, req favoriteRequest) (bool, error) {
		checkOwner(id)
		if req.ID != 9 && req.Route != "/tool" {
			t.Fatal(req)
		}
		return true, nil
	}
	for _, test := range []struct {
		method, body string
		status       int
		contains     string
	}{
		{"GET", "", 200, `"favorites":[]`},
		{"POST", `{"type":"admin_tool","route":"/tool"}`, 200, `"created":true`},
		{"POST", `{"type":"admin_tool","route":"/missing"}`, 404, "unavailable"},
		{"POST", `{"type":"admin_tool","route":"/error"}`, 500, "failed"},
		{"DELETE", `{"id":9}`, 200, `"removed":true`},
		{"DELETE", `{"type":"admin_tool","route":"/tool"}`, 200, `"removed":true`},
		{"POST", `{}`, 400, "invalid favorite request"},
	} {
		req := httptest.NewRequest(test.method, "/api/favorites?user_id=7", strings.NewReader(test.body))
		req.AddCookie(cookie)
		response := httptest.NewRecorder()
		FavoritesHandler(response, req)
		if response.Code != test.status || !strings.Contains(response.Body.String(), test.contains) {
			t.Fatal(test, response.Code, response.Body.String())
		}
		var body struct {
			OwnerUserID int `json:"owner_user_id"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.OwnerUserID != 42 {
			t.Fatalf("%s response owner = %d, decode error = %v", test.method, body.OwnerUserID, err)
		}
	}
}

func TestFavoritesResponseOwnerFollowsSession(t *testing.T) {
	oldReader, oldAdder, oldDeleter := favoriteReader, favoriteAdder, favoriteDeleter
	t.Cleanup(func() { favoriteReader, favoriteAdder, favoriteDeleter = oldReader, oldAdder, oldDeleter })
	favoriteReader = func(_ context.Context, _ int) ([]favorite, error) { return []favorite{}, nil }
	favoriteAdder = func(_ context.Context, _ int, route string) (favorite, bool, error) {
		return favorite{ID: 9, Type: "admin_tool", Route: route}, false, nil
	}
	favoriteDeleter = func(_ context.Context, _ int, _ favoriteRequest) (bool, error) { return false, nil }
	for _, userID := range []int{42, 73} {
		cookie := favoriteSession(t, userID)
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
			request := httptest.NewRequest(method, "/api/favorites?user_id=999", strings.NewReader(`{"type":"admin_tool","route":"/tool"}`))
			request.AddCookie(cookie)
			response := httptest.NewRecorder()
			FavoritesHandler(response, request)
			var body struct {
				OwnerUserID int `json:"owner_user_id"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != http.StatusOK || body.OwnerUserID != userID {
				t.Fatalf("%s: session owner %d, response %s, decode error %v", method, userID, response.Body.String(), err)
			}
		}
	}
}

func TestFavoritesRequestValidation(t *testing.T) {
	for _, method := range []string{"POST", "DELETE"} {
		for _, body := range []string{
			`null`, `[]`, `{}`, `{"type":"row","route":"/tool"}`, `{"type":"admin_tool","route":"tool"}`,
			`{"type":"admin_tool","route":""}`, `{"type":"admin_tool","route":"/tool","user_id":7}`,
			`{"type":"admin_tool","route":"/tool","target_table_uid":5}`, `{"type":"admin_tool","route":"/tool","target_key":"1"}`,
			`{"id":0}`, `{"id":-1}`, `{"id":0,"type":"admin_tool","route":"/tool"}`, `{"id":9,"type":"admin_tool","route":"/tool"}`,
			`{"type":"admin_tool","route":"/tool"}{}`, `{"type":"admin_tool","route":"/` + strings.Repeat("x", 200) + `"}`,
		} {
			req := httptest.NewRequest(method, "/api/favorites", strings.NewReader(body))
			if _, err := decodeFavoriteRequest(req); err == nil {
				t.Errorf("accepted %s %s", method, body)
			}
		}
	}
	if _, err := decodeFavoriteRequest(httptest.NewRequest("POST", "/", strings.NewReader(`{"id":9}`))); err == nil {
		t.Fatal("POST accepted id")
	}
}

func TestFavoritesHandlerRejectsVisitorAndAnonymous(t *testing.T) {
	cookie := favoriteSession(t, 1)
	for _, withCookie := range []bool{true, false} {
		req := httptest.NewRequest("GET", "/api/favorites", nil)
		if withCookie {
			req.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		FavoritesHandler(response, req)
		if response.Code != 401 {
			t.Fatal(response.Code)
		}
	}
}
