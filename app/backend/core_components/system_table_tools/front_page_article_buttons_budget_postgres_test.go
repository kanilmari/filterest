// front_page_article_buttons_budget_postgres_test.go
// Proves enabled Home boxes survive slow denied or unlabelled article reads.
// Connects real visitor grants and canonical projections to a controlled clock.
// Reuses only the disposable bootstrap fixture, without installation access.
package system_table_tools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	config "easelect/backend/core_components/system_config_checks"
)

func TestFrontPageArticleButtonsPostgresSlowOmissionsKeepEnabledBoxes(t *testing.T) {
	db, _ := articleButtonsPostgresFixture(t, frontPageBudgetContext(t))
	frontPageExec(t, db, `UPDATE system_config SET boolean_value=true WHERE key='front_page_show_blocks';
		INSERT INTO wl143_content VALUES(21,'Latest public box','2026-10-13');
		INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,card_element)
			SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
			CASE WHEN col.column_name='title' THEN 'header' ELSE '' END
			FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
			WHERE col.table_schema='public' AND col.table_name='wl143_content';
		INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
			SELECT 3,500000,table_uid FROM system_db_tables WHERE table_name='wl143_content';`)
	boxes := []frontPageBlockInput{{Dataset: "wl143_content", ResultLimit: 1, SortOrder: 1, Enabled: true}}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &boxes}); err != nil {
		t.Fatal(err)
	}
	configured, version, err := readFrontPageArticleButtons(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	empty, _ := json.Marshal(config.EmptyFrontPageArticleButtons())
	version, err = articleButtonsTestSave(db, empty, version)
	if err != nil {
		t.Fatal(err)
	}
	oldClock, oldHandler := frontPageNow, frontPageResultsHandler
	t.Cleanup(func() { frontPageNow, frontPageResultsHandler = oldClock, oldHandler })
	now := time.Now()
	frontPageNow = func() time.Time { return now }
	viewers := []struct {
		id   int
		role string
	}{{42, "basic"}, {1, "guest"}}
	baseline := map[string]string{}
	home := func(id int, role string) string {
		t.Helper()
		response := httptest.NewRecorder()
		GetFrontPageHandler(response, frontPageSessionRequest(t, id, role, "GET", "/api/front-page?lang=en"))
		var result struct {
			Blocks     []frontPageResultBlock   `json:"blocks"`
			Partial    bool                     `json:"partial"`
			ShowBlocks bool                     `json:"show_blocks"`
			Buttons    []frontPageArticleButton `json:"article_buttons"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || !result.ShowBlocks || result.Partial || len(result.Blocks) != 1 || len(result.Blocks[0].Data) != 1 || result.Blocks[0].Dataset != "wl143_content" || len(result.Buttons) != 0 {
			t.Fatal("readable boxes missing", role, response.Code, response.Body.String(), err)
		}
		return response.Body.String()
	}
	for _, viewer := range viewers {
		baseline[viewer.role] = home(viewer.id, viewer.role)
	}
	raw, _ := json.Marshal(configured)
	if _, err := articleButtonsTestSave(db, raw, version); err != nil {
		t.Fatal(err)
	}
	for _, omission := range []string{"denied row", "unlabelled row"} {
		t.Run(omission, func(t *testing.T) {
			if omission == "denied row" {
				frontPageExec(t, db, `UPDATE wl128_article SET published=false`)
			} else {
				frontPageExec(t, db, `UPDATE wl128_article SET published=true,headline=NULL`)
			}
			articleCalls := 0
			frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("view_key") != "article_view" {
					oldHandler(w, r)
					return
				}
				articleCalls++
				projection := httptest.NewRecorder()
				oldHandler(projection, r)
				var result frontPageArticleResult
				if err := json.Unmarshal(projection.Body.Bytes(), &result); err != nil || projection.Code != 200 {
					t.Fatal("canonical article read failed", projection.Body.String(), err)
				}
				if (omission == "denied row" && len(result.Data) != 0) || (omission == "unlabelled row" && (len(result.Data) != 1 || frontPageArticleTitle(r, 42, result) != "")) {
					t.Fatal("fixture does not omit this target", projection.Body.String())
				}
				now = now.Add(4 * time.Second)
				w.WriteHeader(projection.Code)
				w.Write(projection.Body.Bytes())
			}
			for _, viewer := range viewers {
				if got := home(viewer.id, viewer.role); got != baseline[viewer.role] {
					t.Fatal("slow omitted article changed visitor Home", viewer.role, baseline[viewer.role], got)
				}
			}
			if articleCalls != len(viewers) {
				t.Fatal("slow canonical reads were not exercised", articleCalls)
			}
		})
	}
}
