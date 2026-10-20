// front_page_article_buttons_budget_test.go
// Proves optional article work cannot change Home's newest-row boxes or partial.
// Connects the real facade to a controlled clock and slow canonical read results.
// Covers denial, missing labels, late success and the independent article budget.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	config "easelect/backend/core_components/system_config_checks"
)

func TestFrontPageArticleButtonsSlowOmissionsKeepBoxesAndPartial(t *testing.T) {
	for _, partial := range []bool{false, true} {
		for _, slow := range []string{"setting", "target", "denied row", "unlabelled row", "late readable row"} {
			t.Run(fmt.Sprintf("partial=%t/%s", partial, slow), func(t *testing.T) {
				stubFrontPageArticleButtons(t)
				frontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
					return backend.FrontPageSettings{SeparateFrontPage: true, FrontPageShowBlocks: true}, nil
				}
				frontPageBlocksResolver = func(dbutils.Querier, int) ([]frontPageBlock, string, error) {
					return []frontPageBlock{{Dataset: "box_one", ResultLimit: 1, Enabled: true}, {Dataset: "box_two", ResultLimit: 1, Enabled: true}}, "common", nil
				}
				start := time.Now()
				now := start
				frontPageNow = func() time.Time { return now }
				configured, articleCalls, boxCalls := false, 0, 0
				frontPageArticleButtonsReader = func(ctx context.Context, _ *sql.DB) (config.FrontPageArticleButtons, string, error) {
					if _, bounded := ctx.Deadline(); !bounded {
						t.Fatal("setting read lacks the article deadline")
					}
					value := config.EmptyFrontPageArticleButtons()
					if configured {
						value.Items = []config.FrontPageArticleItem{{102, "87654321", true, ""}, {102, "87654322", true, ""}}
						if slow == "setting" {
							now = now.Add(4 * time.Second)
						}
					}
					return value, "v", nil
				}
				frontPageArticleTargetReader = func(*http.Request, int) (string, error) {
					if slow == "target" {
						now = now.Add(4 * time.Second)
					}
					return "private_dataset", nil
				}
				frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Query().Get("view_key") == "card" {
						boxCalls++
						fmt.Fprint(w, `{"columns":["title"],"types":{},"data":[{"id":9,"title":"Newest"}]}`)
						if partial {
							now = now.Add(3 * time.Second)
						}
						return
					}
					articleCalls++
					now = now.Add(4 * time.Second)
					switch slow {
					case "denied row":
						http.Error(w, "private target", http.StatusForbidden)
					case "unlabelled row":
						fmt.Fprint(w, `{"columns":["headline"],"types":{"headline":{"card_element":"header"}},"data":[{"id":87654321,"headline":" "}]}`)
					default:
						fmt.Fprint(w, `{"columns":["headline"],"types":{"headline":{"card_element":"header"}},"data":[{"id":87654321,"headline":"Late title"}]}`)
					}
				}
				request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page?lang=en")
				empty := httptest.NewRecorder()
				GetFrontPageHandler(empty, request)
				var baseline struct {
					Blocks  []frontPageResultBlock `json:"blocks"`
					Partial bool                   `json:"partial"`
				}
				if err := json.Unmarshal(empty.Body.Bytes(), &baseline); err != nil || baseline.Partial != partial || len(baseline.Blocks) != boxCalls || boxCalls == 0 {
					t.Fatal("invalid baseline", empty.Body.String(), err)
				}
				now, configured, boxCalls = start, true, 0
				omitted := httptest.NewRecorder()
				GetFrontPageHandler(omitted, request)
				if empty.Code != 200 || omitted.Code != 200 || empty.Body.String() != omitted.Body.String() || boxCalls != len(baseline.Blocks) {
					t.Fatal("omitted configuration changed Home", empty.Body.String(), omitted.Body.String())
				}
				wantArticleCalls := 1
				if slow == "setting" || slow == "target" {
					wantArticleCalls = 0
				}
				if articleCalls != wantArticleCalls {
					t.Fatal("article budget attempted a later target", articleCalls)
				}
			})
		}
	}
}

func TestFrontPageArticleButtonsBudgetStartsAfterBoxes(t *testing.T) {
	stubFrontPageArticleButtons(t)
	frontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
		return backend.FrontPageSettings{SeparateFrontPage: true, FrontPageShowBlocks: true}, nil
	}
	frontPageBlocksResolver = func(dbutils.Querier, int) ([]frontPageBlock, string, error) {
		return []frontPageBlock{{Dataset: "box", ResultLimit: 1, Enabled: true}}, "common", nil
	}
	now := time.Now()
	frontPageNow = func() time.Time { return now }
	frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
		now = now.Add(2 * time.Second)
		if r.URL.Query().Get("view_key") == "card" {
			fmt.Fprint(w, `{"columns":["title"],"types":{},"data":[{"id":9,"title":"Newest"}]}`)
			return
		}
		fmt.Fprint(w, `{"columns":["headline"],"types":{"headline":{"card_element":"header"}},"data":[{"id":87654321,"headline":"Contact"}]}`)
	}
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page?lang=en"))
	var result struct {
		Blocks  []frontPageResultBlock   `json:"blocks"`
		Partial bool                     `json:"partial"`
		Buttons []frontPageArticleButton `json:"article_buttons"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || len(result.Blocks) != 1 || result.Partial || len(result.Buttons) != 1 || result.Buttons[0].Label != "Contact" {
		t.Fatal("boxes spent the article budget", response.Body.String(), err)
	}
}
