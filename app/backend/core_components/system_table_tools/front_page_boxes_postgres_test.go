// front_page_boxes_postgres_test.go
// Proves saved Home query authorization, identity preservation and explicit empty scopes.
// Connects the released migrations and dedicated API to actual guest/RLS canonical reads.
// Uses only the existing disposable PostgreSQL fixture and destroys it after each proof.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
)

func applySavedHomeMigration(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, name := range []string{"20261024000001_add_saved_home_boxes.sql", "20261024000099_record_database_release_9_13_1.sql"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		frontPageExec(t, db, string(raw))
	}
}

func TestFrontPageBoxesPostgresLegacyMigrationEquivalence(t *testing.T) {
	db := frontPageDisposableDB(t)
	// Reconstruct the previous schema in this disposable database, then upgrade
	// actual saved rows. No installation database or stored account is involved.
	frontPageExec(t, db, `ALTER TABLE system_front_page_blocks DROP COLUMN title,DROP COLUMN query,DROP COLUMN category_links;
        ALTER TABLE system_front_page_blocks ALTER COLUMN result_limit SET DEFAULT 5;
        ALTER TABLE system_front_page_blocks ADD CONSTRAINT uq_system_front_page_blocks_dataset UNIQUE NULLS NOT DISTINCT(user_id,table_uid);
        ALTER TABLE system_front_page_revisions DROP COLUMN is_custom;
        DELETE FROM system_data_repair_records WHERE migration='saved_home_boxes';
        DELETE FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_front_page_blocks')
            AND column_name IN ('title','query','category_links');
        INSERT INTO wl143_content VALUES(1,'older','2025-01-01'),(2,'newer','2025-02-01');
        INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,card_element)
            SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
                CASE WHEN col.column_name='title' THEN 'header' ELSE '' END
            FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
            WHERE col.table_schema='public' AND col.table_name='wl143_content';
        INSERT INTO system_front_page_blocks(id,user_id,table_uid,result_limit,sort_order,enabled)
            SELECT 600,NULL,table_uid,1,7,true FROM system_db_tables WHERE table_name='wl143_content';
        INSERT INTO system_front_page_blocks(id,user_id,table_uid,result_limit,sort_order,enabled)
            SELECT 601,42,table_uid,9,4,false FROM system_db_tables WHERE table_name='wl143_content'`)
	beforeRequest := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page")
	before, ok := delegateFrontPageBlock(beforeRequest, frontPageBlock{ID: 600, Dataset: "wl143_content", ResultLimit: 1, SortOrder: 7, Enabled: true, CategoryLinks: 3})
	if !ok {
		t.Fatal("legacy canonical read")
	}
	for i := 0; i < 2; i++ {
		applySavedHomeMigration(t, db)
	}
	common, err := readFrontPageBlocks(db, 0)
	if err != nil || len(common) != 1 || common[0].ID != 600 || common[0].SortOrder != 7 || common[0].ResultLimit != 1 || !common[0].Enabled || common[0].Title != nil || string(common[0].Query) != "{}" {
		t.Fatal(common, err)
	}
	user, err := readFrontPageBlocks(db, 42)
	if err != nil || len(user) != 1 || user[0].ID != 601 || user[0].SortOrder != 4 || user[0].ResultLimit != 9 || user[0].Enabled {
		t.Fatal(user, err)
	}
	after, ok := delegateFrontPageBlock(beforeRequest, common[0])
	if !ok || !reflect.DeepEqual(before.Data, after.Data) || !reflect.DeepEqual(before.Columns, after.Columns) || !reflect.DeepEqual(before.Types, after.Types) {
		t.Fatal("legacy result changed", before, after)
	}
	for _, scope := range []int{0, 42} {
		custom, err := frontPageScopeCustom(db, scope)
		if err != nil || !custom {
			t.Fatal(scope, custom, err)
		}
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_front_page_blocks') AND column_name IN ('title','query','category_links') AND NOT insertable AND NOT editable_in_ui`) != 3 {
		t.Fatal("new metadata")
	}
}

func TestFrontPageBoxesPostgresDuplicatesStableLegacyIDsAndConflict(t *testing.T) {
	db := frontPageDisposableDB(t)
	inputs := []frontPageBlockInput{{Dataset: "wl143_content", ResultLimit: 4, SortOrder: 1, Enabled: true,
		Title: json.RawMessage(`{"fi":"Oma nimi","en":"Saved title"}`), Query: json.RawMessage(`{"sort_column":"title","sort_order":"ASC"}`)}}
	version, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &inputs})
	if err != nil {
		t.Fatal(err)
	}
	before, err := readFrontPageBlocks(db, 0)
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := decodeFrontPageAdminRequest(strings.NewReader(`{"version":"` + version + `","blocks":[{"dataset":"wl143_content","result_limit":4,"sort_order":2,"enabled":true}]}`))
	if err != nil {
		t.Fatal(err)
	}
	version, err = frontPageTestSave(db, legacy)
	if err != nil {
		t.Fatal(err)
	}
	after, err := readFrontPageBlocks(db, 0)
	if err != nil || len(after) != 1 || after[0].ID != before[0].ID || !reflect.DeepEqual(after[0].Title, before[0].Title) || !reflect.DeepEqual(after[0].Query, before[0].Query) || after[0].CategoryLinks != before[0].CategoryLinks {
		t.Fatal("legacy save lost identity/fields", before, after, err)
	}
	inputs = []frontPageBlockInput{{ID: after[0].ID, Dataset: "wl143_content", ResultLimit: 4, SortOrder: 1, Enabled: true}, {Dataset: "wl143_content", ResultLimit: 2, SortOrder: 2, Enabled: true}}
	previous := version
	version, err = frontPageTestSave(db, frontPageAdminRequest{Version: version, Blocks: &inputs})
	if err != nil {
		t.Fatal(err)
	}
	boxes, err := readFrontPageBlocks(db, 0)
	if err != nil || len(boxes) != 2 || boxes[0].ID != before[0].ID || boxes[0].ID == boxes[1].ID {
		t.Fatal(boxes, err)
	}
	if _, err = frontPageTestSave(db, frontPageAdminRequest{Version: previous, Blocks: &inputs}); !errors.Is(err, errFrontPageConflict) {
		t.Fatal("stale save accepted", err)
	}
	// Swapping positions must preserve both ids under the deferred uniqueness check.
	inputs = []frontPageBlockInput{{ID: boxes[0].ID, Dataset: "wl143_content", ResultLimit: 4, SortOrder: 2, Enabled: true}, {ID: boxes[1].ID, Dataset: "wl143_content", ResultLimit: 2, SortOrder: 1, Enabled: true}}
	if _, err = frontPageTestSave(db, frontPageAdminRequest{Version: version, Blocks: &inputs}); err != nil {
		t.Fatal("swap", err)
	}
}

func TestFrontPageBoxesPostgresCustomEmptyPersistsAcrossFreshReaderAndReset(t *testing.T) {
	db := frontPageDisposableDB(t)
	empty := []frontPageBlockInput{}
	version, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &empty})
	if err != nil {
		t.Fatal(err)
	}
	var socket, port string
	if err := db.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	for _, viewer := range []int{1, 42, 73} {
		for restart := 0; restart < 2; restart++ {
			// A new connection/read has no process-local scope state to retain.
			fresh, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=fixture_owner dbname=postgres sslmode=disable", socket, port))
			if err != nil {
				t.Fatal(err)
			}
			blocks, source, err := resolveFrontPageBlocks(fresh, viewer)
			fresh.Close()
			if err != nil || source != "common" || blocks == nil || len(blocks) != 0 {
				t.Fatal(viewer, blocks, source, err)
			}
		}
	}
	user := 42
	_, err = frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: "none", CopyFromCommon: boolFrontPage(true)})
	if err != nil {
		t.Fatal(err)
	}
	blocks, source, err := resolveFrontPageBlocks(db, user)
	if err != nil || len(blocks) != 0 || source != "user" {
		t.Fatal("copied empty list inherited", blocks, source, err)
	}
	if _, err = frontPageTestSave(db, frontPageAdminRequest{Version: version, Reset: boolFrontPage(true)}); err != nil {
		t.Fatal(err)
	}
	blocks, source, err = resolveFrontPageBlocks(db, 73)
	if err != nil || source != "default" || len(blocks) == 0 {
		t.Fatal("reset did not inherit", blocks, source, err)
	}
}

func boolFrontPage(value bool) *bool { return &value }

func TestFrontPageBoxesPostgresGuestRLSAndAdminRepairDiagnostics(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `INSERT INTO wl143_content VALUES(1,'readable','2025-01-01'),(2,'RLS hidden','2025-02-01'),(3,'row rule hidden','2025-03-01');
        INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,card_element)
            SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
                CASE WHEN col.column_name='title' THEN 'header' ELSE '' END
            FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
            WHERE col.table_schema='public' AND col.table_name='wl143_content';
        INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
            SELECT 3,500000,table_uid FROM system_db_tables WHERE table_name='wl143_content';
        INSERT INTO system_row_groups(slug,title) VALUES('public-home','{"en":"Public"}'),('rls-hidden-home','{"en":"Hidden"}'),('denied-home','{"en":"Denied"}');
        INSERT INTO system_row_group_memberships(group_id,table_uid,row_id)
            SELECT category.id,registry.table_uid,content_row.id FROM system_row_groups category
            CROSS JOIN system_db_tables registry CROSS JOIN wl143_content content_row
            WHERE registry.table_name='wl143_content' AND ((category.slug='public-home' AND content_row.id IN(1,2)) OR
                (category.slug='rls-hidden-home' AND content_row.id=2) OR (category.slug='denied-home' AND content_row.id=3));
        INSERT INTO system_row_access_rules(table_uid,row_id,user_id,action_id,effect)
            SELECT registry.table_uid,3,1,action.id,'deny' FROM system_db_tables registry
            CROSS JOIN system_permission_actions action WHERE registry.table_name='wl143_content'
                AND action.action_key='read' AND action.scope_type='row';
        ALTER TABLE wl143_content ENABLE ROW LEVEL SECURITY;
        CREATE POLICY home_guest_rows ON wl143_content FOR SELECT USING(id<>2);
        UPDATE system_config SET boolean_value=true WHERE key='separate_front_page';`)
	inputs := []frontPageBlockInput{}
	for i, slug := range []string{"public-home", "rls-hidden-home", "denied-home"} {
		inputs = append(inputs, frontPageBlockInput{Dataset: "wl143_content", ResultLimit: 1, SortOrder: i + 1, Enabled: true,
			Title: json.RawMessage(`{"en":"Box title"}`), Query: json.RawMessage(`{"row_group":["` + slug + `"],"sort_column":"title","sort_order":"ASC"}`)})
	}
	_, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &inputs})
	if err != nil {
		t.Fatal(err)
	}
	// A once-valid slug was removed after save: execution must validate it again.
	frontPageExec(t, db, `INSERT INTO system_front_page_blocks(table_uid,sort_order,query,title)
        SELECT table_uid,4,'{"row_group":["unknown-home"]}','{"en":"Private repair title"}' FROM system_db_tables WHERE table_name='wl143_content'`)
	frontPageRuntimeDB(t, db)
	read.InvalidateSchemaCache("wl143_content")
	read.InvalidatePermissionsCache("wl143_content")
	read.InvalidateUserColumnSettingsCache("wl143_content", "card")
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, 1, "guest", "GET", "/api/front-page"))
	var visitor struct {
		Blocks []frontPageResultBlock `json:"blocks"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &visitor); err != nil || response.Code != 200 || len(visitor.Blocks) != 1 || len(visitor.Blocks[0].Data) != 1 || !strings.Contains(string(visitor.Blocks[0].Data[0]), "readable") {
		t.Fatal(response.Code, response.Body.String(), err)
	}
	for _, hidden := range []string{"RLS hidden", "row rule hidden", "rls-hidden-home", "denied-home", "unknown-home", "Private repair title", "reason_key", "diagnostics"} {
		if strings.Contains(response.Body.String(), hidden) {
			t.Fatal("visitor leak", response.Body.String())
		}
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal(response.Header())
	}
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	admin := frontPageSessionRequest(t, 42, "admin", "GET", "/api/admin/front-page").WithContext(dbutils.SetLazyTx(context.Background(), lazy))
	response = httptest.NewRecorder()
	AdminFrontPageHandler(response, admin)
	var settings struct {
		Diagnostics []frontPageBoxDiagnostic `json:"diagnostics"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &settings); err != nil || response.Code != 200 || len(settings.Diagnostics) != 3 {
		t.Fatal(response.Code, response.Body.String(), err)
	}
	for _, diagnostic := range settings.Diagnostics {
		if diagnostic.BoxID == 0 || diagnostic.ReasonKey != "row_group_invalid_filters" {
			t.Fatal(diagnostic)
		}
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal(response.Header())
	}
}
