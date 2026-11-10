// front_page_article_buttons_inherit_test.go
// Proves inherited Home buttons choose one viewer-permitted projection before any row read.
// Connects the real Home resolver, administrator validator and store to bounded stubs.
// Keeps explicit classic and Page pinned, unpinned inheritance and no retried row read.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	config "easelect/backend/core_components/system_config_checks"
)

func stubHomeButtonView(t *testing.T, view string) {
	t.Helper()
	stubFrontPageArticleButtons(t)
	frontPageArticleButtonsReader = func(context.Context, *sql.DB) (config.FrontPageArticleButtons, string, error) {
		return config.FrontPageArticleButtons{SchemaVersion: 1, Placement: "below_text", Items: []config.FrontPageArticleItem{{TableUID: 102, RowID: "87654321", Enabled: true, View: view}}}, "v", nil
	}
}

func TestFrontPageInheritedButtonProjectionBeforeLookup(t *testing.T) {
	for _, test := range []struct {
		name, view       string
		article, page    bool
		readGrant        bool
		delegateStatus   int
		wantProjection   string
		wantHref         string
		pageMustNotCheck bool
	}{
		{name: "article viewer", article: true, page: true, readGrant: true, delegateStatus: 200, wantProjection: "article_view", wantHref: "/contact/87654321", pageMustNotCheck: true},
		{name: "page-only viewer", page: true, readGrant: true, delegateStatus: 200, wantProjection: "image_first_page_view", wantHref: "/contact/87654321"},
		{name: "no presentation right", readGrant: true, delegateStatus: 200},
		{name: "page-only without results grant", page: true, delegateStatus: 200},
		{name: "page-only row refused is not retried", page: true, readGrant: true, delegateStatus: 403, wantProjection: "image_first_page_view"},
		{name: "article row refused is not retried as Page", article: true, page: true, readGrant: true, delegateStatus: 403, wantProjection: "article_view", pageMustNotCheck: true},
		{name: "explicit classic stays pinned", view: "article_view", article: true, page: true, readGrant: true, delegateStatus: 200, wantProjection: "article_view", wantHref: "/contact/87654321?view=article_view", pageMustNotCheck: true},
		{name: "explicit classic never falls back to Page", view: "article_view", page: true, readGrant: true, delegateStatus: 200, pageMustNotCheck: true},
		{name: "explicit Page stays pinned", view: "image_first_page_view", article: true, page: true, readGrant: true, delegateStatus: 200, wantProjection: "image_first_page_view", wantHref: "/contact/87654321?view=image_first_page_view"},
	} {
		t.Run(test.name, func(t *testing.T) {
			stubHomeButtonView(t, test.view)
			frontPageArticleViewAllowed = func(int, string) bool { return test.article }
			frontPagePageViewAllowed = func(int, string) bool {
				if test.pageMustNotCheck {
					t.Fatal("Page grant consulted although the projection was already decided")
				}
				return test.page
			}
			frontPageArticleReadGranted = func(int, string) bool { return test.readGrant }
			projections := []string{}
			frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
				projections = append(projections, r.URL.Query().Get("view_key"))
				if test.delegateStatus != 200 {
					http.Error(w, "Secret title", test.delegateStatus)
					return
				}
				fmt.Fprint(w, `{"columns":["headline"],"types":{"headline":{"card_element":"header"}},"data":[{"id":87654321,"headline":"Readable title"}]}`)
			}
			buttons, _ := resolveFrontPageArticleButtons(frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page?lang=en"), 42)
			if test.wantProjection == "" {
				if len(projections) != 0 {
					t.Fatal("row read without a permitted projection", projections)
				}
			} else if len(projections) != 1 || projections[0] != test.wantProjection {
				t.Fatal("expected exactly one read through", test.wantProjection, projections)
			}
			if test.wantHref == "" {
				if len(buttons) != 0 {
					t.Fatal("button without a readable permitted projection", buttons)
				}
				return
			}
			if len(buttons) != 1 || buttons[0].Href != test.wantHref || buttons[0].Label != "Readable title" {
				t.Fatal(buttons)
			}
		})
	}
}

func TestFrontPageArticleHrefPinsOnlyStoredViews(t *testing.T) {
	for stored, want := range map[string]string{
		"": "/news%20x/7", "article_view": "/news%20x/7?view=article_view", "image_first_page_view": "/news%20x/7?view=image_first_page_view",
	} {
		if got, ok := frontPageArticleHref("/news%20x/7", stored); !ok || got != want {
			t.Fatal(stored, got, want)
		}
	}
}

func TestFrontPageAdministratorInheritedProjection(t *testing.T) {
	stubFrontPageArticleButtons(t)
	for _, test := range []struct {
		view, dataset, site string
		article, page       bool
		want                string
	}{
		{"", "image_first_page_view", "article_view", true, true, "image_first_page_view"},
		{"", "image_first_view", "image_first_page_view", true, true, "article_view"},
		{"", "", "image_first_page_view", false, true, "image_first_page_view"},
		{"", "", "article_view", false, true, ""},
		{"", "", "article_view", false, false, ""},
		{"article_view", "", "", false, true, ""},
		{"image_first_page_view", "", "", true, false, ""},
		{"image_first_page_view", "", "", false, true, "image_first_page_view"},
	} {
		frontPageArticleViewAllowed = func(int, string) bool { return test.article }
		frontPagePageViewAllowed = func(int, string) bool { return test.page }
		frontPageAdminRowDefaults = func(*http.Request, int, string) (string, string, error) {
			if test.view != "" || (!test.article && !test.page) {
				t.Fatal("unexpected managed settings read")
			}
			return test.dataset, test.site, nil
		}
		got, allowed := frontPageAdminArticleProjection(httptest.NewRequest("GET", "/", nil), 74, "private_dataset", config.FrontPageArticleItem{View: test.view})
		if allowed != (test.want != "") || (allowed && got != test.want) {
			t.Fatal(test, got, allowed)
		}
	}
	// A Page-only administrator validates an inherited Page target exactly once.
	frontPageArticleViewAllowed = func(int, string) bool { return false }
	frontPagePageViewAllowed = func(int, string) bool { return true }
	frontPageAdminRowDefaults = func(*http.Request, int, string) (string, string, error) { return "", "image_first_page_view", nil }
	projections := []string{}
	frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
		projections = append(projections, r.URL.Query().Get("view_key"))
		w.WriteHeader(403)
	}
	raw := []byte(`{"schema_version":1,"placement":"below_text","items":[{"table_uid":102,"row_id":"5","enabled":true}]}`)
	if err := validateFrontPageArticleTargets(frontPageSessionRequest(t, 74, "admin", "POST", "/"), 74, raw); err == nil || len(projections) != 1 || projections[0] != "image_first_page_view" {
		t.Fatal("refused inherited target accepted or retried", err, projections)
	}
}

func TestFrontPageInheritanceRestoreAndReadBack(t *testing.T) {
	stubFrontPageArticleButtons(t)
	state := &articleButtonsTestState{}
	db := articleButtonsUnitDB(t, state)
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	frontPageArticleButtonsReader = readFrontPageArticleButtons
	frontPageResultsHandler = func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, `{"data":[{"id":5}]}`) }
	explicit := []byte(`{"schema_version":1,"placement":"below_text","items":[{"table_uid":102,"row_id":"5","enabled":true,"view":"article_view"}]}`)
	version, err := articleButtonsTestSave(db, explicit, "none")
	if err != nil {
		t.Fatal(err)
	}
	inherited := []byte(`{"schema_version":1,"placement":"below_text","items":[{"table_uid":102,"row_id":"5","enabled":true}]}`)
	if version, err = articleButtonsTestSave(db, inherited, version); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	AdminFrontPageArticleButtonsHandler(response, frontPageSessionRequest(t, 74, "admin", "GET", "/api/admin/front-page/article-buttons"))
	var payload struct {
		ArticleButtons json.RawMessage `json:"article_buttons"`
		Version        string          `json:"version"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &payload) != nil || payload.Version != version {
		t.Fatal(response.Code, response.Body.String())
	}
	if strings.Contains(string(payload.ArticleButtons), `"view"`) || !strings.Contains(string(payload.ArticleButtons), `"row_id":"5"`) {
		t.Fatal("inheritance did not read back as an absent view", string(payload.ArticleButtons))
	}
}
