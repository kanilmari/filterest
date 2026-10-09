// front_page_postgres_test.go
// Proves front page migrations, scope replacement and real results delegation on isolated PostgreSQL.
// Follows the favorites Unix-socket-only fixture and imports the reviewed public bootstrap.
// Never reads installation credentials or connects to an existing database.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	_ "github.com/lib/pq"
)

var frontPageMigrations = []string{
	"20261005000030_create_front_page_revision_metadata.sql",
	"20261005000031_create_system_front_page_blocks.sql", "20261005000032_add_front_page_settings.sql",
	"20261005000033_seed_front_page_language_keys.sql", "20261005000034_register_system_front_page_blocks.sql",
	"20261005000085_add_front_page_show_blocks.sql", "20261005000086_seed_front_page_hero_language_keys.sql",
	"20261009000001_seed_front_page_description_language_key.sql",
}

func frontPageDisposableDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	if _, err := os.Stat(filepath.Join(bin, "initdb")); err != nil {
		t.Skip("PostgreSQL test binaries unavailable")
	}
	root, err := os.MkdirTemp("", "filterest-front-page-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) ([]byte, error) {
		return exec.Command(filepath.Join(bin, name), args...).CombinedOutput()
	}
	if out, err := run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8"); err != nil {
		if strings.Contains(string(out), "Operation not permitted") || strings.Contains(string(out), "Permission denied") {
			t.Skipf("sandbox cannot initialize disposable PostgreSQL: %s", out)
		}
		t.Fatalf("disposable initdb: %v: %s", err, out)
	}
	if out, err := run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15491", "-w", "start"); err != nil {
		log, _ := os.ReadFile(filepath.Join(root, "postgres.log"))
		if strings.Contains(string(log), "Operation not permitted") || strings.Contains(string(log), "Permission denied") {
			t.Skipf("sandbox cannot start disposable PostgreSQL: %s", log)
		}
		t.Fatalf("disposable pg_ctl: %v: %s %s", err, out, log)
	}
	t.Cleanup(func() {
		if out, err := run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop"); err != nil {
			t.Errorf("stop fixture: %v %s", err, out)
		}
	})
	db, err := sql.Open("postgres", "host="+socket+" port=15491 user=fixture_owner dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "public_bootstrap", name))
		if err != nil {
			t.Fatal(err)
		}
		frontPageExec(t, db, string(content))
	}
	for i := 0; i < 2; i++ {
		for _, name := range frontPageMigrations {
			content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", name))
			if err != nil {
				t.Fatal(err)
			}
			frontPageExec(t, db, string(content))
		}
	}
	oldDB, oldAdmin, oldBasic, oldGuest := backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest
	backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest = db, db, db, db
	t.Cleanup(func() {
		backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest = oldDB, oldAdmin, oldBasic, oldGuest
	})
	frontPageExec(t, db, `INSERT INTO public.system_users(id,username,enabled) VALUES(42,'Public reader',true),(73,'Another public name',true);
        INSERT INTO public.system_user_group_memberships(user_id,group_id) VALUES(42,2),(73,2);
        INSERT INTO public.system_functions(id,name,disabled,specific_table_related,url_route_endpoint)
            VALUES(500000,'front_page_fixture_read',false,true,'/api/get-results');
        CREATE TABLE public.wl143_content(id bigint PRIMARY KEY,title text,created timestamptz);
        INSERT INTO public.system_db_tables(table_name,schema_name,folder_id,is_main_table)
            VALUES('wl143_content','public',1,true);
        INSERT INTO public.system_group_table_func_rights(user_group_id,function_id,target_table_uid)
            SELECT 2,500000,table_uid FROM public.system_db_tables WHERE table_name='wl143_content';`)
	return db
}

func frontPageExec(t *testing.T, db *sql.DB, query string) {
	t.Helper()
	if _, err := db.Exec(query); err != nil {
		t.Fatal(err)
	}
}

func frontPageCount(t *testing.T, db *sql.DB, query string) int {
	t.Helper()
	var count int
	if err := db.QueryRow(query).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func frontPageTestSave(db *sql.DB, request frontPageAdminRequest) (string, error) {
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	version, err := saveFrontPageAdminRequest(dbutils.SetLazyTx(context.Background(), lazy), request)
	if err == nil {
		err = lazy.Commit()
	}
	return version, err
}

func TestFrontPagePostgresMigrationsConstraintsDefaultsAndCascades(t *testing.T) {
	db := frontPageDisposableDB(t)
	if frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration IN ('system_front_page_blocks_table','system_front_page_blocks_registry') AND action='completed'`) != 2 {
		t.Fatal("markers")
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_db_tables t JOIN system_table_folders f ON f.id=t.folder_id WHERE t.table_name='system_front_page_blocks' AND NOT t.is_removable AND f.folder_name='system'`) != 1 {
		t.Fatal("registry")
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_front_page_blocks') AND NOT insertable AND NOT editable_in_ui`) != 8 {
		t.Fatal("column metadata")
	}
	settings, err := backend.ReadFrontPageSettings(context.Background(), db)
	if err != nil || settings.SeparateFrontPage || settings.FrontPageButtonShowsSiteName {
		t.Fatal(settings, err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_config WHERE key IN ('separate_front_page','front_page_button_shows_site_name') AND value_type=2 AND text_value='false' AND json_value='{"value":false}'::jsonb`) != 2 {
		t.Fatal("switch representation")
	}
	frontPageExec(t, db, `INSERT INTO system_front_page_blocks(user_id,table_uid,sort_order)
        SELECT NULL,table_uid,1 FROM system_db_tables WHERE table_name='wl143_content'`)
	if frontPageCount(t, db, `SELECT count(*) FROM system_front_page_blocks WHERE result_limit=5 AND enabled AND created=updated`) != 1 {
		t.Fatal("defaults")
	}
	for _, values := range []string{"NULL,5,1", "NULL,5,2", "1,5,2", "42,0,2", "42,21,2", "42,5,0", "42,5,101", "999999,5,2"} {
		if _, err := db.Exec(`INSERT INTO system_front_page_blocks(user_id,result_limit,sort_order,table_uid)
            SELECT ` + values + `,table_uid FROM system_db_tables WHERE table_name='wl143_content'`); err == nil {
			t.Fatal("constraint accepted", values)
		}
	}
	if _, err := db.Exec(`INSERT INTO system_front_page_blocks(table_uid,sort_order)
        SELECT table_uid,1 FROM system_db_tables WHERE table_name='tiketit'`); err == nil {
		t.Fatal("common positions are not unique")
	}
	if _, err := db.Exec(`INSERT INTO system_front_page_blocks(table_uid,sort_order) VALUES(999999,2)`); err == nil {
		t.Fatal("missing dataset reference accepted")
	}
	frontPageExec(t, db, `UPDATE system_front_page_blocks SET updated='2000-01-01'`)
	if frontPageCount(t, db, `SELECT count(*) FROM system_front_page_blocks WHERE updated>created`) != 1 {
		t.Fatal("updated timestamp trigger")
	}
	frontPageExec(t, db, `INSERT INTO system_front_page_blocks(user_id,table_uid,sort_order) SELECT 42,table_uid,1 FROM system_db_tables WHERE table_name='wl143_content'; DELETE FROM system_users WHERE id=42`)
	if frontPageCount(t, db, `SELECT count(*) FROM system_front_page_blocks WHERE user_id=42`) != 0 {
		t.Fatal("user cascade")
	}
	frontPageExec(t, db, `DELETE FROM system_db_tables WHERE table_name='wl143_content'`)
	if frontPageCount(t, db, `SELECT count(*) FROM system_front_page_blocks`) != 0 {
		t.Fatal("dataset cascade")
	}
}

func TestFrontPagePostgresScopesReplaceResetAndCopy(t *testing.T) {
	db := frontPageDisposableDB(t)
	blocks, source, err := resolveFrontPageBlocks(db, 42)
	if err != nil || source != "default" || len(blocks) == 0 || len(blocks) > 12 {
		t.Fatal(blocks, source, err)
	}
	inputs := []frontPageBlockInput{{Dataset: "wl143_content", ResultLimit: 5, SortOrder: 1, Enabled: true}}
	version, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &inputs})
	if err != nil {
		t.Fatal(err)
	}
	user := 42
	disabled := append([]frontPageBlockInput{}, inputs...)
	disabled[0].Enabled = false
	userVersion, err := frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: "none", Blocks: &disabled})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{42, 73, 1} {
		blocks, source, err = resolveFrontPageBlocks(db, id)
		if err != nil || len(blocks) != 1 || ((id == 42) != (source == "user")) || ((id == 42) == blocks[0].Enabled) {
			t.Fatal(id, blocks, source, err)
		}
	}
	reset := true
	newVersion, err := frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: userVersion, Reset: &reset})
	if err != nil || newVersion == userVersion {
		t.Fatal(newVersion, err)
	}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: "none", Blocks: &inputs}); !errors.Is(err, errFrontPageConflict) {
		t.Fatal("reset lost version", err)
	}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: newVersion, CopyFromCommon: &reset}); err != nil {
		t.Fatal(err)
	}
	bad := []frontPageBlockInput{{Dataset: "system_users", ResultLimit: 5, SortOrder: 1, Enabled: true}}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Version: version, Blocks: &bad}); !errors.Is(err, errFrontPageInput) {
		t.Fatal("invalid content", err)
	}
	blocks, err = readFrontPageBlocks(db, 0)
	if err != nil || len(blocks) != 1 || blocks[0].Dataset != "wl143_content" {
		t.Fatal("invalid replace was not atomic", blocks, err)
	}
	empty := []frontPageBlockInput{}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Version: version, Blocks: &empty}); err != nil {
		t.Fatal(err)
	}
	blocks, source, err = resolveFrontPageBlocks(db, 73)
	if err != nil || source != "default" || len(blocks) == 0 {
		t.Fatal("reset common default", blocks, source, err)
	}
	users, err := searchFrontPageUsers("Public")
	if err != nil || len(users) != 2 {
		t.Fatal(users, err)
	}
	for _, account := range users {
		if len(account) != 2 || account["display_name"] == nil || account["user_id"] == nil {
			t.Fatal(account)
		}
	}
}

func TestFrontPagePostgresConcurrentSavesConflict(t *testing.T) {
	db := frontPageDisposableDB(t)
	blocks := []frontPageBlockInput{{Dataset: "wl143_content", ResultLimit: 5, SortOrder: 1, Enabled: true}}
	start, results := make(chan struct{}), make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			_, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &blocks})
			results <- err
		}()
	}
	close(start)
	left, right := <-results, <-results
	if !((left == nil && errors.Is(right, errFrontPageConflict)) || (right == nil && errors.Is(left, errFrontPageConflict))) {
		t.Fatal(left, right)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_front_page_blocks`) != 1 {
		t.Fatal("duplicate concurrent save")
	}
}

func TestFrontPagePostgresCanonicalPilotDelegateUsesRequestActorAndTransaction(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `CREATE TABLE public.app_service_catalog(id bigint PRIMARY KEY,user_id bigint,title text,
            published boolean NOT NULL DEFAULT false,enabled boolean NOT NULL DEFAULT false,
            admin_reviewed boolean NOT NULL DEFAULT false,admin_approved boolean NOT NULL DEFAULT false);
        INSERT INTO public.system_db_tables(table_name,schema_name,folder_id) VALUES('app_service_catalog','public',1);
        INSERT INTO public.system_column_details(table_uid,column_name,data_type,co_number,card_element,hide_everywhere)
            SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
                CASE WHEN col.column_name='title' THEN 'header' ELSE '' END,
                col.column_name IN ('published','enabled','admin_reviewed','admin_approved')
            FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
            WHERE col.table_schema='public' AND col.table_name='app_service_catalog';
        INSERT INTO public.system_group_table_func_rights(user_group_id,function_id,target_table_uid)
            SELECT 2,500000,table_uid FROM system_db_tables WHERE table_name='app_service_catalog';
        INSERT INTO app_service_catalog VALUES
            (902,73,'approved foreign',true,true,true,true),(903,73,'foreign unpublished',false,true,true,true),
            (904,73,'foreign disabled',true,false,true,true),(905,73,'foreign unreviewed',true,true,false,true),
            (906,73,'foreign unapproved',true,true,true,false),(907,73,'exact denied',true,true,true,true);
        INSERT INTO system_row_access_rules(table_uid,row_id,user_id,action_id,effect)
            SELECT registry.table_uid,907,42,action.id,'deny' FROM system_db_tables registry
            CROSS JOIN system_permission_actions action WHERE registry.table_name='app_service_catalog'
                AND action.action_key='read' AND action.scope_type='row';`)
	policies, err := os.ReadFile(filepath.Join("..", "..", "..", "testing", "fixtures", "front_page_service_catalog_policies.sql"))
	if err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, string(policies))
	roleDB := frontPageRuntimeDB(t, db)
	frontPageExec(t, db, `GRANT INSERT(id,user_id,title) ON app_service_catalog TO front_page_runtime`)
	lazy := dbutils.NewLazyTxWithBeginHook(roleDB, func(tx *sql.Tx) error {
		return dbutils.ApplyRequestActorToTx(tx, dbutils.NewRequestActorContext(42, "basic"))
	})
	defer lazy.Rollback()
	ctx := dbutils.SetLazyTx(context.Background(), lazy)
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		t.Fatal("request transaction")
	}
	var currentRole string
	var owner, bypass bool
	if err := tx.QueryRow(`SELECT current_user, current_user = pg_get_userbyid(c.relowner), r.rolbypassrls
        FROM pg_class c JOIN pg_roles r ON r.rolname=current_user WHERE c.oid='app_service_catalog'::regclass`).Scan(&currentRole, &owner, &bypass); err != nil {
		t.Fatal(err)
	}
	if currentRole != "front_page_runtime" || owner || bypass {
		t.Fatal("pilot reader bypasses RLS", currentRole, owner, bypass)
	}
	// The runtime role inserts its own row without committing; the real policies
	// accept it only for the transaction's actor, and only that transaction sees it.
	if _, err := tx.Exec(`INSERT INTO app_service_catalog(id,user_id,title) VALUES(901,42,current_setting('app.user_id',true))`); err != nil {
		t.Fatal(err)
	}
	read.InvalidateSchemaCache("app_service_catalog")
	read.InvalidatePermissionsCache("app_service_catalog")
	read.InvalidateUserColumnSettingsCache("app_service_catalog", "card")
	request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page").WithContext(ctx)
	result, ok := delegateFrontPageBlock(request, frontPageBlock{Dataset: "app_service_catalog", ResultLimit: 20, Enabled: true})
	if !ok || len(result.Data) != 2 {
		t.Fatal("canonical RLS delegate", result, ok)
	}
	for index, raw := range result.Data {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		if row["id"] != float64(902-index) {
			t.Fatal("foreign moderation/exact-row denial failed", row)
		}
		if index == 0 {
			for _, column := range []string{"published", "enabled", "admin_reviewed", "admin_approved"} {
				if _, found := row[column]; found {
					t.Fatal("foreign protected moderation field leaked", row)
				}
			}
		} else if row["title"] != "42" {
			t.Fatal("request actor changed", row)
		}
	}
	if frontPageCount(t, db, `SELECT count(*) FROM app_service_catalog WHERE id=901`) != 0 {
		t.Fatal("pilot delegate committed its caller's transaction")
	}
}

func TestFrontPagePostgresCanonicalReadKeepsColumnsFlagsOwnerAndExactRowRules(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `CREATE TABLE public.wl143_rows(id bigint PRIMARY KEY,title text,secret text,
        user_id bigint REFERENCES system_users(id),approved boolean,created timestamptz);
        INSERT INTO public.system_db_tables(table_name,schema_name,folder_id,row_policy_owner_column)
            VALUES('wl143_rows','public',1,'user_id');
        INSERT INTO public.system_column_details(table_uid,column_name,data_type,co_number,card_element,must_be_true_unless_own)
            SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
                CASE WHEN col.column_name='title' THEN 'header' ELSE '' END,col.column_name='approved'
            FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
            WHERE col.table_schema='public' AND col.table_name='wl143_rows';
        INSERT INTO public.system_group_table_func_rights(user_group_id,function_id,target_table_uid)
            SELECT 2,500000,table_uid FROM system_db_tables WHERE table_name='wl143_rows';
        INSERT INTO wl143_rows VALUES(1,'visible','very private',73,true,now()),
            (2,'own unapproved','very private',42,false,now()),(3,'flag denied','very private',73,false,now()),
            (4,'exact denied','very private',73,true,now());
        INSERT INTO system_row_access_rules(table_uid,row_id,user_id,action_id,effect)
            SELECT registry.table_uid,4,42,action.id,'deny' FROM system_db_tables registry
            CROSS JOIN system_permission_actions action WHERE registry.table_name='wl143_rows'
                AND action.action_key='read' AND action.scope_type='row';
        UPDATE system_config SET boolean_value=true WHERE key='separate_front_page';
        INSERT INTO system_front_page_blocks(table_uid,sort_order,result_limit)
            SELECT table_uid,1,20 FROM system_db_tables WHERE table_name='wl143_rows';
        INSERT INTO system_front_page_blocks(table_uid,sort_order,result_limit)
            SELECT table_uid,2,5 FROM system_db_tables WHERE table_name='wl143_content';
        UPDATE system_db_tables SET ui_hidden=true WHERE table_name='wl143_content';
        CREATE ROLE front_page_reader LOGIN;
        GRANT USAGE ON SCHEMA public TO front_page_reader;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO front_page_reader;
        REVOKE SELECT ON wl143_rows FROM front_page_reader;
        GRANT SELECT(id,title,user_id,approved,created) ON wl143_rows TO front_page_reader;`)
	var socket, port string
	if err := db.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	roleDB, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=front_page_reader dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	defer roleDB.Close()
	backend.DbBasic, backend.DbGuest = roleDB, roleDB
	read.InvalidateSchemaCache("wl143_rows")
	read.InvalidatePermissionsCache("wl143_rows")
	read.InvalidateUserColumnSettingsCache("wl143_rows", "card")
	request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page")
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, request)
	var result struct {
		Blocks []frontPageResultBlock `json:"blocks"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || len(result.Blocks) != 1 {
		t.Fatal(response.Code, response.Body.String(), err)
	}
	if strings.Contains(response.Body.String(), "wl143_content") || len(result.Blocks[0].Data) != 2 {
		t.Fatal("hidden dataset, exact-row rule, flag or owner changed", response.Body.String())
	}
	for index, raw := range result.Blocks[0].Data {
		var row map[string]any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatal(err)
		}
		if row["secret"] != nil || row["id"] != float64(2-index) {
			t.Fatal("column or newest rule", row)
		}
	}
	// A guest initially has no route grant for this dataset. Its name disappears
	// completely, then the same canonical delegate becomes available after a grant.
	guest := frontPageSessionRequest(t, 1, "guest", "GET", "/api/front-page")
	response = httptest.NewRecorder()
	GetFrontPageHandler(response, guest)
	if strings.Contains(response.Body.String(), "wl143_rows") {
		t.Fatal("ungranted guest block", response.Body.String())
	}
	frontPageExec(t, db, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
        SELECT 3,500000,table_uid FROM system_db_tables WHERE table_name='wl143_rows'`)
	response = httptest.NewRecorder()
	GetFrontPageHandler(response, guest)
	if !strings.Contains(response.Body.String(), "wl143_rows") || strings.Contains(response.Body.String(), "own unapproved") || strings.Contains(response.Body.String(), "flag denied") {
		t.Fatal("guest canonical flag filtering", response.Body.String())
	}
}

func TestFrontPagePostgresHeroBoxSwitchAndRepeatMigrations(t *testing.T) {
	db := frontPageDisposableDB(t)
	settings, err := backend.ReadFrontPageSettings(context.Background(), db)
	if err != nil || !settings.FrontPageShowBlocks {
		t.Fatal(settings, err)
	}
	frontPageExec(t, db, `DELETE FROM public.system_config WHERE key='front_page_show_blocks'`)
	settings, err = backend.ReadFrontPageSettings(context.Background(), db)
	if err != nil || !settings.FrontPageShowBlocks {
		t.Fatal("missing switch default", settings, err)
	}
	on, off := true, false
	_, err = frontPageTestSave(db, frontPageAdminRequest{Settings: &frontPageAdminSettings{SeparateFrontPage: &on, FrontPageButtonShowsSiteName: &off, FrontPageShowBlocks: &off}})
	if err != nil {
		t.Fatal(err)
	}
	// The slogan's settings fields are multi-line; a typed line break is kept in both translation stores.
	hero := frontPageHero{Title: &frontPageHeroText{Fi: "Oma otsikko", En: "Our title", UsageExplanation: "Reviewed Home copy"}, Slogan: &frontPageHeroText{Fi: "Oma iskulause\ntoisella rivillä", En: "Our slogan"}, Description: &frontPageHeroText{Fi: "Kuvaus\nrivi\n\nKappale", En: "Description", UsageExplanation: "Reviewed description"}}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Hero: &hero}); err != nil {
		t.Fatal(err)
	}
	got, err := readFrontPageHeroForAdmin(db)
	if err != nil || got.Title.Fi != hero.Title.Fi || got.Slogan.Fi != hero.Slogan.Fi || got.Slogan.En != hero.Slogan.En || got.Description.Fi != hero.Description.Fi || got.Description.UsageExplanation != hero.Description.UsageExplanation || got.Title.UsageExplanation != hero.Title.UsageExplanation {
		t.Fatal(got, err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM public.system_lang_keys k JOIN public.system_lang_key_translations tr ON tr.lang_key_id=k.id
  WHERE k.lang_key IN ('site_front_page_title','site_front_page_slogan','site_front_page_description') AND tr.language_code IN ('fi','en') AND tr.translation=CASE tr.language_code WHEN 'fi' THEN k.fi ELSE k.en END`) != 6 {
		t.Fatal("translation stores disagree")
	}
	for _, name := range frontPageMigrations[len(frontPageMigrations)-2:] {
		content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		frontPageExec(t, db, string(content))
		frontPageExec(t, db, string(content))
	}
	settings, err = backend.ReadFrontPageSettings(context.Background(), db)
	if err != nil || settings.FrontPageShowBlocks {
		t.Fatal("migration overwrote boxes off", settings, err)
	}
	got, err = readFrontPageHeroForAdmin(db)
	if err != nil || got.Title.Fi != hero.Title.Fi {
		t.Fatal("migration overwrote hero", got, err)
	}
	oldResolver := frontPageBlocksResolver
	t.Cleanup(func() { frontPageBlocksResolver = oldResolver })
	frontPageBlocksResolver = func(dbutils.Querier, int) ([]frontPageBlock, string, error) {
		t.Fatal("boxes off resolved datasets")
		return nil, "", nil
	}
	response := httptest.NewRecorder()
	GetFrontPageHandler(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"blocks":[]`) || !strings.Contains(response.Body.String(), `"show_blocks":false`) {
		t.Fatal(response.Code, response.Body.String())
	}
	hero.Title.Fi = ""
	hero.Title.En = ""
	hero.Slogan.Fi = ""
	hero.Slogan.En = ""
	hero.Description.Fi = ""
	hero.Description.En = ""
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Hero: &hero}); err != nil {
		t.Fatal(err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM public.system_lang_key_translations tr JOIN public.system_lang_keys k ON k.id=tr.lang_key_id
  WHERE k.lang_key IN ('site_front_page_title','site_front_page_slogan','site_front_page_description')`) != 0 {
		t.Fatal("cleared copy stayed in served translations")
	}
}
