// add_row_relation_keys_test.go
// Verifies stored reference values, physical authorization scope and upload cache keys.
// Connects the existing queue driver to both stored-row readers and relation writers.
// Exists so generated, default and text keys cannot regress to physical row IDs.
package dtt_1_row_create

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/httpresponse"
)

func relationKeyTx(t *testing.T) *sql.Tx {
	t.Helper()
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	t.Cleanup(func() { _ = db.Close() })
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	return tx
}

func TestExistingLinksWriteStoredReferenceValues(t *testing.T) {
	for _, key := range []driver.Value{int64(9044), "parent-slug"} {
		t.Run("one-to-many "+fmt.Sprint(key), func(t *testing.T) {
			tx := relationKeyTx(t)
			pushQuery(queuedQuery{wantSQL: `SELECT * FROM "parents" WHERE id = $1`, wantArgs: []driver.Value{int64(44)},
				cols: []string{"id", "reference_key"}, rows: [][]driver.Value{{int64(44), key}}})
			pushQuery(queuedQuery{cols: []string{"table_name"}}) // Not a picture gallery.
			pushExec(queuedExec{wantSQL: `UPDATE "children" SET "parent_key" = $1 WHERE "id" = ANY($2) AND "parent_key" IS NULL`,
				wantArgs: []driver.Value{key, "{7,8}"}, rowsAffected: 2})
			if err := applyExistingLinks(tx, 44, []resolvedExistingLink{{Kind: existingRelationOneToMany,
				MainTableName: "parents", MainReferencedColumn: "reference_key", RelatedTableName: "children",
				RelatedForeignKey: "parent_key", RowIDs: []int64{7, 8}}}); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, orientation := range []struct{ main, other string }{{"parent_key", "tag_key"}, {"tag_key", "parent_key"}} {
		t.Run("bridge "+orientation.main, func(t *testing.T) {
			tx := relationKeyTx(t)
			pushQuery(queuedQuery{wantArgs: []driver.Value{int64(44)}, cols: []string{"reference_key"}, rows: [][]driver.Value{{"new-key"}}})
			pushQuery(queuedQuery{wantSQL: `SELECT * FROM "related" WHERE id = $1`, wantArgs: []driver.Value{int64(7)},
				cols: []string{"other_key"}, rows: [][]driver.Value{{[]byte("stored-text")}}})
			pushExec(queuedExec{wantSQL: `INSERT INTO "bridge" ("` + orientation.main + `", "` + orientation.other + `") VALUES ($1, $2)`,
				wantArgs: []driver.Value{"new-key", "stored-text"}, rowsAffected: 1})
			if err := applyExistingLinks(tx, 44, []resolvedExistingLink{{Kind: existingRelationManyToMany,
				MainTableName: "parents", MainReferencedColumn: "reference_key", RelatedTableName: "related", RelatedReferencedColumn: "other_key",
				BridgeTableName: "bridge", BridgeMainForeignKey: orientation.main, BridgeOtherForeignKey: orientation.other, RowIDs: []int64{7}}}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOwnedChildUsesStoredParentKey(t *testing.T) {
	tx := relationKeyTx(t)
	pushQuery(queuedQuery{cols: []string{"id", "table_uid"}, rows: [][]driver.Value{{int64(44), int64(9044)}}})
	pushQuery(queuedQuery{wantSQL: `INSERT INTO "children" ("parent_key") VALUES ($1) RETURNING id`, wantArgs: []driver.Value{int64(9044)},
		cols: []string{"id"}, rows: [][]driver.Value{{int64(12)}}})
	pushQuery(queuedQuery{cols: []string{"table_name"}})
	pushQuery(queuedQuery{cols: []string{"specs", "table", "column"}}) // No upload caches.
	id, err := insertSingleChildRow(tx, 44, ChildRowPayload{MainTableName: "parents", MainReferencedColumn: "table_uid",
		TableName: "children", ReferencingColumn: "parent_key", Data: map[string]interface{}{}}, nil)
	if err != nil || id != 12 {
		t.Fatalf("child id=%d error=%v", id, err)
	}
}

func TestMissingStoredKeyRefusesBeforeTheNextWrite(t *testing.T) {
	for _, fixture := range []queuedQuery{
		{cols: []string{"id"}, rows: [][]driver.Value{{int64(44)}}},
		{cols: []string{"reference_key"}, rows: [][]driver.Value{{nil}}},
		{cols: []string{"reference_key"}},
	} {
		tx := relationKeyTx(t)
		pushQuery(fixture)
		_, err := fetchInsertedTriggerSourceRow(context.Background(), tx, "parents", 44, "reference_key")
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.Status != 400 || !strings.Contains(refusal.Message, "parents.reference_key") {
			t.Fatalf("missing key refusal = %v", err)
		}
		response := httptest.NewRecorder()
		respondToSettingWriteError(response, err, "generic failure")
		if response.Code != 400 || !strings.Contains(response.Body.String(), "error_relation_reference_missing") {
			t.Fatalf("refusal response = %d %s", response.Code, response.Body.String())
		}
		_ = tx.Rollback()
	}
}

func TestIDReferenceUsesNoStoredRowQuery(t *testing.T) {
	row, err := fetchInsertedTriggerSourceRow(context.Background(), nil, "parents", 44, "id")
	if err != nil || row["id"] != int64(44) {
		t.Fatalf("id reference = %#v, %v", row, err)
	}
}

func TestExistingLinkAuthorizationStillChecksPhysicalIDs(t *testing.T) {
	tx := relationKeyTx(t)
	pushQuery(queuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}, wantArgs: []driver.Value{"/api/get-results", int64(4), "9001"}})
	pushQuery(queuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}, wantArgs: []driver.Value{"/api/add-row-multipart", int64(4), "9002"}})
	pushQuery(queuedQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(7)}}, wantArgs: []driver.Value{"{7}"},
		wantSQL: `SELECT "app_service_catalog"."id" FROM "app_service_catalog" WHERE "app_service_catalog"."id" = ANY($1) ORDER BY "app_service_catalog"."id" FOR KEY SHARE`})
	err := authorizeExistingLink(tx, resolvedExistingLink{Kind: existingRelationManyToMany, RelatedTableName: "app_service_catalog",
		RelatedTableUID: "9001", RelatedReferencedColumn: "slug", BridgeTableName: "bridge", BridgeTableUID: "9002", RowIDs: []int64{7}}, 4, "admin")
	if err != nil {
		t.Fatal(err)
	}
}

func TestStoredNestedUploadContextKeepsReferenceAndRejectsNULL(t *testing.T) {
	for _, includeKind := range []bool{false, true} {
		for _, value := range []driver.Value{int64(9044), []byte("parent-slug"), nil} {
			tx := relationKeyTx(t)
			fixture := queuedQuery{cols: []string{"parent_key"}, rows: [][]driver.Value{{value}}}
			if includeKind {
				fixture.cols = []string{"kind", "parent_key"}
				fixture.rows = [][]driver.Value{{"image", value}}
			}
			pushQuery(fixture)
			_, stored, err := loadStoredUploadRowContext(tx, "children", 12, "parent_key", includeKind, true)
			if value == nil {
				var refusal *httpresponse.Refusal
				if !errors.As(err, &refusal) {
					t.Fatalf("NULL nested upload reference = %v", err)
				}
			} else if err != nil || (stored != int64(9044) && stored != "parent-slug") {
				t.Fatalf("stored upload reference = %#v, %v", stored, err)
			}
			_ = tx.Rollback()
		}
	}
}

func TestNestedUploadCacheUsesStoredReference(t *testing.T) {
	for _, value := range []driver.Value{int64(9044), "parent-slug"} {
		t.Run(fmt.Sprint(value), func(t *testing.T) {
			tx := relationKeyTx(t)
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("file_child_0", "fixture.pdf")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = part.Write([]byte("%PDF-1.7\nsynthetic fixture\n"))
			_ = writer.Close()
			form, err := multipart.NewReader(&body, writer.Boundary()).ReadForm(1024)
			if err != nil {
				t.Fatal(err)
			}
			defer form.RemoveAll()
			specs := `{"file_upload":{"enabled":true,"profile_key":"attachment","allowed_file_types":["pdf"],"filename_column":"filename","cache_targets":[{"table":"parents","column":"uploaded_filename"}]}}`
			pushQuery(queuedQuery{cols: []string{"specs", "column"}, rows: [][]driver.Value{{[]byte(specs), "parent_key"}}})
			pushQuery(queuedQuery{wantSQL: `SELECT "parent_key" FROM "children" WHERE id = $1`, wantArgs: []driver.Value{int64(12)},
				cols: []string{"parent_key"}, rows: [][]driver.Value{{value}}})
			if value == int64(9044) {
				pushQuery(queuedQuery{cols: []string{"parent", "column", "specs"}}) // No shared storage relation.
			}
			pushQuery(queuedQuery{cols: []string{"parent"}}) // No gallery.
			pushQuery(queuedQuery{cols: []string{"specs", "table", "column"}, rows: [][]driver.Value{{specs, "parents", "reference_key"}}})
			pushExec(queuedExec{wantSQL: `UPDATE "children" SET filename=$1 WHERE id=$2`,
				wantArgs: []driver.Value{"20_44_12.pdf", int64(12)}, rowsAffected: 1})
			pushExec(queuedExec{wantSQL: `UPDATE "parents" SET "uploaded_filename" = $1 WHERE "reference_key" = $2`,
				wantArgs: []driver.Value{"20_44_12.pdf", value}, rowsAffected: 1})
			response := httptest.NewRecorder()
			err = saveUploadedFiles(context.Background(), tx, response, form.File, t.TempDir(), "parents", "20", 44,
				[]ChildInsertResult{{FieldKey: "file_child_0", TableName: "children", ReferencingColumn: "parent_key", ChildRowID: 12, MainRowID: 44}})
			if err != nil || len(execQueue) != 0 || len(queryQueue) != 0 {
				t.Fatalf("nested upload cache: %v; pending queries=%d writes=%d", err, len(queryQueue), len(execQueue))
			}
		})
	}
}

func TestResolveManyToManyReferenceColumns(t *testing.T) {
	tx := relationKeyTx(t)
	pushQuery(queuedQuery{cols: []string{"id", "bridge_uid", "bridge", "main_fk", "related_uid", "related", "other_fk", "main", "main_key", "other_key"},
		rows: [][]driver.Value{{int64(41), "9002", "bridge", "tag_key", "9001", "parents", "parent_key", "tags", "slug", "table_uid"}}})
	relation, err := resolveManyToManyExistingLink(tx, "9003", ExistingRelationLinkPayload{RelationID: 41, RowIDs: []int64{7}})
	if err != nil || relation.MainTableName != "tags" || relation.MainReferencedColumn != "slug" || relation.RelatedReferencedColumn != "table_uid" {
		t.Fatalf("resolved bridge = %#v, %v", relation, err)
	}
}

func TestResolveOwnedChildReferenceColumn(t *testing.T) {
	tx := relationKeyTx(t)
	pushQuery(queuedQuery{cols: []string{"child_uid", "child", "fk", "main", "key", "specs", "insert", "spatial"},
		rows: [][]driver.Value{{"9002", "children", "parent_key", "parents", "slug", `{"file_upload":{"enabled":true}}`, true, false}}})
	pushQuery(queuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}})
	children, err := resolveAndAuthorizeOwnedChildren(tx, "9001", []ChildRowPayload{{RelationID: 41, Data: map[string]interface{}{}}}, 4)
	if err != nil || len(children) != 1 || children[0].MainTableName != "parents" || children[0].MainReferencedColumn != "slug" {
		t.Fatalf("resolved children = %#v, %v", children, err)
	}
}
