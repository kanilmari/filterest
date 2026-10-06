// add_row_relation_keys_rollback_postgres_test.go
// Proves a late nested-reference refusal rolls back an entire request, including files.
// Connects the real insert/upload writers to WithLazyTransaction and its cleanup hooks.
// Reuses the non-id relation fixture; a fixture trigger invalidates the later child
// only after the earlier image has been stored, so rollback cannot pass vacuously.
package dtt_1_row_create

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/media_utils"
	"easelect/backend/core_components/middlewares"
)

func relationUploadForm(t *testing.T) *multipart.Form {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range []string{"file_child_0", "file_child_1"} {
		part, err := writer.CreateFormFile(field, "fixture.png")
		if err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(part, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	form, err := multipart.NewReader(&body, writer.Boundary()).ReadForm(1024 * 1024)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = form.RemoveAll() })
	return form
}

func relationUploadFiles(t *testing.T, root string) []string {
	t.Helper()
	var files []string
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			files = append(files, path)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return files
}

func relationRowsSnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var state string
	if err := db.QueryRow(`SELECT jsonb_build_object(
        'parents', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM review_notes r),
        'children', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM owned_docs r),
        'locations', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM owned_locations r),
        'linked', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM linked_children r),
        'text_linked', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM text_children r),
        'bridge', (SELECT jsonb_agg(to_jsonb(r) ORDER BY parent_key,tag_key) FROM key_bridge r),
        'null_bridge', (SELECT jsonb_agg(to_jsonb(r) ORDER BY parent_key,tag_key) FROM null_bridge r))::text`).Scan(&state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestLateNestedReferenceRefusalRollsBackRequestPostgres(t *testing.T) {
	for _, fault := range []string{"NULL", "missing row"} {
		t.Run(fault, func(t *testing.T) {
			db := relationKeysPostgres(t)
			originalBasic := backend.DbBasic
			backend.DbBasic = db
			defer func() { backend.DbBasic = originalBasic }()
			mutation := `UPDATE owned_docs SET parent_key=NULL WHERE parent_key=NEW.parent_key AND id<>NEW.id;`
			if fault == "missing row" {
				mutation = `DELETE FROM owned_docs WHERE parent_key=NEW.parent_key AND id<>NEW.id;`
			}
			// A site trigger changes the second stored child after the first upload's
			// filename write. This exercises the stored-row reader, not a mock error.
			raceExec(t, db, fmt.Sprintf(`
                UPDATE system_foreign_key_relations_1_m SET target_insert_specs=
                  '{"file_upload":{"enabled":true,"profile_key":"image","allowed_file_types":["png"],"asset_kinds":["image"],"filename_column":"filename","cache_targets":[{"table":"review_notes","column":"uploaded_filename"}]}}'
                  WHERE id=52;
                CREATE FUNCTION invalidate_later_upload() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN %s RETURN NEW; END $$;
                CREATE TRIGGER invalidate_later_upload AFTER UPDATE OF filename ON owned_docs
                  FOR EACH ROW WHEN (NEW.filename IS NOT NULL) EXECUTE FUNCTION invalidate_later_upload();
            `, mutation))
			before := relationRowsSnapshot(t, db)
			root := t.TempDir()
			form := relationUploadForm(t)
			payload := map[string]interface{}{
				"title": "refused after upload", "uploaded_filename": "original cache",
				"_childRows": []ChildRowPayload{
					{RelationID: 52, Data: map[string]interface{}{}},
					{RelationID: 52, Data: map[string]interface{}{}},
					{RelationID: 53, Data: map[string]interface{}{}},
				},
				"_existingLinks": []ExistingRelationLinkPayload{
					{RelationKind: existingRelationOneToMany, RelationID: 50, RowIDs: []int64{7}},
					{RelationKind: existingRelationOneToMany, RelationID: 51, RowIDs: []int64{8}},
					{RelationKind: existingRelationManyToMany, RelationID: 100, RowIDs: []int64{11}},
				},
			}
			earlierUploadVerified, laterRefused := false, false
			handler := middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tx, ok := dbutils.RequireTx(r.Context())
				if !ok {
					t.Fatal("request transaction did not start")
				}
				id, children, err := insertDataAccordingToPayload(w, r, "review_notes", "20", payload, tx)
				if err != nil {
					t.Fatalf("create before upload: %v", err)
				}
				// Singleton file maps force the earlier upload and cache write to finish
				// before the later upload. Both use this one request's real transaction.
				first := map[string][]*multipart.FileHeader{"file_child_0": form.File["file_child_0"]}
				if err := saveUploadedFiles(r.Context(), tx, w, first, root, "review_notes", "20", id, children); err != nil {
					t.Fatalf("earlier upload: %v", err)
				}
				var cacheChanged bool
				if err := tx.QueryRow(`SELECT p.uploaded_filename=d.filename AND p.uploaded_filename<>'original cache'
                    AND (SELECT uploaded_filename='untouched' FROM review_notes WHERE id=9044)
                    AND (SELECT count(*)=1 FROM key_bridge)
                    FROM review_notes p JOIN owned_docs d ON d.id=$2 WHERE p.id=$1`, id, children[0].ChildRowID).Scan(&cacheChanged); err != nil || !cacheChanged {
					t.Fatalf("earlier cache/bridge writes=%v error=%v", cacheChanged, err)
				}
				for _, subfolder := range media_utils.RequiredSubfolders {
					matches, err := filepath.Glob(filepath.Join(root, "20", fmt.Sprint(id), subfolder, "*.png"))
					if err != nil || len(matches) != 1 {
						t.Fatalf("earlier %s file missing: %v %v", subfolder, matches, err)
					}
				}
				earlierUploadVerified = true
				later := map[string][]*multipart.FileHeader{"file_child_1": form.File["file_child_1"]}
				laterRefused = saveUploadedFiles(r.Context(), tx, w, later, root, "review_notes", "20", id, children) != nil
			}))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, raceRequest(t))
			var refusal struct {
				LangKey string `json:"error_lang_key"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &refusal); err != nil || response.Code != http.StatusBadRequest || refusal.LangKey != "error_relation_reference_missing" || !earlierUploadVerified || !laterRefused {
				t.Fatalf("late translated refusal: earlier=%v later=%v status=%d body=%s error=%v", earlierUploadVerified, laterRefused, response.Code, response.Body, err)
			}
			// No explicit rollback here: the middleware must revert all rows/caches
			// and execute the real upload writer's original/derivative cleanup hooks.
			if after := relationRowsSnapshot(t, db); after != before {
				t.Fatalf("request left rows or caches: before=%s after=%s", before, after)
			}
			if files := relationUploadFiles(t, root); len(files) != 0 {
				t.Fatalf("request left original, derivative or temporary files: %v", files)
			}
		})
	}
}
