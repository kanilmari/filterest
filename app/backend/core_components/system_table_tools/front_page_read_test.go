// front_page_read_test.go
// Verifies the front page facade never leaks omitted datasets or changes delegate identity.
// Connects session fixtures to the real handler with only persistence and canonical reads stubbed.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
	presentation "easelect/frontend/shared/front_page_presentation"
	"github.com/gorilla/sessions"
)

func frontPageSessionRequest(t *testing.T, userID int, role, method, target string) *http.Request {
	t.Helper()
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store = sessions.NewCookieStore([]byte("front-page-test-key-32-byte-long!"))
	e_sessions.SessionName = "front_page_test"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = oldStore, oldName })
	request := httptest.NewRequest(method, target, nil)
	response := httptest.NewRecorder()
	session, err := e_sessions.GetOrCreateSession(response, request)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"], session.Values["user_role"] = userID, role
	if err := e_sessions.Save(response, request, session); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range response.Result().Cookies() {
		request.AddCookie(cookie)
	}
	return request
}

func stubFrontPageRead(t *testing.T, blocks []frontPageBlock) {
	t.Helper()
	layoutReader := frontPagePresentationReader
	frontPagePresentationReader = func(context.Context, *sql.DB) (*presentation.Value, string, error) { return nil, "none", nil }
	heroReader := frontPageHeroReader
	settings, background, resolver, canRead, handler, now := frontPageSettingsReader, frontPageBackgroundReader, frontPageBlocksResolver, frontPageCanRead, frontPageResultsHandler, frontPageNow
	frontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
		return backend.FrontPageSettings{SeparateFrontPage: true, FrontPageShowBlocks: true}, nil
	}
	frontPageHeroReader = func(dbutils.Querier) (frontPageHero, error) { return frontPageHero{}, nil }
	frontPageBackgroundReader = func(context.Context, *sql.DB) (*backend.FrontPageBackground, error) { return nil, nil }
	frontPageBlocksResolver = func(dbutils.Querier, int) ([]frontPageBlock, string, error) { return blocks, "common", nil }
	frontPageCanRead = func(int, string) bool { return true }
	t.Cleanup(func() {
		frontPagePresentationReader = layoutReader
		frontPageHeroReader = heroReader
		frontPageSettingsReader, frontPageBackgroundReader, frontPageBlocksResolver, frontPageCanRead, frontPageResultsHandler, frontPageNow = settings, background, resolver, canRead, handler, now
	})
}

func TestFrontPageReadOffAndMethods(t *testing.T) {
	stubFrontPageRead(t, nil)
	frontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
		return backend.FrontPageSettings{}, nil
	}
	for method, status := range map[string]int{"GET": 404, "POST": 405} {
		response := httptest.NewRecorder()
		GetFrontPageHandler(response, httptest.NewRequest(method, "/api/front-page", nil))
		if response.Code != status {
			t.Fatal(response.Code, response.Body.String())
		}
	}
}

func TestFrontPageReadOmitsDeniedAndFailedBlocksAndKeepsDelegateContext(t *testing.T) {
	stubFrontPageRead(t, []frontPageBlock{{Dataset: "allowed", ResultLimit: 1, Enabled: true}, {Dataset: "private-name", ResultLimit: 5, Enabled: true}, {Dataset: "ui-hidden", Enabled: true}, {Dataset: "failed-name", Enabled: true}, {Dataset: "disabled", Enabled: false}})
	frontPageCanRead = func(userID int, dataset string) bool { return userID > 0 && dataset != "private-name" }
	for _, actor := range []struct {
		id   int
		role string
	}{{42, "basic"}, {1, "guest"}} {
		t.Run(actor.role, func(t *testing.T) {
			request := frontPageSessionRequest(t, actor.id, actor.role, "GET", "/api/front-page?dataset=attacker&query=secret")
			lazy := dbutils.NewLazyTx(nil)
			ctx := dbutils.SetLazyTx(request.Context(), lazy)
			request = request.WithContext(ctx)
			calls := []string{}
			frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
				if r.Context() != ctx {
					t.Fatal("delegate lost transaction and actor context")
				}
				id, err := e_sessions.GetUserIDFromSession(r)
				if err != nil || id != actor.id {
					t.Fatal("delegate changed identity", id, err)
				}
				q := r.URL.Query()
				if r.Method != "GET" || r.URL.Path != "/api/get-results" || q.Get("row_count") != "0" || q.Get("sort_column") != "__newest" || q.Get("sort_order") != "DESC" || q.Get("view_key") != "card" || q.Has("include_card_support") || q.Has("include_map_support") || q.Get("query") != "" {
					t.Fatal(q)
				}
				calls = append(calls, q.Get("dataset"))
				if q.Get("dataset") == "ui-hidden" || q.Get("dataset") == "failed-name" {
					http.Error(w, "sensitive dataset name", 403)
					return
				}
				w.Write([]byte(`{"columns":["title"],"types":{"title":"text"},"data":[{"id":9,"title":"new"},{"id":8,"title":"old"}],"row_count":99}`))
			}
			response := httptest.NewRecorder()
			GetFrontPageHandler(response, request)
			if response.Code != 200 {
				t.Fatal(response.Code, response.Body.String())
			}
			var result struct {
				Blocks  []frontPageResultBlock `json:"blocks"`
				Partial bool                   `json:"partial"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Blocks) != 1 || len(result.Blocks[0].Data) != 1 || !strings.Contains(string(result.Blocks[0].Data[0]), `"id":9`) || len(calls) != 3 {
				t.Fatal(result, calls)
			}
			for _, hidden := range []string{"private-name", "ui-hidden", "failed-name", "sensitive", "row_count", "disabled"} {
				if strings.Contains(response.Body.String(), hidden) {
					t.Fatal("omitted dataset leaked", response.Body.String())
				}
			}
		})
	}
}

func TestFrontPageReadBudgetAndCanonicalPageCap(t *testing.T) {
	stubFrontPageRead(t, []frontPageBlock{{Dataset: "one", ResultLimit: 20, Enabled: true}, {Dataset: "two", ResultLimit: 5, Enabled: true}})
	start := time.Now()
	clockCalls := 0
	frontPageNow = func() time.Time {
		clockCalls++
		if clockCalls > 3 {
			return start.Add(3 * time.Second)
		}
		return start
	}
	calls := 0
	frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Write([]byte(`{"columns":["id"],"types":{},"data":[{"id":2},{"id":1}]}`))
	}
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	if calls != 1 || !strings.Contains(response.Body.String(), `"partial":true`) || !strings.Contains(response.Body.String(), `"id":1`) {
		t.Fatal(response.Body.String(), calls)
	}
	frontPageBlocksResolver = func(dbutils.Querier, int) ([]frontPageBlock, string, error) {
		return nil, "", errors.New("database failed")
	}
	GetFrontPageHandler(httptest.NewRecorder(), frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
}

func TestFrontPageReadBoxesOffDoesNotResolveOrDelegateData(t *testing.T) {
	stubFrontPageRead(t, nil)
	frontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
		return backend.FrontPageSettings{SeparateFrontPage: true, FrontPageShowBlocks: false}, nil
	}
	frontPageBlocksResolver = func(dbutils.Querier, int) ([]frontPageBlock, string, error) {
		t.Fatal("resolved hidden boxes")
		return nil, "", nil
	}
	frontPageResultsHandler = func(http.ResponseWriter, *http.Request) { t.Fatal("delegated hidden boxes") }
	frontPageHeroReader = func(dbutils.Querier) (frontPageHero, error) {
		return frontPageHero{Title: &frontPageHeroText{Fi: "Otsikko", En: "Title"}, Slogan: &frontPageHeroText{}}, nil
	}
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"blocks":[]`) || !strings.Contains(response.Body.String(), `"show_blocks":false`) || !strings.Contains(response.Body.String(), `"en":"Title"`) {
		t.Fatal(response.Code, response.Body.String())
	}
}
