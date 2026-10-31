// front_page_article_buttons_security_postgres_test.go
// Proves Home article privacy against real grants, row policies and limited pools.
// Connects disposable bootstrap, three sessions and the canonical results pipeline.
// Never connects to an installation database; denied targets leave no identifiers.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	config "easelect/backend/core_components/system_config_checks"
)

const articleButtonsFixtureDataset = "wl128_article"
const articleButtonsFixtureRow = "87654321"

func articleButtonsPostgresFixture(t *testing.T, contexts ...context.Context) (*sql.DB, int) {
	t.Helper()
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "")
	db := frontPageDisposableDB(t, contexts...)
	frontPageExec(t, db, `CREATE TABLE wl128_article(id bigint PRIMARY KEY,headline jsonb,published boolean,
		user_id bigint REFERENCES system_users(id));
		INSERT INTO wl128_article VALUES(87654321,'{"fi":"Ota yhteyttä","en":"Contact","ch":"联系","yue":"聯絡"}',true,73);
		INSERT INTO system_db_tables(table_name,schema_name,folder_id) VALUES('wl128_article','public',1);
		INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,card_element,is_multilingual,must_be_true_unless_own)
			SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
			CASE WHEN col.column_name='headline' THEN 'header' ELSE '' END,
			col.column_name='headline',col.column_name='published'
			FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
			WHERE col.table_schema='public' AND col.table_name='wl128_article';
		INSERT INTO system_users(id,username,enabled) VALUES(74,'Fixture administrator',true);
		INSERT INTO system_user_group_memberships(user_id,group_id) VALUES(74,1),(1,3) ON CONFLICT DO NOTHING;
		UPDATE system_functions SET disabled=true WHERE url_route_endpoint='/ui/view/article_view';
		INSERT INTO system_functions(id,name,disabled,specific_table_related,url_route_endpoint)
			VALUES(500001,'home_article_fixture_view',false,false,'/ui/view/article_view'),
			(500002,'system_table_tools.AdminFrontPageArticleButtonsHandler',false,false,'/api/admin/front-page/article-buttons');
		INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
			SELECT groups.id,500000,registry.table_uid FROM system_user_groups groups CROSS JOIN system_db_tables registry
			WHERE groups.id IN(1,2,3) AND registry.table_name='wl128_article';
		INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
			SELECT id,500001,NULL FROM system_user_groups WHERE id IN(1,2,3);
		UPDATE system_config SET boolean_value=true WHERE key='separate_front_page';
		UPDATE system_config SET boolean_value=false WHERE key='front_page_show_blocks';`)
	if err := backend.EnsureAdminPermissions(db); err != nil {
		t.Fatal(err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights WHERE user_group_id=1 AND function_id=500002 AND target_table_uid IS NULL`) != 1 {
		t.Fatal("administrator route seed missing")
	}
	frontPageRuntimeDB(t, db)
	var uid int
	if err := db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name='wl128_article'`).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	articleButtonsInvalidateFixtureCaches()
	t.Cleanup(articleButtonsInvalidateFixtureCaches)
	value := config.FrontPageArticleButtons{SchemaVersion: 1, Placement: "below_text", Items: []config.FrontPageArticleItem{{uid, articleButtonsFixtureRow, true, ""}}}
	raw, _ := json.Marshal(value)
	request := frontPageSessionRequest(t, 74, "admin", "POST", "/api/admin/front-page/article-buttons")
	if err := validateFrontPageArticleTargets(request, 74, raw); err != nil {
		t.Fatal("administrator cannot read fixture", err)
	}
	if _, err := articleButtonsTestSave(db, raw, "none"); err != nil {
		t.Fatal(err)
	}
	return db, uid
}

func articleButtonsInvalidateFixtureCaches() {
	read.InvalidateSchemaCache(articleButtonsFixtureDataset)
	read.InvalidateDatasetExistsCache(articleButtonsFixtureDataset)
	read.InvalidatePermissionsCache(articleButtonsFixtureDataset)
	read.InvalidateUserColumnSettingsCache(articleButtonsFixtureDataset, "article_view")
}

func articleButtonsPostgresHome(t *testing.T, id int, role, language string) ([]frontPageArticleButton, string) {
	t.Helper()
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, id, role, "GET", "/api/front-page?lang="+language))
	var result struct {
		Buttons   []frontPageArticleButton `json:"article_buttons"`
		Placement string                   `json:"article_buttons_placement"`
		Blocks    []any                    `json:"blocks"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || result.Buttons == nil || result.Placement != "below_text" || len(result.Blocks) != 0 {
		t.Fatal(response.Code, response.Body.String(), err)
	}
	if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("Vary") != "Cookie" {
		t.Fatal(response.Header())
	}
	for _, secret := range []string{"table_uid", "row_id", "items", "unavailable_items", "configuration_error"} {
		if strings.Contains(response.Body.String(), secret) {
			t.Fatal("configuration leaked", secret, response.Body.String())
		}
	}
	// Home's presentation carries its own schema_version, so the configuration's version is checked where it could
	// leak: at the top level and inside the button entries, which must hold exactly href and label.
	var shape struct {
		SchemaVersion json.RawMessage              `json:"schema_version"`
		Buttons       []map[string]json.RawMessage `json:"article_buttons"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &shape); err != nil || shape.SchemaVersion != nil {
		t.Fatal("configuration leaked schema_version", response.Body.String(), err)
	}
	for _, entry := range shape.Buttons {
		_, hasHref := entry["href"]
		_, hasLabel := entry["label"]
		if len(entry) != 2 || !hasHref || !hasLabel {
			t.Fatal("button entry carries more than href and label", response.Body.String())
		}
	}
	if len(result.Buttons) == 0 && (strings.Contains(response.Body.String(), articleButtonsFixtureDataset) || strings.Contains(response.Body.String(), articleButtonsFixtureRow) || strings.Contains(response.Body.String(), "Contact") || strings.Contains(response.Body.String(), "Ota yhteyttä")) {
		t.Fatal("denied identity or title leaked", response.Body.String())
	}
	t.Logf("viewer=%s language=%s article_buttons=%s", role, language, resultJSON(result.Buttons))
	return result.Buttons, response.Body.String()
}

func resultJSON(value any) string { raw, _ := json.Marshal(value); return string(raw) }

func TestFrontPageArticleButtonsPostgresVisitorRightsProjectionAndLanguages(t *testing.T) {
	db, _ := articleButtonsPostgresFixture(t)
	viewers := []struct {
		id   int
		role string
	}{{74, "admin"}, {42, "basic"}, {1, "guest"}}
	for _, viewer := range viewers {
		for language, label := range map[string]string{"fi": "Ota yhteyttä", "en": "Contact", "ch": "联系", "yue": "聯絡"} {
			buttons, _ := articleButtonsPostgresHome(t, viewer.id, viewer.role, language)
			if len(buttons) != 1 || buttons[0].Label != label || buttons[0].Href != "/wl128_article/87654321?view=article_view" {
				t.Fatal(viewer, buttons)
			}
		}
	}
	for _, denial := range []string{"article grant", "dataset read grant", "hidden dataset", "row policy", "column select"} {
		t.Run(denial, func(t *testing.T) {
			// Even explicit development recovery cannot turn a missing grant
			// into a Home link. Normal administrator reads retain their policy.
			if denial == "article grant" || denial == "dataset read grant" {
				t.Setenv("ENVIRONMENT_TYPE", "dev")
				t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "1")
			}
			switch denial {
			case "article grant":
				frontPageExec(t, db, `DELETE FROM system_group_table_func_rights WHERE function_id=500001`)
			case "dataset read grant":
				frontPageExec(t, db, `DELETE FROM system_group_table_func_rights WHERE function_id=500000 AND target_table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='wl128_article')`)
			case "hidden dataset":
				frontPageExec(t, db, `UPDATE system_db_tables SET ui_hidden=true WHERE table_name='wl128_article'`)
			case "row policy":
				frontPageExec(t, db, `UPDATE wl128_article SET published=false`)
			case "column select":
				frontPageExec(t, db, `REVOKE SELECT ON wl128_article FROM front_page_runtime; GRANT SELECT(id,published,user_id) ON wl128_article TO front_page_runtime`)
				articleButtonsInvalidateFixtureCaches()
			}
			for _, viewer := range viewers {
				buttons, _ := articleButtonsPostgresHome(t, viewer.id, viewer.role, "en")
				want := 0
				if viewer.role == "admin" && (denial == "hidden dataset" || denial == "row policy" || denial == "column select") {
					want = 1
				}
				if len(buttons) != want {
					t.Fatal(denial, viewer, buttons)
				}
			}
			switch denial {
			case "article grant":
				frontPageExec(t, db, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) SELECT id,500001,NULL FROM system_user_groups WHERE id IN(1,2,3)`)
			case "dataset read grant":
				frontPageExec(t, db, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) SELECT groups.id,500000,registry.table_uid FROM system_user_groups groups CROSS JOIN system_db_tables registry WHERE groups.id IN(1,2,3) AND registry.table_name='wl128_article'`)
			case "hidden dataset":
				frontPageExec(t, db, `UPDATE system_db_tables SET ui_hidden=false WHERE table_name='wl128_article'`)
			case "row policy":
				frontPageExec(t, db, `UPDATE wl128_article SET published=true`)
			case "column select":
				frontPageExec(t, db, `GRANT SELECT ON wl128_article TO front_page_runtime`)
				articleButtonsInvalidateFixtureCaches()
			}
		})
	}
}

func TestFrontPageArticleButtonsPostgresDeletedTargetsAdminDiagnosticsAndKeyTitle(t *testing.T) {
	db, uid := articleButtonsPostgresFixture(t)
	// JSONB travels as JSON text in canonical results; a language-key header
	// is a text field, as in ordinary article metadata, rather than a JSON string.
	frontPageExec(t, db, `ALTER TABLE wl128_article ALTER COLUMN headline TYPE text USING headline::text;
		UPDATE system_column_details SET data_type='text',card_element='header+lang_key',is_multilingual=false
		WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='wl128_article') AND column_name='headline';
		UPDATE wl128_article SET headline='home_article_fixture_key';
		INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue) VALUES('home_article_fixture_key','Ota yhteyttä','Contact','联系','聯絡');`)
	articleButtonsInvalidateFixtureCaches()
	for language, label := range map[string]string{"fi": "Ota yhteyttä", "en": "Contact"} {
		buttons, _ := articleButtonsPostgresHome(t, 1, "guest", language)
		if len(buttons) != 1 || buttons[0].Label != label {
			t.Fatal(buttons)
		}
	}
	for _, deleted := range []string{"row", "dataset"} {
		if deleted == "row" {
			frontPageExec(t, db, `DELETE FROM wl128_article`)
		} else {
			frontPageExec(t, db, `DELETE FROM system_db_tables WHERE table_name='wl128_article'`)
		}
		for _, viewer := range []struct {
			id   int
			role string
		}{{74, "admin"}, {42, "basic"}, {1, "guest"}} {
			buttons, _ := articleButtonsPostgresHome(t, viewer.id, viewer.role, "en")
			if len(buttons) != 0 {
				t.Fatal(deleted, viewer, buttons)
			}
		}
		response := httptest.NewRecorder()
		request := frontPageSessionRequest(t, 74, "admin", "GET", "/api/admin/front-page/article-buttons")
		AdminFrontPageArticleButtonsHandler(response, request)
		reason := "row_missing_or_unreadable"
		if deleted == "dataset" {
			reason = "dataset_missing_or_unavailable"
		}
		if response.Code != 200 || !strings.Contains(response.Body.String(), `"reason":"`+reason+`"`) || !strings.Contains(response.Body.String(), fmt.Sprintf(`"table_uid":%d`, uid)) {
			t.Fatal(response.Code, response.Body.String())
		}
		value, _, err := readFrontPageArticleButtons(context.Background(), db)
		if err != nil || len(value.Items) != 1 {
			t.Fatal("read silently removed private configuration", value, err)
		}
		if err := validateFrontPageArticleTargets(request, 74, []byte(resultJSON(value))); !errors.Is(err, errFrontPageInput) {
			t.Fatal("save accepted deleted target", err)
		}
	}
}

func TestFrontPageArticleButtonsPostgresRevisionPersistenceAndConcurrentSave(t *testing.T) {
	db := frontPageDisposableDB(t)
	raw, _ := json.Marshal(config.EmptyFrontPageArticleButtons())
	value, version, err := readFrontPageArticleButtons(context.Background(), db)
	if err != nil || version != "none" || value.Items == nil || len(value.Items) != 0 {
		t.Fatal(value, version, err)
	}
	start, results := make(chan struct{}), make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() { <-start; _, err := articleButtonsTestSave(db, raw, "none"); results <- err }()
	}
	close(start)
	left, right := <-results, <-results
	if !((left == nil && errors.Is(right, errFrontPageConflict)) || (right == nil && errors.Is(left, errFrontPageConflict))) {
		t.Fatal(left, right)
	}
	_, version, err = readFrontPageArticleButtons(context.Background(), db)
	if err != nil || version == "none" {
		t.Fatal(version, err)
	}
	newer, err := articleButtonsTestSave(db, raw, version)
	if err != nil || newer == version {
		t.Fatal(newer, err)
	}
	if _, err := articleButtonsTestSave(db, raw, version); !errors.Is(err, errFrontPageConflict) {
		t.Fatal("stale revision accepted", err)
	}
}
