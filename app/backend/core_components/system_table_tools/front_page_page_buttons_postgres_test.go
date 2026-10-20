// front_page_page_buttons_postgres_test.go
// Proves fresh-key Page activation and the two-right results matrix on PostgreSQL.
// Reuses the native disposable Home fixture and real admin/results handlers.
// Keeps production settings untouched while checking stored view and scoped denial.
package system_table_tools

import (
	"context"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/pipeline/access_control"
)

func TestFrontPageArticlePageButtonsFirstPostAndRightsPostgres(t *testing.T) {
	db, uid := articleButtonsPostgresFixture(t)
	frontPageExec(t, db, `DELETE FROM system_config WHERE key='front_page_article_buttons';
 INSERT INTO system_functions(id,name,url_route_endpoint,disabled,specific_table_related)
 VALUES(500260,'page_fixture','/ui/view/image_first_page_view',false,false);
 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
 SELECT id,500260,NULL FROM system_user_groups WHERE id IN(1,2,3);`)
	// F1: the production shape (fintravel 20.10.): the Page function is tableless and granted GLOBALLY.
	articleButtonsInvalidateFixtureCaches()
	read.InvalidateUserColumnSettingsCache(articleButtonsFixtureDataset, "image_first_page_view")
	t.Cleanup(func() { read.InvalidateUserColumnSettingsCache(articleButtonsFixtureDataset, "image_first_page_view") })
	buttons, _ := articleButtonsPostgresHome(t, 1, "guest", "en")
	if len(buttons) != 0 {
		t.Fatal("missing key produced buttons", buttons)
	}
	admin := httptest.NewRecorder()
	AdminFrontPageArticleButtonsHandler(admin, frontPageSessionRequest(t, 74, "admin", "GET", "/api/admin/front-page/article-buttons"))
	if admin.Code != 200 || !strings.Contains(admin.Body.String(), `"version":"none"`) {
		t.Fatal(admin.Code, admin.Body.String())
	}
	raw := fmt.Sprintf(`{"schema_version":1,"placement":"below_text","items":[{"table_uid":%d,"row_id":"%s","enabled":true,"view":"image_first_page_view"}]}`, uid, articleButtonsFixtureRow)
	post := frontPageSessionRequest(t, 74, "admin", "POST", "/api/admin/front-page/article-buttons")
	post.Body = io.NopCloser(strings.NewReader(`{"version":"none","article_buttons":` + raw + `}`))
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	post = post.WithContext(dbutils.SetLazyTx(post.Context(), lazy))
	saved := httptest.NewRecorder()
	AdminFrontPageArticleButtonsHandler(saved, post)
	if saved.Code != 200 {
		t.Fatal(saved.Code, saved.Body.String())
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	value, version, err := readFrontPageArticleButtons(context.Background(), db)
	if err != nil || version == "none" || len(value.Items) != 1 || value.Items[0].View != "image_first_page_view" {
		t.Fatal(value, version, err)
	}
	buttons, _ = articleButtonsPostgresHome(t, 1, "guest", "en")
	if len(buttons) != 1 || buttons[0].Href != "/wl128_article/87654321?view=image_first_page_view" {
		t.Fatal(buttons)
	}
	// Full /api/get-results route check and real GetResults. No projection/row can
	// reach the response unless both route grants name this exact dataset.
	handler := access_control.WithAccessControl("/api/get-results", "page-pilot", read.GetResultsHandlerWrapper)
	for _, pageGrant := range []bool{false, true} {
		for _, readGrant := range []bool{false, true} {
			t.Run(fmt.Sprintf("page=%t/read=%t", pageGrant, readGrant), func(t *testing.T) {
				frontPageExec(t, db, `DELETE FROM system_group_table_func_rights WHERE user_group_id=2 AND function_id IN(500260,500000)`)
				if pageGrant {
					frontPageExec(t, db, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) VALUES(2,500260,NULL)`)
				}
				if readGrant {
					frontPageExec(t, db, fmt.Sprintf(`INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) VALUES(2,500000,%d)`, uid))
				}
				r := frontPageSessionRequest(t, 42, "basic", "GET", "/api/get-results?dataset=wl128_article&id=87654321&row_count=0&view_key=image_first_page_view")
				response := httptest.NewRecorder()
				handler(response, r)
				if pageGrant && readGrant {
					if response.Code != 200 || !strings.Contains(response.Body.String(), articleButtonsFixtureRow) {
						t.Fatal(response.Code, response.Body.String())
					}
				} else if response.Code != 403 || strings.Contains(response.Body.String(), articleButtonsFixtureRow) || strings.Contains(response.Body.String(), "Contact") {
					t.Fatal(response.Code, response.Body.String())
				}
				buttons, _ := articleButtonsPostgresHome(t, 42, "basic", "en")
				if (len(buttons) == 1) != (pageGrant && readGrant) {
					t.Fatal(buttons)
				}
			})
		}
	}
	// The read grant stays for the scope cases below; only the Page grant varies.
	frontPageExec(t, db, fmt.Sprintf(`DELETE FROM system_group_table_func_rights WHERE user_group_id=2 AND function_id=500000;
 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) VALUES(2,500000,%d);`, uid))
	pageResults := func() *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		handler(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/get-results?dataset=wl128_article&id=87654321&view_key=image_first_page_view"))
		return response
	}
	// Tableless catalogue: a dataset-scoped Page grant (even on this dataset) does not count; only a global one does.
	frontPageExec(t, db, fmt.Sprintf(`DELETE FROM system_group_table_func_rights WHERE user_group_id=2 AND function_id=500260;
 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) VALUES(2,500260,%d);`, uid))
	if denied := pageResults(); denied.Code != 403 || strings.Contains(denied.Body.String(), articleButtonsFixtureRow) {
		t.Fatal(denied.Code, denied.Body.String())
	}
	// Dataset-specific catalogue: a Page grant on another real dataset must not authorize this row; one on it does.
	// The fixture also seeds the real Page function, so the catalogue flag changes for every row of the route.
	frontPageExec(t, db, `UPDATE system_functions SET specific_table_related=true WHERE url_route_endpoint='/ui/view/image_first_page_view';
 DELETE FROM system_group_table_func_rights WHERE user_group_id=2 AND function_id=500260;
 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
 SELECT 2,500260,table_uid FROM system_db_tables WHERE table_name='system_users';`)
	if denied := pageResults(); denied.Code != 403 || strings.Contains(denied.Body.String(), articleButtonsFixtureRow) {
		t.Fatal(denied.Code, denied.Body.String())
	}
	frontPageExec(t, db, fmt.Sprintf(`INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) VALUES(2,500260,%d)`, uid))
	if allowed := pageResults(); allowed.Code != 200 || !strings.Contains(allowed.Body.String(), articleButtonsFixtureRow) {
		t.Fatal(allowed.Code, allowed.Body.String())
	}
	frontPageExec(t, db, `UPDATE system_functions SET specific_table_related=false WHERE url_route_endpoint='/ui/view/image_first_page_view'`)
	// Saving administrators must hold their own Page right and the Page delegate
	// must still prove that the row exists; recovery never creates Home links.
	// Startup's EnsureAdminPermissions also gave the admin group a global grant on the seeded Page function, which
	// the canonical (global) scope now counts: remove every Page grant of the group.
	frontPageExec(t, db, `DELETE FROM system_group_table_func_rights WHERE user_group_id=1
 AND function_id IN (SELECT id FROM system_functions WHERE url_route_endpoint='/ui/view/image_first_page_view')`)
	if err := validateFrontPageArticleTargets(post, 74, []byte(raw)); err == nil {
		t.Fatal("admin save ignored missing Page right")
	}
}
