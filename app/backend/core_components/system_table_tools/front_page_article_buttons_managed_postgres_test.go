package system_table_tools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	config "easelect/backend/core_components/system_config_checks"
)

// Exercises the real dataset appearance writer, canonical row reader and Home
// administration endpoints in the same disposable database as a signed-in user.
func TestFrontPageArticleButtonsPostgresManagedPresentationRoundTrip(t *testing.T) {
	db, uid := articleButtonsPostgresFixture(t)
	const classic, page = "article_view", "image_first_page_view"
	const homeAdmin = "/api/admin/front-page/article-buttons"
	frontPageExec(t, db, `UPDATE system_functions SET disabled=true WHERE url_route_endpoint='/ui/view/image_first_page_view';
		INSERT INTO system_functions(id,name,disabled,specific_table_related,url_route_endpoint)
		VALUES(500003,'wo985_fixture_page',false,false,'/ui/view/image_first_page_view');
		INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
		SELECT id,500003,NULL FROM system_user_groups WHERE id IN(1,2,3)`)

	setTableDefault := func(value string) {
		t.Helper()
		current, err := store.ReadAppearance(db, uid, false)
		if err != nil || current.Defaults[store.RowPresentationPath] != classic {
			t.Fatalf("site default %v, err %v", current.Defaults[store.RowPresentationPath], err)
		}
		change := map[string]any{"schema_version": 2, "dataset_uid": uid, "version": current.Version, "shared_version": current.SharedVersion}
		if value == "" {
			change["unset"] = []string{store.RowPresentationPath}
		} else {
			change["set"] = map[string]any{store.RowPresentationPath: value}
		}
		commitAppearanceHTTP(t, db, appearanceHTTPRefusalRequest{path: "/api/admin/dataset-appearance", body: change, handler: AdminDatasetAppearanceHandler})
		saved, err := store.ReadAppearance(db, uid, false)
		if err != nil {
			t.Fatal(err)
		}
		override, _ := saved.Overrides[store.RowPresentationPath].(string)
		if override != value {
			t.Fatalf("stored override %q, want %q", override, value)
		}
	}

	// Observe which authorized row projection the real handler uses, including retries.
	realReader := frontPageResultsHandler
	defer func() { frontPageResultsHandler = realReader }()
	var reads []string
	frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
		reads = append(reads, r.URL.Query().Get("view_key"))
		realReader(w, r)
	}
	checkReads := func(want ...string) {
		t.Helper()
		if !slices.Equal(reads, want) {
			t.Fatalf("row projections %v, want %v", reads, want)
		}
		reads = nil
	}
	checkAdmin := func(stored string, unavailable int, wantReads ...string) {
		t.Helper()
		rec := httptest.NewRecorder()
		AdminFrontPageArticleButtonsHandler(rec, frontPageSessionRequest(t, 74, "admin", "GET", homeAdmin))
		var value struct {
			List        config.FrontPageArticleButtons `json:"article_buttons"`
			Unavailable []frontPageArticleUnavailable  `json:"unavailable_items"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &value); err != nil || rec.Code != 200 || len(value.List.Items) != 1 || value.List.Items[0].View != stored || len(value.Unavailable) != unavailable {
			t.Fatalf("private read status=%d body=%s err=%v", rec.Code, rec.Body.String(), err)
		}
		checkReads(wantReads...)
	}
	save := func(view string, wantStatus int, wantReads ...string) {
		t.Helper()
		list, revision, err := readFrontPageArticleButtons(context.Background(), db)
		if err != nil || len(list.Items) != 1 {
			t.Fatalf("stored Home buttons %v, err %v", list, err)
		}
		list.Items[0].View = view
		r := frontPageSessionRequest(t, 74, "admin", "POST", homeAdmin)
		r.Body = ioBody(resultJSON(map[string]any{"article_buttons": list, "version": revision}))
		tx := dbutils.NewLazyTx(db)
		defer tx.Rollback()
		rec := httptest.NewRecorder()
		AdminFrontPageArticleButtonsHandler(rec, r.WithContext(dbutils.SetLazyTx(r.Context(), tx)))
		if rec.Code != wantStatus {
			t.Fatalf("save %q: %d %s", view, rec.Code, rec.Body.String())
		}
		if rec.Code == 200 {
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
		}
		checkReads(wantReads...)
	}

	setTableDefault(page)
	save("", 200, page)
	checkAdmin("", 0, page)
	save(classic, 200, classic)
	checkAdmin(classic, 0, classic)
	save("", 200, page)

	frontPageExec(t, db, "DELETE FROM system_group_table_func_rights WHERE function_id=500001")
	articleButtonsInvalidateFixtureCaches()
	checkAdmin("", 0, page)
	save(classic, 400)
	setTableDefault("")
	checkAdmin("", 1)
	save("", 400)

	// The browser alone knows a visitor's per-tab choice. Preserve the authorized
	// Page label in the inherited response, even with a managed Article default.
	buttons, _ := articleButtonsPostgresHome(t, 42, "basic", "en")
	if len(buttons) != 1 || buttons[0].Href != "/wl128_article/87654321" || buttons[0].Label != "Contact" {
		t.Fatal("Page-only user's inherited candidate", buttons)
	}
	checkReads(page)
	frontPageExec(t, db, "DELETE FROM system_group_table_func_rights WHERE function_id=500003")
	articleButtonsInvalidateFixtureCaches()
	if buttons, _ := articleButtonsPostgresHome(t, 42, "basic", "en"); len(buttons) != 0 {
		t.Fatal("ungranted Home candidate", buttons)
	}
	checkReads()
	checkAdmin("", 1)
}
