// row_actor_lifecycle_postgres_test.go
// Exercises actor creation, request writes, refusals and CSV restore on PostgreSQL.
// Reuses the disposable cluster and shipped bootstrap of the ordered-column tests.
// Registry ids deliberately differ from table_uid so a wrong-key join cannot pass.
package dtt_crud_workflows_test

import (
	"bytes"
	"database/sql"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	devtools "easelect/backend/core_components/dev_tools"
	create "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtimepaths"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func TestRowActorLifecyclePostgres(t *testing.T) {
	db, _ := workflows.RegistrationDisposableDBForTest(t)
	workflows.LoadPublicBootstrapForTest(t, db)
	oldDB, oldBasic, oldGuest := backend.Db, backend.DbBasic, backend.DbGuest
	backend.Db, backend.DbBasic, backend.DbGuest = db, db, db
	t.Cleanup(func() { backend.Db, backend.DbBasic, backend.DbGuest = oldDB, oldBasic, oldGuest })
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store = sessions.NewCookieStore([]byte("actor-lifecycle-test-32-byte-key!!"))
	e_sessions.SessionName = "actor_test"
	t.Cleanup(func() { e_sessions.Store, e_sessions.SessionName = oldStore, oldName })
	mustExec := func(q string, args ...interface{}) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`INSERT INTO system_users(id,username,full_name,enabled) VALUES (42001,'actor_one','Actor One',true),(42002,'actor_two','Actor Two',true)`)
	// The stable uid has its own sequence; the unrelated registry id must stay
	// different even on a freshly generated bootstrap.
	mustExec(`SELECT setval('public.system_db_tables_id_seq',900000)`)
	rec := workflows.PostCreateDatasetForTest(t, db, `{"dataset_name":"wl58_notes","folder_id":4,"column_list":[{"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"}]}`)
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var registryID, uid, marks, hidden int
	if err := db.QueryRow(`SELECT id,table_uid FROM system_db_tables WHERE table_name='wl58_notes'`).Scan(&registryID, &uid); err != nil {
		t.Fatal(err)
	}
	if registryID == uid {
		t.Fatal("fixture did not separate registry keys")
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_row_actor_columns WHERE table_uid=$1`, uid).Scan(&marks); err != nil || marks != 2 {
		t.Fatalf("uid marks=%d err=%v", marks, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_column_details WHERE table_uid=$1 AND column_name IN ('created_by','owner_id') AND card_element='hidden' AND insertable=false AND editable_in_ui=false AND hide_in_filter_panel=true`, uid).Scan(&hidden); err != nil || hidden != 2 {
		t.Fatalf("hidden metadata=%d err=%v", hidden, err)
	}

	t.Run("side_table_refusal_and_ordinary_side_table", func(t *testing.T) {
		rec := workflows.PostCreateDatasetForTest(t, db, `{"dataset_name":"wl58_notes_history","folder_id":4,"column_list":[{"name":"id","data_type":"SERIAL"},{"name":"created_by","data_type":"BIGINT"}]}`)
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_reserved_owner_column") {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
		var exists bool
		if err := db.QueryRow(`SELECT to_regclass('public.wl58_notes_history') IS NOT NULL OR EXISTS(SELECT 1 FROM system_db_tables WHERE table_name='wl58_notes_history')`).Scan(&exists); err != nil || exists {
			t.Fatalf("refusal left state: %v %v", exists, err)
		}
		rec = workflows.PostCreateDatasetForTest(t, db, `{"dataset_name":"wl58_notes_history","folder_id":4,"column_list":[{"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"}]}`)
		if rec.Code != 201 {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='wl58_notes_history' AND column_name IN ('created_by','owner_id'))`).Scan(&exists); err != nil || exists {
			t.Fatalf("side table received actors: %v %v", exists, err)
		}
	})
	t.Run("declarations_and_accepted_foreign_key", func(t *testing.T) {
		rec := workflows.PostCreateDatasetForTest(t, db, `{"dataset_name":"wl58_declared","folder_id":4,"column_list":[{"name":"owner_id","data_type":"INTEGER","card_role":"username"},{"name":"id","data_type":"SERIAL"},{"name":"created_by","data_type":"BIGINT","card_role":"details"},{"name":"title","data_type":"TEXT"}],"foreign_keys":[{"referencing_column":"owner_id","referenced_dataset":"system_users","referenced_column":"id"}]}`)
		if rec.Code != 201 {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
		var columns, roles string
		if err := db.QueryRow(`SELECT string_agg(attname,',' ORDER BY attnum) FROM pg_attribute WHERE attrelid='wl58_declared'::regclass AND attnum>0 AND NOT attisdropped`).Scan(&columns); err != nil || columns != "id,title,created_by,owner_id" {
			t.Fatalf("%s %v", columns, err)
		}
		if err := db.QueryRow(`SELECT string_agg(column_name||':'||card_element,',' ORDER BY column_name) FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='wl58_declared') AND column_name IN ('created_by','owner_id')`).Scan(&roles); err != nil || roles != "created_by:details,owner_id:username" {
			t.Fatalf("%s %v", roles, err)
		}
	})

	root := t.TempDir()
	paths, err := runtimepaths.Resolve(root, root, false)
	if err != nil {
		t.Fatal(err)
	}
	oldPaths := runtimepaths.Current()
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtimepaths.Configure(oldPaths) })
	request := func(user int, body string, handler func(http.ResponseWriter, *http.Request)) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("POST", "/", strings.NewReader(body))
		session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
		if err != nil {
			t.Fatal(err)
		}
		role := "admin"
		if user == 1 {
			role = "guest"
		}
		session.Values["user_id"] = user
		session.Values["user_role"] = role
		ctx := dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(user, role))
		req = req.WithContext(ctx)
		rec := httptest.NewRecorder()
		middlewares.WithLazyTransaction(http.HandlerFunc(handler)).ServeHTTP(rec, req)
		return rec
	}
	add := func(user int, payload string) *httptest.ResponseRecorder {
		return request(user, "", func(w http.ResponseWriter, r *http.Request) {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			if err := form.WriteField("jsonPayload", payload); err != nil {
				t.Fatal(err)
			}
			if err := form.Close(); err != nil {
				t.Fatal(err)
			}
			r.Body = io.NopCloser(&body)
			r.Header.Set("Content-Type", form.FormDataContentType())
			create.AddRowMultipartHandler(w, r, "wl58_notes")
		})
	}
	for _, user := range []int{42001, 1} {
		rec := add(user, fmt.Sprintf(`{"title":"user_%d"}`, user))
		if rec.Code != 201 {
			t.Fatalf("stamp %d: %d %s", user, rec.Code, rec.Body)
		}
		var creator, owner sql.NullInt64
		if err := db.QueryRow(`SELECT created_by,owner_id FROM wl58_notes WHERE title=$1`, fmt.Sprintf("user_%d", user)).Scan(&creator, &owner); err != nil {
			t.Fatal(err)
		}
		if user == 1 {
			if creator.Valid || owner.Valid {
				t.Fatal("guest was stamped")
			}
		} else if !creator.Valid || !owner.Valid || creator.Int64 != int64(user) || owner.Int64 != int64(user) {
			t.Fatalf("%+v %+v", creator, owner)
		}
	}
	for _, column := range []string{"created_by", "owner_id"} {
		rec := add(42001, fmt.Sprintf(`{"title":"refused","%s":42002}`, column))
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_lang_key") {
			t.Fatalf("supplied actor: %d %s", rec.Code, rec.Body)
		}
		rec = request(42001, fmt.Sprintf(`{"id":1,"updates":[{"column":"title","value":"refused"},{"column":%q,"value":42002}]}`, column), func(w http.ResponseWriter, r *http.Request) { update.UpdateRowHandler(w, r, "wl58_notes") })
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_lang_key") {
			t.Fatalf("update: %d %s", rec.Code, rec.Body)
		}
	}
	rec = request(42001, fmt.Sprintf(`{"id":%d,"column":"row_policy_owner_column","value":"title"}`, registryID), func(w http.ResponseWriter, r *http.Request) { update.UpdateRowHandler(w, r, "system_db_tables") })
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "error_row_owner_setting_fixed") {
		t.Fatalf("setting: %d %s", rec.Code, rec.Body)
	}
	var refusedRows int
	if err := db.QueryRow(`SELECT count(*) FROM wl58_notes WHERE title='refused'`).Scan(&refusedRows); err != nil || refusedRows != 0 {
		t.Fatalf("refusal wrote: %d %v", refusedRows, err)
	}

	t.Run("restore_keeps_existing_actors_and_original_new_row_actors", func(t *testing.T) {
		dir := filepath.Join(root, "tables_data")
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, "wl58_notes.csv")
		if err := os.WriteFile(path, []byte("id,title,created_by,owner_id\n1,restored,42002,42002\n10,new,42002,42002\n11,invalid,1,-1\n12,missing,999999,999999\n"), 0600); err != nil {
			t.Fatal(err)
		}
		var counts devtools.CSVActorRepairCounts
		rec := request(42001, "", func(w http.ResponseWriter, r *http.Request) {
			tx, ok := dbutils.RequireTx(r.Context())
			if !ok {
				t.Fatal("no tx")
			}
			if _, _, err := devtools.ImportTableCSVTxWithUsername(tx, "wl58_notes", "test", &counts); err != nil {
				t.Fatal(err)
			}
		})
		if rec.Code != 200 || counts.Creator != 2 || counts.Owner != 2 {
			t.Fatalf("restore: %d %+v", rec.Code, counts)
		}
		for _, tc := range []struct{ id, actor int }{{1, 42001}, {10, 42002}, {11, 0}, {12, 0}} {
			var creator, owner sql.NullInt64
			if err := db.QueryRow(`SELECT created_by,owner_id FROM wl58_notes WHERE id=$1`, tc.id).Scan(&creator, &owner); err != nil {
				t.Fatal(err)
			}
			if tc.actor == 0 {
				if creator.Valid || owner.Valid {
					t.Fatal("invalid backup actor survived")
				}
			} else if !creator.Valid || !owner.Valid || creator.Int64 != int64(tc.actor) || owner.Int64 != int64(tc.actor) {
				t.Fatalf("row %d: %+v %+v", tc.id, creator, owner)
			}
		}
		if err := os.WriteFile(path, []byte("id,title\n13,no_actor_columns\n"), 0600); err != nil {
			t.Fatal(err)
		}
		request(42001, "", func(w http.ResponseWriter, r *http.Request) {
			tx, _ := dbutils.RequireTx(r.Context())
			if _, _, err := devtools.ImportTableCSVTxWithUsername(tx, "wl58_notes", "test"); err != nil {
				t.Fatal(err)
			}
		})
		var stamped bool
		if err := db.QueryRow(`SELECT created_by=42001 AND owner_id=42001 FROM wl58_notes WHERE id=13`).Scan(&stamped); err != nil || !stamped {
			t.Fatalf("restore default: %v %v", stamped, err)
		}
	})
	var failures int
	if err := db.QueryRow(`SELECT count(*) FROM public.app_check_row_actor_marks()`).Scan(&failures); err != nil || failures != 0 {
		t.Fatalf("actor final check: %d %v", failures, err)
	}
}
