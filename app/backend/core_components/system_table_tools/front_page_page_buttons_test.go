// front_page_page_buttons_test.go
// Proves the opt-in Home Page contract and fresh-key activation without PostgreSQL.
// Connects the real parser, handler, saver and title delegate to bounded test inputs.
// Keeps legacy items and fail-closed settings behavior covered alongside Page.
package system_table_tools

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	config "easelect/backend/core_components/system_config_checks"
)

const pageButtonsJSON = `{"schema_version":1,"placement":"top_row","items":[{"table_uid":201,"row_id":"5","enabled":true,"view":"image_first_page_view"}]}`

func stubPageButton(t *testing.T) {
	stubFrontPageArticleButtons(t)
	old := frontPagePageViewAllowed
	t.Cleanup(func() { frontPagePageViewAllowed = old })
	frontPagePageViewAllowed = func(user int, dataset string) bool { return user == 74 && dataset == "private_dataset" }
	frontPageArticleButtonsReader = func(ctx context.Context, _ *sql.DB) (config.FrontPageArticleButtons, string, error) {
		value, err := config.ParseFrontPageArticleButtons([]byte(pageButtonsJSON))
		return value, "v", err
	}
}

func TestFrontPagePageButtonsVisibilityHrefAndDelegate(t *testing.T) {
	for _, denial := range []string{"none", "page", "get-results"} {
		t.Run(denial, func(t *testing.T) {
			stubPageButton(t)
			frontPageArticleViewAllowed = func(int, string) bool { t.Fatal("Page consulted Article grant"); return false }
			frontPagePageViewAllowed = func(user int, dataset string) bool {
				return denial != "page" && user == 74 && dataset == "private_dataset"
			}
			frontPageArticleReadGranted = func(int, string) bool { return denial != "get-results" }
			calls := 0
			frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Query().Get("view_key") != "image_first_page_view" || r.URL.Query().Get("id") != "5" {
					t.Fatal(r.URL)
				}
				fmt.Fprint(w, `{"columns":["title"],"types":{"title":{"card_element":"header"}},"data":[{"id":5,"title":"Page title"}]}`)
			}
			buttons, _ := resolveFrontPageArticleButtons(frontPageSessionRequest(t, 74, "admin", "GET", "/api/front-page"), 74)
			if denial == "none" {
				if len(buttons) != 1 || buttons[0].Href != "/contact/5?view=image_first_page_view" || buttons[0].Label != "Page title" || calls != 1 {
					t.Fatal(buttons, calls)
				}
			} else if len(buttons) != 0 || calls != 0 {
				t.Fatal("denied target delegated", buttons, calls)
			}
		})
	}
}

func TestFrontPagePageButtonsAdminTargetUsesPage(t *testing.T) {
	stubPageButton(t)
	frontPageArticleViewAllowed = func(int, string) bool { return false }
	calls := 0
	frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Query().Get("view_key") != "image_first_page_view" {
			t.Fatal(r.URL)
		}
		fmt.Fprint(w, `{"data":[{"id":5}]}`)
	}
	r := frontPageSessionRequest(t, 74, "admin", "POST", "/api/admin/front-page/article-buttons")
	if err := validateFrontPageArticleTargets(r, 74, []byte(pageButtonsJSON)); err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
	frontPagePageViewAllowed = func(int, string) bool { return false }
	if err := validateFrontPageArticleTargets(r, 74, []byte(pageButtonsJSON)); err == nil || calls != 1 {
		t.Fatal("missing admin Page grant reached delegate", err, calls)
	}
	frontPagePageViewAllowed = func(int, string) bool { return true }
	frontPageResultsHandler = func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(403) }
	if err := validateFrontPageArticleTargets(r, 74, []byte(pageButtonsJSON)); err == nil {
		t.Fatal("Page delegate denial ignored")
	}
}

func TestFrontPagePageButtonsMissingKeyAndFirstPost(t *testing.T) {
	stubPageButton(t)
	state := &articleButtonsTestState{}
	db := articleButtonsUnitDB(t, state)
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	frontPageArticleButtonsReader = readFrontPageArticleButtons
	frontPageResultsHandler = func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, `{"data":[{"id":5}]}`) }
	r := frontPageSessionRequest(t, 74, "admin", "GET", "/api/front-page")
	public := httptest.NewRecorder()
	GetFrontPageHandler(public, r)
	if public.Code != 200 || !strings.Contains(public.Body.String(), `"article_buttons":[]`) {
		t.Fatal(public.Code, public.Body.String())
	}
	admin := httptest.NewRecorder()
	AdminFrontPageArticleButtonsHandler(admin, r)
	if admin.Code != 200 || !strings.Contains(admin.Body.String(), `"version":"none"`) || !strings.Contains(admin.Body.String(), `"configuration_error":""`) {
		t.Fatal(admin.Code, admin.Body.String())
	}
	post := frontPageSessionRequest(t, 74, "admin", "POST", "/api/admin/front-page/article-buttons")
	post.Body = io.NopCloser(strings.NewReader(`{"article_buttons":` + pageButtonsJSON + `,"version":"none"}`))
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	post = post.WithContext(dbutils.SetLazyTx(post.Context(), lazy))
	saved := httptest.NewRecorder()
	AdminFrontPageArticleButtonsHandler(saved, post)
	if saved.Code != 200 || state.writes != 1 {
		t.Fatal(saved.Code, saved.Body.String(), state.writes)
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	value, version, err := readFrontPageArticleButtons(context.Background(), db)
	if err != nil || version == "none" || value.Items[0].View != "image_first_page_view" {
		t.Fatal(value, version, err)
	}
}

func TestFrontPagePageButtonsUnknownViewPostAndStoredRead(t *testing.T) {
	stubPageButton(t)
	invalid := strings.Replace(pageButtonsJSON, "image_first_page_view", "unknown", 1)
	r := frontPageSessionRequest(t, 74, "admin", "POST", "/api/admin/front-page/article-buttons")
	r.Body = io.NopCloser(strings.NewReader(`{"article_buttons":` + invalid + `,"version":"none"}`))
	response := httptest.NewRecorder()
	AdminFrontPageArticleButtonsHandler(response, r)
	if response.Code != 400 {
		t.Fatal(response.Code, response.Body.String())
	}
	db := articleButtonsUnitDB(t, &articleButtonsTestState{raw: []byte(invalid), valueType: 5})
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	frontPageArticleButtonsReader = readFrontPageArticleButtons
	frontPageResultsHandler = func(http.ResponseWriter, *http.Request) { t.Fatal("invalid stored setting delegated") }
	buttons, value := resolveFrontPageArticleButtons(frontPageSessionRequest(t, 74, "admin", "GET", "/api/front-page"), 74)
	if len(buttons) != 0 || len(value.Items) != 0 {
		t.Fatal(buttons, value)
	}
}
