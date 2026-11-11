// filterbar_preferences_postgres_test.go
// Proves upgrade/replay preserves site order and existing account visual choices.
// Connects the reviewed migration to native disposable PostgreSQL and real handlers.
// Confirms own orders and theme resets share one row without overwriting each other.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dbutils/queryfixture"
)

func TestFilterbarPreferencesPostgresMigrationAndPersistence(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `UPDATE public.system_config SET json_value='{"section_order":["style","views","filters"],"section_collapsed":{"filters":true},"allow_own_order":true}' WHERE key='filterbar_section_layout';
        INSERT INTO public.system_user_visual_preferences(user_id,theme_mode) VALUES(42,'dark');`)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20261015000013_add_filterbar_preferences.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		frontPageExec(t, db, string(migration))
	}
	request := queryfixture.Request(t, "PATCH", "/api/user-filterbar-preference", `{"order_mode":"own","visibility_memory":"dataset"}`, 42, "user")
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	response := httptest.NewRecorder()
	UserFilterbarPreferenceHandler(response, request.WithContext(dbutils.SetLazyTx(request.Context(), lazy)))
	if response.Code != 200 {
		t.Fatalf("own preference: %d %s", response.Code, response.Body)
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	var theme, mode, memory, order string
	if err := db.QueryRow(`SELECT theme_mode,filterbar_order_mode,filterbar_visibility_memory,filterbar_section_order::text FROM public.system_user_visual_preferences WHERE user_id=42`).Scan(&theme, &mode, &memory, &order); err != nil {
		t.Fatal(err)
	}
	if theme != "dark" || mode != "own" || memory != "dataset" || !strings.HasPrefix(order, `["style", "views", "filters"`) {
		t.Fatalf("shared row lost choices: %s/%s/%s/%s", theme, mode, memory, order)
	}
	// Resetting a theme must preserve the other preferences in the same row.
	reset := queryfixture.Request(t, "DELETE", "/api/user-visual-preference", "", 42, "user")
	resetTx := dbutils.NewLazyTx(db)
	defer resetTx.Rollback()
	resetResponse := httptest.NewRecorder()
	auth.UserVisualPreferenceHandler(resetResponse, reset.WithContext(dbutils.SetLazyTx(reset.Context(), resetTx)))
	if resetResponse.Code != 200 {
		t.Fatalf("theme reset: %s", resetResponse.Body)
	}
	if err := resetTx.Commit(); err != nil {
		t.Fatal(err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_user_visual_preferences WHERE user_id=42 AND theme_mode IS NULL AND filterbar_order_mode='own' AND filterbar_visibility_memory='dataset'`) != 1 {
		t.Fatal("theme reset removed filterbar choices")
	}
	frontPageExec(t, db, string(migration))
	if frontPageCount(t, db, `SELECT count(*) FROM system_config WHERE key='filterbar_section_layout' AND json_value->'section_order'->>0='style' AND (json_value->>'allow_own_order')::boolean`) != 1 {
		t.Fatal("replay changed shared order")
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key LIKE 'filterbar_visibility_%' AND t.language_code IN ('fi','en') AND NULLIF(btrim(t.translation),'') IS NOT NULL`) < 8 {
		t.Fatal("missing Finnish/English visibility explanations")
	}
}

func TestUserFilterbarPreferencePostgresRequestRoles(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `CREATE ROLE filterbar_basic LOGIN;
		GRANT SELECT ON public.system_config TO filterbar_basic;
		GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_user_visual_preferences TO filterbar_basic;
		CREATE ROLE filterbar_reader LOGIN;
		GRANT SELECT (id, admin_access_allowed) ON public.system_users TO filterbar_reader;
		UPDATE public.system_users SET admin_access_allowed=(id=73) WHERE id IN (42,73);
		UPDATE public.system_config SET json_value='{"allow_own_order":false}' WHERE key='filterbar_section_layout';`)
	var socket, port string
	if err := db.QueryRow(`SELECT current_setting('unix_socket_directories'), current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	connect := func(role string) *sql.DB {
		t.Helper()
		pool, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=%s dbname=postgres sslmode=disable", socket, port, role))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { pool.Close() })
		return pool
	}
	basic := connect("filterbar_basic")
	oldReader := backend.DbReaderOnly
	backend.DbReaderOnly = connect("filterbar_reader")
	t.Cleanup(func() { backend.DbReaderOnly = oldReader })

	call := func(method, body string, userID, status int) *httptest.ResponseRecorder {
		t.Helper()
		request := queryfixture.Request(t, method, "/api/user-filterbar-preference?user_id=73", body, userID, "user")
		lazy := dbutils.NewLazyTx(basic)
		defer lazy.Rollback()
		response := httptest.NewRecorder()
		UserFilterbarPreferenceHandler(response, request.WithContext(dbutils.SetLazyTx(request.Context(), lazy)))
		if response.Code != status {
			t.Fatalf("%s session %d: got %d, want %d: %s", method, userID, response.Code, status, response.Body)
		}
		if status == 200 {
			if err := lazy.Commit(); err != nil {
				t.Fatal(err)
			}
		}
		return response
	}
	got := call("GET", "", 42, 200)
	var preference userFilterbarPreference
	if err := json.Unmarshal(got.Body.Bytes(), &preference); err != nil || preference.UserID != 42 || preference.OwnOrderAllowed || preference.OrderMode != "shared" {
		t.Fatalf("ordinary session read: %s (%v)", got.Body, err)
	}
	call("PATCH", `{"order_mode":"own"}`, 42, 403)
	call("PATCH", `{"visibility_memory":"dataset"}`, 42, 200)
	if frontPageCount(t, db, `SELECT count(*) FROM public.system_user_visual_preferences WHERE user_id=42 AND filterbar_visibility_memory='dataset'`) != 1 {
		t.Fatal("ordinary session's preference was not saved")
	}
	call("GET", "", 1, 401)
}
