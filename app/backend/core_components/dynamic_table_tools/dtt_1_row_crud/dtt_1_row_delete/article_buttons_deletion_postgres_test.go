// article_buttons_deletion_postgres_test.go
// Orders generic deletion's absent-key check before a real administrator first save.
// Connects the public bootstrap, dedicated saver and actual generic DELETE helper.
// Proves the saved revision and ordinary rows survive, even if refusal is committed.
package dtt_1_row_delete

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	sessions "easelect/backend/core_components/sessions"
	config "easelect/backend/core_components/system_config_checks"
	home "easelect/backend/core_components/system_table_tools"
	gorillasessions "github.com/gorilla/sessions"
)

func articleDeletionDisposableDB(t *testing.T) *sql.DB {
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
	root, err := os.MkdirTemp("", "filterest-article-delete-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) {
		t.Helper()
		if out, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			log, _ := os.ReadFile(filepath.Join(root, "postgres.log"))
			t.Fatalf("disposable %s: %v: %s %s", name, err, out, log)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15492", "-w", "start")
	t.Cleanup(func() { run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop") })
	db, err := sql.Open("postgres", "host="+socket+" port=15492 user=fixture_owner dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	schema, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "..", "server_tools", "public_bootstrap", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestArticleButtonsPostgresFirstSaveSurvivesOrderedGenericDeletion(t *testing.T) {
	db := articleDeletionDisposableDB(t)
	oldDB, oldStore, oldName := backend.Db, sessions.Store, sessions.SessionName
	backend.Db = db
	sessions.Store = gorillasessions.NewCookieStore([]byte("article-delete-fixture-key-32-byte!"))
	sessions.SessionName = "article_delete_test"
	t.Cleanup(func() { backend.Db, sessions.Store, sessions.SessionName = oldDB, oldStore, oldName })
	var ordinaryID, futureID int
	if err := db.QueryRow(`INSERT INTO public.system_config(key,text_value,value_type)
		VALUES('article_delete_ordinary_fixture','keep me',1) RETURNING id`).Scan(&ordinaryID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT last_value+CASE WHEN is_called THEN 1 ELSE 0 END FROM public.system_config_id_seq`).Scan(&futureID); err != nil {
		t.Fatal(err)
	}
	deleting, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer deleting.Rollback()
	// Stage 1: deletion is already in flight and sees no protected row at its
	// future numeric ID. Keep this transaction open through the saver's commit.
	if err := config.RefuseArticleButtonsDeletion(deleting, "system_config", []int{ordinaryID, futureID}); err != nil {
		t.Fatal("absent-key preflight unexpectedly refused", err)
	}
	var absent int
	if err := deleting.QueryRow(`SELECT count(*) FROM public.system_config WHERE key=$1`, config.FrontPageArticleButtonsKey).Scan(&absent); err != nil || absent != 0 {
		t.Fatal("first-save fixture is not absent", absent, err)
	}
	// Stage 2: the real dedicated saver inserts and commits on another connection.
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	request := httptest.NewRequest("POST", "/api/admin/front-page/article-buttons", strings.NewReader(`{"article_buttons":{"schema_version":1,"placement":"below_text","items":[]},"version":"none"}`))
	cookies := httptest.NewRecorder()
	session, err := sessions.GetOrCreateSession(cookies, request)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"], session.Values["user_role"] = 74, "admin"
	if err := sessions.Save(cookies, request, session); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range cookies.Result().Cookies() {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	home.AdminFrontPageArticleButtonsHandler(response, request.WithContext(dbutils.SetLazyTx(context.Background(), lazy)))
	var saved struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil || response.Code != 200 || saved.Version == "" || saved.Version == "none" {
		t.Fatal("dedicated first save failed", response.Code, response.Body.String(), err)
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	var insertedID int
	if err := db.QueryRow(`SELECT id FROM public.system_config WHERE key=$1`, config.FrontPageArticleButtonsKey).Scan(&insertedID); err != nil || insertedID != futureID {
		t.Fatal("save did not use deletion's future ID", insertedID, futureID, err)
	}
	// Stage 3: READ COMMITTED visibility now admits both targets, exactly as the
	// handler would. The final DELETE must exclude the protected row and undo
	// the ordinary row's partial deletion, without depending on the preflight.
	visible, err := read.RowsVisibleForDelete(deleting, "system_config", "admin", 74, []int64{int64(ordinaryID), int64(futureID)})
	if err != nil || !visible {
		t.Fatal("ordered visibility check did not reach the race", visible, err)
	}
	var forbidden *forbiddenError
	if err := deleteGenericRows(deleting, "system_config", []int{ordinaryID, futureID}, "74", "admin", 74); !errors.As(err, &forbidden) {
		t.Fatal("mixed delete did not refuse atomically", err)
	}
	if err := deleteGenericRows(deleting, "system_config", []int{futureID}, "74", "admin", 74); !errors.As(err, &forbidden) {
		t.Fatal("protected-only delete did not refuse", err)
	}
	if err := deleting.Commit(); err != nil {
		t.Fatal("refused delete left an unusable transaction", err)
	}
	var ordinary string
	if err := db.QueryRow(`SELECT text_value FROM public.system_config WHERE id=$1`, ordinaryID).Scan(&ordinary); err != nil || ordinary != "keep me" {
		t.Fatal("partial ordinary deletion survived rollback", ordinary, err)
	}
	// Ordinary settings remain deletable through the same final predicate.
	ordinaryDelete, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer ordinaryDelete.Rollback()
	if err := deleteGenericRows(ordinaryDelete, "system_config", []int{ordinaryID}, "74", "admin", 74); err != nil {
		t.Fatal("protection blocked an ordinary setting", err)
	}
	if err := ordinaryDelete.Commit(); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := db.QueryRow(`SELECT count(*) FROM public.system_config WHERE id=$1`, ordinaryID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("ordinary delete did not commit", remaining, err)
	}
	// The dedicated read must still expose the identical content and revision.
	request.Method, request.Body = "GET", nil
	response = httptest.NewRecorder()
	home.AdminFrontPageArticleButtonsHandler(response, request)
	var after struct {
		Version string                         `json:"version"`
		Value   config.FrontPageArticleButtons `json:"article_buttons"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &after); err != nil || response.Code != 200 || after.Version != saved.Version || after.Value.SchemaVersion != 1 || after.Value.Placement != "below_text" || after.Value.Items == nil || len(after.Value.Items) != 0 {
		t.Fatal("generic deletion reset the saved setting or revision", saved.Version, response.Body.String(), err)
	}
}
