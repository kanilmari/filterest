// shared_asset_preview_replay_test.go
// Replays the 23.9.2026 About row 4 picture loss through the real upload, edit and delete writers.
// Bridges the add-row upload path, the update-row and delete-rows handlers, and a disposable PostgreSQL.
// Exists to prove a card's only-copy preview picture survives an upload and the upload's deletion.
package dtt_1_row_create

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	dtt_1_row_delete "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete"
	dtt_1_row_update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/runtimepaths"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
	"github.com/lib/pq"
)

const replayFixtureSchema = `
CREATE TABLE system_db_tables(table_uid bigint PRIMARY KEY, table_name text, schema_name text, multi_lang_embeddings boolean DEFAULT false);
CREATE TABLE system_column_details(table_uid bigint, column_name text, editable_in_ui boolean DEFAULT false, must_be_true_unless_own boolean);
CREATE TABLE system_foreign_key_relations_1_m(id bigint PRIMARY KEY, source_table_uid bigint, target_table_uid bigint,
 source_column_name text, target_column_name text, target_insert_specs jsonb);
CREATE TABLE deletion_log(table_name text, record_id text, deleted_by text, UNIQUE(table_name, record_id));
CREATE TABLE system_about(id bigint PRIMARY KEY, cached_image text);
CREATE TABLE system_about_assets(id serial PRIMARY KEY, system_about_id integer REFERENCES system_about(id) ON DELETE CASCADE,
 asset_kind text NOT NULL DEFAULT 'image', filename text, original_name text, sort_order integer NOT NULL DEFAULT 0,
 is_primary boolean NOT NULL DEFAULT false, metadata_json jsonb, created timestamptz DEFAULT now(), updated timestamptz DEFAULT now());
INSERT INTO system_db_tables(table_uid, table_name, schema_name) VALUES (117, 'system_about', 'public'), (118, 'system_about_assets', 'public');
INSERT INTO system_column_details(table_uid, column_name, editable_in_ui) VALUES
 (118, 'filename', true), (118, 'system_about_id', true), (118, 'is_primary', true);
`

// replayDisposableDB starts an isolated PostgreSQL 16 cluster on a private socket.
func replayDisposableDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1")
	}
	root, err := os.MkdirTemp("", "fpr-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	socket := filepath.Join(root, "s")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v %s", name, err, output)
		}
	}
	data := filepath.Join(root, "db")
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "pg.log"), "-o", "-h '' -k '"+socket+"' -p 15462", "-w", "start")
	t.Cleanup(func() {
		_, _ = exec.Command(bin+"pg_ctl", "-D", data, "-m", "fast", "-w", "stop").CombinedOutput()
	})
	db, err := sql.Open("postgres", "host="+socket+" port=15462 user=test_owner dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	replayExec(t, db, replayFixtureSchema)
	specs, err := json.Marshal(dtt_asset_linking.BuildTargetInsertSpecs(
		dtt_asset_linking.BuildImageFileUploadConfig("system_about", 10, []string{"png", "jpg"}),
	))
	if err != nil {
		t.Fatal(err)
	}
	replayExec(t, db, `INSERT INTO system_foreign_key_relations_1_m VALUES (659, 118, 117, 'system_about_id', 'id', $1)`, string(specs))
	return db
}

// replayStorage points the runtime storage roots at a private installation.
func replayStorage(t *testing.T) runtimepaths.Paths {
	t.Helper()
	original := runtimepaths.Current()
	t.Cleanup(func() { _ = runtimepaths.Configure(original) })
	installation := t.TempDir()
	paths, err := runtimepaths.Resolve(filepath.Join(installation, "app"), installation, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	return paths
}

func replayExec(t *testing.T, db interface {
	Exec(string, ...interface{}) (sql.Result, error)
}, query string, args ...interface{}) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func replayWriteFile(t *testing.T, root string, relativePath string) {
	t.Helper()
	fullPath := filepath.Join(root, filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fullPath, []byte("stored picture"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func replayFileExists(root string, relativePath string) bool {
	info, err := os.Stat(filepath.Join(root, filepath.FromSlash(relativePath)))
	return err == nil && info.Mode().IsRegular()
}

func replayPreview(t *testing.T, db *sql.DB, parentID int64) string {
	t.Helper()
	var value sql.NullString
	if err := db.QueryRow(`SELECT cached_image FROM system_about WHERE id = $1`, parentID).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value.String
}

func replayRowCount(t *testing.T, db *sql.DB, where string, args ...interface{}) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM system_about_assets WHERE `+where, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func replayPNG(t *testing.T) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, 4, 3))
	for x := 0; x < 4; x++ {
		for y := 0; y < 3; y++ {
			picture.Set(x, y, color.RGBA{R: uint8(60 * x), G: uint8(80 * y), B: 200, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

// replayUpload runs the real upload writer for a direct gallery upload, as
// /api/add-row-multipart does after inserting the new asset row.
func replayUpload(t *testing.T, db *sql.DB, storageRoot string, parentID int64) (int64, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file_child_0", "kuva.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(replayPNG(t)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	form, err := multipart.NewReader(&body, writer.Boundary()).ReadForm(10 << 20)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = form.RemoveAll() })

	lazyTx := dbutils.NewLazyTx(db)
	ctx := dbutils.SetLazyTx(t.Context(), lazyTx)
	tx, err := lazyTx.Begin()
	if err != nil {
		t.Fatal(err)
	}
	var childID int64
	if err := tx.QueryRow(`INSERT INTO system_about_assets(system_about_id, asset_kind) VALUES ($1, 'image') RETURNING id`, parentID).Scan(&childID); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	if err := saveUploadedFiles(ctx, tx, recorder, form.File, storageRoot, "system_about_assets", "118", childID, nil); err != nil {
		_ = lazyTx.Rollback()
		t.Fatalf("upload failed: %v (%s)", err, recorder.Body.String())
	}
	if err := lazyTx.Commit(); err != nil {
		t.Fatal(err)
	}
	return childID, fmt.Sprintf("117_%d_%d.png", parentID, childID)
}

// replayRequest builds an authenticated administrator request for a handler.
func replayRequest(t *testing.T, target string, body string) *http.Request {
	t.Helper()
	originalStore, originalName := e_sessions.Store, e_sessions.SessionName
	store := sessions.NewCookieStore([]byte("test-secret-key-32-bytes-long!!"))
	store.Options = &sessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = store
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = originalStore
		e_sessions.SessionName = originalName
	})

	request := httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
	cookieRequest := httptest.NewRequest(http.MethodPost, target, nil)
	cookieRecorder := httptest.NewRecorder()
	session, err := store.Get(cookieRequest, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = 2
	session.Values["user_role"] = "admin"
	session.Values["username"] = "test_admin"
	if err := session.Save(cookieRequest, cookieRecorder); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range cookieRecorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	return request
}

// replayServe runs one handler in a request transaction the way the transaction
// middleware does, optionally as a restricted database role.
func replayServe(t *testing.T, db *sql.DB, databaseRole string, request *http.Request, serve func(http.ResponseWriter, *http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	lazyTx := dbutils.NewLazyTxWithBeginHook(db, func(tx *sql.Tx) error {
		if databaseRole == "" {
			return nil
		}
		_, err := tx.Exec(`SET LOCAL ROLE ` + pq.QuoteIdentifier(databaseRole))
		return err
	})
	ctx := dbutils.SetLazyTx(request.Context(), lazyTx)
	ctx = dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(2, "admin"))
	recorder := httptest.NewRecorder()
	serve(recorder, request.WithContext(ctx))
	if recorder.Code >= http.StatusBadRequest {
		_ = lazyTx.Rollback()
		return recorder
	}
	if err := lazyTx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return recorder
}

func replayDelete(t *testing.T, db *sql.DB, childID int64) {
	t.Helper()
	request := replayRequest(t, "/api/delete-rows?dataset=system_about_assets", fmt.Sprintf(`{"ids":[%d]}`, childID))
	recorder := replayServe(t, db, "", request, func(w http.ResponseWriter, r *http.Request) {
		dtt_1_row_delete.DeleteRowsHandler(w, r, "system_about_assets")
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("delete status = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func replayUpdate(t *testing.T, db *sql.DB, databaseRole string, body string) {
	t.Helper()
	request := replayRequest(t, "/api/update-row?dataset=system_about_assets", body)
	recorder := replayServe(t, db, databaseRole, request, func(w http.ResponseWriter, r *http.Request) {
		dtt_1_row_update.UpdateRowHandler(w, r, "system_about_assets")
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("update status = %d: %s", recorder.Code, recorder.Body.String())
	}
}

// On 23.9.2026 a test upload overwrote About row 4's only picture reference and
// deleting the upload then cleared it, although 117_4_4.jpg stayed on disk. Under the
// one card picture rule (K120) the upload no longer replaces the row's picture at all;
// only a primary mark does, and then the old picture is kept as the first gallery row.
func TestDisposableReplayUploadThenDeleteKeepsTheOnlyPreviewPicture(t *testing.T) {
	db := replayDisposableDB(t)
	paths := replayStorage(t)
	replayExec(t, db, `INSERT INTO system_about VALUES (4, '117_4_4.jpg')`)
	replayWriteFile(t, paths.StorageRoot, "117/4/original/117_4_4.jpg")
	replayWriteFile(t, paths.StorageRoot, "117/4/300/117_4_4.jpg")

	uploadID, uploadName := replayUpload(t, db, paths.StorageRoot, 4)
	if got := replayPreview(t, db, 4); got != "117_4_4.jpg" {
		t.Fatalf("preview after upload = %q, want About 4's own picture: the row already had one", got)
	}
	if !replayFileExists(paths.StorageRoot, "117/4/original/"+uploadName) {
		t.Fatal("the upload itself was not stored")
	}

	replayUpdate(t, db, "", fmt.Sprintf(`{"id":%d,"column":"is_primary","value":true}`, uploadID))
	if got := replayPreview(t, db, 4); got != uploadName {
		t.Fatalf("preview after marking the upload primary = %q, want %q", got, uploadName)
	}
	if got := replayRowCount(t, db, `system_about_id = 4 AND filename = '117_4_4.jpg' AND metadata_json->>'recovered_from' = 'cached_image'`); got != 1 {
		t.Fatalf("kept gallery rows for 117_4_4.jpg = %d, want 1", got)
	}

	replayDelete(t, db, uploadID)
	if got := replayPreview(t, db, 4); got != "117_4_4.jpg" {
		t.Fatalf("preview after deleting the upload = %q, want About 4's own 117_4_4.jpg", got)
	}
	if !replayFileExists(paths.StorageRoot, "117/4/original/117_4_4.jpg") || !replayFileExists(paths.StorageRoot, "117/4/300/117_4_4.jpg") {
		t.Fatal("About 4's picture left live storage")
	}
	if replayFileExists(paths.StorageRoot, "117/4/original/"+uploadName) || !replayFileExists(paths.StorageDeletedRoot, "117/4/original/"+uploadName) {
		t.Fatal("the deleted upload's file was not moved to deleted storage")
	}

	// A second row naming the same file is deleted: the kept row still shows it,
	// so the file must stay in live storage.
	var duplicateID int64
	if err := db.QueryRow(`INSERT INTO system_about_assets(system_about_id, filename) VALUES (4, '117_4_4.jpg') RETURNING id`).Scan(&duplicateID); err != nil {
		t.Fatal(err)
	}
	replayDelete(t, db, duplicateID)
	if !replayFileExists(paths.StorageRoot, "117/4/original/117_4_4.jpg") {
		t.Fatal("deleting one of two references moved the shared file")
	}
	if got := replayPreview(t, db, 4); got != "117_4_4.jpg" {
		t.Fatalf("preview = %q, want 117_4_4.jpg", got)
	}
}

func TestDisposableReplayUploadToParentWithPicturesKeepsTheGallerysFirst(t *testing.T) {
	db := replayDisposableDB(t)
	paths := replayStorage(t)
	replayExec(t, db, `INSERT INTO system_about VALUES (12, '117_12_3.jpg')`)
	replayExec(t, db, `INSERT INTO system_about_assets(system_about_id, filename, is_primary, created) VALUES (12, '117_12_3.jpg', false, now() - interval '1 day')`)
	replayWriteFile(t, paths.StorageRoot, "117/12/original/117_12_3.jpg")

	replayUpload(t, db, paths.StorageRoot, 12)
	if got := replayPreview(t, db, 12); got != "117_12_3.jpg" {
		t.Fatalf("preview = %q, want the gallery's first picture: an upload replaces the card picture only on a row without one (K120)", got)
	}
	if got := replayRowCount(t, db, `system_about_id = 12`); got != 2 {
		t.Fatalf("gallery rows = %d, want the old row and the upload only", got)
	}
}

func TestDisposableReplayRowEditRefreshesThePreviewOfEveryAffectedParent(t *testing.T) {
	db := replayDisposableDB(t)
	paths := replayStorage(t)
	replayExec(t, db, `INSERT INTO system_about VALUES (20, '117_20_1.png'), (21, NULL)`)
	replayExec(t, db, `INSERT INTO system_about_assets(id, system_about_id, filename) VALUES (101, 20, '117_20_1.png')`)
	// The old name stays on disk: collecting after the edit would keep it as a stale preview.
	replayWriteFile(t, paths.StorageRoot, "117/20/original/117_20_1.png")
	replayWriteFile(t, paths.StorageRoot, "117/20/original/117_20_2.png")

	replayUpdate(t, db, "", `{"id":101,"column":"filename","value":"117_20_2.png"}`)
	if got := replayPreview(t, db, 20); got != "117_20_2.png" {
		t.Fatalf("preview after renaming the picture = %q, want 117_20_2.png", got)
	}
	if got := replayRowCount(t, db, `filename = '117_20_1.png'`); got != 0 {
		t.Fatalf("the released old name was kept as %d gallery rows", got)
	}

	replayUpdate(t, db, "", `{"id":101,"column":"system_about_id","value":21}`)
	if got := replayPreview(t, db, 20); got != "" {
		t.Fatalf("preview of the parent the picture left = %q, want empty", got)
	}
	if got := replayPreview(t, db, 21); got != "117_20_2.png" {
		t.Fatalf("preview of the parent the picture joined = %q, want 117_20_2.png", got)
	}
}

// Marking a picture primary needs no right to insert gallery rows: without it the
// edit still succeeds and the only-copy preview simply stays.
func TestDisposableReplayMarkPrimaryWithoutInsertRightKeepsPreview(t *testing.T) {
	db := replayDisposableDB(t)
	paths := replayStorage(t)
	replayExec(t, db, `INSERT INTO system_about VALUES (30, '117_30_5.jpg')`)
	replayExec(t, db, `INSERT INTO system_about_assets(id, system_about_id, filename) VALUES (301, 30, '117_30_7.png')`)
	replayWriteFile(t, paths.StorageRoot, "117/30/original/117_30_5.jpg")
	replayExec(t, db, `CREATE ROLE gallery_editor`)
	replayExec(t, db, `GRANT SELECT ON system_db_tables, system_column_details, system_foreign_key_relations_1_m TO gallery_editor`)
	replayExec(t, db, `GRANT SELECT, UPDATE, DELETE ON system_about, system_about_assets TO gallery_editor`)

	replayUpdate(t, db, "gallery_editor", `{"id":301,"column":"is_primary","value":true}`)
	if got := replayPreview(t, db, 30); got != "117_30_5.jpg" {
		t.Fatalf("preview = %q, want the untouched only copy", got)
	}
	var primary bool
	if err := db.QueryRow(`SELECT is_primary FROM system_about_assets WHERE id = 301`).Scan(&primary); err != nil {
		t.Fatal(err)
	}
	if !primary {
		t.Fatal("the edit itself was lost")
	}
	if got := replayRowCount(t, db, `system_about_id = 30`); got != 1 {
		t.Fatalf("gallery rows = %d, want no kept row without the insert right", got)
	}
}
